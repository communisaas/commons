import type { Handle } from '@sveltejs/kit';
import { isAttestedPublicDiscoveryBootstrapRequest } from '$lib/server/public-discovery-bootstrap-runtime';

export const RUNTIME_CONTAINMENT_MODE =
	import.meta.env.VITE_RUNTIME_CONTAINMENT_MODE === 'maintenance'
		? ('maintenance' as const)
		: ('disabled' as const);

export type RuntimeContainmentMode = 'disabled' | 'maintenance';

const IO_FREE_ROUTES = new Set(['/api/live', '/api/containment-readiness']);
const IO_FREE_METHODS = new Set(['GET', 'HEAD']);
const MAINTENANCE_BODY = `${JSON.stringify({
	status: 'maintenance',
	mode: 'containment',
	code: 'SERVICE_CONTAINMENT'
})}\n`;

export type RuntimeContainmentDecision =
	| 'application'
	| 'bootstrap-route'
	| 'io-free-route'
	| 'maintenance';

/**
 * The containment artifact is compiled as a distinct runtime mode. Its only
 * pass-through routes are process liveness and the authenticated, local-only
 * containment attestation. Everything else stops before application hooks.
 */
export function decideRuntimeContainmentRequest(
	request: Request,
	mode: RuntimeContainmentMode = RUNTIME_CONTAINMENT_MODE
): RuntimeContainmentDecision {
	if (mode === 'disabled') return 'application';
	if (isAttestedPublicDiscoveryBootstrapRequest(request)) return 'bootstrap-route';
	const pathname = new URL(request.url).pathname;
	if (IO_FREE_METHODS.has(request.method) && IO_FREE_ROUTES.has(pathname)) {
		return 'io-free-route';
	}
	return 'maintenance';
}

export function runtimeContainmentResponse(): Response {
	return new Response(MAINTENANCE_BODY, {
		status: 503,
		headers: {
			'Cache-Control': 'no-store',
			'CDN-Cache-Control': 'no-store',
			'Cloudflare-CDN-Cache-Control': 'no-store',
			'Content-Type': 'application/json; charset=utf-8',
			'Retry-After': '60',
			'X-Content-Type-Options': 'nosniff',
			'X-Commons-Runtime-Mode': 'containment'
		}
	});
}

/**
 * Dispatch before Sentry, platform-env/Atlas setup, auth, Convex, rate limits,
 * and route-level application code. The allowlisted endpoints go directly to
 * SvelteKit routing; they never enter the application hook chain.
 */
export async function dispatchRuntimeRequest(
	input: Parameters<Handle>[0],
	applicationHandle: Handle,
	mode: RuntimeContainmentMode = RUNTIME_CONTAINMENT_MODE
): Promise<Response> {
	const decision = decideRuntimeContainmentRequest(input.event.request, mode);
	if (decision === 'maintenance') return runtimeContainmentResponse();
	if (decision === 'io-free-route') return input.resolve(input.event);
	return applicationHandle(input);
}
