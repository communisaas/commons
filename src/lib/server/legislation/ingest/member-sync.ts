/**
 * Congress.gov Member Sync
 *
 * Fetches current Congress members via the Congress.gov API v3 members endpoint,
 * upserts DecisionMaker rows via ExternalId lookup by bioguideId, and marks
 * departed members as active=false.
 *
 * Designed for CF Workers context — uses `db` from '$lib/core/db' (ALS pattern).
 *
 * API docs: https://api.congress.gov/
 * Rate limit: 5,000 requests/hour with API key
 */

import { db } from '$lib/core/db';

const CONGRESS_API_BASE = 'https://api.congress.gov/v3';
const PAGE_SIZE = 250; // Congress.gov max per page

// Exponential backoff config (matches congress-gov.ts)
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/** Congress.gov member list response shape */
interface CongressMemberListResponse {
	members: CongressMemberSummary[];
	pagination: {
		count: number;
		next?: string;
	};
}

/** Individual member from the list endpoint */
interface CongressMemberSummary {
	bioguideId: string;
	name: string; // "lastName, firstName" format
	partyName: string; // "Democratic" | "Republican" | "Independent" | etc.
	state: string; // Full state name, e.g., "California"
	district?: number; // House district number (absent for senators)
	terms: {
		item: Array<{
			chamber: string; // "House of Representatives" | "Senate"
			startYear: number;
			endYear?: number;
		}>;
	};
	depiction?: {
		imageUrl: string;
		attribution: string;
	};
	url: string; // API detail URL
}

/** Result returned by syncCongressMembers */
export interface MemberSyncResult {
	created: number;
	updated: number;
	departed: number;
	errors: string[];
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
 * Matches the pattern in congress-gov.ts.
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
				console.warn(`[member-sync] Rate limited, backing off ${delay}ms (attempt ${attempt + 1})`);
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
				console.error(`[member-sync] Failed after ${retries} attempts: ${path}`, error);
				return null;
			}
			const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
			console.warn(`[member-sync] Attempt ${attempt + 1} failed, retrying in ${delay}ms`);
			await new Promise((r) => setTimeout(r, delay));
		}
	}
	return null;
}

/**
 * Parse Congress.gov name format "lastName, firstName" into parts.
 * Falls back gracefully for unexpected formats.
 */
function parseName(raw: string): { firstName: string | null; lastName: string } {
	const commaIdx = raw.indexOf(',');
	if (commaIdx > 0) {
		return {
			lastName: raw.slice(0, commaIdx).trim(),
			firstName: raw.slice(commaIdx + 1).trim() || null
		};
	}
	// No comma — treat the whole thing as lastName
	return { firstName: null, lastName: raw.trim() };
}

/**
 * Map full party name to abbreviation.
 * Congress.gov returns "Democratic", "Republican", "Independent", etc.
 */
function abbreviateParty(partyName: string): string | null {
	const lower = partyName.toLowerCase();
	if (lower.includes('democrat')) return 'D';
	if (lower.includes('republican')) return 'R';
	if (lower.includes('independent')) return 'I';
	if (lower.includes('libertarian')) return 'L';
	return partyName.charAt(0).toUpperCase() || null;
}

/**
 * Map US state name to two-letter code.
 * Congress.gov returns full state names in member responses.
 */
const STATE_CODES: Record<string, string> = {
	'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
	'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
	'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
	'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
	'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
	'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
	'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
	'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
	'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
	'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
	'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
	'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
	'wisconsin': 'WI', 'wyoming': 'WY',
	// Territories
	'american samoa': 'AS', 'district of columbia': 'DC', 'guam': 'GU',
	'northern mariana islands': 'MP', 'puerto rico': 'PR', 'virgin islands': 'VI'
};

function stateNameToCode(stateName: string): string | null {
	return STATE_CODES[stateName.toLowerCase()] ?? null;
}

/**
 * Sync current Congress members from Congress.gov API.
 *
 * - Paginates through all current members (~535 House + 100 Senate)
 * - Upserts DecisionMaker rows via ExternalId bioguide lookup
 * - Marks departed federal legislators as active=false
 * - Returns creation/update/departure counts
 */
export async function syncCongressMembers(apiKey?: string): Promise<MemberSyncResult> {
	const result: MemberSyncResult = {
		created: 0,
		updated: 0,
		departed: 0,
		errors: []
	};

	// Ensure US House and US Senate Institution rows exist
	const [house, senate] = await Promise.all([
		db.institution.upsert({
			where: { type_name_jurisdiction: { type: 'legislature', name: 'U.S. House of Representatives', jurisdiction: 'US' } },
			create: { type: 'legislature', name: 'U.S. House of Representatives', jurisdiction: 'US', jurisdictionLevel: 'federal' },
			update: {}
		}),
		db.institution.upsert({
			where: { type_name_jurisdiction: { type: 'legislature', name: 'U.S. Senate', jurisdiction: 'US' } },
			create: { type: 'legislature', name: 'U.S. Senate', jurisdiction: 'US', jurisdictionLevel: 'federal' },
			update: {}
		})
	]);

	// Phase 1: Collect all members from paginated API
	const allMembers: CongressMemberSummary[] = [];
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const resp = await fetchCongressApi<CongressMemberListResponse>(
			`/member?limit=${PAGE_SIZE}&offset=${offset}&currentMember=true`,
			3,
			apiKey
		);

		if (!resp || !resp.members) {
			result.errors.push(`Failed to fetch member list at offset ${offset}`);
			break;
		}

		allMembers.push(...resp.members);
		hasMore = resp.pagination?.next != null;
		offset += PAGE_SIZE;
	}

	// Phase 2: Batch lookup all existing bioguide ExternalIds
	const allBioguides = allMembers.map((m) => m.bioguideId);
	const existingExternalIds = await db.externalId.findMany({
		where: { system: 'bioguide', value: { in: allBioguides } },
		select: { value: true, decisionMakerId: true }
	});
	const existingMap = new Map(existingExternalIds.map((e) => [e.value, e.decisionMakerId]));

	// Phase 3: Partition into updates vs creates
	const currentDmIds = new Set<string>();
	const now = new Date();

	type MemberData = {
		bioguideId: string;
		data: {
			name: string;
			firstName: string | null;
			lastName: string;
			party: string | null;
			jurisdiction: string | null;
			jurisdictionLevel: string;
			district: string | null;
			title: string;
			institutionId: string;
			photoUrl: string | null;
			active: boolean;
			termStart: Date | null;
			termEnd: Date | null;
			lastSyncedAt: Date;
		};
	};

	const toUpdate: Array<MemberData & { dmId: string }> = [];
	const toCreate: MemberData[] = [];

	for (const member of allMembers) {
		try {
			const { firstName, lastName } = parseName(member.name);
			const stateCode = stateNameToCode(member.state);
			const party = abbreviateParty(member.partyName);

			const chamber = member.district != null ? 'house' : 'senate';
			const institutionId = chamber === 'house' ? house.id : senate.id;
			const title = chamber === 'senate' ? 'Senator' : 'Representative';

			const terms = member.terms?.item ?? [];
			const latestTerm = terms[terms.length - 1];
			const termStart = latestTerm?.startYear
				? new Date(`${latestTerm.startYear}-01-03`)
				: null;
			const termEnd = latestTerm?.endYear
				? new Date(`${latestTerm.endYear}-01-03`)
				: null;

			const data = {
				name: `${firstName ?? ''} ${lastName}`.trim(),
				firstName,
				lastName,
				party,
				jurisdiction: stateCode,
				jurisdictionLevel: 'federal',
				district: member.district != null ? String(member.district) : null,
				title,
				institutionId,
				photoUrl: member.depiction?.imageUrl ?? null,
				active: true,
				termStart,
				termEnd,
				lastSyncedAt: now
			};

			const existingDmId = existingMap.get(member.bioguideId);
			if (existingDmId) {
				toUpdate.push({ bioguideId: member.bioguideId, data, dmId: existingDmId });
				currentDmIds.add(existingDmId);
			} else {
				toCreate.push({ bioguideId: member.bioguideId, data });
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			result.errors.push(`Error preparing member ${member.bioguideId}: ${msg}`);
		}
	}

	// Phase 4: Batch update existing members in chunked transactions
	if (toUpdate.length > 0) {
		try {
			const CHUNK_SIZE = 50;
			for (let i = 0; i < toUpdate.length; i += CHUNK_SIZE) {
				const chunk = toUpdate.slice(i, i + CHUNK_SIZE);
				await db.$transaction(
					chunk.map((m) =>
						db.decisionMaker.update({
							where: { id: m.dmId },
							data: m.data
						})
					)
				);
			}
			result.updated = toUpdate.length;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			result.errors.push(`Error batch-updating members: ${msg}`);
		}
	}

	// Phase 5: Atomically create DecisionMaker + ExternalId in a single transaction
	if (toCreate.length > 0) {
		try {
			await db.$transaction(async (tx) => {
				for (const m of toCreate) {
					const dm = await tx.decisionMaker.create({
						data: { type: 'legislator', ...m.data },
						select: { id: true }
					});
					await tx.externalId.create({
						data: {
							decisionMakerId: dm.id,
							system: 'bioguide',
							value: m.bioguideId
						}
					});
					currentDmIds.add(dm.id);
				}
			});
			result.created = toCreate.length;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			result.errors.push(`Error batch-creating members: ${msg}`);
		}
	}

	// Phase 6: Mark departed federal legislators with circuit breaker
	if (currentDmIds.size > 0) {
		try {
			const totalActive = await db.decisionMaker.count({
				where: { type: 'legislator', jurisdictionLevel: 'federal', active: true }
			});
			const wouldDeactivate = totalActive - currentDmIds.size;

			if (result.errors.length > 0) {
				result.errors.push('Skipping departed marking — API fetch had errors');
			} else if (wouldDeactivate > totalActive * 0.1) {
				result.errors.push(
					`Circuit breaker: would deactivate ${wouldDeactivate}/${totalActive} legislators — aborting departed marking`
				);
			} else {
				const currentIds = Array.from(currentDmIds);
				const departedCount = await db.$executeRaw`
					UPDATE "decision_maker" SET "active" = false
					WHERE "active" = true AND "type" = 'legislator' AND "jurisdiction_level" = 'federal'
						AND "id" NOT IN (SELECT unnest(${currentIds}::text[]))
				`;
				result.departed = departedCount;
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			result.errors.push(`Error marking departed members: ${msg}`);
		}
	}

	console.log(
		`[member-sync] Synced ${result.created} created, ${result.updated} updated, ${result.departed} departed (${result.errors.length} errors)`
	);

	return result;
}

/**
 * Backfill decisionMakerId on LegislativeAction rows that have an externalId
 * (bioguide ID) but no decisionMakerId yet.
 *
 * Called as Step 7 in the legislation-sync cron after member sync.
 */
export async function backfillActionDecisionMakerIds(): Promise<{ linked: number }> {
	const result = await db.$executeRaw`
		UPDATE "legislative_action" la
		SET "decision_maker_id" = ei."decision_maker_id"
		FROM "external_id" ei
		WHERE ei."system" = 'bioguide' AND ei."value" = la."external_id"
			AND la."decision_maker_id" IS NULL
			AND la."external_id" IS NOT NULL
	`;

	if (result > 0) {
		console.log(`[member-sync] Backfilled ${result} LegislativeAction.decisionMakerId links`);
	}

	return { linked: result };
}
