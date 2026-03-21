/**
 * Alert Generator: bill status change + relevance → LegislativeAlert
 *
 * When a bill's status changes and it has OrgBillRelevance > 0.75,
 * generates alerts for each matching org with appropriate urgency.
 */

import { db } from '$lib/core/db';
import { getAlertPreferences } from './preferences';

/** Default minimum relevance score to trigger an alert */
const ALERT_THRESHOLD = 0.75;

/** Critical urgency threshold */
const CRITICAL_THRESHOLD = 0.9;

type AlertType = 'new_bill' | 'status_change' | 'vote_scheduled' | 'amendment';
type Urgency = 'low' | 'normal' | 'high' | 'critical';

interface GeneratedAlert {
	orgId: string;
	billId: string;
	type: AlertType;
	urgency: Urgency;
}

export interface AlertGenerationResult {
	billId: string;
	alertsCreated: number;
	alertsSkipped: number;
}

/**
 * Determine the alert type from the bill's current status.
 */
function resolveAlertType(status: string, isNewBill: boolean): AlertType {
	if (isNewBill) return 'new_bill';
	if (status === 'vote_scheduled') return 'vote_scheduled';
	return 'status_change';
}

/**
 * Compute urgency from bill status + relevance score.
 *
 * Mapping:
 * - low:      introduced + relevance 0.6-0.75 (stored but below alert threshold)
 * - normal:   committee + relevance 0.75+
 * - high:     vote_scheduled + relevance 0.75+
 * - critical: floor + relevance 0.9+
 */
function computeUrgency(status: string, score: number): Urgency {
	if ((status === 'floor' || status === 'passed') && score >= CRITICAL_THRESHOLD) {
		return 'critical';
	}
	if (status === 'vote_scheduled') return 'high';
	if (status === 'committee' || status === 'floor') return 'normal';
	if (score < ALERT_THRESHOLD) return 'low';
	return 'normal';
}

/**
 * Generate a concise alert summary from the bill's data.
 */
function buildAlertSummary(
	billTitle: string,
	status: string,
	matchedDomains: string[]
): string {
	const domainStr = matchedDomains.slice(0, 3).join(', ');
	const statusLabel = status.replace(/_/g, ' ');
	return `Bill "${billTitle}" is now ${statusLabel}. Relevant to your issue areas: ${domainStr}.`;
}

/**
 * Generate alerts for a bill that has been scored for relevance.
 * Only creates alerts for orgs with relevance >= ALERT_THRESHOLD.
 * Deduplicates: won't create a second alert for the same org+bill+type.
 */
export async function generateAlertsForBill(
	billId: string,
	options?: { isNewBill?: boolean }
): Promise<AlertGenerationResult> {
	const isNewBill = options?.isNewBill ?? false;

	// Fetch the bill and all org relevances above the alert threshold
	const bill = await db.bill.findUnique({
		where: { id: billId },
		select: { id: true, title: true, status: true, summary: true }
	});

	if (!bill) {
		return { billId, alertsCreated: 0, alertsSkipped: 0 };
	}

	// Fetch all relevance rows above the base threshold — we'll filter per-org below
	const relevances = await db.orgBillRelevance.findMany({
		where: { billId, score: { gte: ALERT_THRESHOLD } },
		select: { orgId: true, score: true, matchedOn: true }
	});

	if (relevances.length === 0) {
		return { billId, alertsCreated: 0, alertsSkipped: 0 };
	}

	const alertType = resolveAlertType(bill.status, isNewBill);
	let alertsCreated = 0;
	let alertsSkipped = 0;

	// Cache org preferences to avoid repeated lookups
	const prefsCache = new Map<string, Awaited<ReturnType<typeof getAlertPreferences>>>();

	for (const rel of relevances) {
		// Check org-specific threshold: if org set a higher minimum, respect it
		let prefs = prefsCache.get(rel.orgId);
		if (!prefs) {
			prefs = await getAlertPreferences(rel.orgId);
			prefsCache.set(rel.orgId, prefs);
		}

		const effectiveThreshold = Math.max(ALERT_THRESHOLD, prefs.minRelevanceScore);
		if (rel.score < effectiveThreshold) {
			alertsSkipped++;
			continue;
		}

		// Skip if org is digest-only (alerts are sent via weekly digest, not dashboard)
		if (prefs.digestOnly) {
			alertsSkipped++;
			continue;
		}

		const urgency = computeUrgency(bill.status, rel.score);

		// Skip low-urgency from alert creation (they're stored as relevance only)
		if (urgency === 'low') {
			alertsSkipped++;
			continue;
		}

		const summary = buildAlertSummary(bill.title, bill.status, rel.matchedOn);

		// Upsert pattern: attempt create, catch unique constraint violation (P2002).
		// @@unique([orgId, billId, type]) on LegislativeAlert ensures concurrent
		// cron runs can't create duplicates (eliminates findFirst→create TOCTOU).
		try {
			await db.legislativeAlert.create({
				data: {
					orgId: rel.orgId,
					billId,
					type: alertType,
					title: bill.title,
					summary,
					urgency,
					status: 'pending'
				}
			});
			alertsCreated++;
		} catch (e: unknown) {
			if (
				e != null &&
				typeof e === 'object' &&
				'code' in e &&
				(e as { code: string }).code === 'P2002'
			) {
				alertsSkipped++; // duplicate, already exists
			} else {
				throw e;
			}
		}
	}

	return { billId, alertsCreated, alertsSkipped };
}

/**
 * Generate alerts for multiple bills. Errors on individual bills are logged
 * but don't abort the batch.
 */
export async function generateAlertsBatch(
	billIds: string[],
	options?: { isNewBill?: boolean }
): Promise<{
	results: AlertGenerationResult[];
	errors: Array<{ billId: string; error: string }>;
	totalAlertsCreated: number;
}> {
	const results: AlertGenerationResult[] = [];
	const errors: Array<{ billId: string; error: string }> = [];
	let totalAlertsCreated = 0;

	for (const billId of billIds) {
		try {
			const result = await generateAlertsForBill(billId, options);
			results.push(result);
			totalAlertsCreated += result.alertsCreated;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown alert generation error';
			console.error(`[alerts] Failed to generate alerts for bill ${billId}:`, message);
			errors.push({ billId, error: message });
		}
	}

	return { results, errors, totalAlertsCreated };
}
