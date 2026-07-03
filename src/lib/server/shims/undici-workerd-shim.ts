/**
 * undici → workerd shim (SSR bundle only).
 *
 * Why this exists: `@mendable/firecrawl-js` lazily `await import("undici")` as a
 * Node-only WebSocket fallback (guarded by its own isNodeRuntime() check, so the
 * import is dead code on Cloudflare). But Cloudflare Pages' uploader re-bundles
 * `_worker.js` with wrangler 3.x, whose esbuild follows the dynamic import into
 * the real undici package — and undici ≥7.x hard-references `node:sqlite`
 * (lib/util/runtime-features.js), which wrangler 3.x's hybrid nodejs_compat
 * cannot resolve. The build dies with `Could not resolve "node:sqlite"`.
 *
 * The fix: during the SSR build, `@mendable/firecrawl-js` is inlined
 * (ssr.noExternal) with `undici` aliased to this shim, so the emitted server
 * chunks never reference the undici package at all. workerd provides WebSocket
 * natively; everything else firecrawl could touch on this path is unreachable
 * there by its own runtime guard.
 */

// workerd (and Node ≥22) expose WebSocket on globalThis.
export const WebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

export default { WebSocket };
