import { PLATFORM_EXPORT_PROFILES } from '$lib/data/platform-export-profiles';
import { hasPlatformApiCredentialKey } from '$lib/server/platform-api-token-custody';

export type PlatformApiSyncReadiness = {
	ready: boolean;
	credentialCustodyReady: boolean;
	profileCount: number;
	runnerImplemented: boolean;
	missing: string[];
	dependency: string;
	runtimeFlag: 'closed' | 'custody_ready_without_runner' | 'ready';
	message: string;
};

export const PLATFORM_API_SYNC_DEPENDENCY =
	'profile registry, encrypted credential custody, direct sync execution, and continuation checkpointing';

export const PLATFORM_API_SYNC_RUNNER_IMPLEMENTED = false;

export function getPlatformApiSyncReadiness(
	options: {
		credentialCustodyReady?: boolean;
		profileCount?: number;
		runnerImplemented?: boolean;
	} = {}
): PlatformApiSyncReadiness {
	const credentialCustodyReady =
		options.credentialCustodyReady ?? hasPlatformApiCredentialKey();
	const profileCount = options.profileCount ?? PLATFORM_EXPORT_PROFILES.length;
	const runnerImplemented = options.runnerImplemented ?? PLATFORM_API_SYNC_RUNNER_IMPLEMENTED;
	const missing: string[] = [];

	if (profileCount <= 0) missing.push('platform export profile registry');
	if (!credentialCustodyReady) missing.push('encrypted credential custody');
	if (!runnerImplemented) missing.push('direct sync execution');
	if (!runnerImplemented) missing.push('continuation checkpointing');

	const ready = missing.length === 0;
	const runtimeFlag = ready
		? 'ready'
		: credentialCustodyReady && profileCount > 0
			? 'custody_ready_without_runner'
			: 'closed';
	const message = ready
		? 'Direct platform sync has custody and execution ground; adapter-specific format, pagination, rate-limit, and import checks still gate each live import claim.'
		: `Direct platform sync is not armed; missing ${missing.join(', ')}. CSV export intake remains the live migration path.`;

	return {
		ready,
		credentialCustodyReady,
		profileCount,
		runnerImplemented,
		missing,
		dependency: PLATFORM_API_SYNC_DEPENDENCY,
		runtimeFlag,
		message
	};
}
