/**
 * Authoring-step polish (#1 generate-trigger, #3 ambient auth pre-signal,
 * #5 refinement de-scarcify) + search-first front door (#2). Source-pin coverage
 * of the wiring + honesty; the matcher's behavior is covered by
 * tests/unit/topic/template-text-match.test.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('AUTHOR — surfaced generate trigger, honest pre-signal, de-scarcified refinement', () => {
	const uoe = src('src/lib/components/template/creator/UnifiedObjectiveEntry.svelte');

	it('the generate trigger is a real primary affordance gated on MIN_INPUT_LENGTH, not just a kbd shortcut', () => {
		expect(uoe).toContain('generateSuggestion');
		expect(uoe).toContain('MIN_INPUT_LENGTH');
		expect(uoe).toMatch(/handleTextareaKeydown/); // Cmd/Ctrl+Enter still works
	});

	it('the trigger is surfaced in the WRITTEN (quote-artifact) state too, not only the active textarea', () => {
		// the WRITTEN state mirrors the primary gradient Generate button (the common
		// blur→artifact path no longer re-buries the trigger)
		expect(uoe).toMatch(/written-artifact[\s\S]*?from-participation-primary-600[\s\S]*?Generate/);
	});

	it('the auth pre-signal is guest-only and honestly worded (no "keep this draft" overclaim)', () => {
		expect(uoe).toContain('isGuest');
		expect(uoe).toContain("when you're ready to send");
		// sign-in does not "keep" the draft (localStorage already does; it can even orphan it)
		expect(uoe).not.toContain('keep this draft');
	});

	it('refinement is reframed from scarcity to the free/unlimited inline edit', () => {
		expect(uoe).not.toContain('Out of refinements');
		expect(uoe).toContain('free and unlimited');
	});
});

describe('SEARCH — front-door type-ahead surfaces real campaigns only', () => {
	const spark = src('src/lib/components/activation/CreationSpark.svelte');
	const home = src('src/routes/+page.svelte');

	it('renders matches only when they exist — never a fabricated match', () => {
		expect(spark).toContain('matchExistingCampaigns');
		expect(spark).toMatch(/\{#if matches\.length > 0\}/);
	});

	it('picking a match routes through the existing send path (participate fast-path)', () => {
		expect(spark).toContain('onMatchSelect');
		expect(home).toContain('onMatchSelect={handleSendMessage}');
		expect(home).toContain('matchTemplates={templateStore.templates}');
	});

	it('the matcher is the dedicated client-side text sibling, not the location filter or server search', () => {
		expect(spark).toContain("from '$lib/core/topic/template-text-match'");
	});
});
