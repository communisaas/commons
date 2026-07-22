import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
	DECISION_MAKER_PROVIDER_LIMITS,
	EXTERNAL_PROVIDER_ATTEMPT_LIMITS,
	GEMINI_STAGE_ENVELOPES
} from '$lib/core/agents/provider-call-envelope';
import { SEARCH_CONFIG, CONTENTS_CONFIG } from '$lib/server/exa/rate-limiter';
import { FIRECRAWL_CONFIG } from '$lib/server/firecrawl/rate-limiter';

describe('paid provider request ceilings', () => {
	it('removes every 65K output tail and gives each Gemini stage an immutable small ceiling', () => {
		for (const [stage, envelope] of Object.entries(GEMINI_STAGE_ENVELOPES)) {
			expect(envelope.maxPromptBytes, stage).toBeGreaterThan(0);
			expect(envelope.maxPromptBytes, stage).toBeLessThanOrEqual(96 * 1024);
			expect(envelope.maxOutputTokens, stage).toBeLessThanOrEqual(8_192);
			expect(envelope.maxAttempts, stage).toBeLessThanOrEqual(2);
			expect(envelope.timeoutMs, stage).toBeLessThanOrEqual(90_000);
			expect(envelope.maxThinkingTokens, stage).toBeLessThanOrEqual(2_048);
		}
		expect(GEMINI_STAGE_ENVELOPES['subject-line'].maxAttempts).toBe(1);
		expect(GEMINI_STAGE_ENVELOPES['message-write'].maxOutputTokens).toBe(8_192);
		expect(GEMINI_STAGE_ENVELOPES['decision-contact-synthesis'].maxAttempts).toBe(2);
	});

	it('ties request ceilings to the independently enforced Exa and Firecrawl attempt limits', () => {
		expect(EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaSearch).toBe(SEARCH_CONFIG.maxRetries);
		expect(EXTERNAL_PROVIDER_ATTEMPT_LIMITS.exaContents).toBe(CONTENTS_CONFIG.maxRetries);
		expect(EXTERNAL_PROVIDER_ATTEMPT_LIMITS.firecrawlScrape).toBe(FIRECRAWL_CONFIG.maxRetries);
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

	it('exposes decision-maker provider input bounds used by the synthesis provider', () => {
		expect(DECISION_MAKER_PROVIDER_LIMITS).toMatchObject({
			maxPagesTotal: 12,
			maxPagesPerSynthesisChunk: 6,
			maxPageBytesPerSynthesisChunk: 4_000,
			synthesisChunkSize: 3
		});

		const provider = readFileSync('src/lib/core/agents/providers/gemini-provider.ts', 'utf8');
		expect(provider).toContain('DECISION_MAKER_PROVIDER_LIMITS.maxPagesTotal');
	});
});
