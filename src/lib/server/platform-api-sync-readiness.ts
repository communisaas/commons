import { PLATFORM_EXPORT_PROFILES } from '$lib/data/platform-export-profiles';
import { hasPlatformApiCredentialKey } from '$lib/server/platform-api-token-custody';
import { ARMED_PLATFORM_SYNC_SOURCES } from '$lib/server/platform-sync/runner';

export type PlatformApiSyncReadiness = {
	ready: boolean;
	credentialCustodyReady: boolean;
	profileCount: number;
	runnerImplemented: boolean;
	armedAdapterSources: string[];
	heldAdapterSources: string[];
	missing: string[];
	dependency: string;
	runtimeFlag: 'closed' | 'custody_ready_without_runner' | 'ready';
	message: string;
};

export const PLATFORM_API_SYNC_DEPENDENCY =
	'profile registry, encrypted credential custody, direct sync execution, and continuation checkpointing';

/**
 * The bounded sync runner is implemented: paginated adapter fetch, normalized
 * handoff into supporters.importWithEncryption, and continuation checkpoints
 * persisted per slice. Arming is still per-adapter — only sources registered
 * in PLATFORM_SYNC_ADAPTERS may claim a live direct import; tag/list sync is
 * not implemented yet, so direct import covers people records only.
 */
export const PLATFORM_API_SYNC_RUNNER_IMPLEMENTED = true;

export function getPlatformApiSyncReadiness(
	options: {
		credentialCustodyReady?: boolean;
		profileCount?: number;
		runnerImplemented?: boolean;
		armedAdapterSources?: string[];
	} = {}
): PlatformApiSyncReadiness {
	const credentialCustodyReady = options.credentialCustodyReady ?? hasPlatformApiCredentialKey();
	const profileCount = options.profileCount ?? PLATFORM_EXPORT_PROFILES.length;
	const runnerImplemented = options.runnerImplemented ?? PLATFORM_API_SYNC_RUNNER_IMPLEMENTED;
	const armedAdapterSources = runnerImplemented
		? (options.armedAdapterSources ?? [...ARMED_PLATFORM_SYNC_SOURCES])
		: [];
	const heldAdapterSources = PLATFORM_EXPORT_PROFILES.map((profile) => profile.source).filter(
		(source) => !armedAdapterSources.includes(source)
	);
	const missing: string[] = [];

	if (profileCount <= 0) missing.push('platform export profile registry');
	if (!credentialCustodyReady) missing.push('encrypted credential custody');
	if (!runnerImplemented) missing.push('direct sync execution');
	if (!runnerImplemented) missing.push('continuation checkpointing');
	if (runnerImplemented && armedAdapterSources.length === 0) {
		missing.push('at least one armed platform adapter');
	}

	const ready = missing.length === 0;
	const runtimeFlag = ready
		? 'ready'
		: credentialCustodyReady && profileCount > 0
			? 'custody_ready_without_runner'
			: 'closed';
	const armedLabel = armedAdapterSources.join(', ');
	const message = ready
		? `Direct platform sync is armed for ${armedLabel} with bounded slices and continuation checkpoints; ${heldAdapterSources.length} other platform profiles remain CSV export intake, and tag/list sync stays gated.`
		: `Direct platform sync is not armed; missing ${missing.join(', ')}. CSV export intake remains the live migration path.`;

	return {
		ready,
		credentialCustodyReady,
		profileCount,
		runnerImplemented,
		armedAdapterSources,
		heldAdapterSources,
		missing,
		dependency: PLATFORM_API_SYNC_DEPENDENCY,
		runtimeFlag,
		message
	};
}
