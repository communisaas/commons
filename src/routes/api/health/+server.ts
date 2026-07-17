import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ConvexHttpClient } from 'convex/browser';
import { api, CONVEX_URL } from '$lib/convex';

const startTime = Date.now();
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

type HealthEnv = {
	ATLAS_BASE_URL?: string;
	EXPECTED_CELL_MAP_ROOT?: string;
	EXPECTED_CELL_MAP_DEPTH?: string;
	PUBLIC_CONVEX_URL?: string;
};

export const GET: RequestHandler = async ({ platform }) => {
	const env = platform?.env as HealthEnv | undefined;
	const [atlas, convex] = await Promise.all([checkAtlas(env), checkConvex(env)]);

	const healthy = convex && atlas.status === 'ok';
	const status = healthy ? 'ok' : 'down';
	const code = healthy ? 200 : 503;

	return json(
		{
			status,
			convex,
			atlas,
			uptime: Math.floor((Date.now() - startTime) / 1000)
		},
		{ status: code }
	);
};

async function checkConvex(env: HealthEnv | undefined): Promise<boolean> {
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		// servicePing performs one indexed read of the tiny public-discovery
		// manifest singleton, exercising the data plane without hydrating an
		// embedding-bearing application document. Use a request-local HTTP client
		// so the deadline aborts the underlying fetch rather than merely abandoning
		// an unbounded serverQuery promise.
		const client = new ConvexHttpClient(env?.PUBLIC_CONVEX_URL || CONVEX_URL, {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal: controller.signal })
		});
		timeout = setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
		const result = await client.query(api.observability.servicePing, {});
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
