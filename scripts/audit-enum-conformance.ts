import { ConvexHttpClient } from 'convex/browser';
import { internal } from '../convex/_generated/api.js';

const TABLES = [
	'campaigns',
	'events',
	'subscriptions',
	'emailBlasts',
	'smsBlasts',
	'smsMessages',
	'eventRsvps',
	'debates',
	'accountabilityReceipts'
] as const;

type FieldAudit = {
	field: string;
	total: number;
	byValue: Record<string, number>;
	nonConforming: Record<string, number>;
};

type AuditPage = {
	summary: FieldAudit[];
	continueCursor: string | null;
	isDone: boolean;
};

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
	for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}

async function main(): Promise<void> {
	const convexUrl = process.env.CONVEX_URL;
	const adminKey = process.env.CONVEX_ADMIN_KEY;
	if (!convexUrl || !adminKey) throw new Error('CONVEX_URL and CONVEX_ADMIN_KEY are required');

	const client = new ConvexHttpClient(convexUrl);
	(client as unknown as { setAdminAuth: (key: string) => void }).setAdminAuth(adminKey);
	const aggregate = new Map<string, FieldAudit>();

	for (const table of TABLES) {
		let cursor: string | null = null;
		const seenCursors = new Set<string>();
		for (;;) {
			const page = (await client.query(
				(internal as unknown as { backfill: { auditEnumConformance: unknown } }).backfill
					.auditEnumConformance,
				{ table, cursor }
			)) as AuditPage;
			for (const field of page.summary) {
				let combined = aggregate.get(field.field);
				if (!combined) {
					combined = { field: field.field, total: 0, byValue: {}, nonConforming: {} };
					aggregate.set(field.field, combined);
				}
				combined.total += field.total;
				mergeCounts(combined.byValue, field.byValue);
				mergeCounts(combined.nonConforming, field.nonConforming);
			}
			if (page.isDone) break;
			if (!page.continueCursor || seenCursors.has(page.continueCursor)) {
				throw new Error(`ENUM_AUDIT_CURSOR_STALLED:${table}`);
			}
			seenCursors.add(page.continueCursor);
			cursor = page.continueCursor;
		}
	}

	const summary = [...aggregate.values()];
	const blockingDeploy = summary.some((field) => Object.keys(field.nonConforming).length > 0);
	console.log(JSON.stringify({ summary, blockingDeploy }, null, 2));
	console.log('\nSibling schema checks:');
	console.log('  npm run ops:normalize-schema');
	console.log(
		'  Verify emailBlasts.campaignId and debateNullifiers.argumentId are valid Convex IDs.'
	);
	if (blockingDeploy) process.exitCode = 2;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
