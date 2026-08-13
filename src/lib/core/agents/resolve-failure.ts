import { sanitizeProviderControlledText } from './provider-error';

export const RESOLVE_FAILURE_STAGES = Object.freeze([
	'admission',
	'budget',
	'moderation',
	'research',
	'verification',
	'recommendation',
	'accountability',
	'suppression',
	'completion',
	'timeout',
	'unknown'
] as const);

export type ResolveFailureStage = (typeof RESOLVE_FAILURE_STAGES)[number];

export const RESOLVE_FAILURE_SIGNATURES = Object.freeze([
	'aborted',
	'timeout',
	'rate-limited',
	'quota-exhausted',
	'auth-failed',
	'bad-request',
	'safety-blocked',
	'parse-failed',
	'network',
	'no-provider',
	'unclassified'
] as const);

export type ResolveFailureSignature = (typeof RESOLVE_FAILURE_SIGNATURES)[number];

export const RESOLVE_FAILURE_BUDGETS = Object.freeze([
	'metering-unavailable',
	'denied-absent',
	'denied-unconfirmed',
	'denied-withheld',
	'denied-quota',
	'denied-platform-ceiling',
	'denied-rate-limit',
	'granted-org',
	'granted-individual'
] as const);

export type ResolveFailureBudget = (typeof RESOLVE_FAILURE_BUDGETS)[number];

export const RESOLVE_PROVIDER_ATTRIBUTIONS = Object.freeze(['observed', 'unobserved'] as const);
export type ResolveProviderAttribution =
	| Readonly<{ provider: string; providerAttribution: 'observed' }>
	| Readonly<{ provider: null; providerAttribution: 'unobserved' }>;

export const STAGE_COPY: Readonly<Record<ResolveFailureStage, string>> = Object.freeze({
	admission: 'We were stopped before research could begin. Nothing was sent.',
	budget: 'We were stopped while checking research capacity. Nothing was sent.',
	moderation:
		'We were stopped while checking whether this request could be researched safely. Nothing was sent.',
	research: 'We were stopped while researching who decides this. Nothing was sent.',
	verification:
		'We found candidates but were stopped before we could check their addresses can receive mail. Nothing was sent.',
	recommendation:
		'We were stopped while deciding which offices should hear from you. Nothing was sent.',
	accountability:
		'We were stopped while checking why these offices are responsible. Nothing was sent.',
	suppression:
		'We were stopped while checking whether any addresses should not be contacted. Nothing was sent.',
	completion:
		'We finished the checks but were stopped while preparing the results. Nothing was sent.',
	timeout: 'Research took too long and was stopped. Please try again — it may go faster on retry.',
	unknown: 'Research was stopped before we could finish. Nothing was sent.'
});

const RESOLVE_PROVIDER = Symbol('resolve.provider');
const STAGE_SET: ReadonlySet<string> = new Set(RESOLVE_FAILURE_STAGES);

type AttributedError = object & { [RESOLVE_PROVIDER]?: string };

function errorMessage(error: unknown): string {
	try {
		if (error instanceof Error) return error.message;
		if (typeof error === 'string') return error;
		return String(error);
	} catch {
		return '';
	}
}

export function coerceStage(stage: unknown): ResolveFailureStage {
	return typeof stage === 'string' && STAGE_SET.has(stage)
		? (stage as ResolveFailureStage)
		: 'unknown';
}

export function classifyResolveSignature(error: unknown): ResolveFailureSignature {
	const message = sanitizeProviderControlledText(errorMessage(error)).toLowerCase();

	if (/\babort(?:ed|ing)?\b|aborterror/u.test(message)) return 'aborted';
	if (/\btime(?:d\s*out|out)\b|deadline exceeded|etimedout/u.test(message)) return 'timeout';
	if (/rate[- ]?limit|too many requests|\b429\b/u.test(message)) return 'rate-limited';
	if (
		/quota.{0,24}(?:exceed|exhaust)|resource[_ -]?exhausted|insufficient[_ -]?quota/u.test(message)
	) {
		return 'quota-exhausted';
	}
	if (
		/\b(?:401|403)\b|unauthori[sz]ed|authentication|invalid api key|permission denied|forbidden/u.test(
			message
		)
	) {
		return 'auth-failed';
	}
	if (/\b400\b|bad request|invalid argument/u.test(message)) return 'bad-request';
	if (/safety|content filter|blocked.{0,24}(?:policy|content)/u.test(message)) {
		return 'safety-blocked';
	}
	if (/parse|malformed|unexpected token|invalid json|json syntax/u.test(message)) {
		return 'parse-failed';
	}
	if (/network|fetch failed|econn|enotfound|socket|\bdns\b|\btls\b/u.test(message)) {
		return 'network';
	}
	if (/no provider available|no available provider/u.test(message)) return 'no-provider';
	return 'unclassified';
}

export function attributeProviderFailure(providerName: string, error: unknown): void {
	if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return;
	try {
		Object.defineProperty(error, RESOLVE_PROVIDER, {
			value: providerName,
			configurable: false,
			enumerable: false,
			writable: false
		});
	} catch {
		// Frozen/non-extensible provider errors remain honestly unobserved.
	}
}

export function readProviderAttribution(error: unknown): ResolveProviderAttribution {
	if ((typeof error !== 'object' || error === null) && typeof error !== 'function') {
		return { provider: null, providerAttribution: 'unobserved' };
	}
	try {
		const provider = (error as AttributedError)[RESOLVE_PROVIDER];
		return typeof provider === 'string' && provider.length > 0
			? { provider, providerAttribution: 'observed' }
			: { provider: null, providerAttribution: 'unobserved' };
	} catch {
		return { provider: null, providerAttribution: 'unobserved' };
	}
}

export function describeResolveFailure(input: {
	stage: unknown;
	error: unknown;
	budget: ResolveFailureBudget;
	providerAttribution: ResolveProviderAttribution;
}) {
	const stage = coerceStage(input.stage);
	return Object.freeze({
		stage,
		signature: classifyResolveSignature(input.error),
		budget: input.budget,
		provider: input.providerAttribution.provider,
		providerAttribution: input.providerAttribution.providerAttribution,
		message: STAGE_COPY[stage],
		code: stage === 'timeout' ? 'RESOLVE_TIMED_OUT' : `RESOLVE_STOPPED_${stage.toUpperCase()}`
	});
}
