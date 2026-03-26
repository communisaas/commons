/**
// CONVEX: Keep SvelteKit
 * Registration Reconciliation Endpoint
 *
 * Two responsibilities:
 * 1. Process KV retry queue — re-attempt Convex writes for registrations
 *    where Shadow Atlas succeeded but Convex failed.
 * 2. Verify Convex records match Shadow Atlas leaf state — detect and flag
 *    mismatches from any cause (network glitch, partial failure, corruption).
 *
 * Protected by CRON_SECRET. Intended to be called by an external cron.
 *
 * POST /api/admin/reconcile-registrations
 * Headers: Authorization: Bearer <CRON_SECRET>
 */

import { json } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { verifyCronSecret } from '$lib/server/cron-auth';

const SHADOW_ATLAS_URL = env.SHADOW_ATLAS_API_URL || 'http://localhost:3000';
const SHADOW_ATLAS_REGISTRATION_TOKEN = env.SHADOW_ATLAS_REGISTRATION_TOKEN || '';

/** Build auth headers for shadow-atlas admin endpoints */
function atlasHeaders(): Record<string, string> {
	const headers: Record<string, string> = { Accept: 'application/json' };
	if (SHADOW_ATLAS_REGISTRATION_TOKEN) {
		headers['Authorization'] = `Bearer ${SHADOW_ATLAS_REGISTRATION_TOKEN}`;
	}
	return headers;
}

export const POST: RequestHandler = async (event) => {
	// Authenticate with CRON_SECRET
	const authHeader = event.request.headers.get('Authorization');
	const cronSecret = env.CRON_SECRET;

	if (!cronSecret || !verifyCronSecret(authHeader, cronSecret)) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const results = {
		retriesProcessed: 0,
		retriesSucceeded: 0,
		retriesFailed: 0,
		reconciled: 0,
		mismatches: [] as Array<{ userId: string; leafIndex: number; reason: string }>,
	};

	// Phase 1: Process KV retry queue
	const kv = event.platform?.env?.REGISTRATION_RETRY_KV;
	if (kv) {
		try {
			const list = await kv.list({ prefix: 'retry:' });
			for (const key of list.keys) {
				results.retriesProcessed++;
				try {
					const raw = await kv.get(key.name);
					if (!raw) continue;

					const data = JSON.parse(raw) as {
						userId: string;
						identityCommitment: string;
						verificationMethod: string;
						atlasResult: {
							leafIndex: number;
							userRoot: string;
							userPath: string[];
							pathIndices: number[];
						};
						isReplace?: boolean;
						queuedAt: string;
					};

					await serverMutation(api.users.upsertRegistration, {
						userId: data.userId,
						identityCommitment: data.identityCommitment,
						leafIndex: data.atlasResult.leafIndex,
						merkleRoot: data.atlasResult.userRoot,
						merklePath: data.atlasResult.userPath,
						isReplace: data.isReplace ?? false,
						verificationMethod: data.verificationMethod,
						queuedAt: data.queuedAt
					});

					// Success — remove from retry queue
					await kv.delete(key.name);
					results.retriesSucceeded++;
					console.log('[Reconciliation] Retry succeeded', {
						userId: data.userId,
						leafIndex: data.atlasResult.leafIndex,
					});
				} catch (retryError) {
					results.retriesFailed++;
					console.error('[Reconciliation] Retry failed', {
						key: key.name,
						error: retryError instanceof Error ? retryError.message : String(retryError),
					});
				}
			}
		} catch (listError) {
			console.error('[Reconciliation] KV list failed', { error: listError });
		}
	}

	// Phase 2: Spot-check Convex records against Shadow Atlas
	try {
		const treeInfoResponse = await fetch(`${SHADOW_ATLAS_URL}/v1/tree/info`, {
			headers: atlasHeaders(),
			signal: AbortSignal.timeout(10_000),
		});

		if (treeInfoResponse.ok) {
			const treeInfo = await treeInfoResponse.json() as { treeSize: number };
			const pgCount = await serverQuery(api.users.countRegistrations, {});

			// Tree size >= pg count is expected (tree has padding/replaced zeros).
			// pg count > tree size is a bug.
			if (pgCount > treeInfo.treeSize) {
				results.mismatches.push({
					userId: 'GLOBAL',
					leafIndex: -1,
					reason: `Convex has ${pgCount} records but atlas tree has only ${treeInfo.treeSize} leaves`,
				});
			}

			// Spot-check a sample of recent registrations (max 50 per run)
			const recentRegistrations = await serverQuery(api.users.listRecentRegistrations, {
				limit: 50
			});

			for (const reg of recentRegistrations) {
				try {
					const leafResponse = await fetch(
						`${SHADOW_ATLAS_URL}/v1/tree/leaf/${reg.leafIndex}`,
						{
							headers: atlasHeaders(),
							signal: AbortSignal.timeout(5_000),
						}
					);

					if (leafResponse.ok) {
						const leafData = await leafResponse.json() as {
							leaf: string;
							isEmpty: boolean;
						};

						if (leafData.isEmpty) {
							results.mismatches.push({
								userId: reg.userId,
								leafIndex: reg.leafIndex,
								reason: 'Convex points to zeroed leaf (may need replacement record update)',
							});
						}
						results.reconciled++;
					}
				} catch {
					// Atlas unreachable for this check — skip, don't flag
				}
			}
		}
	} catch (treeError) {
		console.warn('[Reconciliation] Tree info check failed', {
			error: treeError instanceof Error ? treeError.message : String(treeError),
		});
	}

	console.log('[Reconciliation] Complete', results);
	return json(results);
};
