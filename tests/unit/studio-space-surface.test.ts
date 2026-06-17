/**
 * Studio surface contract.
 *
 * The Studio space is a live view over the OS process registry: an intent form
 * that spawns real authoring processes, the streamed reasoning front and
 * center, the loop's products, and two draft handoffs. These tests pin the
 * load-bearing wiring and the absence of internal contract vocabulary — not
 * prose.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const STUDIO_SPACE = 'src/lib/components/org/os/StudioSpace.svelte';
const STUDIO_SEND = 'src/lib/components/org/studio/StudioSend.svelte';

const space = readFileSync(STUDIO_SPACE, 'utf8');
const send = readFileSync(STUDIO_SEND, 'utf8');

describe('studio space wiring', () => {
	it('spawns processes through the OS runner and renders the registry view', () => {
		expect(space).toContain("from '$lib/core/authoring-process'");
		expect(space).toContain('startAuthoringProcess(os,');
		expect(space).toContain('os.focusedProcess');
		expect(space).toContain('<StudioReasoning');
		expect(space).toContain('<StudioSources');
		expect(space).toContain('<StudioSend');
		expect(space).toContain('id="studio-intent"');
	});

	it('hands the composed artifact to both delivery drafts', () => {
		expect(space).toContain('saveStudioProcessAsTemplateDraft');
		expect(space).toContain('saveStudioProcessAsOrgEmailDraft');
	});

	it('renders the quiet one-sentence notice when the authoring runtime is unconfigured', () => {
		expect(space).toContain('authoringRuntimeLimitNotice');
		expect(space).toContain('<BoundedNotice');
		// The runtime sentence comes from the shared limit-sentence source, not
		// from a readiness table rendered in place.
		expect(space).toContain("from '$lib/data/org-limit-sentences'");
	});

	it('keeps the raw failure message out of the closed-loop headline', () => {
		// A failed run reads as one plain sentence; the raw error detail rides
		// in the title attribute only.
		expect(space).toContain('The run stopped before finishing — start it again.');
		expect(space).toContain('title={closedLoopDetail ?? undefined}');
		expect(space).not.toMatch(/closedLoopSentence = \$derived\([\s\S]*?\(proc\.errorMessage/);
	});

	it('renders the replay count only after a replay has loaded, with a sentence for a loaded zero', () => {
		expect(space).toContain('{#if traceReplayLoaded}');
		expect(space).toContain('No events were logged for this run.');
		// The not-loaded state stays quiet — no null Datum ghosting an em-dash.
		expect(space).not.toContain('traceReplayEventCount || null');
	});
});

describe('studio send actions', () => {
	it('offers the two real draft handoffs by name', () => {
		expect(send).toContain('Publish as a public action page');
		expect(send).toContain('Send to your list');
	});

	it('keeps congressional delivery to one shared plain sentence', () => {
		expect(send).toContain('congressionalNotice');
		expect(send).toContain('<BoundedNotice');
	});

	it('holds actions with one quiet line instead of state machinery', () => {
		expect(send).toContain('These open once the loop finishes composing a message.');
		expect(send).toContain('need org authority');
	});

	it('names the action group in plain words for screen readers', () => {
		expect(send).toContain('aria-label="Send options"');
		expect(send).not.toContain('aria-label="Delivery handoffs"');
	});
});

describe('studio surfaces carry no internal machinery', () => {
	// Forbidden module names and vocabulary are assembled from fragments so
	// they never appear verbatim in this file either.
	const CAP = 'capability';
	const FORBIDDEN_MODULES = [
		`${CAP}-hyper${'graph'}`,
		`${CAP}-state-labels`,
		`${CAP}-clusters`,
		`${'Capability'}${'Landscape'}`
	];
	const ED = 'ed';
	const INTERNAL_VOCABULARY = new RegExp(
		`\\b(arm${ED}|bound${ED}|draft-on${'ly'}|not arm${ED})\\b`,
		'i'
	);

	for (const [name, source] of [
		['StudioSpace', space],
		['StudioSend', send]
	] as const) {
		it(`${name} imports none of the retired contract modules`, () => {
			for (const module of FORBIDDEN_MODULES) {
				expect(source).not.toContain(module);
			}
		});

		it(`${name} stays in plain org words`, () => {
			expect(source).not.toMatch(INTERNAL_VOCABULARY);
		});

		it(`${name} carries no provenance whispers`, () => {
			expect(source).not.toMatch(new RegExp('cite' + '='));
		});
	}
});
