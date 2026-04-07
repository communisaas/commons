/**
 * Draft Resumption Data Flow Tests
 *
 * Validates the invariant: when a user sees draft text on the homepage and clicks
 * "Review subject line", the modal MUST display that same text — never an empty input.
 *
 * Regression: Draft rawInput can be empty (e.g., after "Start fresh") while the draft
 * still has a title. The homepage falls back to showing the title, but the modal
 * loaded rawInput directly from the draft → empty. The backfill in TemplateCreator
 * covers this gap.
 */

import { describe, it, expect } from 'vitest';
import type { TemplateFormData } from '$lib/types/template';

// Extract the backfill logic from TemplateCreator to make it testable.
// This mirrors the _backfillDraftData function in TemplateCreator.svelte.
function backfillDraftData(
	draftData: TemplateFormData,
	initialText: string
): TemplateFormData {
	if (!draftData.objective.rawInput?.trim() && initialText.trim()) {
		draftData.objective.rawInput = initialText;
	}
	return draftData;
}

// Mirror the CreationSpark logic for selecting display text
function getHomepageDisplayText(draft: {
	rawInput: string;
	title: string;
}): string | null {
	if (draft.rawInput.trim()) return draft.rawInput;
	if (draft.title.trim()) return draft.title;
	return null;
}

function makeDraftObjective(overrides: Partial<TemplateFormData['objective']> = {}): TemplateFormData {
	return {
		objective: {
			rawInput: '',
			title: '',
			description: '',
			domain: '',
			slug: '',
			topics: [],
			voiceSample: '',
			aiGenerated: false,
			...overrides
		},
		audience: {
			decisionMakers: [],
			recipientEmails: [],
			includesCongress: false,
			customRecipients: []
		},
		content: {
			preview: '',
			variables: [],
			sources: [],
			researchLog: [],
			geographicScope: null,
			aiGenerated: false,
			edited: false
		},
		review: {}
	};
}

describe('Draft Resumption: Homepage → Modal Text Continuity', () => {
	describe('Core invariant: homepage text matches modal text', () => {
		it('should backfill rawInput when draft has title but empty rawInput', () => {
			// Scenario: User typed text, AI generated a subject line, user clicked "Start fresh"
			// on the written-artifact → rawInput cleared, title persisted from AI suggestion.
			// On next page load, homepage shows the title. Modal must also show it.
			const draft = makeDraftObjective({
				rawInput: '',
				title: 'Amazon workers are pissing in bottles while Bezos builds yachts'
			});

			const homepageText = getHomepageDisplayText({
				rawInput: draft.objective.rawInput,
				title: draft.objective.title
			});
			expect(homepageText).toBe('Amazon workers are pissing in bottles while Bezos builds yachts');

			// Simulate what TemplateCreator does: backfill with initialText (= homepageText)
			const result = backfillDraftData(draft, homepageText!);
			expect(result.objective.rawInput).toBe(homepageText);
		});

		it('should NOT overwrite existing rawInput with initialText', () => {
			// Normal case: draft has rawInput, homepage shows rawInput, modal should use it
			const draft = makeDraftObjective({
				rawInput: 'the original user text about amazon workers',
				title: 'Some AI-generated title'
			});

			const homepageText = getHomepageDisplayText({
				rawInput: draft.objective.rawInput,
				title: draft.objective.title
			});
			expect(homepageText).toBe('the original user text about amazon workers');

			const result = backfillDraftData(draft, homepageText!);
			expect(result.objective.rawInput).toBe('the original user text about amazon workers');
		});

		it('should handle whitespace-only rawInput as empty', () => {
			const draft = makeDraftObjective({
				rawInput: '   ',
				title: 'A valid title'
			});

			const result = backfillDraftData(draft, 'A valid title');
			expect(result.objective.rawInput).toBe('A valid title');
		});
	});

	describe('Edge cases', () => {
		it('should not backfill when initialText is also empty', () => {
			// Both empty — nothing to show. This is the fresh-start case.
			const draft = makeDraftObjective({ rawInput: '', title: '' });
			const result = backfillDraftData(draft, '');
			expect(result.objective.rawInput).toBe('');
		});

		it('should not backfill when initialText is whitespace-only', () => {
			const draft = makeDraftObjective({ rawInput: '', title: '' });
			const result = backfillDraftData(draft, '   \n  ');
			expect(result.objective.rawInput).toBe('');
		});

		it('should preserve rawInput even if title is different', () => {
			// User edited the rawInput after AI suggestion changed the title
			const draft = makeDraftObjective({
				rawInput: 'my original angry text about warehouse conditions',
				title: 'Clean AI-refined title'
			});
			const result = backfillDraftData(draft, 'my original angry text about warehouse conditions');
			expect(result.objective.rawInput).toBe('my original angry text about warehouse conditions');
		});
	});

	describe('CreationSpark display text selection', () => {
		it('prefers rawInput over title', () => {
			expect(getHomepageDisplayText({
				rawInput: 'user text',
				title: 'ai title'
			})).toBe('user text');
		});

		it('falls back to title when rawInput is empty', () => {
			expect(getHomepageDisplayText({
				rawInput: '',
				title: 'ai title'
			})).toBe('ai title');
		});

		it('returns null when both are empty', () => {
			expect(getHomepageDisplayText({
				rawInput: '',
				title: ''
			})).toBeNull();
		});
	});
});
