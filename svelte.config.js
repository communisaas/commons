import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Atlas host is read from PUBLIC_ATLAS_HOST at config-evaluation time.
// commons.email's atlas remains in the connect-src list as the default fallback,
// so the reference deployment is unchanged when PUBLIC_ATLAS_HOST is unset or
// already equals 'https://atlas.commons.email'. Peer implementations point
// PUBLIC_ATLAS_HOST at their own R2/IPFS-backed atlas; the resulting host is
// appended to connect-src so browser fetches aren't CSP-blocked.
const DEFAULT_ATLAS_HOST = 'https://atlas.commons.email';
const configuredAtlasHost = (process.env.PUBLIC_ATLAS_HOST || '').trim().replace(/\/$/, '');
const atlasHosts = configuredAtlasHost && configuredAtlasHost !== DEFAULT_ATLAS_HOST
	? [DEFAULT_ATLAS_HOST, configuredAtlasHost]
	: [DEFAULT_ATLAS_HOST];

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
				'img-src': [
					'self',
					'data:',
					'blob:',
					'https://tile.openstreetmap.org',
					'https://*.basemaps.cartocdn.com',
					// Shadow Atlas pre-rendered per-district basemap PNGs. Same host
					// as the GeoJSON; mirrors connect-src's atlasHosts treatment.
					...atlasHosts,
					// OAuth provider avatar CDNs (consumed via `user.image` from the
					// providers wired in src/lib/core/auth/oauth-providers.ts).
					'https://*.googleusercontent.com',
					'https://*.fbcdn.net',
					'https://media.licdn.com',
					'https://pbs.twimg.com',
					'https://cdn.discordapp.com',
					'https://avatars.githubusercontent.com'
				],
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
					// Map tiles: Protomaps PMTiles (BubbleTerrain), OSM raster (MapPinSelector), CartoDB Positron (DistrictMap)
					'https://build.protomaps.com',
					'https://demotiles.maplibre.org',
					'https://tile.openstreetmap.org',
					'https://*.basemaps.cartocdn.com',
					// Shadow Atlas data: R2 custom domain (primary read path).
					// commons.email is the default; peer impls add their own host via
					// PUBLIC_ATLAS_HOST (read at build time, see top of this file).
					// IPFS gateways are dormant — re-add gateway domains here when
					// IPFS_CID_ROOT is set and the IPFS fallback path is reactivated.
					...atlasHosts,
					// Convex: HTTP queries + WebSocket subscriptions (dual-stack, Cycle 1)
					'https://*.convex.cloud',
					'wss://*.convex.cloud',
					// Sentry error-monitoring ingest (envelope POSTs from the browser SDK).
					// DSN host is o<org>.ingest.us.sentry.io — the wildcard matches the org
					// subdomain. Without this the SDK's reports are CSP-blocked.
					'https://*.ingest.us.sentry.io'
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
