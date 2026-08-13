import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ConvexHttpClient } from 'convex/browser';
import { api, getRuntimeConvexUrl } from '$lib/convex';
import { getInternalSecret, matchInternalSecret } from '$lib/server/internal/secret-auth';
import { resolveSessionCookieSigningSecrets } from '$lib/server/auth/session-cookie';
import { budgetedServerQuery } from '$lib/server/convex-work-budget';
import {
	readPublicDiscoveryPublicationStatus,
	type PublicDiscoveryPublicationStatus
} from '$lib/server/public-discovery-manifest-shield';
import { paidProviderRuntimeReadiness } from '$lib/server/paid-provider-runtime-readiness';

const startTime = Date.now();
const HEALTH_PROBE_TIMEOUT_MS = 5_000;
const BUILD_RELEASE_SHA = import.meta.env.VITE_RELEASE_SHA as string | undefined;
const CONVEX_REALMS = {
	nonproduction: 'https://outstanding-firefly-831.convex.cloud',
	production: 'https://quirky-chinchilla-352.convex.cloud'
} as const;
const REQUIRED_LAUNCH_PROJECTION_PLANES = [
	'discoverySource',
	'endorsementCounts',
	'templateList',
	'recipientMetrics',
	'sessionAuthority',
	'campaignReadModel',
	'campaignCounters',
	'debateReadModel',
	'organizationDirectory',
	'coalitionMetrics',
	'networkCharters',
	'supporterBrowse',
	'supporterAudienceActions',
	'accountabilityReadModel',
	'planUsage',
	'workflowExecutionCounts',
	'donationConfirmationSummaries',
	'smsReplySummaries'
] as const;

type HealthEnv = {
	ATLAS_BASE_URL?: string;
	EXPECTED_CELL_MAP_ROOT?: string;
	EXPECTED_CELL_MAP_DEPTH?: string;
	PUBLIC_CONVEX_URL?: string;
	PUBLIC_RELEASE_TRANSACTION_ID?: string;
	CONVEX_WORK_BUDGET?: DurableObjectNamespace;
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE?: DurableObjectNamespace;
	PUBLIC_DISCOVERY_R2?: R2Bucket;
	SESSION_CREATION_SECRET?: string;
	SESSION_CREATION_SECRET_PREVIOUS?: string;
	SESSION_COOKIE_SIGNING_SECRET?: string;
	SESSION_COOKIE_SIGNING_SECRET_PREVIOUS?: string;
	EXA_API_KEY?: string;
	FIRECRAWL_API_KEY?: string;
	GEMINI_API_KEY?: string;
	GROQ_API_KEY?: string;
	PAID_PROVIDER_OPERATOR_USER_IDS?: string;
};

type AtlasHealth = Awaited<ReturnType<typeof checkAtlas>>;
type HealthSnapshot = {
	checkedAt: number;
	status: 'down' | 'ok';
	convex: boolean;
	convexRealm: 'nonproduction' | 'production' | 'unknown';
	atlas: AtlasHealth;
	publicDiscoveryCache: {
		status: 'down' | 'ok';
		r2Bound: boolean;
		refreshGateBound: boolean;
		workBudgetBound: boolean;
		publication: PublicDiscoveryPublicationStatus;
	};
	release: {
		status: 'down' | 'ok';
		sha: string | null;
		transactionId: string | null;
	};
	sessionCookieAuthority: {
		status: 'down' | 'ok';
		keysIsolated: boolean;
	};
	paidProvider: {
		status: 'down' | 'ok';
		budgetCoordinatorBound: boolean;
		operatorAllowlistConfigured: boolean;
		providerSecretsConfigured: boolean;
		missingBindings: readonly string[];
	};
};

/**
 * Validate the secret-bearing Convex destination against the exact approved
 * deployment realms. The effective URL is runtime-bound so the byte-identical
 * production artifact can prove itself against the isolated preview realm;
 * the Convex SDK constructor alone is not an egress boundary for the internal
 * secret.
 */
function pinnedConvexHealthOrigin(env: HealthEnv | undefined): string {
	const parseHostedOrigin = (value: unknown): URL => {
		let parsed: URL;
		try {
			if (typeof value !== 'string' || value.length === 0) {
				throw new Error('missing');
			}
			parsed = new URL(value);
		} catch {
			throw new Error('Invalid Convex health URL');
		}
		if (
			parsed.protocol !== 'https:' ||
			!parsed.hostname.endsWith('.convex.cloud') ||
			parsed.port !== '' ||
			parsed.username !== '' ||
			parsed.password !== '' ||
			parsed.pathname !== '/' ||
			parsed.search !== '' ||
			parsed.hash !== ''
		) {
			throw new Error('Invalid Convex health URL');
		}
		return parsed;
	};

	const runtimeFallback = getRuntimeConvexUrl();
	const effective = parseHostedOrigin(env?.PUBLIC_CONVEX_URL || runtimeFallback);
	const approved = new Set<string>(Object.values(CONVEX_REALMS));
	if (!approved.has(effective.origin)) {
		throw new Error('Convex health URL is not an approved deployment realm');
	}
	return effective.origin;
}

export const GET: RequestHandler = async ({ platform, request, locals }) => {
	// Dependency readiness is an authenticated operations surface. A public
	// cache still permits one origin miss per Cloudflare location, which turns a
	// distributed probe flood into Convex/Atlas work. Public monitors must use
	// the I/O-free /api/live endpoint; deployment and readiness monitors carry
	// the rotating internal secret and deliberately obtain a fresh result.
	if (!matchInternalSecret(request.headers.get('x-internal-secret')).ok) {
		return json(
			{ status: 'unauthorized', liveness: '/api/live' },
			{ status: 401, headers: { 'Cache-Control': 'no-store' } }
		);
	}
	locals.convexWorkBudgetOperatorAuthorized = true;
	const env = platform?.env as HealthEnv | undefined;
	const r2Bound =
		typeof env?.PUBLIC_DISCOVERY_R2?.get === 'function' &&
		typeof env.PUBLIC_DISCOVERY_R2.put === 'function' &&
		typeof env.PUBLIC_DISCOVERY_R2.list === 'function' &&
		typeof env.PUBLIC_DISCOVERY_R2.delete === 'function';
	const refreshGateBound =
		typeof env?.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE?.idFromName === 'function' &&
		typeof env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE.get === 'function';
	const workBudgetBound =
		typeof env?.CONVEX_WORK_BUDGET?.idFromName === 'function' &&
		typeof env.CONVEX_WORK_BUDGET.get === 'function';
	const snapshot = await computeHealthSnapshot(
		platform,
		env,
		r2Bound,
		refreshGateBound,
		workBudgetBound
	);
	const code = snapshot.status === 'ok' ? 200 : 503;

	return json(
		{
			status: snapshot.status,
			convex: snapshot.convex,
			convexRealm: snapshot.convexRealm,
			atlas: snapshot.atlas,
			publicDiscoveryCache: snapshot.publicDiscoveryCache,
			release: snapshot.release,
			sessionCookieAuthority: snapshot.sessionCookieAuthority,
			paidProvider: snapshot.paidProvider,
			uptime: Math.floor((Date.now() - startTime) / 1000)
		},
		{ status: code, headers: { 'Cache-Control': 'no-store' } }
	);
};

async function computeHealthSnapshot(
	platform: App.Platform | undefined,
	env: HealthEnv | undefined,
	r2Bound: boolean,
	refreshGateBound: boolean,
	workBudgetBound: boolean
): Promise<HealthSnapshot> {
	const [atlas, convex, publication] = await Promise.all([
		checkAtlas(env),
		checkConvex(env),
		checkPublicDiscoveryPublication(platform)
	]);
	const keysIsolated = sessionCookieKeysIsolated(env);
	const paidProvider = paidProviderRuntimeReadiness(env);
	const releaseSha = _normalizeExactReleaseSha(BUILD_RELEASE_SHA);
	const releaseTransactionId = _normalizeExactReleaseTransaction(
		env?.PUBLIC_RELEASE_TRANSACTION_ID
	);
	const ready =
		convex.ready &&
		atlas.status === 'ok' &&
		r2Bound &&
		refreshGateBound &&
		workBudgetBound &&
		publication.healthy &&
		keysIsolated &&
		paidProvider.ready &&
		releaseSha !== null &&
		releaseTransactionId !== null;
	return {
		checkedAt: Date.now(),
		status: ready ? 'ok' : 'down',
		convex: convex.ready,
		convexRealm: convex.realm,
		atlas,
		publicDiscoveryCache: {
			status: r2Bound && refreshGateBound && workBudgetBound && publication.healthy ? 'ok' : 'down',
			r2Bound,
			refreshGateBound,
			workBudgetBound,
			publication
		},
		release: {
			status: releaseSha === null || releaseTransactionId === null ? 'down' : 'ok',
			sha: releaseSha,
			transactionId: releaseTransactionId
		},
		sessionCookieAuthority: {
			status: keysIsolated ? 'ok' : 'down',
			keysIsolated
		},
		paidProvider: {
			status: paidProvider.ready && workBudgetBound ? 'ok' : 'down',
			budgetCoordinatorBound: workBudgetBound,
			operatorAllowlistConfigured: paidProvider.operatorAllowlistConfigured,
			providerSecretsConfigured: paidProvider.providerSecretsConfigured,
			missingBindings: paidProvider.missingBindings
		}
	};
}

function unavailablePublicationStatus(): PublicDiscoveryPublicationStatus {
	return {
		healthy: false,
		lagAgeMs: null,
		lagStartedAt: null,
		phase: 'unknown',
		servedGeneration: null,
		status: 'unavailable',
		targetGeneration: null,
		terminalCode: null
	};
}

async function checkPublicDiscoveryPublication(
	platform: App.Platform | undefined
): Promise<PublicDiscoveryPublicationStatus> {
	if (!platform) return unavailablePublicationStatus();
	try {
		return await readPublicDiscoveryPublicationStatus({ platform });
	} catch {
		return unavailablePublicationStatus();
	}
}

export function _normalizeExactReleaseSha(value: unknown): string | null {
	return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

export function _normalizeExactReleaseTransaction(value: unknown): string | null {
	return typeof value === 'string' && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,9}$/.test(value)
		? value
		: null;
}

function sessionCookieKeysIsolated(env: HealthEnv | undefined): boolean {
	try {
		resolveSessionCookieSigningSecrets({
			activeSecret: env?.SESSION_COOKIE_SIGNING_SECRET ?? process.env.SESSION_COOKIE_SIGNING_SECRET,
			previousSecret:
				env?.SESSION_COOKIE_SIGNING_SECRET_PREVIOUS ??
				process.env.SESSION_COOKIE_SIGNING_SECRET_PREVIOUS,
			sessionCreationSecret: env?.SESSION_CREATION_SECRET ?? process.env.SESSION_CREATION_SECRET,
			previousSessionCreationSecret:
				env?.SESSION_CREATION_SECRET_PREVIOUS ?? process.env.SESSION_CREATION_SECRET_PREVIOUS
		});
		return true;
	} catch {
		return false;
	}
}

async function checkConvex(
	env: HealthEnv | undefined
): Promise<{ ready: boolean; realm: 'nonproduction' | 'production' | 'unknown' }> {
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		// The secret-gated producer status performs one indexed read of the tiny
		// public-discovery manifest singleton, exercising the data plane without
		// exposing failure or refresh timing to anonymous Convex callers. Use a
		// request-local HTTP client so the deadline aborts the underlying fetch
		// rather than merely abandoning an unbounded serverQuery promise.
		// Resolve and pin the destination before constructing a client or reading
		// the shared secret. A mutable public env var must never become a secret
		// exfiltration target, including another tenant's valid Convex deployment.
		const convexOrigin = pinnedConvexHealthOrigin(env);
		const realm =
			convexOrigin === CONVEX_REALMS.production
				? 'production'
				: convexOrigin === CONVEX_REALMS.nonproduction
					? 'nonproduction'
					: 'unknown';
		const client = new ConvexHttpClient(convexOrigin, {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal: controller.signal })
		});
		timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
		const result = await budgetedServerQuery(api.observability.discoveryProducerStatus, () =>
			client.query(api.observability.discoveryProducerStatus, {
				_secret: getInternalSecret()
			})
		);
		const launchPlanesReady = exactLaunchProjectionPlanesReady(result.launchProjectionPlanes);
		const producerScheduleHealthy =
			result.discoveryProducerOverdueAt === null ||
			(typeof result.discoveryProducerOverdueAt === 'number' &&
				Number.isFinite(result.discoveryProducerOverdueAt) &&
				Date.now() <= result.discoveryProducerOverdueAt);
		return {
			ready:
				result.ok === true &&
				result.storageReadable === true &&
				result.discoveryManifestPresent === true &&
				result.discoverySourcePlaneReady === true &&
				result.discoveryEndorsementCountsReady === true &&
				result.templateListProjectionReady === true &&
				result.recipientMetricsReady === true &&
				result.launchProjectionsReady === true &&
				launchPlanesReady &&
				result.discoveryProducerHealthy === true &&
				producerScheduleHealthy,
			realm
		};
	} catch {
		return { ready: false, realm: 'unknown' };
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

/**
 * Fail closed on both missing and newly-added projection planes. Keeping this
 * list exact means a backend rollout cannot silently add a required cutover
 * while an older Pages artifact continues declaring readiness.
 */
function exactLaunchProjectionPlanesReady(value: unknown): boolean {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
	const planes = value as Record<string, unknown>;
	const keys = Object.keys(planes).sort();
	const required = [...REQUIRED_LAUNCH_PROJECTION_PLANES].sort();
	if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
		return false;
	}
	return REQUIRED_LAUNCH_PROJECTION_PLANES.every((name) => {
		const candidate = planes[name];
		if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
			return false;
		}
		const plane = candidate as Record<string, unknown>;
		return (
			plane.ready === true &&
			typeof plane.status === 'string' &&
			plane.status.length > 0 &&
			plane.status !== 'missing' &&
			plane.failureCode === null
		);
	});
}

/** Test-only reset for module-local readiness state. */
export function _clearHealthProbeCacheForTests(): void {
	// Retained as a no-op compatibility hook for focused tests. Readiness is
	// secret-gated and deliberately fresh; there is no public dependency cache.
}

async function checkAtlas(env: HealthEnv | undefined) {
	const baseUrl = (env?.ATLAS_BASE_URL || process.env.ATLAS_BASE_URL || '').replace(/\/$/, '');
	const expectedRoot = env?.EXPECTED_CELL_MAP_ROOT || process.env.EXPECTED_CELL_MAP_ROOT || '';
	const expectedDepth = env?.EXPECTED_CELL_MAP_DEPTH || process.env.EXPECTED_CELL_MAP_DEPTH || '';

	const configured = Boolean(baseUrl);
	const rootPinned = /^0x[0-9a-fA-F]{64}$/.test(expectedRoot);
	const depthPinned = ['18', '20', '22', '24'].includes(expectedDepth);

	let manifest = false;
	let districtIndex = false;
	if (configured) {
		[manifest, districtIndex] = await Promise.all([
			headOk(`${baseUrl}/US/manifest.json`),
			headOk(`${baseUrl}/US/district-index.json`)
		]);
	}

	const ok = configured && rootPinned && depthPinned && manifest && districtIndex;
	return {
		status: ok ? 'ok' : 'down',
		configured,
		rootPinned,
		depthPinned,
		manifest,
		districtIndex,
		baseUrl: configured ? baseUrl : null
	};
}

async function headOk(url: string): Promise<boolean> {
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
			headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
		});
		return response.ok;
	} catch {
		return false;
	}
}
