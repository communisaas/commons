import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	DECISION_MAKER_PROVIDER_LIMITS,
	EXTERNAL_PROVIDER_ATTEMPT_LIMITS,
	GEMINI_STAGE_ENVELOPES,
	MAX_DECISION_MAKER_PROVIDER_BUNDLE,
	MAX_DECISION_MAKER_PROVIDER_ATTEMPTS,
	PROVIDER_OPERATION_CALL_BUNDLES,
	PROVIDER_OPERATION_CALL_ENVELOPES,
	decisionMakerProviderBundle,
	decisionMakerProviderAttempts
} from '$lib/core/agents/provider-call-envelope';
import { MAX_DECISION_MAKER_FANOUT } from '$lib/core/agents/cogs-fanout';
import { SEARCH_CONFIG, CONTENTS_CONFIG } from '$lib/server/exa/rate-limiter';
import { FIRECRAWL_CONFIG } from '$lib/server/firecrawl/rate-limiter';
import {
	paidProviderBudgetOperationNames,
	paidProviderBudgetPolicyFor
} from '$lib/server/paid-provider-budget-policy';

describe('paid provider call envelopes', () => {
	it('removes every 65K output tail and gives each Gemini stage an immutable small ceiling', () => {
		for (const [stage, envelope] of Object.entries(GEMINI_STAGE_ENVELOPES)) {
			expect(envelope.maxPromptBytes, stage).toBeGreaterThan(0);
			expect(envelope.maxOutputTokens, stage).toBeLessThanOrEqual(8_192);
			expect(envelope.maxAttempts, stage).toBeLessThanOrEqual(2);
			expect(envelope.timeoutMs, stage).toBeLessThanOrEqual(90_000);
			expect(envelope.maxThinkingTokens, stage).toBeLessThanOrEqual(2_048);
		}
		expect(GEMINI_STAGE_ENVELOPES['subject-line'].maxAttempts).toBe(1);
		expect(GEMINI_STAGE_ENVELOPES['message-write'].maxOutputTokens).toBe(8_192);
		expect(GEMINI_STAGE_ENVELOPES['decision-contact-synthesis'].maxAttempts).toBe(2);
	});

	it('proves every cache split stays inside the exact 166-unit decision-maker reservation', () => {
		const attempts = Array.from({ length: MAX_DECISION_MAKER_FANOUT + 1 }, (_, uncached) =>
			decisionMakerProviderAttempts(uncached)
		);
		expect(attempts).toEqual([52, 71, 86, 101, 118, 129, 140, 145, 148, 151, 156, 159, 162]);
		expect(MAX_DECISION_MAKER_PROVIDER_ATTEMPTS).toBe(162);
		expect(MAX_DECISION_MAKER_PROVIDER_BUNDLE).toEqual({
			dnsMx: 12,
			exaContents: 32,
			exaSearch: 72,
			firecrawl: 32,
			gemini: 13,
			groq: 1
		});
		expect(PROVIDER_OPERATION_CALL_ENVELOPES['decision-makers']).toBe(162);
		expect(decisionMakerProviderBundle(10).dnsMx).toBe(12);
		expect(decisionMakerProviderAttempts(12)).toBe(162);
		expect(
			Object.values(MAX_DECISION_MAKER_PROVIDER_BUNDLE).reduce((sum, attempts) => sum + attempts, 0)
		).toBe(162);
		for (let uncached = 0; uncached <= MAX_DECISION_MAKER_FANOUT; uncached++) {
			const actual = decisionMakerProviderBundle(uncached);
			// MX bills per domain, and the ceiling is enforced at the call site —
			// it must bind for every cache split, not just the worst one.
			expect(actual.dnsMx, `dnsMx at uncached=${uncached}`).toBeLessThanOrEqual(
				DECISION_MAKER_PROVIDER_LIMITS.maxMxDomainsPerResolution
			);
			for (const provider of Object.keys(actual) as Array<keyof typeof actual>) {
				expect(actual[provider], `${provider} at uncached=${uncached}`).toBeLessThanOrEqual(
					MAX_DECISION_MAKER_PROVIDER_BUNDLE[provider]
				);
			}
		}
		expect(DECISION_MAKER_PROVIDER_LIMITS).toMatchObject({
			maxPagesTotal: 12,
			maxSeatHopPages: 4,
			maxPagesPerSynthesisChunk: 6,
			maxPageBytesPerSynthesisChunk: 4_000,
			maxCandidatesPerSynthesisChunk: 8,
			synthesisChunkSize: 3
		});
	});

	it('ties the proof to the independently enforced Exa and Firecrawl attempt limits', () => {
		expect(EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaSearch).toBe(SEARCH_CONFIG.maxRetries);
		expect(EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaContents).toBe(CONTENTS_CONFIG.maxRetries);
		expect(EXTERNAL_PROVIDER_ATTEMPT_LIMITS.firecrawlScrape).toBe(FIRECRAWL_CONFIG.maxRetries);
	});

	it('makes the durable reservation weight dominate its exact worst-case call bundle', () => {
		expect(paidProviderBudgetOperationNames()).toEqual(
			Object.keys(PROVIDER_OPERATION_CALL_ENVELOPES).sort()
		);
		for (const [operation, calls] of Object.entries(PROVIDER_OPERATION_CALL_ENVELOPES)) {
			const policy = paidProviderBudgetPolicyFor(operation, 'authenticated');
			expect(policy, operation).not.toBeNull();
			expect(policy?.maxProviderCallsPerReservation, operation).toBe(calls);
			expect(policy?.weightUnits, operation).toBeGreaterThanOrEqual(calls);
			expect(policy?.providerCallBundle, operation).toEqual(
				PROVIDER_OPERATION_CALL_BUNDLES[operation as keyof typeof PROVIDER_OPERATION_CALL_BUNDLES]
			);
		}
	});

	it('requires one named stage at every production Gemini call site', () => {
		const expectations: ReadonlyArray<readonly [string, readonly string[]]> = [
			['src/lib/core/agents/agents/subject-line.ts', ["stage: 'subject-line'"]],
			['src/routes/api/agents/stream-subject/+server.ts', ["stage: 'subject-line'"]],
			['src/lib/core/agents/agents/message-writer.ts', ["stage: 'message-write'"]],
			['src/lib/core/agents/agents/source-evaluator.ts', ["stage: 'message-source-evaluation'"]],
			[
				'src/lib/core/agents/agents/decision-maker-accountability.ts',
				["stage: 'decision-accountability'"]
			],
			[
				'src/lib/core/agents/providers/gemini-provider.ts',
				[
					"stage: 'decision-role-discovery'",
					"stage: 'decision-identity-extraction'",
					"stage: 'decision-query-planning'",
					"stage: 'decision-page-selection'",
					"stage: 'decision-contact-synthesis'"
				]
			],
			['src/lib/server/delegation/parse-policy.ts', ["stage: 'delegation-policy'"]]
		];

		for (const [path, markers] of expectations) {
			const source = readFileSync(path, 'utf8');
			for (const marker of markers) expect(source, `${path}: ${marker}`).toContain(marker);
			expect(source, path).not.toMatch(/maxOutputTokens:\s*65_?536/u);
		}
	});

	it('eliminates semantic subject retries and non-aborting embedding timeout races', () => {
		const subject = readFileSync('src/lib/core/agents/agents/subject-line.ts', 'utf8');
		expect(subject.match(/await interact\(/gu)).toHaveLength(1);
		expect(subject).toContain('provider returned no usable subject line');

		const embeddings = readFileSync('src/lib/core/search/gemini-embeddings.ts', 'utf8');
		expect(embeddings).not.toContain('Promise.race');
		expect(embeddings).not.toContain('setTimeout(');
		expect(embeddings).toContain('abortSignal: options.signal');
		expect(embeddings).toContain('retryOptions: { attempts: 1 }');
	});
});
