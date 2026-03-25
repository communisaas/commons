/**
 * Unit Tests — Delegation Policy Parser
 *
 * Tests natural language → structured policy parsing via mocked Gemini.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Hoisted mocks
// ============================================================================

const mockGenerate = vi.hoisted(() => vi.fn());

vi.mock('$lib/core/agents/gemini-client', () => ({
	generate: mockGenerate
}));

// ============================================================================
// Import SUT
// ============================================================================

import { parsePolicy } from '../../../src/lib/server/delegation/parse-policy';

// ============================================================================
// Tests
// ============================================================================

describe('Policy Parser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('parses a climate petition policy', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'campaign_sign',
				issueFilter: ['climate'],
				orgFilter: [],
				maxActionsPerDay: 3,
				requireReviewAbove: 10
			})
		});

		const result = await parsePolicy('Sign climate petitions in my district, max 3 per day');

		expect(result.scope).toBe('campaign_sign');
		expect(result.issueFilter).toEqual(['climate']);
		expect(result.orgFilter).toEqual([]);
		expect(result.maxActionsPerDay).toBe(3);
		expect(result.requireReviewAbove).toBe(10);
	});

	it('parses a full delegation policy', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'full',
				issueFilter: [],
				orgFilter: [],
				maxActionsPerDay: 5,
				requireReviewAbove: 10
			})
		});

		const result = await parsePolicy('Do everything on my behalf');

		expect(result.scope).toBe('full');
		expect(result.issueFilter).toEqual([]);
		expect(result.maxActionsPerDay).toBe(5);
	});

	it('parses message generation with multiple issues', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'message_generate',
				issueFilter: ['healthcare', 'education'],
				orgFilter: [],
				maxActionsPerDay: 2,
				requireReviewAbove: 5
			})
		});

		const result = await parsePolicy(
			'Write messages about healthcare and education to my representatives'
		);

		expect(result.scope).toBe('message_generate');
		expect(result.issueFilter).toEqual(['healthcare', 'education']);
		expect(result.maxActionsPerDay).toBe(2);
		expect(result.requireReviewAbove).toBe(5);
	});

	it('clamps maxActionsPerDay above 20', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'full',
				issueFilter: [],
				orgFilter: [],
				maxActionsPerDay: 50,
				requireReviewAbove: 10
			})
		});

		const result = await parsePolicy('Do everything, no limit');
		expect(result.maxActionsPerDay).toBe(20);
	});

	it('clamps maxActionsPerDay below 1', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'campaign_sign',
				issueFilter: [],
				orgFilter: [],
				maxActionsPerDay: -3,
				requireReviewAbove: 10
			})
		});

		const result = await parsePolicy('Sign petitions very carefully');
		expect(result.maxActionsPerDay).toBe(1);
	});

	it('defaults invalid scope to campaign_sign', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'invalid_scope',
				issueFilter: [],
				orgFilter: [],
				maxActionsPerDay: 5,
				requireReviewAbove: 10
			})
		});

		const result = await parsePolicy('Do some stuff');
		expect(result.scope).toBe('campaign_sign');
	});

	it('lowercases and trims issue filters', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'campaign_sign',
				issueFilter: ['  Climate ', 'HOUSING', '  '],
				orgFilter: [],
				maxActionsPerDay: 5,
				requireReviewAbove: 10
			})
		});

		const result = await parsePolicy('Focus on climate and housing');
		expect(result.issueFilter).toEqual(['climate', 'housing']);
	});

	it('throws on empty Gemini response', async () => {
		mockGenerate.mockResolvedValue({ text: '' });

		await expect(parsePolicy('test input')).rejects.toThrow();
	});

	it('throws on Gemini API failure', async () => {
		mockGenerate.mockRejectedValue(new Error('API rate limit'));

		await expect(parsePolicy('test input')).rejects.toThrow('API rate limit');
	});

	it('handles missing fields with defaults', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'campaign_sign',
				issueFilter: null,
				orgFilter: null,
				maxActionsPerDay: null,
				requireReviewAbove: null
			})
		});

		const result = await parsePolicy('Sign some petitions');
		expect(result.issueFilter).toEqual([]);
		expect(result.orgFilter).toEqual([]);
		// null maxActionsPerDay falls through `|| 5` default, then rounds to 5
		expect(result.maxActionsPerDay).toBe(5);
		// null requireReviewAbove falls through `?? 10` default
		expect(result.requireReviewAbove).toBe(10);
	});

	it('calls generate with correct options', async () => {
		mockGenerate.mockResolvedValue({
			text: JSON.stringify({
				scope: 'full',
				issueFilter: [],
				orgFilter: [],
				maxActionsPerDay: 5,
				requireReviewAbove: 10
			})
		});

		await parsePolicy('Do everything');

		expect(mockGenerate).toHaveBeenCalledOnce();
		const [prompt, options] = mockGenerate.mock.calls[0];
		expect(prompt).toContain('Do everything');
		expect(options.temperature).toBe(0.1);
		expect(options.responseSchema).toBeDefined();
		expect(options.systemInstruction).toContain('policy parser');
	});
});
