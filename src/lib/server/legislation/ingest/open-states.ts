/**
 * Open States API v3 Bill Ingestion
 *
 * Fetches, normalizes, and upserts US state bills from Open States.
 * Rate limit: 1,000 requests/day — budget carefully.
 *
 * Only ingests for states where active orgs exist (query org addresses).
 * Canonical state bill ID: {state}-{chamber}-{number}-{session}
 *   e.g., ca-sb-567-2026
 *
 * API docs: https://v3.openstates.org/docs
 */

import { db } from '$lib/core/db';
import { upsertBill } from './congress-gov';
import type { BillIngestion, BillSponsor, IngestionCursor, IngestionResult } from './types';

const OPEN_STATES_API_BASE = 'https://v3.openstates.org';
const DEFAULT_CHUNK_SIZE = 50;
const MAX_CONSECUTIVE_ERRORS = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/** Open States API response shapes */
interface OpenStatesBillListResponse {
	results: OpenStatesBill[];
	pagination: {
		per_page: number;
		page: number;
		max_page: number;
		total_items: number;
	};
}

interface OpenStatesBill {
	id: string; // openstates internal ID
	identifier: string; // e.g. "SB 567"
	title: string;
	session: string; // e.g. "2025-2026"
	classification: string[]; // ["bill"], ["resolution"], etc.
	subject: string[];
	abstracts: Array<{ abstract: string; note: string }>;
	from_organization: {
		name: string; // "Senate" | "House" | "Assembly"
		classification: string; // "upper" | "lower"
	};
	jurisdiction: {
		id: string; // "ocd-jurisdiction/country:us/state:ca/government"
		name: string; // "California"
		classification: string; // "state"
	};
	latest_action_date: string;
	latest_action_description: string;
	sponsorships: Array<{
		name: string;
		entity_type: string; // "person" | "organization"
		classification: string; // "primary" | "cosponsor"
		person: { id: string; name: string; party: string } | null;
	}>;
	actions: Array<{
		description: string;
		date: string;
		classification: string[];
		organization: { name: string };
	}>;
	sources: Array<{ url: string; note: string }>;
	versions: Array<{
		note: string;
		date: string;
		links: Array<{ url: string; media_type: string }>;
	}>;
	openstates_url: string;
}

function getApiKey(apiKey?: string): string {
	const key = apiKey ?? process.env.OPEN_STATES_API_KEY;
	if (!key) {
		throw new Error('OPEN_STATES_API_KEY environment variable not set');
	}
	return key;
}

/**
 * Fetch from Open States API with retry + exponential backoff.
 */
async function fetchOpenStatesApi<T>(path: string, retries = 3, apiKey?: string): Promise<T | null> {
	const resolvedKey = getApiKey(apiKey);
	const separator = path.includes('?') ? '&' : '?';
	const url = `${OPEN_STATES_API_BASE}${path}${separator}apikey=${resolvedKey}`;

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await fetch(url);

			if (response.status === 429) {
				const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
				console.warn(
					`[open-states] Rate limited, backing off ${delay}ms (attempt ${attempt + 1})`
				);
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
				console.error(`[open-states] Failed after ${retries} attempts: ${path}`, error);
				return null;
			}
			const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
			console.warn(`[open-states] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	return null;
}

/**
 * Extract 2-letter state code from Open States jurisdiction ID.
 * e.g., "ocd-jurisdiction/country:us/state:ca/government" → "ca"
 */
function extractStateCode(jurisdictionId: string): string {
	const match = jurisdictionId.match(/state:(\w{2})/);
	return match ? match[1] : 'unknown';
}

/**
 * Normalize Open States bill identifier to canonical chamber prefix.
 * "SB 567" → "sb", "HB 123" → "hb", "AB 456" → "ab"
 */
function normalizeBillIdentifier(identifier: string): { chamber: string; number: string } {
	// Remove spaces and dots, split into prefix and number
	const clean = identifier.replace(/\s+/g, '').replace(/\./g, '');
	const match = clean.match(/^([A-Za-z]+)(\d+)$/);
	if (!match) {
		return { chamber: 'bill', number: clean };
	}
	return { chamber: match[1].toLowerCase(), number: match[2] };
}

/**
 * Build canonical state bill external ID: {state}-{chamber}-{number}-{session}
 * e.g., ca-sb-567-2026
 */
export function buildStateBillId(
	stateCode: string,
	identifier: string,
	session: string
): string {
	const { chamber, number } = normalizeBillIdentifier(identifier);
	// Normalize session to just the year (take first 4 digits)
	const sessionYear = session.replace(/[^0-9]/g, '').slice(0, 4);
	return `${stateCode}-${chamber}-${number}-${sessionYear}`;
}

/**
 * Map Open States action classifications to our bill status enum.
 */
function inferStatusFromActions(
	actions: OpenStatesBill['actions'],
	latestDescription: string
): string {
	const desc = latestDescription.toLowerCase();

	if (desc.includes('signed by governor') || desc.includes('became law')) return 'signed';
	if (desc.includes('vetoed')) return 'vetoed';
	if (desc.includes('passed') && desc.includes('house') && desc.includes('senate')) return 'passed';
	if (desc.includes('failed') || desc.includes('died')) return 'failed';

	// Check action classifications for more precise mapping
	for (const action of actions.slice(-5)) {
		const classes = action.classification || [];
		if (classes.includes('became-law') || classes.includes('executive-signature')) return 'signed';
		if (classes.includes('executive-veto')) return 'vetoed';
		if (classes.includes('passage')) return 'passed';
		if (classes.includes('failure')) return 'failed';
		if (classes.includes('committee-passage') || classes.includes('reading-3')) return 'floor';
		if (classes.includes('referral-committee') || classes.includes('reading-1')) return 'committee';
	}

	if (desc.includes('committee') || desc.includes('referred')) return 'committee';
	if (desc.includes('floor') || desc.includes('third reading') || desc.includes('calendar'))
		return 'floor';

	return 'introduced';
}

/**
 * Map Open States organization classification to our chamber field.
 */
function normalizeChamber(classification: string): 'house' | 'senate' | null {
	if (classification === 'upper') return 'senate';
	if (classification === 'lower') return 'house';
	return null;
}

/**
 * Normalize an Open States bill to our BillIngestion type.
 */
function normalizeOpenStatesBill(bill: OpenStatesBill): BillIngestion {
	const stateCode = extractStateCode(bill.jurisdiction.id);
	const externalId = buildStateBillId(stateCode, bill.identifier, bill.session);

	// Extract summary from abstracts
	let summary: string | null = null;
	if (bill.abstracts?.length) {
		summary = bill.abstracts[0].abstract;
		if (summary && summary.length > 6000) {
			summary = summary.slice(0, 6000) + '...';
		}
	}

	// Extract sponsors
	const sponsors: BillSponsor[] = [];
	for (const s of bill.sponsorships || []) {
		if (s.entity_type === 'person') {
			sponsors.push({
				name: s.person?.name || s.name,
				externalId: s.person?.id || '',
				party: s.person?.party || null
			});
		}
	}

	// Source URL
	const sourceUrl = bill.openstates_url || (bill.sources?.[0]?.url ?? '');

	// Full text URL from versions
	let fullTextUrl: string | null = null;
	if (bill.versions?.length) {
		const latest = bill.versions[bill.versions.length - 1];
		const htmlLink = latest.links?.find(
			(l) => l.media_type === 'text/html' || l.media_type === 'application/pdf'
		);
		if (htmlLink) fullTextUrl = htmlLink.url;
	}

	return {
		externalId,
		jurisdiction: `us-state-${stateCode}`,
		jurisdictionLevel: 'state',
		chamber: normalizeChamber(bill.from_organization.classification),
		title: bill.title,
		summary,
		status: inferStatusFromActions(bill.actions || [], bill.latest_action_description || ''),
		statusDate: new Date(bill.latest_action_date),
		sponsors,
		committees: [], // Open States doesn't expose committee names in list endpoint
		sourceUrl,
		fullTextUrl,
		topics: bill.subject || [],
		entities: []
	};
}

/**
 * Get state codes where active orgs operate.
 * Uses TemplateJurisdiction state_code and DistrictCredential congressional_district
 * to determine which states have engaged users/orgs.
 * Only ingest bills for these states to conserve rate limits (1K req/day).
 */
async function getActiveStatesCodes(): Promise<string[]> {
	// Get state codes from template jurisdictions (orgs targeting state-level)
	const fromTemplates = await db.$queryRaw<Array<{ state: string }>>`
		SELECT DISTINCT LOWER(tj.state_code) as state
		FROM template_jurisdiction tj
		WHERE tj.state_code IS NOT NULL
		LIMIT 50
	`;

	// Get state codes from district credentials (2-letter prefix of "TX-18")
	const fromCredentials = await db.$queryRaw<Array<{ state: string }>>`
		SELECT DISTINCT LOWER(SUBSTRING(dc.congressional_district FROM 1 FOR 2)) as state
		FROM district_credential dc
		WHERE dc.congressional_district IS NOT NULL
		  AND dc.revoked_at IS NULL
		  AND dc.expires_at > NOW()
		LIMIT 50
	`;

	const stateSet = new Set<string>();
	for (const row of fromTemplates) {
		if (row.state && row.state.length === 2) stateSet.add(row.state);
	}
	for (const row of fromCredentials) {
		if (row.state && row.state.length === 2) stateSet.add(row.state);
	}

	return [...stateSet];
}

/**
 * Run one chunk of Open States bill ingestion.
 *
 * @param cursor - Persisted cursor from previous invocation
 * @param chunkSize - Max bills to process (default 50)
 * @returns Result with upsert counts and next cursor
 */
export async function ingestStateBills(
	cursor: IngestionCursor,
	chunkSize: number = DEFAULT_CHUNK_SIZE,
	apiKey?: string
): Promise<IngestionResult> {
	const result: IngestionResult = {
		upserted: 0,
		statusChanged: 0,
		nextCursor: null,
		errors: []
	};

	// Get states to sync
	const activeStates = await getActiveStatesCodes();
	if (activeStates.length === 0) {
		console.log('[open-states] No active states with orgs — skipping');
		result.nextCursor = JSON.stringify({
			offset: 0,
			lastSyncedAt: new Date().toISOString(),
			consecutiveErrors: 0
		} satisfies IngestionCursor);
		return result;
	}

	// Build jurisdiction filter for Open States
	// Only sync updated bills since last sync
	const updatedSince = cursor.lastSyncedAt || new Date(0).toISOString();
	const page = Math.floor(cursor.offset / 20) + 1; // Open States uses page-based pagination, default 20/page

	const jurisdictions = activeStates
		.map((s) => `ocd-jurisdiction/country:us/state:${s}/government`)
		.join('&jurisdiction=');

	const listPath = `/bills?jurisdiction=${jurisdictions}&updated_since=${updatedSince.split('T')[0]}&page=${page}&per_page=20&sort=updated_at&include=abstracts&include=sponsorships&include=actions&include=sources&include=versions`;

	const listResp = await fetchOpenStatesApi<OpenStatesBillListResponse>(listPath, 3, apiKey);

	if (!listResp || !listResp.results) {
		const errCount = cursor.consecutiveErrors + 1;
		result.errors.push(`Failed to fetch bill list (consecutive errors: ${errCount})`);

		if (errCount >= MAX_CONSECUTIVE_ERRORS) {
			result.errors.push(
				`Hit ${MAX_CONSECUTIVE_ERRORS} consecutive API errors. Will retry next cycle.`
			);
		}

		result.nextCursor = JSON.stringify({
			...cursor,
			consecutiveErrors: errCount
		} satisfies IngestionCursor);

		return result;
	}

	let processed = 0;

	for (const bill of listResp.results) {
		if (processed >= chunkSize) break;

		try {
			const normalized = normalizeOpenStatesBill(bill);
			const { statusChanged } = await upsertBill(normalized);
			result.upserted++;
			if (statusChanged) result.statusChanged++;
			processed++;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			result.errors.push(`Error processing ${bill.identifier}: ${msg}`);
		}
	}

	// Compute next cursor
	const pagination = listResp.pagination;
	const hasMore = pagination.page < pagination.max_page;

	if (hasMore && processed > 0) {
		result.nextCursor = JSON.stringify({
			offset: cursor.offset + processed,
			lastSyncedAt: cursor.lastSyncedAt, // Don't update until full cycle complete
			consecutiveErrors: 0
		} satisfies IngestionCursor);
	} else {
		// Cycle complete — reset
		result.nextCursor = JSON.stringify({
			offset: 0,
			lastSyncedAt: new Date().toISOString(),
			consecutiveErrors: 0
		} satisfies IngestionCursor);
	}

	console.log(
		`[open-states] Ingested ${result.upserted} state bills (${result.statusChanged} status changes, ${result.errors.length} errors) from ${activeStates.length} states`
	);

	return result;
}
