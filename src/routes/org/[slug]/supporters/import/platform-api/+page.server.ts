import { fail, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation, serverAction } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { PLATFORM_EXPORT_PROFILES } from '$lib/data/platform-export-profiles';
import { formatGateEvidence, getGateEvidence } from '$lib/data/capability-hypergraph';
import {
	hasPlatformApiCredentialKey,
	openPlatformApiCredential,
	sealPlatformApiCredential
} from '$lib/server/platform-api-token-custody';
import { getPlatformApiSyncReadiness } from '$lib/server/platform-api-sync-readiness';
import {
	isArmedPlatformSyncSource,
	runPlatformApiSyncSlice,
	MAX_PAGES_PER_SLICE
} from '$lib/server/platform-sync/runner';
import { PlatformSyncError } from '$lib/server/platform-sync/types';
import type { EncryptedPlatformApiCredential } from '$lib/server/platform-api-token-custody';
import type { PageServerLoad, Actions } from './$types';

/** Records per importWithEncryption call; keeps each Convex action small. */
const IMPORT_CHUNK_SIZE = 100;

const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3'], {
	name: 'Platform API sync',
	downstream: 1,
	dependency: 'Encrypted credential custody + direct sync execution'
});

function platformApiBoundaryError(prefix: string): string {
	return formatGateEvidence(platformApiGate, { prefix });
}

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

function platformLabel(source: string): string {
	return PLATFORM_EXPORT_PROFILES.find((profile) => profile.source === source)?.label ?? source;
}

function platformApiBoundaryPayload(
	readiness = getPlatformApiSyncReadiness(),
	options: {
		code?:
			| 'platform_api_credential_custody_not_configured'
			| 'platform_api_sync_not_armed'
			| 'platform_api_credential_probe_failed';
		blockedVerb?:
			| 'store_platform_credential'
			| 'direct_platform_import'
			| 'open_platform_credential';
		preservedArtifact?: 'csv_import_profile' | 'encrypted_credential_custody';
	} = {}
) {
	return {
		error: platformApiBoundaryError(readiness.message),
		code: options.code ?? 'platform_api_sync_not_armed',
		blockedVerb: options.blockedVerb ?? 'direct_platform_import',
		preservedArtifact: options.preservedArtifact ?? 'encrypted_credential_custody',
		gate: 'CP-platform-api-sync',
		taskIds: ['T1-3'],
		dependency: readiness.dependency,
		missing: readiness.missing,
		runtimeFlag: readiness.runtimeFlag,
		runnerImplemented: readiness.runnerImplemented,
		credentialCustodyReady: readiness.credentialCustodyReady,
		profileCount: readiness.profileCount,
		runtimeMessage: readiness.message
	};
}

function parseStoredPlatformCredential(
	raw: string,
	source: string
): EncryptedPlatformApiCredential {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('Stored platform credential envelope is not valid JSON.');
	}
	if (!parsed || typeof parsed !== 'object') {
		throw new Error('Stored platform credential envelope is malformed.');
	}
	const credential = parsed as Partial<EncryptedPlatformApiCredential>;
	if (
		credential.version !== 'platform-api-token-v1' ||
		credential.source !== source ||
		typeof credential.ciphertext !== 'string' ||
		typeof credential.iv !== 'string' ||
		typeof credential.storedAt !== 'number' ||
		(credential.keySource !== 'PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY' &&
			credential.keySource !== 'OAUTH_ENCRYPTION_KEY')
	) {
		throw new Error('Stored platform credential envelope does not match this platform profile.');
	}
	return credential as EncryptedPlatformApiCredential;
}

export const load: PageServerLoad = async ({ parent, params }) => {
	const { membership } = await parent();
	requireRole(membership.role, 'editor');
	const platformApiSyncReadiness = getPlatformApiSyncReadiness();

	const sync = await serverQuery(api.organizations.getPlatformApiState, {
		slug: params.slug
	});

	return {
		maxPagesPerSlice: MAX_PAGES_PER_SLICE,
		sync: sync
			? {
					status: sync.status,
					syncType: sync.syncType,
					checkpoint: sync.checkpoint ?? null,
					directImportArmed:
						platformApiSyncReadiness.ready &&
						typeof sync.adapterSource === 'string' &&
						isArmedPlatformSyncSource(sync.adapterSource),
					totalResources: sync.totalResources ?? 0,
					processedResources: sync.processedResources ?? 0,
					currentResource: sync.currentResource ?? null,
					imported: sync.imported ?? 0,
					updated: sync.updated ?? 0,
					skipped: sync.skipped ?? 0,
					adapterSource: sync.adapterSource ?? null,
					adapterLabel:
						typeof sync.adapterSource === 'string' ? platformLabel(sync.adapterSource) : null,
					credentialStoredAt: sync.credentialStoredAt
						? new Date(sync.credentialStoredAt).toISOString()
						: null,
					credentialVersion: sync.credentialVersion ?? null,
					credentialProbeCompletedAt: sync.credentialProbeCompletedAt
						? new Date(sync.credentialProbeCompletedAt).toISOString()
						: null,
					credentialProbeVersion: sync.credentialProbeVersion ?? null,
					errors: sync.errors ?? null,
					lastSyncAt: sync.lastSyncAt ? new Date(sync.lastSyncAt).toISOString() : null,
					startedAt: sync.startedAt ? new Date(sync.startedAt).toISOString() : null,
					completedAt: sync.completedAt ? new Date(sync.completedAt).toISOString() : null,
					createdAt: sync.startedAt ? new Date(sync.startedAt).toISOString() : null
				}
			: null,
		connected: !!sync,
		credentialCustodyReady: platformApiSyncReadiness.credentialCustodyReady,
		platformApiSyncRuntimeReady: platformApiSyncReadiness.ready,
		platformApiSyncRuntimeMissing: platformApiSyncReadiness.missing,
		platformApiSyncRuntimeDependency: platformApiSyncReadiness.dependency,
		platformApiSyncRuntimeMessage: platformApiSyncReadiness.message,
		platformApiSyncRuntimeFlag: platformApiSyncReadiness.runtimeFlag,
		platformApiSyncRunnerImplemented: platformApiSyncReadiness.runnerImplemented,
		platformApiSyncReadiness
	};
};

export const actions: Actions = {
	connect: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(
				302,
				`/auth/google?returnTo=/org/${params.slug}/supporters/import/platform-api`
			);
		}

		const formData = await request.formData();
		const apiKey = formData.get('api_key')?.toString().trim();
		const source = formData.get('platform_source')?.toString().trim();
		const profile = PLATFORM_EXPORT_PROFILES.find((candidate) => candidate.source === source);

		if (!apiKey) {
			return fail(400, { error: 'API key is required.' });
		}
		if (!profile) {
			return fail(400, { error: 'Choose a supported platform profile before storing a key.' });
		}
		if (!hasPlatformApiCredentialKey()) {
			return fail(
				424,
				platformApiBoundaryPayload(getPlatformApiSyncReadiness(), {
					code: 'platform_api_credential_custody_not_configured',
					blockedVerb: 'store_platform_credential',
					preservedArtifact: 'csv_import_profile'
				})
			);
		}

		const sealed = await sealPlatformApiCredential(apiKey, {
			orgSlug: params.slug,
			source: profile.source
		});

		await serverMutation(api.organizations.connectPlatformApiCredential, {
			slug: params.slug,
			encryptedApiKey: JSON.stringify(sealed),
			adapterSource: profile.source,
			credentialStoredAt: sealed.storedAt,
			credentialVersion: sealed.version
		});

		return {
			connected: true,
			adapterLabel: profile.label
		};
	},

	sync: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(
				302,
				`/auth/google?returnTo=/org/${params.slug}/supporters/import/platform-api`
			);
		}

		const readiness = getPlatformApiSyncReadiness();
		const sync = await serverQuery(api.organizations.getPlatformApiState, {
			slug: params.slug
		});
		if (!sync) {
			return fail(400, {
				error: 'Store an encrypted platform credential before probing custody.',
				code: 'platform_api_credential_required'
			});
		}

		const adapterSource = typeof sync.adapterSource === 'string' ? sync.adapterSource : '';
		const profile = PLATFORM_EXPORT_PROFILES.find(
			(candidate) => candidate.source === adapterSource
		);
		if (!profile) {
			return fail(400, {
				error:
					'Stored platform credential does not point at a supported platform profile. Reconnect it from the profile list.',
				code: 'platform_api_profile_unknown'
			});
		}
		if (!hasPlatformApiCredentialKey()) {
			return fail(
				424,
				platformApiBoundaryPayload(readiness, {
					code: 'platform_api_credential_custody_not_configured',
					blockedVerb: 'open_platform_credential',
					preservedArtifact: 'encrypted_credential_custody'
				})
			);
		}

		try {
			const encryptedCredential = parseStoredPlatformCredential(sync.apiKey, profile.source);
			const plaintext = await openPlatformApiCredential(encryptedCredential, {
				orgSlug: params.slug
			});
			if (!plaintext.trim()) {
				throw new Error('Stored platform credential opened to an empty value.');
			}
			const probedAt = Date.now();
			await serverMutation(api.organizations.recordPlatformApiCredentialProbe, {
				slug: params.slug,
				adapterSource: profile.source,
				credentialVersion: encryptedCredential.version,
				probedAt
			});

			return {
				probed: true,
				code: 'platform_api_credential_probe_complete',
				adapterLabel: profile.label,
				credentialVersion: encryptedCredential.version,
				credentialStoredAt: encryptedCredential.storedAt,
				credentialProbeCompletedAt: new Date(probedAt).toISOString(),
				blockedVerb: 'direct_platform_import',
				preservedArtifact: 'encrypted_credential_custody',
				gate: 'CP-platform-api-sync',
				taskIds: ['T1-3'],
				dependency: readiness.dependency,
				missing: readiness.missing,
				runtimeFlag: readiness.runtimeFlag,
				runnerImplemented: readiness.runnerImplemented,
				credentialCustodyReady: readiness.credentialCustodyReady,
				probeMessage:
					'Credential custody probe passed. Direct platform import remains held until direct sync execution and continuation checkpoints are armed.',
				runtimeMessage: readiness.message
			};
		} catch (err) {
			return fail(424, {
				...platformApiBoundaryPayload(readiness, {
					code: 'platform_api_credential_probe_failed',
					blockedVerb: 'open_platform_credential',
					preservedArtifact: 'encrypted_credential_custody'
				}),
				error:
					err instanceof Error ? err.message : 'Stored platform credential could not be opened.'
			});
		}
	},

	import: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(
				302,
				`/auth/google?returnTo=/org/${params.slug}/supporters/import/platform-api`
			);
		}

		const readiness = getPlatformApiSyncReadiness();
		const sync = await serverQuery(api.organizations.getPlatformApiState, {
			slug: params.slug
		});
		if (!sync) {
			return fail(400, {
				error: 'Store an encrypted platform credential before importing.',
				code: 'platform_api_credential_required'
			});
		}

		const adapterSource = typeof sync.adapterSource === 'string' ? sync.adapterSource : '';
		const profile = PLATFORM_EXPORT_PROFILES.find(
			(candidate) => candidate.source === adapterSource
		);
		if (!profile) {
			return fail(400, {
				error:
					'Stored platform credential does not point at a supported platform profile. Reconnect it from the profile list.',
				code: 'platform_api_profile_unknown'
			});
		}
		if (!readiness.ready || !isArmedPlatformSyncSource(profile.source)) {
			return fail(424, platformApiBoundaryPayload(readiness));
		}

		const formData = await request.formData();
		// 'running' with a checkpoint is a parked slice boundary; 'failed' with a
		// checkpoint is a rate-limited/transient stop. Both continue where they left off.
		const resume =
			Boolean(sync.checkpoint) && (sync.status === 'running' || sync.status === 'failed');
		const requestedIncremental = formData.get('sync_type')?.toString() === 'incremental';
		// Incremental needs a completed-run watermark; without one it honestly
		// falls back to a full fetch instead of silently importing nothing.
		const incremental = requestedIncremental && typeof sync.lastSyncAt === 'number';
		const syncType: 'full' | 'incremental' = resume
			? sync.syncType === 'incremental'
				? 'incremental'
				: 'full'
			: incremental
				? 'incremental'
				: 'full';

		let plaintextKey: string;
		try {
			const encryptedCredential = parseStoredPlatformCredential(sync.apiKey, profile.source);
			plaintextKey = await openPlatformApiCredential(encryptedCredential, {
				orgSlug: params.slug
			});
		} catch (err) {
			return fail(424, {
				...platformApiBoundaryPayload(readiness, {
					code: 'platform_api_credential_probe_failed',
					blockedVerb: 'open_platform_credential',
					preservedArtifact: 'encrypted_credential_custody'
				}),
				error:
					err instanceof Error ? err.message : 'Stored platform credential could not be opened.'
			});
		}

		try {
			await serverMutation(api.organizations.startPlatformApiSync, {
				slug: params.slug,
				syncType,
				resume
			});
		} catch (err) {
			return fail(409, {
				error:
					err instanceof Error && err.message.includes('already in progress')
						? 'A sync slice is already in flight for this org. Wait for it to park or fail, then continue.'
						: err instanceof Error
							? err.message
							: 'Could not claim the sync run.',
				code: 'platform_api_sync_claim_failed'
			});
		}

		const baseProcessed = resume ? (sync.processedResources ?? 0) : 0;
		const baseImported = resume ? (sync.imported ?? 0) : 0;
		const baseUpdated = resume ? (sync.updated ?? 0) : 0;
		const baseSkipped = resume ? (sync.skipped ?? 0) : 0;

		try {
			const slice = await runPlatformApiSyncSlice({
				source: profile.source,
				apiKey: plaintextKey,
				checkpoint: resume ? (sync.checkpoint ?? null) : null,
				modifiedSince:
					syncType === 'incremental' && typeof sync.lastSyncAt === 'number'
						? new Date(sync.lastSyncAt).toISOString()
						: undefined
			});

			let imported = 0;
			let updated = 0;
			let skipped = slice.droppedNoEmail;
			const rowErrors: unknown[] = [];
			for (let i = 0; i < slice.records.length; i += IMPORT_CHUNK_SIZE) {
				const chunk = slice.records.slice(i, i + IMPORT_CHUNK_SIZE);
				const result = await serverAction(api.supporters.importWithEncryption, {
					slug: params.slug,
					supporters: chunk
				});
				imported += result.imported ?? 0;
				updated += result.updated ?? 0;
				skipped += result.skipped ?? 0;
				if (Array.isArray(result.errors) && result.errors.length) {
					rowErrors.push(...result.errors);
				}
			}

			const counters = {
				processedResources: baseProcessed + slice.records.length + slice.droppedNoEmail,
				totalResources: slice.totalRecords ?? sync.totalResources ?? 0,
				imported: baseImported + imported,
				updated: baseUpdated + updated,
				skipped: baseSkipped + skipped
			};

			const persistedRowErrors = rowErrors.slice(0, 20).map((entry) => String(entry));
			if (slice.nextCursor) {
				await serverMutation(api.organizations.recordPlatformApiSyncProgress, {
					slug: params.slug,
					...counters,
					checkpoint: slice.nextCursor,
					currentResource: `people:page=${slice.nextCursor}`,
					rowErrors: persistedRowErrors.length ? persistedRowErrors : undefined
				});
			} else {
				await serverMutation(api.organizations.completePlatformApiSync, {
					slug: params.slug,
					...counters,
					rowErrors: persistedRowErrors.length ? persistedRowErrors : undefined
				});
			}

			return {
				sliceComplete: true,
				syncComplete: slice.nextCursor === null,
				nextCheckpoint: slice.nextCursor,
				pagesFetched: slice.pagesFetched,
				maxPagesPerSlice: MAX_PAGES_PER_SLICE,
				adapterLabel: profile.label,
				syncType,
				droppedNoEmail: slice.droppedNoEmail,
				rowErrorCount: rowErrors.length,
				...counters
			};
		} catch (err) {
			const message =
				err instanceof PlatformSyncError
					? err.message
					: err instanceof Error
						? `Platform import failed: ${err.message}`
						: 'Platform import failed.';
			await serverMutation(api.organizations.failPlatformApiSync, {
				slug: params.slug,
				errorMessage: message
			});
			return fail(err instanceof PlatformSyncError && err.code === 'auth_failed' ? 401 : 502, {
				error: message,
				code:
					err instanceof PlatformSyncError
						? `platform_api_sync_${err.code}`
						: 'platform_api_sync_failed',
				// A fresh start cleared any prior checkpoint; only a resumed run
				// still has one persisted for the next attempt.
				checkpointPreserved: resume
			});
		}
	},

	disconnect: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(
				302,
				`/auth/google?returnTo=/org/${params.slug}/supporters/import/platform-api`
			);
		}

		await serverMutation(api.organizations.disconnectPlatformApiCredential, {
			slug: params.slug
		});

		return { disconnected: true };
	},

	refresh: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(
				302,
				`/auth/google?returnTo=/org/${params.slug}/supporters/import/platform-api`
			);
		}

		// Just reload — the load function will fetch the latest sync status
		return { refreshed: true };
	}
};
