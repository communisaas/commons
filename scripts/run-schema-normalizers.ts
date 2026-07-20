import { ConvexHttpClient } from 'convex/browser';
import { internal } from '../convex/_generated/api.js';

const NORMALIZERS = [
	'normalizeBlastRecipientFilters',
	'normalizeSmsRecipientFilters',
	'normalizeCampaignTemplateIds'
] as const;

type NormalizerResult = {
	complete: boolean;
	continueCursor: string | null;
	scanned: number;
	normalized?: number;
	cleared?: number;
	valid?: number;
};

async function main(): Promise<void> {
	const convexUrl = process.env.CONVEX_URL;
	const adminKey = process.env.CONVEX_ADMIN_KEY;
	if (!convexUrl || !adminKey) throw new Error('CONVEX_URL and CONVEX_ADMIN_KEY are required');

	const client = new ConvexHttpClient(convexUrl);
	(client as unknown as { setAdminAuth: (key: string) => void }).setAdminAuth(adminKey);

	for (const name of NORMALIZERS) {
		let cursor: string | null = null;
		let scanned = 0;
		let changed = 0;
		let valid = 0;
		const seenCursors = new Set<string>();
		for (;;) {
			const result = (await client.action(
				(internal as unknown as { backfill: Record<string, unknown> }).backfill[name],
				{ cursor }
			)) as NormalizerResult;
			scanned += result.scanned;
			changed += result.normalized ?? result.cleared ?? 0;
			valid += result.valid ?? 0;
			if (result.complete) break;
			if (!result.continueCursor || seenCursors.has(result.continueCursor)) {
				throw new Error(`SCHEMA_NORMALIZER_CURSOR_STALLED:${name}`);
			}
			seenCursors.add(result.continueCursor);
			cursor = result.continueCursor;
		}
		console.log(`${name}: scanned=${scanned} changed=${changed} valid=${valid} complete=true`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
