import { MAX_DECISION_MAKER_FANOUT } from './cogs-fanout';

/**
 * Paid-provider execution envelopes.
 *
 * These are request ceilings, not tuning suggestions. Every Gemini invocation
 * names one stage so the shared client can enforce the exact prompt, output,
 * retry, timeout, and thinking budget before a request leaves the process.
 */
export const GEMINI_STAGE_ENVELOPES = Object.freeze({
	'subject-line': {
		operation: 'subject-line',
		maxPromptBytes: 24 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 45_000,
		maxThinkingTokens: 1_024
	},
	'decision-role-discovery': {
		operation: 'decision-makers',
		maxPromptBytes: 24 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'decision-identity-extraction': {
		operation: 'decision-makers',
		maxPromptBytes: 64 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'decision-query-planning': {
		operation: 'decision-makers',
		maxPromptBytes: 32 * 1024,
		maxOutputTokens: 3_072,
		maxAttempts: 1,
		timeoutMs: 45_000,
		maxThinkingTokens: 512
	},
	'decision-page-selection': {
		operation: 'decision-makers',
		maxPromptBytes: 72 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'decision-contact-synthesis': {
		operation: 'decision-makers',
		maxPromptBytes: 64 * 1024,
		maxOutputTokens: 4_096,
		// Contact synthesis has no equivalent deterministic extraction path. It
		// alone receives one retry, and only for an explicit transient response.
		maxAttempts: 2,
		timeoutMs: 60_000,
		maxThinkingTokens: 512
	},
	'decision-accountability': {
		operation: 'decision-makers',
		maxPromptBytes: 32 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'message-source-evaluation': {
		operation: 'message-generation',
		maxPromptBytes: 24 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 45_000,
		maxThinkingTokens: 512
	},
	'message-write': {
		operation: 'message-generation',
		maxPromptBytes: 40 * 1024,
		maxOutputTokens: 8_192,
		maxAttempts: 1,
		timeoutMs: 90_000,
		maxThinkingTokens: 2_048
	},
	'delegation-policy': {
		operation: 'delegation-policy',
		maxPromptBytes: 16 * 1024,
		maxOutputTokens: 2_048,
		// This small, non-streaming schema has no local fallback. One explicit
		// provider-transient retry is covered by its 20-unit reservation.
		maxAttempts: 2,
		timeoutMs: 30_000,
		maxThinkingTokens: 512
	}
} as const);

export type GeminiProviderStage = keyof typeof GEMINI_STAGE_ENVELOPES;

export type GeminiStageEnvelope = Readonly<{
	operation: (typeof GEMINI_STAGE_ENVELOPES)[GeminiProviderStage]['operation'];
	maxPromptBytes: number;
	maxOutputTokens: number;
	maxAttempts: 1 | 2;
	timeoutMs: number;
	maxThinkingTokens: number;
}>;

export function geminiStageEnvelope(stage: GeminiProviderStage): GeminiStageEnvelope {
	return GEMINI_STAGE_ENVELOPES[stage];
}

/** Downstream target-resolution cardinality bounds used by the call proof. */
export const DECISION_MAKER_PROVIDER_LIMITS = Object.freeze({
	maxPagesTotal: 12,
	maxSeatHopPages: 4,
	maxPagesPerSynthesisChunk: 6,
	maxPageBytesPerSynthesisChunk: 4_000,
	maxRecordBlocksPerPage: 24,
	maxRecordBlockBytes: 160,
	maxCandidatesPerSynthesisChunk: 8,
	synthesisChunkSize: 3,
	// MX verification bills per DOMAIN, not per ADDRESS: one DNS-over-HTTPS
	// lookup covers every contact sharing a domain. This ceiling is *enforced*,
	// not assumed — decision-maker.ts passes it as `verifyEmailBatch`'s
	// `maxDomains`, which is what makes the `min()` in the dnsMx term below a
	// bound rather than a hope.
	maxMxDomainsPerResolution: 12,
	// gemini-client.ts throws RangeError above the 64 KiB contact-synthesis
	// envelope. The producer-level proof in contact-email.test.ts includes the
	// real user prompt, system instruction, response schema, and every delimiter.
	maxContactHintEmailsPerPage: 12,
	maxContactHintBytesPerPage: 896,
	maxEmailBytes: 254,
	maxContactHintPhonesPerPage: 2,
	maxContactHintSocialUrlsPerPage: 1,
	maxPhoneBytes: 64,
	maxSocialUrlBytes: 512,
	maxIssueCoreMessageBytes: 4_000,
	maxIssueTopics: 5
} as const);

export function truncateUtf8(value: string, maxBytes: number): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).byteLength <= maxBytes) return value;
	let result = '';
	let bytes = 0;
	for (const character of value) {
		const characterBytes = encoder.encode(character).byteLength;
		if (bytes + characterBytes > maxBytes) break;
		result += character;
		bytes += characterBytes;
	}
	return result;
}

export function boundContactHintEmails(emails: readonly string[]): string[] {
	const encoder = new TextEncoder();
	const bounded: string[] = [];
	let totalBytes = 0;
	for (const email of emails) {
		if (bounded.length >= DECISION_MAKER_PROVIDER_LIMITS.maxContactHintEmailsPerPage) break;
		const truncated = truncateUtf8(email, DECISION_MAKER_PROVIDER_LIMITS.maxEmailBytes);
		const emailBytes = encoder.encode(truncated).byteLength;
		if (totalBytes + emailBytes > DECISION_MAKER_PROVIDER_LIMITS.maxContactHintBytesPerPage) {
			break;
		}
		bounded.push(truncated);
		totalBytes += emailBytes;
	}
	return bounded;
}

/** External clients' independently tested attempt ceilings. */
export const EXTERNAL_PROVIDER_ATTEMPT_LIMITS = Object.freeze({
	exaSearch: 3,
	exaContents: 2,
	firecrawlScrape: 2,
	promptGuard: 1,
	mxLookup: 1
} as const);

/**
 * Exact worst-case provider attempts for a 12-role decision-maker admission.
 * `uncached` is enumerated so the proof covers every cache split, not only the
 * two intuitive endpoints. Firecrawl failure includes its Exa-contents fallback.
 */
export type ProviderCallBundle = Readonly<{
	dnsMx: number;
	exaContents: number;
	exaSearch: number;
	firecrawl: number;
	gemini: number;
	groq: number;
}>;

export function providerCallBundleTotal(bundle: ProviderCallBundle): number {
	return Object.values(bundle).reduce((sum, attempts) => sum + attempts, 0);
}

export function decisionMakerProviderBundle(uncached: number): ProviderCallBundle {
	if (!Number.isSafeInteger(uncached) || uncached < 0 || uncached > MAX_DECISION_MAKER_FANOUT) {
		throw new RangeError('uncached decision-maker count is outside the reviewed fanout');
	}
	const cached = MAX_DECISION_MAKER_FANOUT - uncached;
	const synthesisChunks = Math.ceil(uncached / DECISION_MAKER_PROVIDER_LIMITS.synthesisChunkSize);
	const selectedPages = Math.min(uncached * 2, DECISION_MAKER_PROVIDER_LIMITS.maxPagesTotal);
	const seatHopPages = Math.min(uncached, DECISION_MAKER_PROVIDER_LIMITS.maxSeatHopPages);
	const maximumContacts =
		cached + synthesisChunks * DECISION_MAKER_PROVIDER_LIMITS.maxCandidatesPerSynthesisChunk;

	const exaSearch =
		(MAX_DECISION_MAKER_FANOUT + uncached) * EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaSearch;
	const firecrawl =
		(selectedPages + seatHopPages) * EXTERNAL_PROVIDER_ATTEMPT_LIMITS.firecrawlScrape;
	const exaContents = (selectedPages + seatHopPages) * EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaContents;
	const gemini =
		// Role discovery + identity extraction always run.
		2 +
		(uncached > 0
			? // Query planning + page selection + bounded parallel synthesis.
				2 + synthesisChunks * GEMINI_STAGE_ENVELOPES['decision-contact-synthesis'].maxAttempts
			: 0) +
		// Accountability runs when the worst-case result has contacts.
		(maximumContacts > 0 ? 1 : 0);

	return Object.freeze({
		dnsMx:
			Math.min(maximumContacts, DECISION_MAKER_PROVIDER_LIMITS.maxMxDomainsPerResolution) *
			EXTERNAL_PROVIDER_ATTEMPT_LIMITS.mxLookup,
		exaContents,
		exaSearch,
		firecrawl,
		gemini,
		groq: EXTERNAL_PROVIDER_ATTEMPT_LIMITS.promptGuard
	});
}

export function decisionMakerProviderAttempts(uncached: number): number {
	return providerCallBundleTotal(decisionMakerProviderBundle(uncached));
}

export const MAX_DECISION_MAKER_PROVIDER_ATTEMPTS = Math.max(
	...Array.from({ length: MAX_DECISION_MAKER_FANOUT + 1 }, (_, uncached) =>
		decisionMakerProviderAttempts(uncached)
	)
);

const decisionMakerBundles = Array.from({ length: MAX_DECISION_MAKER_FANOUT + 1 }, (_, uncached) =>
	decisionMakerProviderBundle(uncached)
);

/**
 * Element-wise provider attempt envelope across every cache split. Its fields
 * need not occur in one execution: the scalar worst-total envelope above is
 * enumerated separately so a mixed-cache admission is bounded without
 * pretending all provider maxima coincide.
 *
 * With the enforced MX domain ceiling, `dnsMx` is constant at 12 for every
 * `uncached` in 0..12 — the ceiling binds at every split, since `maximumContacts`
 * is already 12 at `uncached = 0` and only grows. Every remaining provider peaks
 * at `uncached = 12`, so the element-wise envelope now numerically equals the
 * scalar worst-total at 146, where before it exceeded it (152 vs 150). Both
 * remain separately enumerated: that agreement is a property of these particular
 * constants, not a structural guarantee, and collapsing them would silently
 * unbound a mixed-cache admission the moment a constant moves.
 */
export const MAX_DECISION_MAKER_PROVIDER_BUNDLE: ProviderCallBundle = Object.freeze({
	dnsMx: Math.max(...decisionMakerBundles.map((calls) => calls.dnsMx)),
	exaContents: Math.max(...decisionMakerBundles.map((calls) => calls.exaContents)),
	exaSearch: Math.max(...decisionMakerBundles.map((calls) => calls.exaSearch)),
	firecrawl: Math.max(...decisionMakerBundles.map((calls) => calls.firecrawl)),
	gemini: Math.max(...decisionMakerBundles.map((calls) => calls.gemini)),
	groq: Math.max(...decisionMakerBundles.map((calls) => calls.groq))
});

const bundle = (values: Partial<ProviderCallBundle>): ProviderCallBundle =>
	Object.freeze({
		dnsMx: 0,
		exaContents: 0,
		exaSearch: 0,
		firecrawl: 0,
		gemini: 0,
		groq: 0,
		...values
	});

/** Exact per-provider worst-case attempts behind one successful admission. */
export const PROVIDER_OPERATION_CALL_BUNDLES = Object.freeze({
	'subject-line': bundle({ gemini: 1, groq: 1 }),
	'decision-makers': MAX_DECISION_MAKER_PROVIDER_BUNDLE,
	'message-generation': bundle({
		exaSearch: 3 * EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaSearch,
		exaContents: 6 * EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaContents,
		firecrawl: 6 * EXTERNAL_PROVIDER_ATTEMPT_LIMITS.firecrawlScrape,
		gemini:
			GEMINI_STAGE_ENVELOPES['message-source-evaluation'].maxAttempts +
			GEMINI_STAGE_ENVELOPES['message-write'].maxAttempts,
		groq: 3 * EXTERNAL_PROVIDER_ATTEMPT_LIMITS.promptGuard
	}),
	embeddings: bundle({ gemini: 1 }),
	'moderation-personalization': bundle({ groq: 2 }),
	'moderation-check': bundle({ groq: 2 }),
	'template-authoring': bundle({ gemini: 1, groq: 2 }),
	'delegation-policy': bundle({
		gemini: GEMINI_STAGE_ENVELOPES['delegation-policy'].maxAttempts
	}),
	// One rejected batch plus at most one isolated call for each of 20 rows.
	'embedding-backfill': bundle({ gemini: 21 })
} as const);

export const PROVIDER_OPERATION_CALL_ENVELOPES = Object.freeze(
	Object.fromEntries(
		Object.entries(PROVIDER_OPERATION_CALL_BUNDLES).map(([operation, callBundle]) => [
			operation,
			operation === 'decision-makers'
				? MAX_DECISION_MAKER_PROVIDER_ATTEMPTS
				: providerCallBundleTotal(callBundle)
		])
	) as { [K in keyof typeof PROVIDER_OPERATION_CALL_BUNDLES]: number }
);
