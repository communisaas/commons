/**
 * Congress.gov Vote Tracker
 *
 * Fetches roll call votes from Congress.gov API and creates
 * LegislativeAction rows for each member's vote on tracked bills.
 *
 * Only tracks votes on bills that exist in our Bill table.
 * Matches members by bioguide_id where possible.
 */

import { db } from '$lib/core/db';

const CONGRESS_API_BASE = 'https://api.congress.gov/v3';
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/** Congress.gov vote response shapes */
interface CongressVoteListResponse {
	votes: CongressVoteSummary[];
	pagination: {
		count: number;
		next?: string;
	};
}

interface CongressVoteSummary {
	congress: number;
	chamber: string; // "House" | "Senate"
	number: number; // Roll call number
	date: string;
	url: string; // API detail URL
	question: string;
	result: string;
	bill?: {
		congress: number;
		type: string;
		number: number;
	};
}

interface CongressVoteDetailResponse {
	vote: {
		congress: number;
		chamber: string;
		number: number;
		date: string;
		question: string;
		result: string;
		bill?: {
			congress: number;
			type: string;
			number: number;
			title: string;
		};
		votes: {
			memberVotes: {
				Yea?: CongressMemberVote[];
				Nay?: CongressMemberVote[];
				'Not Voting'?: CongressMemberVote[];
				Present?: CongressMemberVote[];
				// Senate uses different keys
				Yes?: CongressMemberVote[];
				No?: CongressMemberVote[];
			};
		};
	};
}

interface CongressMemberVote {
	bioguideId: string;
	fullName: string;
	party: string;
	state: string;
	district?: number;
}

function getApiKey(apiKey?: string): string {
	const key = apiKey ?? process.env.CONGRESS_API_KEY;
	if (!key) {
		throw new Error('CONGRESS_API_KEY environment variable not set');
	}
	return key;
}

/**
 * Fetch from Congress.gov API with retry.
 */
async function fetchCongressApi<T>(path: string, retries = 3, apiKey?: string): Promise<T | null> {
	const resolvedKey = getApiKey(apiKey);
	const separator = path.includes('?') ? '&' : '?';
	const url = `${CONGRESS_API_BASE}${path}${separator}api_key=${resolvedKey}&format=json`;

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await fetch(url);

			if (response.status === 429) {
				const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
				console.warn(
					`[vote-tracker] Rate limited, backing off ${delay}ms (attempt ${attempt + 1})`
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
				console.error(`[vote-tracker] Failed after ${retries} attempts: ${path}`, error);
				return null;
			}
			const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
			console.warn(`[vote-tracker] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	return null;
}

/**
 * Build canonical bill ID from vote's bill reference.
 * Must match the format used by congress-gov.ts ingestion.
 */
function buildBillIdFromVote(billRef: { congress: number; type: string; number: number }): string {
	const type = billRef.type.toLowerCase().replace(/\./g, '');
	return `${type}-${billRef.number}-${billRef.congress}`;
}

/**
 * Map vote position to our action enum.
 */
function mapVotePosition(
	position: 'yea' | 'nay' | 'not_voting' | 'present'
): 'voted_yes' | 'voted_no' | 'abstained' {
	switch (position) {
		case 'yea':
			return 'voted_yes';
		case 'nay':
			return 'voted_no';
		case 'not_voting':
		case 'present':
			return 'abstained';
	}
}

export interface VoteTrackingResult {
	votesProcessed: number;
	actionsCreated: number;
	skippedUntracked: number;
	errors: string[];
}

/**
 * Process a single roll call vote into LegislativeAction rows.
 *
 * Only processes votes on bills that exist in our Bill table.
 * Creates one LegislativeAction per member per vote.
 */
async function processVote(voteSummary: CongressVoteSummary, apiKey?: string): Promise<{
	actionsCreated: number;
	skipped: boolean;
	error: string | null;
}> {
	// Skip votes not tied to a bill
	if (!voteSummary.bill) {
		return { actionsCreated: 0, skipped: true, error: null };
	}

	const externalBillId = buildBillIdFromVote(voteSummary.bill);

	// Check if we're tracking this bill
	const bill = await db.bill.findUnique({
		where: { externalId: externalBillId },
		select: { id: true }
	});

	if (!bill) {
		return { actionsCreated: 0, skipped: true, error: null };
	}

	// Fetch vote detail with member votes
	const chamber = voteSummary.chamber.toLowerCase(); // "house" | "senate"
	const detailPath = `/${chamber === 'senate' ? 'senate' : 'house'}/vote/${voteSummary.congress}/${voteSummary.number}`;
	const detail = await fetchCongressApi<CongressVoteDetailResponse>(detailPath, 3, apiKey);

	if (!detail?.vote?.votes?.memberVotes) {
		return { actionsCreated: 0, skipped: false, error: `Failed to fetch vote detail: ${detailPath}` };
	}

	const memberVotes = detail.vote.votes.memberVotes;
	const voteDate = new Date(voteSummary.date);
	const sourceUrl = `https://www.congress.gov/congressional-record/vote?congress=${voteSummary.congress}&session=1&chamber=${chamber}&number=${voteSummary.number}`;

	// Collect all member votes with their positions
	const allVotes: Array<{ member: CongressMemberVote; position: 'yea' | 'nay' | 'not_voting' | 'present' }> = [];

	// Handle both House and Senate naming conventions
	const yeaMembers = memberVotes.Yea || memberVotes.Yes || [];
	const nayMembers = memberVotes.Nay || memberVotes.No || [];
	const notVotingMembers = memberVotes['Not Voting'] || [];
	const presentMembers = memberVotes.Present || [];

	for (const member of yeaMembers) allVotes.push({ member, position: 'yea' });
	for (const member of nayMembers) allVotes.push({ member, position: 'nay' });
	for (const member of notVotingMembers) allVotes.push({ member, position: 'not_voting' });
	for (const member of presentMembers) allVotes.push({ member, position: 'present' });

	// Build all (externalId, billId, action) tuples from the roll call
	const voteTuples = allVotes.map(({ member, position }) => ({
		externalId: member.bioguideId,
		name: member.fullName,
		action: mapVotePosition(position)
	}));

	// Batch lookup existing LegislativeAction records for this bill + date
	const existingActions = await db.legislativeAction.findMany({
		where: {
			billId: bill.id,
			occurredAt: voteDate,
			externalId: { in: voteTuples.map((t) => t.externalId) }
		},
		select: { externalId: true, action: true }
	});

	// Build dedup set of composite keys: "externalId|action"
	const existingKeys = new Set(
		existingActions.map((a) => `${a.externalId}|${a.action}`)
	);

	// Partition into creates (those not in existing set)
	const voteDetail = `${voteSummary.question} — ${voteSummary.result}`;
	const toCreate = voteTuples
		.filter((t) => !existingKeys.has(`${t.externalId}|${t.action}`))
		.map((t) => ({
			billId: bill.id,
			externalId: t.externalId,
			name: t.name,
			action: t.action,
			detail: voteDetail,
			sourceUrl,
			occurredAt: voteDate
		}));

	// Batch insert
	const { count: actionsCreated } = await db.legislativeAction.createMany({
		data: toCreate,
		skipDuplicates: true
	});

	return { actionsCreated, skipped: false, error: null };
}

/**
 * Track recent roll call votes from Congress.gov.
 *
 * Fetches recent votes, filters to bills we track, and creates
 * LegislativeAction rows for each member vote.
 *
 * @param congress - Congress number (default: 119)
 * @param chamber - "house" | "senate" | "both" (default: "both")
 * @param limit - Max votes to process (default: 20)
 * @returns Tracking result with counts
 */
export async function trackRecentVotes(
	congress: number = 119,
	chamber: 'house' | 'senate' | 'both' = 'both',
	limit: number = 20,
	apiKey?: string
): Promise<VoteTrackingResult> {
	const result: VoteTrackingResult = {
		votesProcessed: 0,
		actionsCreated: 0,
		skippedUntracked: 0,
		errors: []
	};

	const chambers = chamber === 'both' ? ['house', 'senate'] : [chamber];

	for (const ch of chambers) {
		const listPath = `/${ch}/vote/${congress}?limit=${limit}&sort=date+desc`;
		const listResp = await fetchCongressApi<CongressVoteListResponse>(listPath, 3, apiKey);

		if (!listResp?.votes) {
			result.errors.push(`Failed to fetch ${ch} vote list`);
			continue;
		}

		for (const vote of listResp.votes) {
			try {
				const voteResult = await processVote(vote, apiKey);

				if (voteResult.error) {
					result.errors.push(voteResult.error);
				} else if (voteResult.skipped) {
					result.skippedUntracked++;
				} else {
					result.votesProcessed++;
					result.actionsCreated += voteResult.actionsCreated;
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				result.errors.push(`Error processing vote ${ch}/${vote.number}: ${msg}`);
			}
		}
	}

	console.log(
		`[vote-tracker] Processed ${result.votesProcessed} votes, created ${result.actionsCreated} actions, skipped ${result.skippedUntracked} untracked, ${result.errors.length} errors`
	);

	return result;
}
