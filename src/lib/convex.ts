import { PUBLIC_CONVEX_URL } from "$env/static/public";

export const CONVEX_URL = PUBLIC_CONVEX_URL;

// Re-export the generated API for convenient imports from $lib/convex.
// Usage: import { api } from '$lib/convex';
// Note: Components can also import directly from '$convex/_generated/api'
// once the $convex alias is configured in svelte.config.js.
export { api, internal } from "../../convex/_generated/api";
