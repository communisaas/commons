import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [vitePreprocess()],

	kit: {
		// $convex alias: allows `import { api } from '$convex/_generated/api'`
		// in component code. The convex/ directory is at the project root (outside src/),
		// so SvelteKit needs an explicit alias to resolve it.
		alias: {
			'$convex': 'convex'
		},
		adapter: adapterCloudflare({
			prerender: {
				handleHttpError: 'warn',
				handleMissingId: 'warn'
			}
		}),
		// BR5-015: Content Security Policy — SvelteKit auto-injects nonces for its inline scripts.
		// Mode 'auto' uses hashes for prerendered pages, nonces for dynamic pages.
		// 'wasm-unsafe-eval' required for Noir/Barretenberg WASM execution.
		// COOP/COEP headers remain in hooks.server.ts (not part of CSP).
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self', 'https://fonts.gstatic.com'],
				'connect-src': [
					'self',
					'https://nominatim.openstreetmap.org',
					'https://crs.aztec.network',
					// Barretenberg WASM (Poseidon hashing) loads via data: URI
					'data:',
					'blob:',
					// F4: Scroll RPC — debate-client.ts, evm-provider.ts (browser-side chain reads + tx submission)
					'https://sepolia-rpc.scroll.io',
					'https://rpc.scroll.io',
					// F4: NEAR RPC — chain-signatures.ts via near-provider.ts (browser-side MPC signing)
					'https://rpc.testnet.near.org',
					'https://rpc.mainnet.near.org',
					// Storacha IPFS: client-side ZKP district lookup (Shadow Atlas cell chunks)
					// Bare domain for path-style fetch, wildcard for subdomain redirect
					'https://storacha.link',
					'https://*.storacha.link',
					'https://w3s.link',
					'https://*.w3s.link',
					// Convex: HTTP queries + WebSocket subscriptions (dual-stack, Cycle 1)
					'https://*.convex.cloud',
					'wss://*.convex.cloud'
				],
				'worker-src': ['self', 'blob:'],
				'object-src': ['none'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'upgrade-insecure-requests': true
			}
		},
		// BA-010: CSRF origin checking is enabled by default (trustedOrigins: []).
		// All non-GET requests must have a matching Origin header.
		// External webhooks (e.g., Didit) that lack a browser Origin header
		// are allowed through because server-to-server requests typically omit Origin.
		// SvelteKit only blocks requests where Origin is present but mismatched.
		env: {
			dir: '.',
			publicPrefix: 'PUBLIC_'
		},
		// Experimental: Server instrumentation for Sentry
		// Enables src/instrumentation.server.ts to initialize before SvelteKit
		experimental: {
			instrumentation: {
				server: true
			}
		}
	},

	extensions: ['.svelte']
};

export default config;
