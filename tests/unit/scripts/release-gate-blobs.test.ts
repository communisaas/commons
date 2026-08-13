import { describe, expect, it } from 'vitest';

import {
	TRUSTED_RELEASE_GATE_ABSENT_PATHS,
	TRUSTED_RELEASE_GATE_PATHS,
	verifyReleaseGateBlobIdentity
} from '../../../scripts/verify-release-gate-blobs.mjs';

const trustedSha = 'a'.repeat(40);
const sourceSha = 'b'.repeat(40);
const blob = 'c'.repeat(40);

function stableObjectId(_sha: string, path: string): string {
	return TRUSTED_RELEASE_GATE_ABSENT_PATHS.includes(path) ? '' : blob;
}

describe('trusted release gate blob identity', () => {
	it('pins every new pre-environment authority and cost-shield input to T', () => {
		expect(TRUSTED_RELEASE_GATE_PATHS).toEqual(
			expect.arrayContaining([
				'.github/CODEOWNERS',
				'.github/cloudflare-queue-allowed-signers',
				'.github/convex-quota-allowed-signers',
				'.github/paid-provider-posture-allowed-signers',
				'.npmrc',
				'package.json',
				'package-lock.json',
				'postcss.config.js',
				'tailwind.config.ts',
				'tsconfig.json',
				'config/anonymous-dynamic-route-cost-inventory.json',
				'config/brutalist-review-authority.json',
				'config/cloudflare-pages-dev-origin-closure.json',
				'config/cloudflare-public-dynamic-rate-limit.json',
				'config/convex-native-usage-limits.json',
				'config/convex-paid-provider-egress.json',
				'config/convex-work-budget-policy.json',
				'config/paid-provider-account-authority.json',
				'config/paid-provider-budget-policy.json',
				'convex.json',
				'convex',
				'convex/templates.ts',
				'scripts/check-convex-server-work-budget.mjs',
				'scripts/verify-convex-paid-provider-egress.mjs',
				'scripts/verify-brutalist-review-authority.mjs',
				'scripts/cloudflare-queue-free-envelope.mjs',
				'scripts/convex-team-usage-attestation.mjs',
				'scripts/capture-convex-team-usage-attestation.mjs',
				'scripts/sign-convex-team-usage-attestation.mjs',
				'scripts/materialize-paid-provider-pages-secrets.mjs',
				'scripts/paid-provider-account-posture.mjs',
				'scripts/sign-paid-provider-account-posture.mjs',
				'scripts/verify-convex-contained-cron-deployments.mjs',
				'scripts/verify-convex-native-usage-limits.mjs',
				'scripts/verify-convex-work-budget-deployment.mjs',
				'scripts/verify-paid-provider-account-posture.mjs',
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
				'src',
				'src/hooks.server.ts',
				'src/hooks.ts',
				'src/lib/core/agents',
				'src/lib/core/search/gemini-embeddings.ts',
				'src/lib/core/security/rate-limiter.ts',
				'src/lib/core/server/moderation',
				'src/lib/components/template-browser/parts/ActionBar.svelte',
				'src/lib/server/agent-request-envelope.ts',
				'src/lib/server/agent-request-authority.ts',
				'src/lib/server/bounded-json-request.ts',
				'src/lib/server/bounded-response.mjs',
				'src/lib/server/convex-work-budget-client.ts',
				'src/lib/server/convex-work-budget-policy.ts',
				'src/lib/server/delegation/parse-policy.ts',
				'src/lib/server/exa',
				'src/lib/server/firecrawl',
				'src/lib/server/llm-cost-protection.ts',
				'src/lib/server/paid-provider-budget-client.ts',
				'src/lib/server/paid-provider-budget-policy.ts',
				'src/lib/server/production-host-authority.ts',
				'src/lib/server/rate-limiter.ts',
				'src/lib/server/public-template-og-operation-budget.mjs',
				'src/lib/server/public-template-og-queue.ts',
				'src/routes/api/release-candidate/+server.ts',
				'src/routes/api/release-origin/+server.ts',
				'src/routes',
				'static',
				'workers',
				'svelte.config.js',
				'vite.config.ts',
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
				'wrangler.public-discovery-bootstrap.toml',
				'wrangler.public-template-og.toml'
			])
		);
		for (const changedPath of [
			'.github/CODEOWNERS',
			'.github/cloudflare-queue-allowed-signers',
			'.github/convex-quota-allowed-signers',
			'.github/paid-provider-posture-allowed-signers',
			'.npmrc',
			'package.json',
			'package-lock.json',
			'postcss.config.js',
			'tailwind.config.ts',
			'tsconfig.json',
			'config/anonymous-dynamic-route-cost-inventory.json',
			'config/brutalist-review-authority.json',
			'config/cloudflare-pages-dev-origin-closure.json',
			'config/cloudflare-public-dynamic-rate-limit.json',
			'config/convex-native-usage-limits.json',
			'config/convex-paid-provider-egress.json',
			'config/convex-work-budget-policy.json',
			'config/paid-provider-account-authority.json',
			'config/paid-provider-budget-policy.json',
			'convex.json',
			'convex',
			'convex/templates.ts',
			'scripts/check-convex-server-work-budget.mjs',
			'scripts/verify-convex-paid-provider-egress.mjs',
			'scripts/verify-brutalist-review-authority.mjs',
			'scripts/cloudflare-queue-free-envelope.mjs',
			'scripts/convex-team-usage-attestation.mjs',
			'scripts/capture-convex-team-usage-attestation.mjs',
			'scripts/sign-convex-team-usage-attestation.mjs',
			'scripts/materialize-paid-provider-pages-secrets.mjs',
			'scripts/paid-provider-account-posture.mjs',
			'scripts/sign-paid-provider-account-posture.mjs',
			'scripts/verify-convex-contained-cron-deployments.mjs',
			'scripts/verify-convex-native-usage-limits.mjs',
			'scripts/verify-convex-work-budget-deployment.mjs',
			'scripts/verify-paid-provider-account-posture.mjs',
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
			'src',
			'src/hooks.server.ts',
			'src/hooks.ts',
			'src/lib/core/agents',
			'src/lib/core/search/gemini-embeddings.ts',
			'src/lib/core/security/rate-limiter.ts',
			'src/lib/core/server/moderation',
			'src/lib/components/template-browser/parts/ActionBar.svelte',
			'src/lib/server/agent-request-envelope.ts',
			'src/lib/server/agent-request-authority.ts',
			'src/lib/server/bounded-json-request.ts',
			'src/lib/server/bounded-response.mjs',
			'src/lib/server/convex-work-budget-client.ts',
			'src/lib/server/convex-work-budget-policy.ts',
			'src/lib/server/delegation/parse-policy.ts',
			'src/lib/server/exa',
			'src/lib/server/firecrawl',
			'src/lib/server/llm-cost-protection.ts',
			'src/lib/server/paid-provider-budget-client.ts',
			'src/lib/server/paid-provider-budget-policy.ts',
			'src/lib/server/production-host-authority.ts',
			'src/lib/server/rate-limiter.ts',
			'src/lib/server/public-template-og-operation-budget.mjs',
			'src/lib/server/public-template-og-queue.ts',
			'src/routes/api/release-candidate/+server.ts',
			'src/routes/api/release-origin/+server.ts',
			'src/routes',
			'static',
			'workers',
			'svelte.config.js',
			'vite.config.ts',
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
			'wrangler.public-discovery-bootstrap.toml',
			'wrangler.public-template-og.toml'
		]) {
			expect(() =>
				verifyReleaseGateBlobIdentity({
					trustedSha,
					sourceSha,
					readBlobId: (sha, path) =>
						sha === sourceSha && path === changedPath ? 'd'.repeat(40) : stableObjectId(sha, path)
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
					path === '.github/workflows' && sha === sourceSha
						? 'd'.repeat(40)
						: stableObjectId(sha, path)
			})
		).toThrow(/\.github\/workflows/);
	});

	it.each([
		['non-API +server.ts addition', 'src/routes/og/new-image/+server.ts', 'src/routes'],
		['+page.server.ts change', 'src/routes/accountability/[id]/+page.server.ts', 'src/routes'],
		['+layout.server.ts addition', 'src/routes/private/+layout.server.ts', 'src/routes'],
		['hooks.server.ts change', 'src/hooks.server.ts', 'src/hooks.server.ts'],
		['transitive server helper addition', 'src/lib/server/new-provider.ts', 'src'],
		['SSR component import change', 'src/lib/components/new-provider-trigger.svelte', 'src'],
		['Convex provider action addition', 'convex/newProviderAction.ts', 'convex'],
		['Worker helper addition', 'workers/new-provider-helper.ts', 'workers'],
		['dependency graph change', 'node_modules/new-provider', 'package-lock.json'],
		['build plugin change', 'postcss.config.js', 'postcss.config.js'],
		['static executable change', 'static/provider-trigger.js', 'static']
	])('rejects a synthetic %s at %s', (_label, syntheticPath, changedObject) => {
		if (syntheticPath.startsWith('src/routes/')) {
			expect(syntheticPath).not.toMatch(/^src\/routes\/api\//u);
		}
		expect(TRUSTED_RELEASE_GATE_PATHS).toContain(changedObject);
		expect(() =>
			verifyReleaseGateBlobIdentity({
				trustedSha,
				sourceSha,
				readBlobId: (sha, path) =>
					sha === sourceSha && path === changedObject ? 'd'.repeat(40) : stableObjectId(sha, path)
			})
		).toThrow(changedObject);
	});

	it('rejects additions at every absent SvelteKit/Vite server execution entry', () => {
		for (const addedPath of TRUSTED_RELEASE_GATE_ABSENT_PATHS) {
			expect(() =>
				verifyReleaseGateBlobIdentity({
					trustedSha,
					sourceSha,
					readBlobId: (sha, path) =>
						sha === sourceSha && path === addedPath ? 'd'.repeat(40) : stableObjectId(sha, path)
				})
			).toThrow(addedPath);
		}
	});

	it('pins the config files that select and transform SvelteKit server entries', () => {
		expect(TRUSTED_RELEASE_GATE_PATHS).toEqual(
			expect.arrayContaining([
				'package.json',
				'package-lock.json',
				'postcss.config.js',
				'tailwind.config.ts',
				'tsconfig.json',
				'svelte.config.js',
				'vite.config.ts',
				'src',
				'convex',
				'static',
				'workers'
			])
		);
		expect(TRUSTED_RELEASE_GATE_ABSENT_PATHS).toEqual(
			expect.arrayContaining([
				'.env.production',
				'postcss.config.mjs',
				'svelte.config.ts',
				'src/instrumentation.server.js',
				'src/instrumentation.server.ts',
				'vite.config.js',
				'vite.config.mjs'
			])
		);
	});

	it('accepts only when every allowlisted T/S blob is byte-identical', () => {
		expect(
			verifyReleaseGateBlobIdentity({ trustedSha, sourceSha, readBlobId: stableObjectId })
		).toEqual({
			trustedSha,
			sourceSha,
			paths: TRUSTED_RELEASE_GATE_PATHS.length,
			absentPaths: TRUSTED_RELEASE_GATE_ABSENT_PATHS.length
		});
	});

	it('rejects one changed or missing gate-critical blob', () => {
		const changedPath = TRUSTED_RELEASE_GATE_PATHS[0];
		expect(() =>
			verifyReleaseGateBlobIdentity({
				trustedSha,
				sourceSha,
				readBlobId: (sha, path) =>
					sha === sourceSha && path === changedPath ? 'd'.repeat(40) : stableObjectId(sha, path)
			})
		).toThrow(changedPath);
		expect(() =>
			verifyReleaseGateBlobIdentity({
				trustedSha,
				sourceSha,
				readBlobId: (sha, path) =>
					sha === sourceSha && path === changedPath ? '' : stableObjectId(sha, path)
			})
		).toThrow(/missing/i);
	});
});
