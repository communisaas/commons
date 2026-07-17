import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

const startTime = Date.now();
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

type HealthEnv = {
	ATLAS_BASE_URL?: string;
	EXPECTED_CELL_MAP_ROOT?: string;
	EXPECTED_CELL_MAP_DEPTH?: string;
};

export const GET: RequestHandler = async ({ platform }) => {
	const [atlas, convex] = await Promise.all([
		checkAtlas(platform?.env as HealthEnv | undefined),
		checkConvex()
	]);

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

async function checkConvex(): Promise<boolean> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		// servicePing performs one indexed read of the tiny public-discovery
		// manifest singleton, exercising the data plane without hydrating an
		// embedding-bearing application document.
		const query = serverQuery(api.observability.servicePing, {})
			.then(() => true)
			.catch(() => false);
		const deadline = new Promise<boolean>((resolve) => {
			timeout = setTimeout(() => resolve(false), HEALTH_PROBE_TIMEOUT_MS);
		});
		return await Promise.race([query, deadline]);
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
