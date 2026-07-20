import { describe, expect, it } from 'vitest';

import {
	TRUSTED_RELEASE_GATE_PATHS,
	verifyReleaseGateBlobIdentity
} from '../../../scripts/verify-release-gate-blobs.mjs';

const trustedSha = 'a'.repeat(40);
const sourceSha = 'b'.repeat(40);
const blob = 'c'.repeat(40);

describe('trusted release gate blob identity', () => {
	it('pins every new pre-environment authority and cost-shield input to T', () => {
		expect(TRUSTED_RELEASE_GATE_PATHS).toEqual(
			expect.arrayContaining([
				'.github/cloudflare-queue-allowed-signers',
				'.github/convex-quota-allowed-signers',
				'.npmrc',
				'config/anonymous-dynamic-route-cost-inventory.json',
				'config/cloudflare-pages-dev-origin-closure.json',
				'config/cloudflare-public-dynamic-rate-limit.json',
				'config/convex-native-usage-limits.json',
				'config/convex-work-budget-policy.json',
				'scripts/check-convex-server-work-budget.mjs',
				'scripts/cloudflare-queue-free-envelope.mjs',
				'scripts/convex-team-usage-attestation.mjs',
				'scripts/capture-convex-team-usage-attestation.mjs',
				'scripts/sign-convex-team-usage-attestation.mjs',
				'scripts/verify-convex-contained-cron-deployments.mjs',
				'scripts/verify-convex-native-usage-limits.mjs',
				'scripts/verify-convex-work-budget-deployment.mjs',
				'scripts/verify-cloudflare-pages-dev-origin-closure.mjs',
				'scripts/verify-cloudflare-public-dynamic-rate-limit.mjs',
				'scripts/verify-github-release-authority.mjs',
				'scripts/validate-pages-release-artifact.mjs',
				'scripts/finalize-public-template-og-release-artifact.mjs',
				'scripts/finalize-trusted-release-worker.mjs',
				'scripts/manage-public-template-og-queues.mjs',
				'scripts/manage-public-template-og-workers.mjs',
				'scripts/prove-public-discovery-edge-cache.mjs',
				'scripts/qualify-public-discovery-generation.mjs',
				'scripts/run-public-template-og-release-phase.mjs',
				'scripts/seed-public-discovery-manifest.mjs',
				'scripts/sign-cloudflare-queue-free-envelope.mjs',
				'scripts/verify-cloudflare-queue-free-envelope.mjs',
				'scripts/verify-cloudflare-queue-release-phase.mjs',
				'scripts/verify-public-template-og-deployment.mjs',
				'scripts/verify-release-candidate-lockfile.mjs',
				'scripts/verify-runtime-neutral-client-realm.mjs',
				'src/hooks.server.ts',
				'src/lib/server/production-host-authority.ts',
				'src/lib/server/public-template-og-operation-budget.mjs',
				'src/lib/server/public-template-og-queue.ts',
				'src/routes/api/release-candidate/+server.ts',
				'src/routes/api/release-origin/+server.ts',
				'workers/convex-work-budget.ts',
				'workers/access-safe-sveltekit-pages-adapter.ts',
				'workers/public-discovery-manifest-cron.ts',
				'workers/public-discovery-manifest-refresh-gate.ts',
				'workers/public-template-og-consumer.ts',
				'workers/trusted-pages-release-cache.ts',
				'wrangler.convex-work-budget.toml',
				'wrangler.public-discovery-manifest-gate-nonprod.toml',
				'wrangler.public-discovery-manifest-gate.toml',
				'wrangler.public-discovery-manifest.toml',
				'wrangler.public-template-og.toml'
			])
		);
		for (const changedPath of [
			'.github/cloudflare-queue-allowed-signers',
			'.github/convex-quota-allowed-signers',
			'.npmrc',
			'config/anonymous-dynamic-route-cost-inventory.json',
			'config/cloudflare-pages-dev-origin-closure.json',
			'config/cloudflare-public-dynamic-rate-limit.json',
			'config/convex-native-usage-limits.json',
			'config/convex-work-budget-policy.json',
			'scripts/check-convex-server-work-budget.mjs',
			'scripts/cloudflare-queue-free-envelope.mjs',
			'scripts/convex-team-usage-attestation.mjs',
			'scripts/capture-convex-team-usage-attestation.mjs',
			'scripts/sign-convex-team-usage-attestation.mjs',
			'scripts/verify-convex-contained-cron-deployments.mjs',
			'scripts/verify-convex-native-usage-limits.mjs',
			'scripts/verify-convex-work-budget-deployment.mjs',
			'scripts/verify-cloudflare-pages-dev-origin-closure.mjs',
			'scripts/verify-cloudflare-public-dynamic-rate-limit.mjs',
			'scripts/verify-github-release-authority.mjs',
			'scripts/validate-pages-release-artifact.mjs',
			'scripts/finalize-public-template-og-release-artifact.mjs',
			'scripts/finalize-trusted-release-worker.mjs',
			'scripts/manage-public-template-og-queues.mjs',
			'scripts/manage-public-template-og-workers.mjs',
			'scripts/prove-public-discovery-edge-cache.mjs',
			'scripts/qualify-public-discovery-generation.mjs',
			'scripts/run-public-template-og-release-phase.mjs',
			'scripts/seed-public-discovery-manifest.mjs',
			'scripts/sign-cloudflare-queue-free-envelope.mjs',
			'scripts/verify-cloudflare-queue-free-envelope.mjs',
			'scripts/verify-cloudflare-queue-release-phase.mjs',
			'scripts/verify-public-template-og-deployment.mjs',
			'scripts/verify-release-candidate-lockfile.mjs',
			'scripts/verify-runtime-neutral-client-realm.mjs',
			'src/hooks.server.ts',
			'src/lib/server/production-host-authority.ts',
			'src/lib/server/public-template-og-operation-budget.mjs',
			'src/lib/server/public-template-og-queue.ts',
			'src/routes/api/release-candidate/+server.ts',
			'src/routes/api/release-origin/+server.ts',
			'workers/convex-work-budget.ts',
			'workers/access-safe-sveltekit-pages-adapter.ts',
			'workers/public-discovery-manifest-cron.ts',
			'workers/public-discovery-manifest-refresh-gate.ts',
			'workers/public-template-og-consumer.ts',
			'workers/trusted-pages-release-cache.ts',
			'wrangler.convex-work-budget.toml',
			'wrangler.public-discovery-manifest-gate-nonprod.toml',
			'wrangler.public-discovery-manifest-gate.toml',
			'wrangler.public-discovery-manifest.toml',
			'wrangler.public-template-og.toml'
		]) {
			expect(() =>
				verifyReleaseGateBlobIdentity({
					trustedSha,
					sourceSha,
					readBlobId: (sha, path) =>
						sha === sourceSha && path === changedPath ? 'd'.repeat(40) : blob
				})
			).toThrow(changedPath);
		}
	});

	it('rejects an S-only workflow through exact workflow-tree identity', () => {
		expect(TRUSTED_RELEASE_GATE_PATHS).toContain('.github/workflows');
		expect(() =>
			verifyReleaseGateBlobIdentity({
				trustedSha,
				sourceSha,
				readBlobId: (sha, path) =>
					path === '.github/workflows' && sha === sourceSha ? 'd'.repeat(40) : blob
			})
		).toThrow(/\.github\/workflows/);
	});

	it('accepts only when every allowlisted T/S blob is byte-identical', () => {
		expect(
			verifyReleaseGateBlobIdentity({ trustedSha, sourceSha, readBlobId: () => blob })
		).toEqual({ trustedSha, sourceSha, paths: TRUSTED_RELEASE_GATE_PATHS.length });
	});

	it('rejects one changed or missing gate-critical blob', () => {
		const changedPath = TRUSTED_RELEASE_GATE_PATHS[0];
		expect(() =>
			verifyReleaseGateBlobIdentity({
				trustedSha,
				sourceSha,
				readBlobId: (sha, path) =>
					sha === sourceSha && path === changedPath ? 'd'.repeat(40) : blob
			})
		).toThrow(changedPath);
		expect(() =>
			verifyReleaseGateBlobIdentity({
				trustedSha,
				sourceSha,
				readBlobId: (sha, path) => (sha === sourceSha && path === changedPath ? '' : blob)
			})
		).toThrow(/missing/i);
	});
});
