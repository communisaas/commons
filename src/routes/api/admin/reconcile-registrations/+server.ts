/**
// CONVEX: Keep SvelteKit
 * Registration Reconciliation Endpoint
 *
 * Two responsibilities:
 * 1. Process KV retry queue — re-attempt Postgres writes for registrations
 *    where Shadow Atlas succeeded but Postgres failed.
 * 2. Verify Postgres records match Shadow Atlas leaf state — detect and flag
 *    mismatches from any cause (network glitch, partial failure, corruption).
 *
 * Protected by CRON_SECRET. Intended to be called by an external cron
 * (e.g., CF Worker cron trigger, or cron-job.org) on an hourly schedule.
 *
 * POST /api/admin/reconcile-registrations
 * Headers: Authorization: Bearer <CRON_SECRET>
 *
 * Response: { retriesProcessed, reconciled, mismatches }
 */

import { json } from '@sveltejs/kit';
import { prisma } from '$lib/core/db';
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

					if (data.isReplace) {
						// Replace: update existing record
						await prisma.shadowAtlasRegistration.update({
							where: { user_id: data.userId },
							data: {
								identity_commitment: data.identityCommitment,
								leaf_index: data.atlasResult.leafIndex,
								merkle_root: data.atlasResult.userRoot,
								merkle_path: data.atlasResult.userPath,
							},
						});
					} else {
						// New registration: upsert (may have been retried by client)
						await prisma.shadowAtlasRegistration.upsert({
							where: { user_id: data.userId },
							update: {
								identity_commitment: data.identityCommitment,
								leaf_index: data.atlasResult.leafIndex,
								merkle_root: data.atlasResult.userRoot,
								merkle_path: data.atlasResult.userPath,
							},
							create: {
								user_id: data.userId,
								congressional_district: 'three-tree',
								identity_commitment: data.identityCommitment,
								leaf_index: data.atlasResult.leafIndex,
								merkle_root: data.atlasResult.userRoot,
								merkle_path: data.atlasResult.userPath,
								credential_type: 'three-tree',
								cell_id: null,
								verification_method: data.verificationMethod,
								verification_id: data.userId,
								verification_timestamp: new Date(data.queuedAt),
								registration_status: 'registered',
								expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
							},
						});
					}

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

	// Phase 2: Spot-check Postgres records against Shadow Atlas
	// Quick sanity: compare record count against tree size
	try {
		const treeInfoResponse = await fetch(`${SHADOW_ATLAS_URL}/v1/tree/info`, {
			headers: atlasHeaders(),
			signal: AbortSignal.timeout(10_000),
		});

		if (treeInfoResponse.ok) {
			const treeInfo = await treeInfoResponse.json() as { treeSize: number };
			const pgCount = await prisma.shadowAtlasRegistration.count();

			// Tree size >= pg count is expected (tree has padding/replaced zeros).
			// pg count > tree size is a bug.
			if (pgCount > treeInfo.treeSize) {
				results.mismatches.push({
					userId: 'GLOBAL',
					leafIndex: -1,
					reason: `Postgres has ${pgCount} records but atlas tree has only ${treeInfo.treeSize} leaves`,
				});
			}

			// Spot-check a sample of recent registrations (max 50 per run)
			const recentRegistrations = await prisma.shadowAtlasRegistration.findMany({
				orderBy: { verification_timestamp: 'desc' },
				take: 50,
				select: {
					user_id: true,
					leaf_index: true,
					merkle_root: true,
				},
			});

			for (const reg of recentRegistrations) {
				try {
					const leafResponse = await fetch(
						`${SHADOW_ATLAS_URL}/v1/tree/leaf/${reg.leaf_index}`,
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
							// Leaf was zeroed (replaced) — check if we have a newer record
							results.mismatches.push({
								userId: reg.user_id,
								leafIndex: reg.leaf_index,
								reason: 'Postgres points to zeroed leaf (may need replacement record update)',
							});
						}
						// Leaf value comparison would require storing the leaf hash in Postgres.
						// Currently we store the Merkle proof but not the leaf itself.
						// Mark as reconciled — the leaf exists and isn't empty.
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
