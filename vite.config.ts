import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import wasm from 'vite-plugin-wasm';
import alias from '@rollup/plugin-alias';
import { fileURLToPath } from 'url';

// Suppress spurious MaxListenersExceededWarning from SvelteKit HMR child processes
process.setMaxListeners(20);

// Resolve paths for alias configuration
const bufferShimPath = fileURLToPath(
	new URL('./src/lib/core/proof/buffer-shim.ts', import.meta.url)
);
const pinoShimPath = fileURLToPath(new URL('./src/lib/core/proof/pino-shim.ts', import.meta.url));
const voterProtocolStubPath = fileURLToPath(
	new URL('./src/lib/core/crypto/voter-protocol-stub.ts', import.meta.url)
);

export default defineConfig({
	plugins: [
		// Client-only buffer/pino shims for @aztec/bb.js ZK proving.
		// CRITICAL: Must NOT apply to SSR — server-side Node.js needs real buffer.
		{
			name: 'client-only-shims',
			enforce: 'pre',
			resolveId(source, _importer, options) {
				if (options?.ssr) return null;
				if (source === 'buffer') return bufferShimPath;
				if (source === 'pino') return pinoShimPath;
				return null;
			}
		},
		// Stub @voter-protocol/noir-prover ONLY during SSR.
		// SSR only needs BN254_MODULUS (a constant). Client needs the real package
		// with WASM prover for in-browser ZK proof generation.
		{
			name: 'voter-protocol-ssr-stub',
			resolveId(source, _importer, options) {
				if (source === '@voter-protocol/noir-prover' && options?.ssr) {
					return voterProtocolStubPath;
				}
				return null;
			}
		},
		wasm(),
		sveltekit()
	],

	// Use native top-level await with esnext target (replaces vite-plugin-top-level-await)
	build: {
		target: 'esnext',
		rollupOptions: {
			external: [
				// 'redis' is optionally imported in rate-limiter.ts (only when REDIS_URL is set).
				// Not available on Cloudflare Workers (no TCP).
				'redis',
				// ai-evaluator lives in voter-protocol monorepo, dynamically imported with try/catch fallback.
				// Not published to npm yet — evaluate endpoint returns 503 when unavailable.
				'@voter-protocol/ai-evaluator',
				// Sharp requires native binaries not available on Workers.
				'sharp',
				// node-fetch is transitive (via @google/genai → google-auth-library → gaxios,
				// and near-api-js). CF Workers has native fetch — this is dead weight.
				'node-fetch',
				// google-auth-library is transitive via @google/genai. Never instantiated
				// because we always pass apiKey (not Vertex AI service account auth).
				'google-auth-library',
				// ethers is 1 MB. Used in 23+ wallet/debate files but doesn't need to be
				// inlined — available at runtime via node_modules resolution.
				'ethers'
				// Note: @voter-protocol/noir-prover is stubbed via voter-protocol-ssr-stub plugin (SSR only).
				// Client gets the real package for in-browser ZK proving.
			]
		}
	},

	// Polyfill Node.js globals for browser (needed for @aztec/bb.js)
	// NOTE: buffer/pino aliases are applied ONLY via the alias() plugin (client + workers).
	// resolve.alias is NOT used because it also applies to SSR, which breaks pg/Prisma
	// (SSR needs the real Node.js buffer, not the browser shim).
	resolve: {},

	optimizeDeps: {
		exclude: [
			'chunk-PCGYAOMB.js',
			// Exclude noir-lang packages so their WASM files load correctly
			'@noir-lang/noir_js',
			'@noir-lang/acvm_js',
			'@noir-lang/noirc_abi',
			// CRITICAL: Exclude bb.js so its internal worker URL resolution works correctly
			// When pre-bundled, new URL('./main.worker.js', import.meta.url) breaks
			// because import.meta.url points to .vite/deps/ instead of node_modules/
			'@aztec/bb.js',
			// Exclude noir-prover so its WASM/worker deps resolve correctly (same reason as bb.js)
			'@voter-protocol/noir-prover'
		]
		// Note: Buffer alias is applied via resolve.alias which works even without pre-bundling
	},

	// Enable WASM support
	assetsInclude: ['**/*.wasm'],

	ssr: {},

	worker: {
		format: 'es',
		plugins: () => [
			// CRITICAL: Apply alias plugin to workers so bare 'buffer' imports resolve to our shim
			// Without this, workers in dev mode can't resolve bare imports like 'buffer'
			alias({
				entries: [
					{ find: 'buffer', replacement: bufferShimPath },
					{ find: 'pino', replacement: pinoShimPath }
				]
			}),
			wasm()
		],
		rollupOptions: {
			external: [
				'@voter-protocol/noir-prover'
			],
			output: {
				inlineDynamicImports: false
			}
		}
	},

	// Add cross-origin isolation headers for SharedArrayBuffer support (required for ZK proving)
	server: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		},
		fs: {
			// Allow serving files from linked npm packages (for local testing)
			// Also allow serving WASM files from node_modules
			allow: ['..', './node_modules']
		},
		watch: {
			ignored: ['**/convex/_generated/**']
		}
	},

	// Ensure preview server also has COOP/COEP headers
	preview: {
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		}
	},

	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		environment: 'jsdom',
		setupFiles: ['./src/test-setup.ts'],
		globals: true,
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'html', 'json', 'lcov'],
			reportsDirectory: './coverage',
			exclude: [
				'node_modules/**',
				'src/test/**',
				'**/*.d.ts',
				'**/*.config.{js,ts}',
				'**/coverage/**',
				'e2e/**',
				'prisma/**',
				'**/*.spec.ts',
				'**/*.test.ts'
			],
			include: ['src/**/*.{js,ts,svelte}'],
			thresholds: {
				global: {
					branches: 70,
					functions: 70,
					lines: 70,
					statements: 70
				}
			}
		}
	},

	// Separate configuration for Svelte component tests
	define: {
		'import.meta.vitest': undefined
	}
});
