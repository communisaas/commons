/**
 * Congress.gov API v3 Bill Ingestion
 *
 * Fetches, normalizes, and upserts US federal bills from Congress.gov.
 * Designed for chunked execution on CF Workers (N bills per cron invocation).
 *
 * API docs: https://api.congress.gov/
 * Rate limit: 5,000 requests/hour with API key
 * Canonical bill ID format: {chamber}-{number}-{congress} (e.g., hr-1234-119)
 */

import { db } from '$lib/core/db';
import type { BillIngestion, BillSponsor, IngestionCursor, IngestionResult } from './types';

const CONGRESS_API_BASE = 'https://api.congress.gov/v3';
const PAGE_SIZE = 250; // Congress.gov max per page
const DEFAULT_CHUNK_SIZE = 50; // Bills per cron invocation
const MAX_CONSECUTIVE_ERRORS = 3;

// Exponential backoff config
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/** Congress.gov API response shapes (subset of fields we use) */
interface CongressBillListResponse {
	bills: CongressBillSummary[];
	pagination: {
		count: number;
		next?: string;
	};
}

interface CongressBillSummary {
	congress: number;
	type: string; // "HR", "S", "HJRES", etc.
	number: number;
	title: string;
	latestAction?: {
		actionDate: string;
		text: string;
	};
	updateDate: string;
	url: string; // API detail URL
}

interface CongressBillDetail {
	bill: {
		congress: number;
		type: string;
		number: number;
		title: string;
		introducedDate: string;
		updateDate: string;
		originChamber: string;
		sponsors?: Array<{
			bioguideId: string;
			fullName: string;
			party: string;
			state: string;
		}>;
		cosponsors?: {
			count: number;
			url: string;
		};
		committees?: {
			url: string;
		};
		summaries?: {
			url: string;
		};
		actions?: {
			url: string;
		};
		policyArea?: {
			name: string;
		};
		subjects?: {
			url: string;
		};
		textVersions?: {
			url: string;
		};
		latestAction?: {
			actionDate: string;
			text: string;
		};
	};
}

interface CongressSummaryResponse {
	summaries: Array<{
		text: string;
		actionDate: string;
		versionCode: string;
	}>;
}

interface CongressCommitteeResponse {
	committees: Array<{
		name: string;
		chamber: string;
		type: string;
	}>;
}

interface CongressSubjectsResponse {
	subjects: {
		legislativeSubjects: Array<{ name: string }>;
		policyArea?: { name: string };
	};
}

interface CongressTextVersionsResponse {
	textVersions: Array<{
		type: string;
		date: string;
		formats: Array<{
			type: string;
			url: string;
		}>;
	}>;
}

function getApiKey(apiKey?: string): string {
	const key = apiKey ?? process.env.CONGRESS_API_KEY;
	if (!key) {
		throw new Error('CONGRESS_API_KEY environment variable not set');
	}
	return key;
}

/**
 * Fetch from Congress.gov API with retry + exponential backoff.
 * Returns null if the request fails after retries (allows caller to handle gracefully).
 */
async function fetchCongressApi<T>(path: string, retries = 3, apiKey?: string): Promise<T | null> {
	const resolvedKey = getApiKey(apiKey);
	const separator = path.includes('?') ? '&' : '?';
	const url = `${CONGRESS_API_BASE}${path}${separator}api_key=${resolvedKey}&format=json`;

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await fetch(url);

			if (response.status === 429) {
				// Rate limited — back off
				const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
				console.warn(`[congress-gov] Rate limited, backing off ${delay}ms (attempt ${attempt + 1})`);
				await new Promise((r) => setTimeout(r, delay));
				continue;
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			return (await response.json()) as T;
		} catch (error) {
			const isLast = attempt === retries - 1;
			if (isLast) {
				console.error(`[congress-gov] Failed after ${retries} attempts: ${path}`, error);
				return null;
			}
			const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
			console.warn(`[congress-gov] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	return null;
}

/**
 * Normalize Congress.gov bill type codes to lowercase chamber prefix.
 * HR/HRES/HJRES/HCONRES → "hr"/"hres"/"hjres"/"hconres"
 * S/SRES/SJRES/SCONRES → "s"/"sres"/"sjres"/"sconres"
 */
function normalizeBillType(type: string): string {
	return type.toLowerCase().replace(/\./g, '');
}

/**
 * Build canonical external ID: {chamber}-{number}-{congress}
 * e.g., hr-1234-119, s-567-119, hjres-12-119
 */
export function buildFederalBillId(type: string, number: number, congress: number): string {
	return `${normalizeBillType(type)}-${number}-${congress}`;
}

/**
 * Map Congress.gov latest action text to our bill status enum.
 * This is heuristic — Congress.gov doesn't have a clean status field.
 */
function inferStatus(latestAction?: { text: string }): string {
	if (!latestAction?.text) return 'introduced';

	const text = latestAction.text.toLowerCase();

	if (text.includes('became public law') || text.includes('signed by president')) return 'signed';
	if (text.includes('vetoed')) return 'vetoed';
	if (text.includes('passed house') || text.includes('passed senate')) return 'passed';
	if (text.includes('failed') || text.includes('rejected') || text.includes('not agreed to'))
		return 'failed';
	if (
		text.includes('placed on calendar') ||
		text.includes('cloture') ||
		text.includes('motion to proceed')
	)
		return 'floor';
	if (text.includes('referred to') || text.includes('committee')) return 'committee';

	return 'introduced';
}

/**
 * Map origin chamber string to our chamber field.
 */
function normalizeChamber(originChamber: string): 'house' | 'senate' | null {
	const lower = originChamber.toLowerCase();
	if (lower === 'house') return 'house';
	if (lower === 'senate') return 'senate';
	return null;
}

/**
 * Fetch and normalize a single bill's full details from Congress.gov.
 */
async function fetchBillDetail(
	summary: CongressBillSummary,
	apiKey?: string
): Promise<BillIngestion | null> {
	const billType = normalizeBillType(summary.type);
	const detailPath = `/bill/${summary.congress}/${billType}/${summary.number}`;

	const detail = await fetchCongressApi<CongressBillDetail>(detailPath, 3, apiKey);
	if (!detail?.bill) return null;

	const bill = detail.bill;

	// Fetch summary text (optional — may not exist for new bills)
	let summaryText: string | null = null;
	if (bill.summaries?.url) {
		const summaryPath = `/bill/${summary.congress}/${billType}/${summary.number}/summaries`;
		const summaryResp = await fetchCongressApi<CongressSummaryResponse>(summaryPath, 3, apiKey);
		if (summaryResp?.summaries?.length) {
			// Use the most recent summary, strip HTML tags
			const latest = summaryResp.summaries[summaryResp.summaries.length - 1];
			summaryText = latest.text.replace(/<[^>]*>/g, '').trim();
			// Truncate to ~6000 chars to stay within embedding token limits
			if (summaryText.length > 6000) {
				summaryText = summaryText.slice(0, 6000) + '...';
			}
		}
	}

	// Fetch committees (optional)
	const committees: string[] = [];
	if (bill.committees?.url) {
		const committeePath = `/bill/${summary.congress}/${billType}/${summary.number}/committees`;
		const committeeResp = await fetchCongressApi<CongressCommitteeResponse>(committeePath, 3, apiKey);
		if (committeeResp?.committees) {
			for (const c of committeeResp.committees) {
				committees.push(c.name);
			}
		}
	}

	// Fetch subjects/topics (optional)
	const topics: string[] = [];
	const entities: string[] = [];
	if (bill.subjects?.url) {
		const subjectPath = `/bill/${summary.congress}/${billType}/${summary.number}/subjects`;
		const subjectResp = await fetchCongressApi<CongressSubjectsResponse>(subjectPath, 3, apiKey);
		if (subjectResp?.subjects) {
			if (subjectResp.subjects.policyArea) {
				topics.push(subjectResp.subjects.policyArea.name);
			}
			for (const s of subjectResp.subjects.legislativeSubjects) {
				topics.push(s.name);
			}
		}
	} else if (bill.policyArea?.name) {
		topics.push(bill.policyArea.name);
	}

	// Extract sponsors
	const sponsors: BillSponsor[] = [];
	if (bill.sponsors) {
		for (const s of bill.sponsors) {
			sponsors.push({
				name: s.fullName,
				externalId: s.bioguideId,
				party: s.party || null
			});
		}
	}

	// Build source URL (public-facing, not API URL)
	const sourceUrl = `https://www.congress.gov/bill/${summary.congress}th-congress/${bill.originChamber?.toLowerCase() === 'senate' ? 'senate' : 'house'}-bill/${summary.number}`;

	// Full text URL (optional)
	let fullTextUrl: string | null = null;
	if (bill.textVersions?.url) {
		const textPath = `/bill/${summary.congress}/${billType}/${summary.number}/text`;
		const textResp = await fetchCongressApi<CongressTextVersionsResponse>(textPath, 3, apiKey);
		if (textResp?.textVersions?.length) {
			const latest = textResp.textVersions[textResp.textVersions.length - 1];
			const htmlFormat = latest.formats.find(
				(f) => f.type === 'Formatted Text' || f.type === 'PDF'
			);
			if (htmlFormat) fullTextUrl = htmlFormat.url;
		}
	}

	return {
		externalId: buildFederalBillId(summary.type, summary.number, summary.congress),
		jurisdiction: 'us-federal',
		jurisdictionLevel: 'federal',
		chamber: normalizeChamber(bill.originChamber || ''),
		title: bill.title,
		summary: summaryText,
		status: inferStatus(bill.latestAction),
		statusDate: new Date(bill.latestAction?.actionDate || bill.updateDate),
		sponsors,
		committees,
		sourceUrl,
		fullTextUrl,
		topics,
		entities
	};
}

/**
 * Upsert a normalized bill into the database.
 * Returns true if the bill status changed (for downstream alerting).
 */
export async function upsertBill(bill: BillIngestion): Promise<{ id: string; statusChanged: boolean }> {
	// Snapshot the previous status before the atomic upsert so we can detect changes.
	const existing = await db.bill.findUnique({
		where: { externalId: bill.externalId },
		select: { status: true }
	});

	const updateData = {
		title: bill.title,
		summary: bill.summary,
		status: bill.status,
		statusDate: bill.statusDate,
		sponsors: bill.sponsors as unknown as undefined,
		committees: bill.committees,
		sourceUrl: bill.sourceUrl,
		fullTextUrl: bill.fullTextUrl,
		topics: bill.topics,
		entities: bill.entities
	};

	const result = await db.bill.upsert({
		where: { externalId: bill.externalId },
		update: updateData,
		create: {
			externalId: bill.externalId,
			jurisdiction: bill.jurisdiction,
			jurisdictionLevel: bill.jurisdictionLevel,
			chamber: bill.chamber,
			...updateData
		}
	});

	const statusChanged = !existing || existing.status !== bill.status;
	return { id: result.id, statusChanged };
}

/**
 * Get the default cursor for a fresh ingestion (no prior state).
 */
export function defaultCursor(): IngestionCursor {
	return {
		offset: 0,
		lastSyncedAt: new Date(0).toISOString(),
		consecutiveErrors: 0
	};
}

/**
 * Run one chunk of Congress.gov bill ingestion.
 *
 * Fetches up to `chunkSize` bills starting from `cursor.offset`,
 * normalizes them, and upserts into the Bill table.
 *
 * @param cursor - Persisted cursor from previous invocation
 * @param chunkSize - Max bills to process this invocation (default 50)
 * @param congress - Congress number to sync (default: current 119th)
 * @returns Result with upsert counts and next cursor
 */
export async function ingestCongressBills(
	cursor: IngestionCursor,
	chunkSize: number = DEFAULT_CHUNK_SIZE,
	congress: number = 119,
	apiKey?: string
): Promise<IngestionResult> {
	const result: IngestionResult = {
		upserted: 0,
		statusChanged: 0,
		nextCursor: null,
		errors: []
	};

	// Fetch bill list page
	const listPath = `/bill/${congress}?offset=${cursor.offset}&limit=${PAGE_SIZE}&sort=updateDate+desc`;
	const listResp = await fetchCongressApi<CongressBillListResponse>(listPath, 3, apiKey);

	if (!listResp || !listResp.bills) {
		const errCount = cursor.consecutiveErrors + 1;
		result.errors.push(`Failed to fetch bill list (consecutive errors: ${errCount})`);

		if (errCount >= MAX_CONSECUTIVE_ERRORS) {
			result.errors.push(
				`Hit ${MAX_CONSECUTIVE_ERRORS} consecutive API errors. Manual intervention needed (bulk download fallback is future work).`
			);
		}

		// Persist error count, don't advance cursor
		result.nextCursor = JSON.stringify({
			...cursor,
			consecutiveErrors: errCount
		} satisfies IngestionCursor);

		return result;
	}

	// Reset consecutive errors on success
	const bills = listResp.bills;
	let processed = 0;

	for (const billSummary of bills) {
		if (processed >= chunkSize) break;

		try {
			const normalized = await fetchBillDetail(billSummary, apiKey);
			if (!normalized) {
				result.errors.push(
					`Failed to fetch detail for ${billSummary.type} ${billSummary.number}`
				);
				continue;
			}

			const { statusChanged } = await upsertBill(normalized);
			result.upserted++;
			if (statusChanged) result.statusChanged++;
			processed++;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			result.errors.push(`Error processing ${billSummary.type} ${billSummary.number}: ${msg}`);
		}
	}

	// Compute next cursor
	const newOffset = cursor.offset + processed;
	const hasMore = listResp.pagination?.next != null || bills.length === PAGE_SIZE;

	if (hasMore && processed > 0) {
		result.nextCursor = JSON.stringify({
			offset: newOffset,
			lastSyncedAt: new Date().toISOString(),
			consecutiveErrors: 0
		} satisfies IngestionCursor);
	} else {
		// Reached the end — reset to 0 for next full sync cycle
		result.nextCursor = JSON.stringify({
			offset: 0,
			lastSyncedAt: new Date().toISOString(),
			consecutiveErrors: 0
		} satisfies IngestionCursor);
	}

	console.log(
		`[congress-gov] Ingested ${result.upserted} bills (${result.statusChanged} status changes, ${result.errors.length} errors)`
	);

	return result;
}
