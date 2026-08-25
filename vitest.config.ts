import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env file for tests (needed for smoke tests that hit real APIs)
const env = loadEnv('test', process.cwd(), '');
Object.assign(process.env, env);
const TEST_RELEASE_SHA =
	typeof process.env.VITE_RELEASE_SHA === 'string' &&
	/^[a-f0-9]{40}$/.test(process.env.VITE_RELEASE_SHA)
		? process.env.VITE_RELEASE_SHA
		: '0'.repeat(40);

/**
 * Test-only module resolver:
 *   - Stub `$lib/server/monitoring/sentry` because the real module loads
 *     @sentry/sveltekit → @sentry/node → @opentelemetry/api@1.9.0, which has
 *     a broken ESM build that crashes Node's native ESM loader in vitest.
 *   - Stub `redis` (optional dep, dynamically imported only when REDIS_URL is
 *     set) so Vite's import analysis doesn't fail when redis isn't installed.
 */
function testModuleStubsPlugin(): Plugin {
	const sentryStubPath = path.join(__dirname, 'tests/mocks/sentry-stub.ts');
	const publicEnvStubPath = path.join(__dirname, 'tests/mocks/public-env-stub.ts');
	return {
		name: 'test-module-stubs',
		enforce: 'pre',
		resolveId(source) {
			if (source === '$env/dynamic/public') {
				return publicEnvStubPath;
			}
			if (
				source === '$lib/server/monitoring/sentry' ||
				source.endsWith('/src/lib/server/monitoring/sentry.ts') ||
				source.endsWith('/src/lib/server/monitoring/sentry')
			) {
				return sentryStubPath;
			}
			if (source === 'redis') {
				return { id: 'redis-stub:virtual', external: true };
			}
		}
	};
}

export default defineConfig({
	define: {
		// Production receives the source-verified SHA from the deploy workflow.
		// Unit tests use a syntactically valid sentinel so readiness behavior can
		// be exercised without pretending a mutable runtime variable is identity.
		'import.meta.env.VITE_RELEASE_SHA': JSON.stringify(TEST_RELEASE_SHA),
		'import.meta.env.VITE_RUNTIME_CONTAINMENT_MODE': JSON.stringify('disabled')
	},
	plugins: [
		testModuleStubsPlugin(),
		sveltekit(),
		svelteTesting({
			resolveBrowser: false, // Don't automatically modify resolve.conditions
			autoCleanup: true, // Use automatic cleanup from @testing-library/svelte/vitest
			noExternal: false // Don't modify ssr.noExternal
		})
	],
	ssr: {
		// redis is an optional dependency (dynamically imported in rate-limiter.ts only when REDIS_URL is set).
		// Externalize it so Vite's import analysis doesn't fail when redis isn't installed.
		external: ['redis']
	},
	resolve: {
		// Standard conditions for Node.js test environment
		// This allows msw/node to resolve correctly
		conditions: ['node', 'import', 'module', 'default'],
		alias: {
			// Stub @voter-protocol/noir-prover in CI where the local package isn't linked
			'@voter-protocol/noir-prover': path.join(
				__dirname,
				'src/lib/core/crypto/voter-protocol-stub.ts'
			)
			// Note: $lib/server/monitoring/sentry stub is wired via testModuleStubsPlugin
			// (pre-plugin) because SvelteKit's $lib resolver overrides resolve.alias.
		}
	},
	test: {
		// File patterns
		include: ['tests/**/*.{test,spec}.{js,ts}', 'convex/**/*.{test,spec}.{js,ts}'],
		exclude: [
			// Exclude Playwright E2E tests (UI-based)
			'tests/e2e/basic-functionality.spec.ts',
			'tests/e2e/identity-verification-flow.spec.ts',
			'tests/e2e/moderation/moderation-pipeline.spec.ts',
			'tests/e2e/regrounding-flow.spec.ts',
			'tests/e2e/auth.setup.ts',
			// Temporarily exclude Svelte component tests - require Svelte 5 browser environment
			// (incompatible with MSW Node.js environment in current config)
			// See: docs/testing/svelte-component-testing.md for migration path
			'tests/unit/ProofGenerator.test.ts',
			'tests/unit/components/AddressChangeFlow.test.ts',
			// Behavioral test for VerificationGate auto-dismiss — requires the
			// components-lane config for @testing-library/svelte + stub modules.
			'tests/unit/components/VerificationGate-auto-dismiss.test.ts',
			// Behavioral test for GovernmentCredentialVerification conditional
			// dead-end copy. Same components-lane setup.
			'tests/unit/components/GovernmentCredentialVerification-conditional-copy.test.ts',
			// Same Svelte 5 lifecycle_function_unavailable issue.
			// `mount(...)` is not available on the server-side render path that
			// runs under the current vitest jsdom + MSW config.
			'tests/unit/components/GroundCard.test.ts',
			// Both mount real components and hit the same `mount(...)` failure here.
			// They pass in the components lane, which resolves the browser build.
			'tests/unit/components/send-text-swap-race.test.ts',
			'tests/unit/components/zzz-integrated-repro.test.ts',
			// Behavioral first-paint test for the Datum spring primitive —
			// needs the components-lane browser runtime to mount.
			'tests/unit/components/datum-first-paint.test.ts',
			// Svelte 5 mount() is unavailable under the default jsdom + MSW lane;
			// runs in the components lane (vitest.components.config.ts).
			'tests/unit/components/TemplateTile.test.ts',
			'tests/unit/components/DomainBand.test.ts',
			'tests/unit/components/SpectrumLandscape.test.ts',
			'tests/unit/components/SpectrumOverview.test.ts',
			'tests/unit/components/RelationGraph.test.ts',
			'tests/unit/components/DescentDive.test.ts',
			// Behavioral test for the delivery-gate conversion prompt — requires
			// the components-lane config for @testing-library/svelte rendering.
			'tests/unit/components/DeliveryGateNotice.test.ts',
			// Mount-based render of the stale-artifact advisory banner (authoring honesty).
			// Components-lane only; same @testing-library/svelte mount path.
			'tests/unit/components/StaleArtifactBanner.test.ts',
			// Behavioral render of the congressional delivery floor (VerificationGate at
			// REQUIRED_CONGRESSIONAL_PROOF_TIER). Components-lane only; the structural
			// single-source lock runs in CI via congressional-delivery-tier.test.ts.
			'tests/unit/components/congressional-delivery-gate.behavior.test.ts',
			// Renders the preview footer to prove it equals the outgoing mailto body.
			// Components-lane only; the builder semantics run in CI via
			// tests/unit/identity/attestation-parity.test.ts.
			'tests/unit/components/attestation-parity.test.ts',
			// Mounts TemplatePreview across the sign-in round trip to prove a note the
			// lane cannot carry is discarded, cleared and announced. Components-lane
			// only; the lane decision itself runs in CI via tests/unit/send-lane.test.ts.
			'tests/unit/components/template-preview-sender-text.test.ts',
			// Mounts TemplateModal to prove the honest receipt and the unobserved
			// hand-off state are actually rendered, not just declared. Components-lane
			// only; the evidence table itself runs in CI via
			// tests/unit/send-evidence-honesty.test.ts.
			'tests/unit/components/send-handoff-honesty.test.ts',
			'tests/unit/components/free-lane-exhaustion-copy.test.ts',
			// Mounts the stranger's `/s/[slug]` send surface to prove an empty shared
			// pool renders as the shared pool, not "temporarily unavailable".
			// Components-lane only.
			'tests/unit/components/stranger-pool-exhaustion-copy.test.ts',
			'tests/unit/components/decision-maker-results-delivery-tier.test.ts',
			// Mounts PowerLandscape for the per-row route sentence. Components-lane only.
			'tests/unit/components/landscape-card-measured-route.test.ts',
			// Mounts PowerLandscape and TemplatePreview with a stranger's props to prove the
			// batch promise equals the addressable set. Components-lane only.
			'tests/unit/components/arrival-reach-honesty.test.ts',
			// Post-Convex migration: these tests reference deleted source files,
			// missing Convex URL config, or stale assertions. Need rewriting against Convex.
			'tests/integration/analytics-aggregate.test.ts',
			'tests/integration/oauth-resumption.test.ts',
			'tests/integration/dp-end-to-end.test.ts',
			'tests/unit/agents/source-cache.test.ts',
			// Tests below mock the deleted `$lib/core/db` Prisma path or import
			// removed source modules; legitimately need rewriting against the
			// Convex-only stack. Identified via `vi.mock('$lib/core/db', ...)`
			// grep — re-run that grep before adding to this list.
			'tests/unit/events/event-crud.test.ts',
			'tests/unit/fundraising/donation-api-v1.test.ts',
			'tests/unit/fundraising/donation-checkout.test.ts',
			'tests/unit/fundraising/fundraising-crud.test.ts',
			'tests/unit/geographic/api-v1-reps.test.ts',
			'tests/unit/geographic/campaign-targeting.test.ts',
			'tests/unit/networks/network-api-v1.test.ts',
			'tests/unit/scorecard/api.test.ts',
			'tests/unit/sms/patch-through-call.test.ts',
			'tests/unit/sms/sms-api-v1.test.ts',
			'tests/unit/sms/sms-crud.test.ts',
			'tests/unit/wallet/wallet-api.test.ts',
			// Skip-only stub tests for deleted helpers (5-line files with single
			// `describe.skip` block). Still need rewriting against the new
			// implementation; left excluded to keep the runner output clean.
			'tests/unit/api/cron-analytics-snapshot.test.ts',
			'tests/unit/billing/usage.test.ts',
			'tests/unit/dp-contribution-bounding.test.ts',
			'tests/unit/scorecard/compute.test.ts',
			'tests/unit/server/reacher-client.test.ts',
			// Directly imports convex/_generated/api which isn't available in CI:
			'tests/unit/agents/stream-endpoints.test.ts'
		],

		// Environment configuration
		environment: 'jsdom',
		setupFiles: [
			'tests/setup/api-test-setup.ts', // MSW setup FIRST so it can intercept fetch
			'tests/config/setup.ts',
			'@testing-library/svelte/vitest' // Adds setup() and cleanup() for Svelte 5
		],
		globals: true,

		// MSW v2 Node.js compatibility - resolve server imports correctly
		server: {
			deps: {
				inline: ['msw'], // MSW must be inlined for Node.js ESM compatibility
				external: ['redis'] // redis is optional (rate-limiter.ts dynamic import), not available in test env
			}
		},

		// Performance optimizations
		pool: 'forks', // Better isolation for integration tests
		poolOptions: {
			forks: {
				singleFork: false, // Enable parallelism for unit tests
				minForks: 1,
				maxForks: 4 // Use up to 4 parallel processes
			}
		},
		// Run integration tests sequentially to avoid database interference
		// Unit tests can still run in parallel
		fileParallelism: false, // Prevent race conditions in shared database tests

		// Test execution settings (CI-aware)
		testTimeout: process.env.CI ? 15000 : 10000, // Longer timeouts for CI
		hookTimeout: process.env.CI ? 15000 : 10000, // DB cold start needs headroom

		// Mock optimizations
		clearMocks: true, // Clear mocks between tests
		restoreMocks: true, // Restore original implementations

		// Coverage configuration - HONEST MEASUREMENT
		coverage: {
			provider: 'v8', // Svelte-aware coverage provider
			reporter: ['text', 'html', 'json', 'lcov', 'cobertura'],
			reportsDirectory: './coverage',

			// Include ALL source code for honest measurement
			include: ['src/**/*.{js,ts,svelte}'],

			// Minimal exclusions - only build artifacts and tests
			exclude: [
				'node_modules/**',
				'tests/**',
				'**/*.d.ts',
				'**/*.config.{js,ts}',
				'**/coverage/**',
				'e2e/**',
				'**/*.spec.ts',
				'**/*.test.ts',
				'build/',
				'.svelte-kit/',
				'src/app.html'
			],

			// HONEST thresholds - meaningful minimums to prevent regression
			thresholds: {
				global: {
					branches: 20, // Realistic starting point from current reality
					functions: 20, // Build up from current state
					lines: 20, // Incremental improvement targets
					statements: 20 // Honest measurement, not theater
				},
				// Higher standards for critical production paths
				'src/lib/core/auth/': {
					branches: 40,
					functions: 40,
					lines: 40,
					statements: 40
				},
				'src/routes/api/': {
					branches: 30,
					functions: 30,
					lines: 30,
					statements: 30
				}
			},

			// Include all source files in coverage report
			all: true
		},

		// Enhanced reporting for CI
		reporter: process.env.CI ? ['verbose', 'junit', 'json'] : ['verbose'],
		outputFile: {
			junit: './coverage/junit-results.xml',
			json: './coverage/test-results.json'
		}
	}
});
