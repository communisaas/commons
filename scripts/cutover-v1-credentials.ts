/**
 * V1 -> V2 Credential Cutover Script
 *
 * Stage 5 (F1 closure) — one-shot migration that marks every currently-active
 * districtCredential as revoked and schedules on-chain revocation emits
 * against RevocationRegistry. Used exactly once at the v1 -> v2 cutover.
 *
 * Pre-launch assumption: see
 * voter-protocol/specs/CIRCUIT-REVISION-MIGRATION.md. Operator MUST verify
 * Commons has no production users prior to running this script with --execute.
 *
 * Idempotency: re-running the script finds only credentials still in the
 * pre-cutover state (revokedAt undefined). A credential already patched is
 * skipped; a credential whose emit failed and flipped to revocationStatus
 * 'failed' is NOT re-processed by this script — operator must investigate
 * and re-queue via convex directly.
 *
 * Usage:
 *   npx tsx scripts/cutover-v1-credentials.ts                 # dry-run (default)
 *   npx tsx scripts/cutover-v1-credentials.ts --execute       # apply changes
 *
 * Env vars required:
 *   CONVEX_URL               — Convex deployment URL
 *   CONVEX_ADMIN_KEY         — Admin key for the deployment
 */

import { ConvexHttpClient } from 'convex/browser';
import { api, internal } from '../convex/_generated/api.js';
import type { Id } from '../convex/_generated/dataModel.js';

interface Options {
	execute: boolean;
	batchSize: number;
}

function parseArgs(): Options {
	const args = process.argv.slice(2);
	return {
		execute: args.includes('--execute'),
		batchSize: 50
	};
}

async function main() {
	const opts = parseArgs();
	const convexUrl = process.env.CONVEX_URL;
	const adminKey = process.env.CONVEX_ADMIN_KEY;

	if (!convexUrl || !adminKey) {
		console.error('[cutover] CONVEX_URL and CONVEX_ADMIN_KEY required.');
		process.exit(1);
	}

	const client = new ConvexHttpClient(convexUrl);
	(client as unknown as { setAdminAuth: (k: string) => void }).setAdminAuth(adminKey);

	console.log('=== V1 -> V2 Credential Cutover ===');
	console.log(`Mode: ${opts.execute ? 'EXECUTE (will patch DB)' : 'DRY RUN'}`);
	console.log('');

	type Candidate = {
		_id: Id<'districtCredentials'>;
		userId: Id<'users'>;
		districtCommitment?: string;
		issuedAt: number;
	};
	type CandidatePage = {
		page: Candidate[];
		continueCursor: string;
		isDone: boolean;
	};

	const listPage = async (cursor: string | null): Promise<CandidatePage> =>
		(await client.query(
			(internal as unknown as { cutover: { listActiveCredentials: unknown } }).cutover
				.listActiveCredentials,
			{ paginationOpts: { numItems: opts.batchSize, cursor } }
		)) as CandidatePage;

	if (!opts.execute) {
		let cursor: string | null = null;
		let total = 0;
		let withCommitment = 0;
		const sample: Candidate[] = [];
		do {
			const page = await listPage(cursor);
			total += page.page.length;
			withCommitment += page.page.filter((candidate) =>
				Boolean(candidate.districtCommitment)
			).length;
			sample.push(...page.page.slice(0, Math.max(0, 20 - sample.length)));
			cursor = page.isDone ? null : page.continueCursor;
			if (page.isDone) break;
		} while (cursor);

		console.log(`Found ${total} active credentials to cut over.`);
		console.log(`  With districtCommitment (schedulable on-chain): ${withCommitment}`);
		console.log(`  Without (server-layer only):                   ${total - withCommitment}`);
		console.log('');
		console.log('[DRY RUN] No changes applied. Re-run with --execute to commit.');
		console.log('');
		console.log('Summary by first 20 credentials:');
		for (const c of sample) {
			console.log(
				`  - ${c._id}  user=${c.userId}  commitment=${c.districtCommitment ? 'yes' : 'no'}  issuedAt=${new Date(c.issuedAt).toISOString()}`
			);
		}
		if (total > 20) console.log(`  ... and ${total - 20} more`);
		return;
	}

	let succeeded = 0;
	let scheduled = 0;
	// Mutations remove rows from the active index. Always read the next page
	// from the start rather than advancing a cursor through a changing range;
	// this cannot skip an entry moved out of that range by the previous batch.
	while (true) {
		const { page: batch } = await listPage(null);
		if (batch.length === 0) break;
		for (const cred of batch) {
			try {
				const result = await client.mutation(
					(
						internal as unknown as {
							cutover: { markCredentialForCutover: unknown };
						}
					).cutover.markCredentialForCutover,
					{ credentialId: cred._id }
				);
				succeeded += 1;
				if ((result as { scheduled?: boolean }).scheduled) scheduled += 1;
			} catch (err) {
				console.error(
					`[cutover] failed to mark ${cred._id}:`,
					err instanceof Error ? err.message : err
				);
			}
		}
		console.log(
			`[cutover] processed ${succeeded} active credentials (scheduled emit: ${scheduled})`
		);
	}

	console.log('');
	console.log('=== Done ===');
	console.log(`Marked revoked: ${succeeded}`);
	console.log(`On-chain emit scheduled: ${scheduled}`);
	console.log('');
	console.log(
		'Monitor convex/districtCredentials for revocationStatus transitions. Stuck-pending cron handles orphans. `failed` rows require operator attention.'
	);
}

main().catch((err) => {
	console.error('[cutover] FATAL:', err);
	process.exit(1);
});
