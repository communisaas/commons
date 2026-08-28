import { env as publicEnv } from '$env/dynamic/public';

// Read at call time. SvelteKit replaces the server-side dynamic environment
// for each request; snapshotting it during module evaluation would capture the
// empty bootstrap object before a Cloudflare request supplies platform.env.
export function getRuntimeConvexUrl(): string | undefined {
	return publicEnv.PUBLIC_CONVEX_URL;
}

// Re-export the generated API for convenient imports from $lib/convex.
// Usage: import { api } from '$lib/convex';
// Note: Components can also import directly from '$convex/_generated/api'
// once the $convex alias is configured in svelte.config.js.
export { api, internal } from '../../convex/_generated/api';
