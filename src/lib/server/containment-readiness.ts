import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { matchInternalSecretValues } from '$lib/server/internal/secret-auth';
import { resolveSessionCookieSigningSecrets } from '$lib/server/auth/session-cookie';
import {
	RUNTIME_CONTAINMENT_MODE,
	type RuntimeContainmentMode
} from '$lib/server/runtime-containment';

const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;

export type ContainmentReadinessEnv = {
	CONVEX_WORK_BUDGET?: DurableObjectNamespace;
	INTERNAL_API_SECRET?: string;
	INTERNAL_API_SECRET_PREVIOUS?: string;
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE?: DurableObjectNamespace;
	PUBLIC_DISCOVERY_R2?: R2Bucket;
	SESSION_CREATION_SECRET?: string;
	SESSION_CREATION_SECRET_PREVIOUS?: string;
	SESSION_COOKIE_SIGNING_SECRET?: string;
	SESSION_COOKIE_SIGNING_SECRET_PREVIOUS?: string;
};

export function normalizeContainmentReleaseSha(value: unknown): string | null {
	return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

function sessionCookieKeysAreIsolated(env: ContainmentReadinessEnv | undefined): boolean {
	try {
		resolveSessionCookieSigningSecrets({
			activeSecret: env?.SESSION_COOKIE_SIGNING_SECRET,
			previousSecret: env?.SESSION_COOKIE_SIGNING_SECRET_PREVIOUS,
			sessionCreationSecret: env?.SESSION_CREATION_SECRET,
			previousSessionCreationSecret: env?.SESSION_CREATION_SECRET_PREVIOUS
		});
		return true;
	} catch {
		return false;
	}
}

export function evaluateContainmentReadiness(input: {
	authenticated: boolean;
	mode: RuntimeContainmentMode;
	releaseSha: unknown;
	env: ContainmentReadinessEnv | undefined;
}) {
	const releaseSha = normalizeContainmentReleaseSha(input.releaseSha);
	// Containment is a capability-minimal artifact, not a degraded normal
	// deployment. Treat even a malformed or partial binding value as present: a
	// trusted config proof owns the stronger control-plane assertion that neither
	// binding was declared, while this runtime proof rejects any capability that
	// nevertheless reaches the artifact.
	const r2Bound = input.env?.PUBLIC_DISCOVERY_R2 !== undefined;
	const refreshGateBound = input.env?.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE !== undefined;
	const workBudgetBound = input.env?.CONVEX_WORK_BUDGET !== undefined;
	const discoveryBindingsAbsent = !r2Bound && !refreshGateBound && !workBudgetBound;
	const keysIsolated = sessionCookieKeysAreIsolated(input.env);
	const containmentActive = input.mode === 'maintenance';
	const ready =
		input.authenticated &&
		containmentActive &&
		releaseSha !== null &&
		discoveryBindingsAbsent &&
		keysIsolated;

	return {
		status: ready ? ('ok' as const) : ('down' as const),
		mode: input.mode,
		authentication: {
			status: input.authenticated ? ('ok' as const) : ('down' as const),
			internalSecretAccepted: input.authenticated
		},
		containment: {
			status: containmentActive ? ('ok' as const) : ('down' as const),
			active: containmentActive
		},
		release: {
			status: releaseSha === null ? ('down' as const) : ('ok' as const),
			sha: releaseSha
		},
		publicDiscoveryCache: {
			status: discoveryBindingsAbsent ? ('isolated' as const) : ('down' as const),
			bindingsAbsent: discoveryBindingsAbsent,
			r2Bound,
			refreshGateBound,
			workBudgetBound
		},
		sessionCookieAuthority: {
			status: keysIsolated ? ('ok' as const) : ('down' as const),
			keysIsolated
		},
		// This endpoint only inspects local artifact identity, binding absence,
		// authentication, and secret separation. It deliberately invokes no binding,
		// fetch, Convex client, Atlas client, or Cache API operation.
		externalDependencies: {
			status: 'isolated' as const,
			calls: 0,
			convexCalls: 0,
			atlasCalls: 0,
			r2Calls: 0,
			durableObjectCalls: 0
		}
	};
}

export function createContainmentReadinessHandler(
	mode: RuntimeContainmentMode = RUNTIME_CONTAINMENT_MODE,
	releaseSha: unknown = BUILD_RELEASE_SHA
): RequestHandler {
	return async ({ platform, request }) => {
		const env = platform?.env as ContainmentReadinessEnv | undefined;
		const authenticated = matchInternalSecretValues(
			request.headers.get('x-internal-secret'),
			env?.INTERNAL_API_SECRET,
			env?.INTERNAL_API_SECRET_PREVIOUS
		);
		if (!authenticated.ok) {
			return json(
				{ status: 'unauthorized', liveness: '/api/live' },
				{ status: 401, headers: { 'Cache-Control': 'no-store' } }
			);
		}

		const snapshot = evaluateContainmentReadiness({
			authenticated: true,
			mode,
			releaseSha,
			env
		});
		return json(snapshot, {
			status: snapshot.status === 'ok' ? 200 : 503,
			headers: {
				'Cache-Control': 'no-store',
				'CDN-Cache-Control': 'no-store',
				'Cloudflare-CDN-Cache-Control': 'no-store'
			}
		});
	};
}
