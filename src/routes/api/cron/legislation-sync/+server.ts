/**
 * Legislation Sync Cron Endpoint
 *
 * SCHEDULE: Every 6h (federal), daily (state) via GitHub Actions
 *
 * Orchestrates the full pipeline:
 * 1. Fetch bills from Congress.gov (or Open States)
 * 2. Generate embeddings for new bills
 * 3. Score relevance against all org issue domains
 * 4. Generate alerts for orgs with relevant bills
 * 5. Auto-dismiss stale alerts per org preferences
 * 6. Sync Congress.gov members → DecisionMaker table
 * 7. Backfill decisionMakerId on new LegislativeActions
 *
 * AUTHENTICATION:
 * - Requires CRON_SECRET environment variable (fail-closed)
 * - Pass as Bearer token: Authorization: Bearer <CRON_SECRET>
 *
 * USAGE:
 * ```bash
 * curl -X GET "https://commons.email/api/cron/legislation-sync?source=federal&limit=50" \
 *   -H "Authorization: Bearer $CRON_SECRET"
 * ```
 *
 * The caller (GitHub Actions) stores the cursor between invocations.
 * Pass it as ?cursor=<json> on subsequent calls.
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { FEATURES } from '$lib/config/features';
import {
	ingestCongressBills,
	defaultCursor
} from '$lib/server/legislation/ingest/congress-gov';
import type { IngestionCursor } from '$lib/server/legislation/ingest/types';
import { embedNewBills } from '$lib/server/legislation/relevance/embedder';
import { scoreBillsBatch } from '$lib/server/legislation/relevance/scorer';
import { generateAlertsBatch } from '$lib/server/legislation/alerts/generator';
import { getAlertPreferences, ALERT_PREF_DEFAULTS } from '$lib/server/legislation/alerts/preferences';
import { CronCostMonitor } from '$lib/server/legislation/monitoring';
import { syncCongressMembers, backfillActionDecisionMakerIds } from '$lib/server/legislation/ingest/member-sync';
import { db } from '$lib/core/db';
import { verifyCronSecret } from '$lib/server/cron-auth';

/** Statuses that should never be auto-dismissed */
const PROTECTED_STATUSES = ['floor', 'committee'];

/**
 * Auto-dismiss stale alerts per org preferences.
 *
 * Dismisses alerts for bills that haven't changed status in N days
 * (from the org's autoArchiveDays setting). Bills with status 'floor'
 * or 'committee' are NEVER auto-dismissed regardless of age.
 */
async function autoDismissStaleAlerts(): Promise<{ dismissed: number; errors: string[] }> {
	const errors: string[] = [];
	let totalDismissed = 0;

	// Get all orgs that have pending alerts
	const orgsWithAlerts = await db.legislativeAlert.groupBy({
		by: ['orgId'],
		where: { status: 'pending' },
		_count: { id: true }
	});

	for (const { orgId } of orgsWithAlerts) {
		try {
			const prefs = await getAlertPreferences(orgId);
			const archiveDays = prefs.autoArchiveDays ?? ALERT_PREF_DEFAULTS.autoArchiveDays;
			const cutoff = new Date(Date.now() - archiveDays * 24 * 60 * 60 * 1000);

			// Find stale pending alerts for this org where the bill is NOT in a protected status
			const staleAlerts = await db.legislativeAlert.findMany({
				where: {
					orgId,
					status: 'pending',
					createdAt: { lt: cutoff },
					bill: {
						status: { notIn: PROTECTED_STATUSES }
					}
				},
				select: { id: true }
			});

			if (staleAlerts.length > 0) {
				await db.legislativeAlert.updateMany({
					where: { id: { in: staleAlerts.map((a) => a.id) } },
					data: { status: 'dismissed' }
				});
				totalDismissed += staleAlerts.length;
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`auto-dismiss org ${orgId}: ${msg}`);
		}
	}

	return { dismissed: totalDismissed, errors };
}

/**
 * GET /api/cron/legislation-sync
 *
 * Query params:
 * - source: "federal" | "state" | "all" (default: "federal")
 * - limit: max bills per invocation (default: 50)
 * - cursor: JSON cursor from previous invocation (default: fresh cursor)
 */
export const GET: RequestHandler = async ({ request, url }) => {
	// Fail-closed auth
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) {
		return json({ error: 'CRON_SECRET not configured' }, { status: 500 });
	}

	const authHeader = request.headers.get('authorization');
	if (!verifyCronSecret(authHeader, cronSecret)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (!FEATURES.LEGISLATION) {
		return json({ error: 'LEGISLATION feature flag is disabled' }, { status: 503 });
	}

	const source = url.searchParams.get('source') ?? 'federal';
	const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);
	const cursorParam = url.searchParams.get('cursor');

	let cursor: IngestionCursor;
	try {
		cursor = cursorParam ? JSON.parse(cursorParam) : defaultCursor();
	} catch {
		return json({ error: 'Invalid cursor JSON' }, { status: 400 });
	}

	const monitor = new CronCostMonitor();

	const summary = {
		source,
		bills_ingested: 0,
		status_changes: 0,
		embeddings_generated: 0,
		bills_scored: 0,
		alerts_created: 0,
		alerts_dismissed: 0,
		members_created: 0,
		members_updated: 0,
		members_departed: 0,
		actions_linked: 0,
		next_cursor: null as string | null,
		errors: [] as string[],
		costs: null as ReturnType<CronCostMonitor['summarize']> | null,
		duration_ms: 0
	};

	const startTime = performance.now();

	try {
		const congressApiKey = env.CONGRESS_API_KEY;
		const openStatesApiKey = env.OPEN_STATES_API_KEY;

		// Step 1: Ingest bills
		if (source === 'federal' || source === 'all') {
			const ingestionResult = await ingestCongressBills(cursor, limit, 119, congressApiKey);
			summary.bills_ingested = ingestionResult.upserted;
			summary.status_changes = ingestionResult.statusChanged;
			summary.next_cursor = ingestionResult.nextCursor;
			summary.errors.push(...ingestionResult.errors);
			monitor.trackCongressGovCall(limit); // one API page fetch per batch
		}

		// Step 2: Generate embeddings for unembedded bills
		// embedNewBills finds bills with NULL topic_embedding
		const embedded = await embedNewBills(limit);
		summary.embeddings_generated = embedded;
		monitor.trackEmbeddings(embedded);

		// Step 3: Score newly embedded bills against all org issue domains
		// Find bills that have embeddings but no relevance rows yet
		const unscoredBills = await db.$queryRaw<Array<{ id: string }>>`
			SELECT b.id
			FROM bill b
			WHERE b.topic_embedding IS NOT NULL
				AND NOT EXISTS (
					SELECT 1 FROM org_bill_relevance r WHERE r.bill_id = b.id
				)
			ORDER BY b.updated_at DESC
			LIMIT ${limit}
		`;

		if (unscoredBills.length > 0) {
			const billIds = unscoredBills.map((b) => b.id);
			const scoringResult = await scoreBillsBatch(billIds);
			summary.bills_scored = scoringResult.results.length;
			summary.errors.push(...scoringResult.errors.map((e) => `scoring: ${e.billId}: ${e.error}`));
			monitor.trackCosineQuery(billIds.length);

			// Step 4: Generate alerts for scored bills
			// New bills get "new_bill" alerts; status-changed bills get "status_change" alerts
			const alertResult = await generateAlertsBatch(billIds, { isNewBill: true });
			summary.alerts_created = alertResult.totalAlertsCreated;
			summary.errors.push(
				...alertResult.errors.map((e) => `alerts: ${e.billId}: ${e.error}`)
			);
		}

		// Step 5: Auto-dismiss stale alerts
		const dismissResult = await autoDismissStaleAlerts();
		summary.alerts_dismissed = dismissResult.dismissed;
		summary.errors.push(...dismissResult.errors);

		// Step 6: Sync Congress members → DecisionMaker
		if (source === 'federal' || source === 'all') {
			try {
				const memberResult = await syncCongressMembers(congressApiKey);
				summary.members_created = memberResult.created;
				summary.members_updated = memberResult.updated;
				summary.members_departed = memberResult.departed;
				summary.errors.push(...memberResult.errors.map((e) => `member-sync: ${e}`));
				monitor.trackCongressGovCall(3); // ~3 paginated API calls for ~635 members
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				summary.errors.push(`member-sync: ${msg}`);
			}
		}

		// Step 7: Backfill LegislativeAction.decisionMakerId
		try {
			const backfillResult = await backfillActionDecisionMakerIds();
			summary.actions_linked = backfillResult.linked;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			summary.errors.push(`backfill-rep-ids: ${msg}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Pipeline failed';
		summary.errors.push(`fatal: ${message}`);
		console.error('[legislation-sync] Fatal pipeline error:', message);
	}

	summary.costs = monitor.summarize();
	summary.duration_ms = Math.round(performance.now() - startTime);

	console.log('[legislation-sync] Cost summary:', JSON.stringify(summary.costs));

	const status = summary.errors.some((e) => e.startsWith('fatal:')) ? 500 : 200;
	return json({ success: status === 200, ...summary }, { status });
};
