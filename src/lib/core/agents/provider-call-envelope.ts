/**
 * Paid-provider execution envelopes.
 *
 * These are request ceilings, not tuning suggestions. Every Gemini invocation
 * names one stage so the shared client can enforce the exact prompt, output,
 * retry, timeout, and thinking ceilings before a request leaves the process.
 */
export const GEMINI_STAGE_ENVELOPES = Object.freeze({
	'subject-line': {
		maxPromptBytes: 64 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 45_000,
		maxThinkingTokens: 1_024
	},
	'decision-role-discovery': {
		maxPromptBytes: 24 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'decision-identity-extraction': {
		maxPromptBytes: 64 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'decision-query-planning': {
		maxPromptBytes: 32 * 1024,
		maxOutputTokens: 3_072,
		maxAttempts: 1,
		timeoutMs: 45_000,
		maxThinkingTokens: 512
	},
	'decision-page-selection': {
		maxPromptBytes: 72 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'decision-contact-synthesis': {
		maxPromptBytes: 64 * 1024,
		maxOutputTokens: 4_096,
		// Contact synthesis has no equivalent deterministic extraction path. It
		// alone receives one retry, only for an explicit provider-transient response.
		maxAttempts: 2,
		timeoutMs: 60_000,
		maxThinkingTokens: 512
	},
	'decision-accountability': {
		maxPromptBytes: 32 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 60_000,
		maxThinkingTokens: 1_024
	},
	'message-source-evaluation': {
		maxPromptBytes: 64 * 1024,
		maxOutputTokens: 4_096,
		maxAttempts: 1,
		timeoutMs: 45_000,
		maxThinkingTokens: 512
	},
	'message-write': {
		maxPromptBytes: 96 * 1024,
		maxOutputTokens: 8_192,
		maxAttempts: 1,
		timeoutMs: 90_000,
		maxThinkingTokens: 2_048
	},
	'delegation-policy': {
		maxPromptBytes: 16 * 1024,
		maxOutputTokens: 2_048,
		// This small, non-streaming schema has no local fallback. It receives one
		// retry, only for an explicit provider-transient response.
		maxAttempts: 2,
		timeoutMs: 30_000,
		maxThinkingTokens: 512
	}
} as const);

export type GeminiProviderStage = keyof typeof GEMINI_STAGE_ENVELOPES;

export type GeminiStageEnvelope = Readonly<{
	maxPromptBytes: number;
	maxOutputTokens: number;
	maxAttempts: 1 | 2;
	timeoutMs: number;
	maxThinkingTokens: number;
}>;

export function geminiStageEnvelope(stage: GeminiProviderStage): GeminiStageEnvelope {
	return GEMINI_STAGE_ENVELOPES[stage];
}

/** Downstream target-resolution cardinality bounds used by provider prompts. */
export const DECISION_MAKER_PROVIDER_LIMITS = Object.freeze({
	maxPagesTotal: 12,
	maxPagesPerSynthesisChunk: 6,
	maxPageBytesPerSynthesisChunk: 4_000,
	maxCandidatesPerSynthesisChunk: 4,
	synthesisChunkSize: 3,
	maxContactHintEmailsPerPage: 4,
	maxContactHintPhonesPerPage: 2,
	maxContactHintSocialUrlsPerPage: 1,
	maxEmailBytes: 320,
	maxPhoneBytes: 64,
	maxSocialUrlBytes: 512,
	maxIssueCoreMessageBytes: 4_000,
	maxIssueTopics: 5
} as const);

/** External clients' independently tested attempt ceilings. */
export const EXTERNAL_PROVIDER_ATTEMPT_LIMITS = Object.freeze({
	exaSearch: 3,
	exaContents: 2,
	firecrawlScrape: 2
} as const);
