import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RELEASE_CONTROL_SOURCES = [
	'scripts/capture-cloudflare-queue-free-envelope.mjs',
	'scripts/capture-convex-team-usage-attestation.mjs',
	'scripts/cloudflare-pages-production-control.mjs',
	'scripts/manage-public-template-og-queues.mjs',
	'scripts/manage-public-template-og-workers.mjs',
	'scripts/reconcile-cloudflare-pages-exposure.mjs',
	'scripts/reconcile-public-discovery-r2-lifecycle.mjs',
	'scripts/seed-public-discovery-manifest.mjs',
	'scripts/verify-cloudflare-pages-dev-origin-closure.mjs',
	'scripts/verify-cloudflare-public-dynamic-rate-limit.mjs',
	'scripts/verify-cloudflare-queue-release-phase.mjs',
	'scripts/verify-convex-native-usage-limits.mjs',
	'scripts/verify-convex-work-budget-deployment.mjs',
	'scripts/verify-pages-containment-bindings.mjs',
	'scripts/verify-pages-durable-object-binding.mjs',
	'scripts/verify-pages-preview-release.mjs',
	'scripts/verify-public-discovery-cron-deployment.mjs',
	'scripts/verify-public-template-og-deployment.mjs',
	'workers/public-discovery-manifest-cron.ts'
] as const;

describe('release control-plane network safety', () => {
	it.each(RELEASE_CONTROL_SOURCES)(
		'uses the shared bounded reader and refuses redirects in %s',
		(filePath) => {
			const source = readFileSync(filePath, 'utf8');
			expect(source).toContain('readBoundedResponseJson');
			expect(source).toContain("redirect: 'error'");
			expect(source).not.toMatch(/\bresponse\.(?:arrayBuffer|json|text)\s*\(/u);
		}
	);
});
