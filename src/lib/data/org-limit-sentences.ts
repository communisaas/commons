/**
 * One home for the plain-language limit sentences shown on org actions that
 * work today within a real limit, keyed by the server boundary codes that
 * enforce them. Numbers interpolate from the exported constants so the copy
 * can never drift from the enforcement. Operator runtime detail (missing
 * configuration, dependency summary) rides along for a collapsed
 * administrator affordance — it is never the headline.
 */

/**
 * Email sends at or under this recipient count go out directly from the
 * sender's browser. Above it, server dispatch infrastructure takes over.
 */
export const CLIENT_DIRECT_EMAIL_THRESHOLD = 500;

/** Carrier text dispatch accepts at most this many recipients per batch. */
export const MAX_DECRYPTED_SMS_DISPATCH = 100;

/**
 * Every boundary code that carries a limit sentence. The first seven are
 * boundary codes returned by the org server routes; `congressional_delivery`
 * is keyed explicitly because congressional readiness surfaces through load
 * data rather than a route error code.
 */
export const ORG_LIMIT_CODES = [
	'text_dispatch_not_armed',
	'email_server_dispatch_dependency_missing',
	'workflow_email_dependency_missing',
	'call_initiation_not_armed',
	'platform_api_sync_not_armed',
	'platform_api_credential_custody_not_configured',
	'platform_api_credential_probe_failed',
	'congressional_delivery'
] as const;

export type OrgLimitCode = (typeof ORG_LIMIT_CODES)[number];

export type PlatformApiLimitCode = Extract<
	OrgLimitCode,
	| 'platform_api_sync_not_armed'
	| 'platform_api_credential_custody_not_configured'
	| 'platform_api_credential_probe_failed'
>;

/**
 * Runtime detail for the collapsed administrator affordance. May name
 * environment variables and dependency chains — which is exactly why it never
 * appears in the headline sentence.
 */
export type OrgLimitOperatorDetail = {
	missing: string[];
	dependency: string | null;
	message: string | null;
};

export type OrgLimitNotice = {
	code: OrgLimitCode;
	/** The one plain-language sentence an org member sees. */
	sentence: string;
	/** Quiet secondary reassurance that nothing was lost, when an artifact is kept. */
	reassurance: string | null;
	/** Operator detail for the collapsed administrator affordance, never the headline. */
	operatorDetail: OrgLimitOperatorDetail | null;
};

export function textDispatchLimitSentence(batchSize: number = MAX_DECRYPTED_SMS_DISPATCH): string {
	return `Texts send in batches of ${batchSize} for now.`;
}

export function emailServerDispatchLimitSentence(
	threshold: number = CLIENT_DIRECT_EMAIL_THRESHOLD
): string {
	return `Emails to more than ${threshold} recipients are saved as drafts until your email infrastructure is connected.`;
}

export function orgLimitSentence(code: OrgLimitCode): string {
	switch (code) {
		case 'text_dispatch_not_armed':
			return textDispatchLimitSentence();
		case 'email_server_dispatch_dependency_missing':
			return emailServerDispatchLimitSentence();
		case 'workflow_email_dependency_missing':
			return 'Workflow emails stay paused until your email infrastructure is connected — every other step runs.';
		case 'call_initiation_not_armed':
			return 'Calls connect once phone service is configured.';
		case 'platform_api_sync_not_armed':
			return "Direct sync isn't available for this platform yet. CSV import works now.";
		case 'platform_api_credential_custody_not_configured':
			return "Platform credentials can't be stored yet, so direct sync isn't available. CSV import works now.";
		case 'platform_api_credential_probe_failed':
			return "Your stored platform credential didn't open — reconnect it. CSV import still works.";
		case 'congressional_delivery':
			return "Congressional delivery isn't available yet — messages save as drafts until it is.";
	}
}

/**
 * Preserved-artifact reassurance, present only where an artifact is kept and
 * the sentence itself does not already say so.
 */
export function orgLimitReassurance(code: OrgLimitCode): string | null {
	switch (code) {
		case 'text_dispatch_not_armed':
			return 'Your draft is saved.';
		case 'workflow_email_dependency_missing':
			return 'Your workflow is saved.';
		default:
			return null;
	}
}

type OperatorDetailSource = {
	missing?: readonly string[] | null;
	dependency?: string | null;
	message?: string | null;
};

export function buildOrgLimitNotice(
	code: OrgLimitCode,
	detail?: OperatorDetailSource | null
): OrgLimitNotice {
	const missing = (detail?.missing ?? []).filter(
		(item): item is string => typeof item === 'string' && item.length > 0
	);
	const dependency = detail?.dependency ?? null;
	const message = detail?.message ?? null;
	const hasDetail = missing.length > 0 || dependency !== null || message !== null;

	return {
		code,
		sentence: orgLimitSentence(code),
		reassurance: orgLimitReassurance(code),
		operatorDetail: hasDetail ? { missing, dependency, message } : null
	};
}

// ─── Adapters for the readiness slices threaded through OperatingGroundData ───
// Each accepts the slice shape the org layout load already provides, so
// surfaces can pass `spaces.operating.<slice>` straight through.

export function textDeliveryLimitNotice(
	textDelivery?: {
		dispatchRuntimeMissing: string[];
		dispatchRuntimeDependency: string;
		dispatchRuntimeMessage: string;
	} | null
): OrgLimitNotice {
	return buildOrgLimitNotice(
		'text_dispatch_not_armed',
		textDelivery
			? {
					missing: textDelivery.dispatchRuntimeMissing,
					dependency: textDelivery.dispatchRuntimeDependency,
					message: textDelivery.dispatchRuntimeMessage
				}
			: null
	);
}

export function emailDeliveryLimitNotice(
	emailDelivery?: {
		serverDispatchRuntimeMissing: string[];
		serverDispatchRuntimeDependency: string;
		serverDispatchRuntimeMessage: string;
	} | null
): OrgLimitNotice {
	return buildOrgLimitNotice(
		'email_server_dispatch_dependency_missing',
		emailDelivery
			? {
					missing: emailDelivery.serverDispatchRuntimeMissing,
					dependency: emailDelivery.serverDispatchRuntimeDependency,
					message: emailDelivery.serverDispatchRuntimeMessage
				}
			: null
	);
}

export function workflowEmailLimitNotice(
	readiness?: {
		missing: string[];
		dependency: string;
		message: string;
	} | null
): OrgLimitNotice {
	return buildOrgLimitNotice('workflow_email_dependency_missing', readiness);
}

export function callRoutingLimitNotice(
	callRouting?: {
		initiationRuntimeMissing: string[];
		initiationRuntimeDependency: string;
		initiationRuntimeMessage: string;
	} | null
): OrgLimitNotice {
	return buildOrgLimitNotice(
		'call_initiation_not_armed',
		callRouting
			? {
					missing: callRouting.initiationRuntimeMissing,
					dependency: callRouting.initiationRuntimeDependency,
					message: callRouting.initiationRuntimeMessage
				}
			: null
	);
}

export function platformApiSyncLimitNotice(
	platformApiSync?: {
		runtimeMissing: string[];
		runtimeDependency: string;
		runtimeMessage: string;
	} | null,
	code: PlatformApiLimitCode = 'platform_api_sync_not_armed'
): OrgLimitNotice {
	return buildOrgLimitNotice(
		code,
		platformApiSync
			? {
					missing: platformApiSync.runtimeMissing,
					dependency: platformApiSync.runtimeDependency,
					message: platformApiSync.runtimeMessage
				}
			: null
	);
}

export function congressionalDeliveryLimitNotice(
	congressionalDelivery?: {
		runtimeMissing: string[];
		runtimeDependency: string;
		runtimeMessage: string;
	} | null
): OrgLimitNotice {
	return buildOrgLimitNotice(
		'congressional_delivery',
		congressionalDelivery
			? {
					missing: congressionalDelivery.runtimeMissing,
					dependency: congressionalDelivery.runtimeDependency,
					message: congressionalDelivery.runtimeMessage
				}
			: null
	);
}
