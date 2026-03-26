/**
// CONVEX: Keep SvelteKit
 * Shadow Atlas Community Field Contribution Proxy
 *
 * Proxies POST requests to Shadow Atlas /v1/community-field/contribute.
 * Keeps the Shadow Atlas URL server-side. Stores a local contribution record
 * for epoch nullifier dedup and verification tracking.
 *
 * Auth: requires session (Tier 1+). Anonymous contributions are not supported —
 * the proof alone proves personhood, but the session gates API access.
 *
 * Flow:
 *   1. Client generates BubbleMembershipProof in browser (community-field-client.ts)
 *   2. Client POST /api/shadow-atlas/community-field with proof + publicInputs
 *   3. This proxy forwards to Shadow Atlas for verification + aggregation
 *   4. On success, stores CommunityFieldContribution for local tracking
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/core/db';

const SHADOW_ATLAS_URL = env.SHADOW_ATLAS_API_URL || 'http://localhost:3000';
const WRITE_RELAY_URL = env.WRITE_RELAY_URL || SHADOW_ATLAS_URL;
const WRITE_RELAY_TOKEN = env.WRITE_RELAY_TOKEN || '';

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const session = locals.session;

	if (!session) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (!body || typeof body !== 'object') {
		return json({ error: 'Request body must be an object' }, { status: 400 });
	}

	const { proof, publicInputs, epochDate } = body as Record<string, unknown>;

	// Validate proof
	if (typeof proof !== 'string' || !proof.startsWith('0x')) {
		return json({ error: 'proof must be a 0x-prefixed hex string' }, { status: 400 });
	}

	// Validate publicInputs
	if (!Array.isArray(publicInputs) || publicInputs.length !== 5) {
		return json({ error: 'publicInputs must be an array of 5 field elements' }, { status: 400 });
	}
	for (const pi of publicInputs) {
		if (typeof pi !== 'string' || !pi.startsWith('0x')) {
			return json({ error: 'Each publicInput must be a 0x-prefixed hex string' }, { status: 400 });
		}
	}

	// Validate epochDate
	if (typeof epochDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(epochDate)) {
		return json({ error: 'epochDate must be YYYY-MM-DD format' }, { status: 400 });
	}

	// Extract public outputs from publicInputs array
	// Layout: [engagementRoot, epochDomain, cellSetRoot, epochNullifier, cellCount]
	const cellSetRoot = publicInputs[2] as string;
	const epochNullifier = publicInputs[3] as string;

	const prisma = db;

	// Check epoch nullifier dedup locally first (fast reject)
	const existing = await prisma.communityFieldContribution.findUnique({
		where: {
			epoch_date_epoch_nullifier: {
				epoch_date: epochDate,
				epoch_nullifier: epochNullifier
			}
		}
	});

	if (existing) {
		return json(
			{ error: 'Already contributed for this epoch', code: 'DUPLICATE_CONTRIBUTION' },
			{ status: 409 }
		);
	}

	try {
		const clientIp = event.getClientAddress();
		const requestId = request.headers.get('X-Request-ID') ?? crypto.randomUUID();

		// Forward to write relay for proof verification + aggregation
		// Auth: WRITE_RELAY_TOKEN is a server-side secret shared with the relay.
		// Never forward the browser client's auth header.
		const authToken = WRITE_RELAY_TOKEN || env.SHADOW_ATLAS_REGISTRATION_TOKEN || '';
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'X-Client-Version': 'commons-v1',
			'X-Forwarded-For': clientIp,
			'X-Request-ID': requestId
		};
		if (authToken) {
			headers['Authorization'] = `Bearer ${authToken}`;
		}

		const response = await fetch(`${WRITE_RELAY_URL}/v1/community-field/contribute`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ proof, publicInputs, epochDate }),
			signal: AbortSignal.timeout(15_000) // Proof verification can take a moment
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({
				error: { code: 'UPSTREAM_ERROR', message: response.statusText }
			}));
			return json(
				{ error: errorData?.error?.message ?? 'Contribution verification failed' },
				{ status: response.status >= 500 ? 503 : response.status }
			);
		}

		const data = await response.json();

		// Store local contribution record for tracking
		const proofHash = '0x' + await hashHex(proof);

		await prisma.communityFieldContribution.create({
			data: {
				epoch_date: epochDate,
				epoch_nullifier: epochNullifier,
				cell_tree_root: cellSetRoot,
				proof_hash: proofHash,
				verification_status: 'verified' // Shadow Atlas verified the proof
			}
		});

		return json({
			success: true,
			cellSetRoot,
			epochNullifier,
			epochDate
		});
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error('[Shadow Atlas] Community field contribution proxy failed:', msg);

		return json({ error: 'Community field service unavailable' }, { status: 503 });
	}
};

/** Hash a hex string to a short identifier using SubtleCrypto. */
async function hashHex(hex: string): Promise<string> {
	const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
