#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TRUSTED_RELEASE_GATE_PATHS = Object.freeze([
	'.github/CODEOWNERS',
	'.github/brutalist-allowed-signers',
	'.github/cloudflare-queue-allowed-signers',
	'.github/convex-quota-allowed-signers',
	'.github/paid-provider-posture-allowed-signers',
	'.github/release-gate/package-lock.json',
	'.github/release-gate/package.json',
	// Pinning the tree object rejects any S-only workflow path, mode, or blob.
	// This closes same-GitHub-App status-check spoofing by a new job named `test`.
	'.github/workflows',
	'.github/workflows/brutalist-review.yml',
	'.github/workflows/ci.yml',
	'.github/workflows/cloudflare-branch-alias.yml',
	'.github/workflows/deploy.yml',
	'.github/workflows/pages-exposure-guard.yml',
	'.github/workflows/public-template-og-release-recovery.yml',
	'.node-version',
	'.npmrc',
	// Candidate dependencies and build configuration are executable inputs, not
	// inert metadata. A changed script, plugin, lock graph, TypeScript resolver,
	// or CSS config can rewrite the server bundle even when every route matches T.
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
	// Pin the entire backend tree: an added action or a changed transitive import
	// is just as capable as an edited reviewed export.
	'convex',
	'convex/templates.ts',
	'docs/strategy/public-discovery-release-hypergraph/edges/blocks.json',
	'docs/strategy/public-discovery-release-hypergraph/edges/requires.json',
	'docs/strategy/public-discovery-release-hypergraph/edges/rollback.json',
	'docs/strategy/public-discovery-release-hypergraph/nodes/tasks.json',
	'docs/strategy/public-discovery-release-hypergraph/topology.json',
	'scripts/cloudflare-pages-production-control.mjs',
	'scripts/cloudflare-queue-free-envelope.mjs',
	'scripts/check-convex-server-work-budget.mjs',
	'scripts/verify-convex-paid-provider-egress.mjs',
	'scripts/convex-team-usage-attestation.mjs',
	'scripts/capture-convex-team-usage-attestation.mjs',
	'scripts/sign-convex-team-usage-attestation.mjs',
	'scripts/materialize-paid-provider-pages-secrets.mjs',
	'scripts/paid-provider-account-posture.mjs',
	'scripts/sign-paid-provider-account-posture.mjs',
	'scripts/sign-cloudflare-queue-free-envelope.mjs',
	'scripts/verify-cloudflare-pages-dev-origin-closure.mjs',
	'scripts/verify-cloudflare-public-dynamic-rate-limit.mjs',
	'scripts/verify-cloudflare-queue-free-envelope.mjs',
	'scripts/verify-cloudflare-queue-release-phase.mjs',
	'scripts/generate-trusted-containment-worker.mjs',
	'scripts/reconcile-cloudflare-pages-exposure.mjs',
	'scripts/reconcile-public-discovery-r2-lifecycle.mjs',
	'scripts/validate-pages-release-artifact.mjs',
	'scripts/finalize-pages-release-artifact.mjs',
	'scripts/finalize-trusted-release-worker.mjs',
	'scripts/finalize-public-template-og-release-artifact.mjs',
	'scripts/manage-public-template-og-queues.mjs',
	'scripts/manage-public-template-og-workers.mjs',
	'scripts/prepare-public-template-og-release-recovery.mjs',
	'scripts/prove-public-discovery-edge-cache.mjs',
	'scripts/public-template-og-release-recovery-store.mjs',
	'scripts/qualify-public-discovery-generation.mjs',
	'scripts/resolve-public-template-og-release-recovery-run.mjs',
	'scripts/run-public-template-og-release-phase.mjs',
	'scripts/seed-public-discovery-manifest.mjs',
	'scripts/verify-brutalist-attestation.mjs',
	'scripts/verify-brutalist-review-authority.mjs',
	'scripts/verify-containment-deployment.mjs',
	'scripts/verify-convex-contained-cron-deployments.mjs',
	'scripts/verify-convex-native-usage-limits.mjs',
	'scripts/verify-convex-work-budget-deployment.mjs',
	'scripts/verify-paid-provider-account-posture.mjs',
	'scripts/verify-github-release-authority.mjs',
	'scripts/verify-pages-containment-bindings.mjs',
	'scripts/verify-pages-deployment-retired.mjs',
	'scripts/verify-pages-durable-object-binding.mjs',
	'scripts/verify-pages-preview-release.mjs',
	'scripts/verify-public-discovery-cron-deployment.mjs',
	'scripts/verify-public-discovery-gate-deployments.mjs',
	'scripts/verify-public-template-og-deployment.mjs',
	'scripts/verify-release-gate-blobs.mjs',
	'scripts/verify-release-candidate-lockfile.mjs',
	'scripts/verify-release-hypergraph.mjs',
	'scripts/verify-runtime-neutral-client-realm.mjs',
	'scripts/verify-trusted-pages-release-edge.mjs',
	'scripts/verify-trusted-pages-release-origin-response.mjs',
	// The complete SvelteKit execution tree is the only durable transitive-import
	// bound. Routes, hooks, universal SSR components, and $lib imports all live
	// beneath src; enumerating current imports would fail open on the next one.
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
	// Every SvelteKit route is part of the provider-capability closure. Server
	// code also executes in non-API +server, +page.server, +layout.server, and
	// universal route modules, so an API-only tree pin is not a security bound.
	'src/routes',
	'svelte.config.js',
	'vite.config.ts',
	// Static assets can include browser-executable code and service-worker inputs.
	'static',
	// Standalone Worker entrypoints may import sibling helpers. Pinning the tree
	// closes that transitive source graph for trusted-finalized Workers too.
	'workers',
	'workers/trusted-pages-release-edge.ts',
	'workers/trusted-pages-release-edge-entry.ts',
	'workers/trusted-pages-release-cache.ts',
	'workers/access-safe-sveltekit-pages-adapter.ts',
	'workers/public-discovery-manifest-cron.ts',
	'workers/convex-work-budget.ts',
	'workers/public-discovery-manifest-refresh-gate.ts',
	'workers/public-template-og-consumer.ts',
	'wrangler.containment.toml',
	'wrangler.convex-work-budget.toml',
	'wrangler.public-discovery-manifest-gate-nonprod.toml',
	'wrangler.public-discovery-manifest-gate.toml',
	'wrangler.public-discovery-manifest.toml',
	'wrangler.public-discovery-bootstrap.toml',
	'wrangler.public-template-og.toml',
	'wrangler.trusted-pages-release-edge-staging.toml',
	'wrangler.trusted-pages-release-edge.toml',
	'wrangler.toml'
]);

// These default SvelteKit/Vite entry candidates are intentionally absent from
// T. Equality alone cannot pin an absent Git path, so the verifier separately
// proves that S did not add an earlier-resolving config, alternate hook, or
// server instrumentation module.
export const TRUSTED_RELEASE_GATE_ABSENT_PATHS = Object.freeze([
	// Vite build mode is production. A source-only env file can rewrite public
	// build inputs without changing the pinned workflow or configuration.
	'.env',
	'.env.local',
	'.env.production',
	'.env.production.local',
	// Alternate auto-discovered build configs must not outrank or supplement T.
	'postcss.config.cjs',
	'postcss.config.mjs',
	'postcss.config.ts',
	'postcss.config.cts',
	'postcss.config.mts',
	'.postcssrc',
	'.postcssrc.json',
	'.postcssrc.yaml',
	'.postcssrc.yml',
	'.postcssrc.js',
	'.postcssrc.cjs',
	'.postcssrc.mjs',
	'.postcssrc.ts',
	'svelte.config.cjs',
	'svelte.config.mjs',
	'svelte.config.ts',
	'src/hooks',
	'src/hooks.js',
	'src/hooks.server',
	'src/hooks.server.js',
	'src/instrumentation.server',
	'src/instrumentation.server.js',
	'src/instrumentation.server.ts',
	'vite.config.js',
	'vite.config.mjs',
	'vite.config.cjs',
	'vite.config.mts',
	'vite.config.cts'
]);

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/**
 * @param {{trustedSha: string, sourceSha: string, readBlobId: (sha: string, path: string) => string}} input
 */
export function verifyReleaseGateBlobIdentity({ trustedSha, sourceSha, readBlobId }) {
	invariant(/^[a-f0-9]{40}$/.test(trustedSha), 'Trusted gate SHA must be exact lowercase Git SHA.');
	invariant(/^[a-f0-9]{40}$/.test(sourceSha), 'Source SHA must be exact lowercase Git SHA.');
	invariant(
		new Set(TRUSTED_RELEASE_GATE_PATHS).size === TRUSTED_RELEASE_GATE_PATHS.length,
		'Trusted release gate allowlist contains a duplicate path.'
	);
	invariant(
		new Set(TRUSTED_RELEASE_GATE_ABSENT_PATHS).size === TRUSTED_RELEASE_GATE_ABSENT_PATHS.length,
		'Trusted release gate absence list contains a duplicate path.'
	);
	invariant(
		TRUSTED_RELEASE_GATE_ABSENT_PATHS.every((path) => !TRUSTED_RELEASE_GATE_PATHS.includes(path)),
		'Trusted release gate required and absent paths overlap.'
	);
	for (const path of TRUSTED_RELEASE_GATE_PATHS) {
		const trustedBlob = readBlobId(trustedSha, path);
		const sourceBlob = readBlobId(sourceSha, path);
		invariant(/^[a-f0-9]{40,64}$/.test(trustedBlob), `Trusted gate object is missing: ${path}.`);
		invariant(/^[a-f0-9]{40,64}$/.test(sourceBlob), `Source gate object is missing: ${path}.`);
		invariant(sourceBlob === trustedBlob, `Source changed trusted release gate object: ${path}.`);
	}
	for (const path of TRUSTED_RELEASE_GATE_ABSENT_PATHS) {
		const trustedBlob = readBlobId(trustedSha, path);
		const sourceBlob = readBlobId(sourceSha, path);
		invariant(trustedBlob === '', `Trusted gate absence path is present: ${path}.`);
		invariant(sourceBlob === '', `Source added trusted release gate execution entry: ${path}.`);
	}
	return {
		trustedSha,
		sourceSha,
		paths: TRUSTED_RELEASE_GATE_PATHS.length,
		absentPaths: TRUSTED_RELEASE_GATE_ABSENT_PATHS.length
	};
}

/** @param {string[]} argv */
export function parseReleaseGateBlobArgs(argv) {
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			['--repository-git-dir', '--trusted-sha', '--source-sha'].includes(flag) &&
				value !== undefined &&
				!value.startsWith('--') &&
				!values.has(flag),
			'Usage: --repository-git-dir <path> --trusted-sha <sha> --source-sha <sha>.'
		);
		values.set(flag, value);
	}
	invariant(values.size === 3, 'All release gate blob arguments are required.');
	return {
		repositoryGitDir: values.get('--repository-git-dir'),
		trustedSha: values.get('--trusted-sha'),
		sourceSha: values.get('--source-sha')
	};
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	try {
		const { repositoryGitDir, trustedSha, sourceSha } = parseReleaseGateBlobArgs(
			process.argv.slice(2)
		);
		/** @param {string} sha @param {string} path */
		const readBlobId = (sha, path) => {
			const result = spawnSync(
				'git',
				['--git-dir', repositoryGitDir, 'rev-parse', '--verify', `${sha}:${path}`],
				{ encoding: 'utf8', shell: false }
			);
			return result.status === 0 ? result.stdout.trim() : '';
		};
		console.log(
			JSON.stringify(verifyReleaseGateBlobIdentity({ trustedSha, sourceSha, readBlobId }))
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
