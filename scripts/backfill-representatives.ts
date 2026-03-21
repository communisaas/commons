/**
 * Backfill Representatives from existing data.
 *
 * 1. Creates Representative rows from LegislativeAction.externalId + name
 * 2. Creates Representative rows from Bill.sponsors JSON
 * 3. Links LegislativeAction.representativeId via bioguideId match
 * 4. Links AccountabilityReceipt.representativeId via bioguideId match
 *
 * This is a one-time migration script — safe to re-run (idempotent).
 * Runs in Node.js (not CF Workers), so uses PrismaClient directly.
 *
 * Usage: npx tsx scripts/backfill-representatives.ts
 */

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/**
 * Parse a name string into firstName/lastName.
 *
 * Handles common formats:
 *   "Smith" → { firstName: null, lastName: "Smith" }
 *   "John Smith" → { firstName: "John", lastName: "Smith" }
 *   "Smith, John" → { firstName: "John", lastName: "Smith" }
 *   "Rep. John A. Smith" → { firstName: "John A.", lastName: "Smith" }
 */
function parseName(raw: string): { firstName: string | null; lastName: string } {
	const trimmed = raw.trim();

	// "lastName, firstName" format (Congress.gov style)
	const commaIdx = trimmed.indexOf(',');
	if (commaIdx > 0) {
		return {
			lastName: trimmed.slice(0, commaIdx).trim(),
			firstName: trimmed.slice(commaIdx + 1).trim() || null
		};
	}

	// Strip common prefixes
	const cleaned = trimmed
		.replace(/^(Rep\.|Sen\.|Representative|Senator|Del\.|Delegate)\s+/i, '')
		.trim();

	const parts = cleaned.split(/\s+/);
	if (parts.length === 1) {
		return { firstName: null, lastName: parts[0] };
	}

	// Last token is lastName, everything else is firstName
	const lastName = parts[parts.length - 1];
	const firstName = parts.slice(0, -1).join(' ');
	return { firstName, lastName };
}

async function main() {
	console.log('[backfill] Starting representative backfill...');

	let totalCreated = 0;

	// Step 1: Collect unique bioguide IDs from LegislativeAction
	console.log('[backfill] Step 1: Scanning LegislativeAction for bioguide IDs...');
	const actionBioguides = await db.$queryRaw<
		Array<{ external_id: string; name: string }>
	>`
		SELECT DISTINCT external_id, name
		FROM legislative_action
		WHERE external_id IS NOT NULL
			AND external_id != ''
	`;
	console.log(`[backfill]   Found ${actionBioguides.length} unique bioguide IDs from actions`);

	// Step 2: Collect unique bioguide IDs from Bill.sponsors JSON
	console.log('[backfill] Step 2: Scanning Bill.sponsors for bioguide IDs...');
	const sponsorBioguides = await db.$queryRaw<
		Array<{ bioguide_id: string; name: string }>
	>`
		SELECT DISTINCT
			sponsor->>'externalId' AS bioguide_id,
			sponsor->>'name' AS name
		FROM bill,
			jsonb_array_elements(sponsors) AS sponsor
		WHERE sponsors IS NOT NULL
			AND sponsor->>'externalId' IS NOT NULL
			AND sponsor->>'externalId' != ''
	`;
	console.log(`[backfill]   Found ${sponsorBioguides.length} unique bioguide IDs from sponsors`);

	// Merge into a deduplicated map: bioguideId → name
	const bioguideMap = new Map<string, string>();
	for (const row of actionBioguides) {
		bioguideMap.set(row.external_id, row.name);
	}
	for (const row of sponsorBioguides) {
		if (!bioguideMap.has(row.bioguide_id)) {
			bioguideMap.set(row.bioguide_id, row.name);
		}
	}
	console.log(`[backfill]   ${bioguideMap.size} unique bioguide IDs total`);

	// Step 3: Create Representative rows for IDs not already in the table
	console.log('[backfill] Step 3: Creating Representative rows...');
	const existingBioguides = await db.$queryRaw<Array<{ bioguide_id: string }>>`
		SELECT bioguide_id FROM representatives
	`;
	const existingSet = new Set(existingBioguides.map((r) => r.bioguide_id));

	for (const [bioguideId, name] of bioguideMap) {
		if (existingSet.has(bioguideId)) continue;

		const { firstName, lastName } = parseName(name);
		try {
			await db.$executeRaw`
				INSERT INTO representatives (id, bioguide_id, name, first_name, last_name, in_office, created_at, updated_at)
				VALUES (
					gen_random_uuid()::text,
					${bioguideId},
					${name},
					${firstName},
					${lastName},
					true,
					NOW(),
					NOW()
				)
				ON CONFLICT (bioguide_id) DO NOTHING
			`;
			totalCreated++;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[backfill]   Error creating rep ${bioguideId}: ${msg}`);
		}
	}
	console.log(`[backfill]   Created ${totalCreated} Representative rows`);

	// Step 4: Bulk update LegislativeAction.representativeId
	console.log('[backfill] Step 4: Linking LegislativeAction.representativeId...');
	const actionsLinked = await db.$executeRaw`
		UPDATE legislative_action la
		SET representative_id = r.id
		FROM representatives r
		WHERE la.external_id = r.bioguide_id
			AND la.representative_id IS NULL
			AND la.external_id IS NOT NULL
	`;
	console.log(`[backfill]   Linked ${actionsLinked} LegislativeAction rows`);

	// Step 5: Bulk update AccountabilityReceipt.representativeId
	console.log('[backfill] Step 5: Linking AccountabilityReceipt.representativeId...');
	const receiptsLinked = await db.$executeRaw`
		UPDATE accountability_receipt ar
		SET representative_id = r.id
		FROM representatives r
		WHERE ar.bioguide_id = r.bioguide_id
			AND ar.representative_id IS NULL
	`;
	console.log(`[backfill]   Linked ${receiptsLinked} AccountabilityReceipt rows`);

	console.log('[backfill] Done.');
	console.log(`[backfill] Summary: ${totalCreated} reps created, ${actionsLinked} actions linked, ${receiptsLinked} receipts linked`);

	await db.$disconnect();
}

main().catch((err) => {
	console.error('[backfill] Fatal error:', err);
	process.exit(1);
});
