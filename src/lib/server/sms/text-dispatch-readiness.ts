type TextDispatchRuntimeEnv = {
	TWILIO_ACCOUNT_SID?: string;
	TWILIO_AUTH_TOKEN?: string;
	TWILIO_PHONE_NUMBER?: string;
};

export type TextDispatchReadiness = {
	ready: boolean;
	missing: string[];
	dependency: string;
	runtimeFlag: 'closed' | 'open_without_client_decryptor' | 'open_without_runner' | 'ready';
	runnerImplemented: boolean;
	clientDecryptorMounted: boolean;
	clientBatchRouteMounted: boolean;
	message: string;
};

export const TEXT_DISPATCH_DEPENDENCY =
	'text dispatch gate, browser phone custody, Twilio dispatch runner, and transport credentials';

export const TEXT_DISPATCH_RUNNER_IMPLEMENTED = true;
export const TEXT_DISPATCH_CLIENT_DECRYPTOR_MOUNTED = false;
export const TEXT_DISPATCH_CLIENT_BATCH_ROUTE_MOUNTED = true;

export function getTextDispatchReadiness(
	env: TextDispatchRuntimeEnv,
	options: {
		featureEnabled?: boolean;
		runnerImplemented?: boolean;
		clientDecryptorMounted?: boolean;
		clientBatchRouteMounted?: boolean;
	} = {}
): TextDispatchReadiness {
	const featureEnabled = options.featureEnabled === true;
	const runnerImplemented = options.runnerImplemented ?? TEXT_DISPATCH_RUNNER_IMPLEMENTED;
	const clientDecryptorMounted =
		options.clientDecryptorMounted ?? TEXT_DISPATCH_CLIENT_DECRYPTOR_MOUNTED;
	const clientBatchRouteMounted =
		options.clientBatchRouteMounted ?? TEXT_DISPATCH_CLIENT_BATCH_ROUTE_MOUNTED;
	const missing: string[] = [];

	if (!featureEnabled) missing.push('text dispatch feature gate');
	if (!clientDecryptorMounted) missing.push('browser phone custody');
	if (!runnerImplemented) missing.push('Twilio dispatch runner');
	if (!env.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
	if (!env.TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN');
	if (!env.TWILIO_PHONE_NUMBER) missing.push('TWILIO_PHONE_NUMBER');

	const ready = missing.length === 0;
	const runtimeFlag: TextDispatchReadiness['runtimeFlag'] = ready
		? 'ready'
		: featureEnabled && runnerImplemented
			? 'open_without_client_decryptor'
			: featureEnabled
				? 'open_without_runner'
			: 'closed';

	return {
		ready,
		missing,
		dependency: TEXT_DISPATCH_DEPENDENCY,
		runtimeFlag,
		runnerImplemented,
		clientDecryptorMounted,
		clientBatchRouteMounted,
		message: ready
			? 'Bulk text dispatch runtime is ready for a client-decrypted recipient batch.'
			: `Bulk text dispatch is dependency-bound. Drafts are preserved; configure ${missing.join(
					', '
				)} before carrier delivery can be armed.`
	};
}
