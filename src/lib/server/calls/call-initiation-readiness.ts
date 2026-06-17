export type CallInitiationRuntimeEnv = {
	TWILIO_ACCOUNT_SID?: string;
	TWILIO_AUTH_TOKEN?: string;
	TWILIO_PHONE_NUMBER?: string;
};

export type CallInitiationReadinessScope = 'os_surface' | 'api_request';

export type CallInitiationReadiness = {
	ready: boolean;
	twilioConfigured: boolean;
	missing: string[];
	dependency: string;
	runtimeFlag: 'closed' | 'transport_ready_without_surface' | 'ready';
	scope: CallInitiationReadinessScope;
	surfaceMounted: boolean;
	proxyImplemented: boolean;
	message: string;
};

export const CALL_INITIATION_DEPENDENCY =
	'call authority, supporter phone custody, caller confirmation, mounted connect controls, and Twilio transport credentials';

export const CALL_INITIATION_SURFACE_MOUNTED = false;
export const CALL_INITIATION_PROXY_IMPLEMENTED = true;

export function getCallInitiationReadiness(
	env: CallInitiationRuntimeEnv,
	options: {
		featureEnabled?: boolean;
		canManageCalls?: boolean;
		scope?: CallInitiationReadinessScope;
		supporterPhonePresent?: boolean;
		callerPhoneProvided?: boolean;
	} = {}
): CallInitiationReadiness {
	const scope = options.scope ?? 'os_surface';
	const missing: string[] = [];

	if (options.featureEnabled === false) missing.push('SMS feature flag');
	if (options.canManageCalls === false) missing.push('call authority');
	if (!CALL_INITIATION_PROXY_IMPLEMENTED) missing.push('Twilio call proxy');
	if (!env.TWILIO_ACCOUNT_SID) missing.push('TWILIO_ACCOUNT_SID');
	if (!env.TWILIO_AUTH_TOKEN) missing.push('TWILIO_AUTH_TOKEN');
	if (!env.TWILIO_PHONE_NUMBER) missing.push('TWILIO_PHONE_NUMBER');

	if (scope === 'os_surface') {
		if (!CALL_INITIATION_SURFACE_MOUNTED) {
			missing.push('supporter phone custody and mounted connect controls');
		}
	} else {
		if (options.supporterPhonePresent === false) missing.push('supporter phone on file');
		if (options.callerPhoneProvided !== true) {
			missing.push('caller phone confirmation from org-key decrypt');
		}
	}

	const twilioConfigured = Boolean(
		env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER
	);
	const transportReady =
		twilioConfigured &&
		CALL_INITIATION_PROXY_IMPLEMENTED &&
		options.featureEnabled !== false &&
		options.canManageCalls !== false;
	const ready = missing.length === 0;
	const runtimeFlag = ready
		? 'ready'
		: scope === 'os_surface' && transportReady
			? 'transport_ready_without_surface'
			: 'closed';
	const message = ready
		? scope === 'api_request'
			? 'Patch-through call initiation is armed for this request: call authority, caller confirmation, Twilio bridge, and transport credentials are present.'
			: 'Patch-through call initiation can be surfaced.'
		: scope === 'os_surface'
			? `Patch-through transport is ${transportReady ? 'configured' : 'not fully configured'}, but the org OS must stay record-first until ${missing.join(', ')} clear.`
			: `Patch-through call initiation is not armed; missing ${missing.join(', ')}.`;

	return {
		ready,
		twilioConfigured,
		missing,
		dependency: CALL_INITIATION_DEPENDENCY,
		runtimeFlag,
		scope,
		surfaceMounted: CALL_INITIATION_SURFACE_MOUNTED,
		proxyImplemented: CALL_INITIATION_PROXY_IMPLEMENTED,
		message
	};
}
