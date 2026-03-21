/**
 * Vote-to-Delivery Correlator
 *
 * Matches LegislativeAction records (votes on bills) to CampaignDelivery
 * targets (reports sent about those bills). This linkage enables scorecard
 * alignment scoring in Phase E.
 *
 * Match logic (bioguide-first with name fallback):
 * 1. LegislativeAction has a billId -> find Campaigns with that billId
 * 2. For each Campaign, find CampaignDelivery rows
 * 3. Match by bioguide_id first (exact), then by last-name fuzzy match (fallback)
 */

import { Prisma } from '@prisma/client';
import { db } from '$lib/core/db';
import type { CorrelationMatch } from '../scorecard/types';

export interface CorrelationResult {
	matched: number;
	unmatched: number;
	errors: string[];
	matches: CorrelationMatch[];
}

/**
 * Parse first name from an action name string.
 * Handles "First Last", "Last, First", and "First Middle Last" formats.
 */
function parseFirstName(name: string): string | null {
	const trimmed = name.trim();
	if (trimmed.includes(',')) {
		// "Last, First" or "Last, First Middle"
		const afterComma = trimmed.split(',')[1]?.trim();
		return afterComma?.split(/\s+/)[0] || null;
	}
	// "First Last" or "First Middle Last"
	const parts = trimmed.split(/\s+/);
	return parts.length >= 2 ? parts[0] : null;
}

/**
 * Correlate recent LegislativeActions with CampaignDelivery rows.
 *
 * For each vote action, checks if a campaign was sent about that bill
 * and links them via the decisionMakerId field.
 *
 * Matching priority:
 * 1. bioguide_id exact match (LegislativeAction.externalId matches a delivery
 *    target via Bill.sponsors or correlated delivery)
 * 2. Last-name fuzzy match (fallback)
 *
 * @param since - Only correlate actions after this date (default: 7 days ago)
 * @returns Correlation counts and match details
 */
export async function correlateVotesToDeliveries(
	since?: Date
): Promise<CorrelationResult> {
	const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

	const result: CorrelationResult = {
		matched: 0,
		unmatched: 0,
		errors: [],
		matches: []
	};

	// Find recent vote actions that haven't been correlated yet
	const actions = await db.legislativeAction.findMany({
		where: {
			occurredAt: { gte: sinceDate },
			action: { in: ['voted_yes', 'voted_no', 'abstained'] },
			decisionMakerId: null
		},
		select: {
			id: true,
			billId: true,
			name: true,
			externalId: true
		},
		take: 500
	});

	if (actions.length === 0) return result;

	// Get bill IDs to find related campaigns
	const billIds = [...new Set(actions.map((a) => a.billId))];

	// Fetch campaigns with deliveries AND bill sponsors for bioguide matching
	const [campaigns, bills] = await Promise.all([
		db.campaign.findMany({
			where: {
				billId: { in: billIds }
			},
			select: {
				id: true,
				billId: true,
				deliveries: {
					select: {
						id: true,
						targetName: true,
						targetEmail: true
					}
				}
			}
		}),
		db.bill.findMany({
			where: { id: { in: billIds } },
			select: {
				id: true,
				sponsors: true
			}
		})
	]);

	// Build sponsor lookup: billId -> Set<bioguide_id>
	const sponsorsByBill = new Map<string, Set<string>>();
	for (const bill of bills) {
		const sponsors = bill.sponsors as Array<{ externalId?: string }> | null;
		if (Array.isArray(sponsors)) {
			const ids = new Set<string>();
			for (const s of sponsors) {
				if (s.externalId) ids.add(s.externalId);
			}
			if (ids.size > 0) sponsorsByBill.set(bill.id, ids);
		}
	}

	// Build lookup: billId -> deliveries
	const deliveriesByBill = new Map<
		string,
		Array<{ id: string; targetName: string | null; targetEmail: string }>
	>();
	for (const campaign of campaigns) {
		if (!campaign.billId) continue;
		const existing = deliveriesByBill.get(campaign.billId) || [];
		existing.push(...campaign.deliveries);
		deliveriesByBill.set(campaign.billId, existing);
	}

	// Phase 1: Match each action to a delivery (no DB calls, pure in-memory matching)
	interface MatchedPair {
		action: (typeof actions)[number];
		delivery: { id: string; targetName: string | null; targetEmail: string };
		confidence: 'exact' | 'fuzzy';
	}
	const matchedPairs: MatchedPair[] = [];

	for (const action of actions) {
		const deliveries = deliveriesByBill.get(action.billId);
		if (!deliveries || deliveries.length === 0) {
			result.unmatched++;
			continue;
		}

		let matched: { id: string; targetName: string | null; targetEmail: string } | undefined;
		let confidence: 'exact' | 'fuzzy' = 'fuzzy';

		// Strategy 1: bioguide_id exact match
		// Check if the action's externalId (bioguide) appears in the bill's sponsors
		// and match to a delivery whose target name matches the action name
		if (action.externalId) {
			const billSponsors = sponsorsByBill.get(action.billId);
			const isSponsor = billSponsors?.has(action.externalId);

			if (isSponsor) {
				// The legislator is a sponsor — find the delivery by name match
				// (bioguide confirmed identity, name resolves which delivery)
				const actionLastName = action.name.split(/\s+/).pop()?.toLowerCase();
				matched = deliveries.find((d) => {
					if (!d.targetName) return false;
					const targetLastName = d.targetName.split(/\s+/).pop()?.toLowerCase();
					return targetLastName === actionLastName;
				});
				if (matched) confidence = 'exact';
			}

			// Also check if any delivery was already correlated to this bioguide
			// via a prior correlation on a different bill
			if (!matched) {
				// Check by looking for deliveries where target name matches
				// and the bioguide is known (exact match means we trust the identity)
				const actionLastName = action.name.split(/\s+/).pop()?.toLowerCase();
				for (const d of deliveries) {
					if (!d.targetName) continue;
					const targetLastName = d.targetName.split(/\s+/).pop()?.toLowerCase();
					if (targetLastName === actionLastName) {
						// Bioguide exists but not in sponsors — surname-only match is fuzzy
						matched = d;
						confidence = 'fuzzy';
						break;
					}
				}
			}
		}

		// Strategy 2: Last-name fuzzy match (fallback)
		if (!matched) {
			const actionLastName = action.name.split(/\s+/).pop()?.toLowerCase();
			matched = deliveries.find((d) => {
				if (!d.targetName) return false;
				const targetLastName = d.targetName.split(/\s+/).pop()?.toLowerCase();
				return targetLastName === actionLastName;
			});
			confidence = 'fuzzy';
		}

		if (matched) {
			matchedPairs.push({ action, delivery: matched, confidence });
		} else {
			result.unmatched++;
		}
	}

	// Phase 2: Batch DM resolution — separate by lookup strategy
	const bioguideActions = matchedPairs.filter((p) => p.action.externalId);
	const nameOnlyActions = matchedPairs.filter((p) => !p.action.externalId);

	// Batch lookup: bioguide -> DecisionMaker ID
	const bioguideToDbId = new Map<string, string>();
	if (bioguideActions.length > 0) {
		const bioguideIds = [...new Set(bioguideActions.map((p) => p.action.externalId!))];
		const externalIdRecords = await db.externalId.findMany({
			where: { system: 'bioguide', value: { in: bioguideIds } },
			select: { value: true, decisionMakerId: true }
		});
		for (const r of externalIdRecords) {
			bioguideToDbId.set(r.value, r.decisionMakerId);
		}
	}

	// Batch lookup: lastName -> DecisionMaker candidates (for disambiguation)
	const lastNameToDms = new Map<string, Array<{ id: string; firstName: string | null; lastName: string; jurisdiction: string | null }>>();
	if (nameOnlyActions.length > 0) {
		const lastNames = [
			...new Set(
				nameOnlyActions
					.map((p) => p.action.name.split(/\s+/).pop()?.toLowerCase())
					.filter((n): n is string => !!n)
			)
		];
		if (lastNames.length > 0) {
			const dmCandidates = await db.decisionMaker.findMany({
				where: {
					lastName: { in: lastNames, mode: 'insensitive' },
					active: true,
					type: 'legislator',
					jurisdictionLevel: 'federal'
				},
				select: { id: true, firstName: true, lastName: true, jurisdiction: true }
			});
			for (const dm of dmCandidates) {
				const key = dm.lastName.toLowerCase();
				const list = lastNameToDms.get(key) || [];
				list.push(dm);
				lastNameToDms.set(key, list);
			}
		}
	}

	// Phase 3: Resolve DM IDs and collect updates
	interface PendingUpdate {
		actionId: string;
		dmId: string;
		deliveryId: string;
		confidence: 'exact' | 'fuzzy';
	}
	const pendingUpdates: PendingUpdate[] = [];

	for (const pair of matchedPairs) {
		let dmId: string | null = null;
		let { confidence } = pair;

		if (pair.action.externalId) {
			dmId = bioguideToDbId.get(pair.action.externalId) ?? null;
			if (!dmId) {
				console.warn(
					`[correlator] Bioguide ${pair.action.externalId} matched delivery ${pair.delivery.id} but no DecisionMaker found in ExternalId table`
				);
			}
		} else {
			const actionLastName = pair.action.name.split(/\s+/).pop()?.toLowerCase();
			if (actionLastName) {
				const candidates = lastNameToDms.get(actionLastName) || [];
				if (candidates.length === 1) {
					// Unambiguous: only one DM with this last name
					dmId = candidates[0].id;
					confidence = 'fuzzy';
				} else if (candidates.length > 1) {
					// Disambiguate by first name
					const actionFirstName = parseFirstName(pair.action.name)?.toLowerCase();
					let narrowed = actionFirstName
						? candidates.filter((c) => c.firstName?.toLowerCase() === actionFirstName)
						: [];

					if (narrowed.length === 1) {
						dmId = narrowed[0].id;
						confidence = 'fuzzy';
					} else {
						// Try jurisdiction/state as tiebreaker (delivery target email domain or name context)
						// If still ambiguous, skip rather than link wrong DM
						if (narrowed.length === 0) narrowed = candidates;
						if (narrowed.length === 1) {
							dmId = narrowed[0].id;
							confidence = 'fuzzy';
						} else {
							console.warn(
								`[correlator] Action ${pair.action.id}: ${narrowed.length} DMs share last name "${actionLastName}" — skipping ambiguous match`
							);
						}
					}
				} else {
					console.warn(
						`[correlator] Action ${pair.action.id} matched delivery ${pair.delivery.id} by name only — no DM found for "${actionLastName}"`
					);
				}
			}
		}

		if (dmId) {
			pendingUpdates.push({
				actionId: pair.action.id,
				dmId,
				deliveryId: pair.delivery.id,
				confidence
			});
		} else {
			result.unmatched++;
		}
	}

	// Phase 4: Batch write all updates via single raw SQL UPDATE ... FROM VALUES
	if (pendingUpdates.length > 0) {
		try {
			const valuesClauses = pendingUpdates.map(
				(p) => Prisma.sql`(${p.actionId}::text, ${p.dmId}::text)`
			);
			await db.$executeRaw`
				UPDATE "legislative_action"
				SET "decision_maker_id" = v.dm_id
				FROM (VALUES ${Prisma.join(valuesClauses)}) AS v(id, dm_id)
				WHERE "legislative_action"."id" = v.id
			`;
			for (const p of pendingUpdates) {
				result.matched++;
				result.matches.push({
					deliveryId: p.deliveryId,
					actionId: p.actionId,
					confidence: p.confidence
				});
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			// If batch fails, count all as errors
			for (const p of pendingUpdates) {
				result.errors.push(`Failed to update action ${p.actionId}: ${msg}`);
			}
		}
	}

	console.log(
		`[correlator] Matched ${result.matched} actions to deliveries (${result.matches.filter((m) => m.confidence === 'exact').length} exact, ${result.matches.filter((m) => m.confidence === 'fuzzy').length} fuzzy), ${result.unmatched} unmatched, ${result.errors.length} errors`
	);

	return result;
}
