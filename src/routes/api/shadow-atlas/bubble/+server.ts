/**
 * Shadow Atlas Bubble Query Proxy
 *
 * Proxies POST requests to Shadow Atlas /v1/bubble-query.
 * Keeps the Shadow Atlas URL server-side. Returns fences + clipped
 * districts within the bubble extent for client-side geometry processing.
 *
 * Auth: requires session (Tier 1+). Anonymous bubble queries are not supported
 * because they would enable crawling the entire boundary topology.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const SHADOW_ATLAS_URL = env.SHADOW_ATLAS_API_URL || 'http://localhost:3000';

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const session = locals.session;

	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Parse and validate body
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body || typeof body !== 'object') {
		return json({ error: 'Request body must be an object' }, { status: 400 });
	}

	const { center, radius, postal_code, layers } = body as Record<string, unknown>;

	// Basic validation (Shadow Atlas does full Zod validation, but reject obvious garbage here)
	if (
		!center ||
		typeof center !== 'object' ||
		typeof (center as Record<string, unknown>).lat !== 'number' ||
		typeof (center as Record<string, unknown>).lng !== 'number'
	) {
		return json({ error: 'center must be { lat: number, lng: number }' }, { status: 400 });
	}

	if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 1 || radius > 50_000) {
		return json({ error: 'radius must be 1-50000 meters' }, { status: 400 });
	}

	// bound caller-supplied postal_code + layers before proxy
	// to Shadow Atlas. Shadow Atlas does Zod validation downstream but fail-fast
	// at our boundary to avoid forwarding megabyte payloads upstream.
	if (postal_code !== undefined && (typeof postal_code !== 'string' || postal_code.length > 16)) {
		return json({ error: 'postal_code must be a string ≤16 characters' }, { status: 400 });
	}
	if (
		layers !== undefined &&
		(!Array.isArray(layers) ||
			layers.length > 32 ||
			layers.some((l) => typeof l !== 'string' || (l as string).length > 64))
	) {
		return json(
			{ error: 'layers must be an array of ≤32 strings (each ≤64 characters)' },
			{ status: 400 }
		);
	}

	// Validate center.lat/lng physical ranges before proxy.
	const centerObj = center as Record<string, unknown>;
	const lat = centerObj.lat as number;
	const lng = centerObj.lng as number;
	if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
		return json(
			{ error: 'center.lat must be -90..90 and center.lng must be -180..180' },
			{ status: 400 }
		);
	}

	try {
		const clientIp = event.getClientAddress();
		const requestId =
			request.headers.get('X-Request-ID') ?? crypto.randomUUID();

		const response = await fetch(`${SHADOW_ATLAS_URL}/v1/bubble-query`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				'X-Client-Version': 'voter-protocol-v1',
				'X-Forwarded-For': clientIp,
				'X-Request-ID': requestId
			},
			body: JSON.stringify({ center, radius, postal_code, layers }),
			signal: AbortSignal.timeout(10_000)
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({
				error: { code: 'UPSTREAM_ERROR', message: response.statusText }
			}));
			return json(
				{ error: errorData?.error?.message ?? 'Bubble query failed' },
				{ status: response.status >= 500 ? 503 : response.status }
			);
		}

		const data = await response.json();

		return json(data, {
			headers: {
				'Cache-Control': 'private, max-age=300' // 5 min client cache
			}
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error('[Shadow Atlas] Bubble query proxy failed:', msg);

		return json({ error: 'Bubble service unavailable' }, { status: 503 });
	}
};
