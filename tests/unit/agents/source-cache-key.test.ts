import { describe, expect, it } from 'vitest';

import { computeSourceCacheInputHash } from '$lib/server/source-cache-key';

const BASE_INPUT = {
	subjectLine: 'Clean water now',
	coreMessage: 'Restore the watershed',
	topics: ['water', 'environment'],
	geographicScope: {
		type: 'subnational' as const,
		country: 'US',
		subdivision: 'IL',
		locality: 'Springfield'
	},
	decisionMakers: [{ name: 'A. Mayor', title: 'Mayor', organization: 'Springfield' }]
};

describe('source cache research-input key', () => {
	it('is deterministic and always emits a SHA-256 hex digest', async () => {
		const first = await computeSourceCacheInputHash(BASE_INPUT);
		const second = await computeSourceCacheInputHash({ ...BASE_INPUT });

		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(second).toBe(first);
	});

	it.each([
		['subject', { subjectLine: 'Different subject' }],
		['core message', { coreMessage: 'A materially different issue' }],
		['topics', { topics: ['housing'] }],
		['geography', { geographicScope: { type: 'nationwide' as const, country: 'US' } }],
		[
			'decision makers',
			{ decisionMakers: [{ name: 'B. Governor', title: 'Governor', organization: 'Illinois' }] }
		]
	])('changes when %s changes', async (_label, changed) => {
		await expect(
			computeSourceCacheInputHash({ ...BASE_INPUT, ...changed })
		).resolves.not.toBe(await computeSourceCacheInputHash(BASE_INPUT));
	});

	it('does not invalidate reusable research for voice-only personalization changes', async () => {
		const withoutVoice = await computeSourceCacheInputHash(BASE_INPUT);
		const requestWithUnrelatedWriterFields = {
			...BASE_INPUT,
			voiceSample: 'My family depends on this river.',
			rawInput: 'Please act.'
		};

		await expect(computeSourceCacheInputHash(requestWithUnrelatedWriterFields)).resolves.toBe(
			withoutVoice
		);
	});
});
