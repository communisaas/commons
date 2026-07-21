import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ConvexHttpClient } from 'convex/browser';
import { api, CONVEX_URL } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';

const startTime = Date.now();
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

type HealthEnv = {
	ATLAS_BASE_URL?: string;
	EXPECTED_CELL_MAP_ROOT?: string;
	EXPECTED_CELL_MAP_DEPTH?: string;
	PUBLIC_CONVEX_URL?: string;
	PUBLIC_DISCOVERY_KV?: KVNamespace;
};

/**
 * Validate the secret-bearing Convex destination against both the hosted
 * deployment shape and the build-pinned public URL. The Convex SDK accepts any
 * syntactically valid HTTP(S) URL, so its constructor check is not an egress
 * boundary for INTERNAL_API_SECRET.
 */
function pinnedConvexHealthOrigin(env: HealthEnv | undefined): string {
	const parseHostedOrigin = (value: string): URL => {
		let parsed: URL;
		try {
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

	const pinned = parseHostedOrigin(CONVEX_URL);
	const effective = parseHostedOrigin(env?.PUBLIC_CONVEX_URL || CONVEX_URL);
	if (effective.origin !== pinned.origin) {
		throw new Error('Convex health URL does not match the build-pinned deployment');
	}
	return effective.origin;
}

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform?.env as HealthEnv | undefined;
	const [atlas, convex] = await Promise.all([checkAtlas(env), checkConvex(env)]);
	const kvBound =
		typeof env?.PUBLIC_DISCOVERY_KV?.get === 'function' &&
		typeof env.PUBLIC_DISCOVERY_KV.put === 'function' &&
		typeof env.PUBLIC_DISCOVERY_KV.list === 'function';
	const publicDiscoveryCache = {
		status: kvBound ? 'ok' : 'degraded',
		kvBound
	};

	// The cache is an availability/cost shield, not a whole-application
	// dependency. Report a missing binding explicitly, but keep core readiness
	// tied to Convex and Atlas. Deployment verification separately requires the
	// committed namespace and this runtime binding before accepting a release.
	const coreReady = convex && atlas.status === 'ok';
	const status = coreReady ? 'ok' : 'down';
	const code = coreReady ? 200 : 503;

	return json(
		{
			status,
			convex,
			atlas,
			publicDiscoveryCache,
			uptime: Math.floor((Date.now() - startTime) / 1000)
		},
		{ status: code }
	);
};

async function checkConvex(env: HealthEnv | undefined): Promise<boolean> {
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
		const client = new ConvexHttpClient(convexOrigin, {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal: controller.signal })
		});
		timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
		const result = await client.query(api.observability.discoveryProducerStatus, {
			_secret: getInternalSecret()
		});
		const producerScheduleHealthy =
			result.discoveryProducerOverdueAt === null ||
			(typeof result.discoveryProducerOverdueAt === 'number' &&
				Number.isFinite(result.discoveryProducerOverdueAt) &&
				Date.now() <= result.discoveryProducerOverdueAt);
		return (
			result.ok === true &&
			result.storageReadable === true &&
			result.discoveryManifestPresent === true &&
			result.discoveryProducerHealthy === true &&
			producerScheduleHealthy
		);
	} catch {
		return false;
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
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
