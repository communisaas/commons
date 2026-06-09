import { fail, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { PLATFORM_EXPORT_PROFILES } from '$lib/data/platform-export-profiles';
import { formatGateEvidence, getGateEvidence } from '$lib/data/capability-hypergraph';
import {
	hasPlatformApiCredentialKey,
	openPlatformApiCredential,
	sealPlatformApiCredential
} from '$lib/server/platform-api-token-custody';
import { getPlatformApiSyncReadiness } from '$lib/server/platform-api-sync-readiness';
import type { EncryptedPlatformApiCredential } from '$lib/server/platform-api-token-custody';
import type { PageServerLoad, Actions } from './$types';

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
		sync: sync
			? {
					status: sync.status,
					syncType: sync.syncType,
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
		const profile = PLATFORM_EXPORT_PROFILES.find((candidate) => candidate.source === adapterSource);
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
			return fail(
				424,
				{
					...platformApiBoundaryPayload(readiness, {
						code: 'platform_api_credential_probe_failed',
						blockedVerb: 'open_platform_credential',
						preservedArtifact: 'encrypted_credential_custody'
					}),
					error:
						err instanceof Error
							? err.message
							: 'Stored platform credential could not be opened.'
				}
			);
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
