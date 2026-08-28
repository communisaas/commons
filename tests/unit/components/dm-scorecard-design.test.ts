/**
 * Decision-maker scorecard page design contracts.
 *
 * Contracts for `src/routes/dm/[id]/scorecard/+page.svelte`, an anonymous
 * public surface naming a real official. Two separately-measured
 * axes are never multiplied into one scalar and rendered against that name:
 * the badge that did so is deleted, the trend line that plotted it is
 * deleted, and nothing replaces either with a differently-named index.
 * Where the hero needs a number it is a count of things, with no bar, no
 * `/100` denominator, and no green/amber/red encoding — a colour ramp on a
 * derived scalar reads as an approval grade the substrate does not issue.
 *
 * The count and absence contracts server-render the page with serialized `Fact`
 * fixtures so a green test proves rendered output, not just matching source.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import fs from 'node:fs';
import path from 'node:path';
import { absent, blocked, present, withheld, type Fact } from '$lib/core/fact';
import ScorecardPage from '../../../src/routes/dm/[id]/scorecard/+page.svelte';

// Composed from parts so this pin does not itself put the deleted identifier
// back into a repo-wide grep for it.
const DELETED_BADGE = ['Composite', 'Score', 'Badge'].join('');
const BADGE_COMPONENT = path.resolve(
	process.cwd(),
	`src/lib/components/scorecard/${DELETED_BADGE}.svelte`
);

const current = {
	// The producer emits ratios in [0, 1], not percentage points.
	responsiveness: 0.5,
	alignment: 0.25,
	period: { start: '2026-01-01', end: '2026-03-31' },
	attestationHash: 'a'.repeat(64),
	methodologyVersion: 2,
	deliveriesSent: 3,
	deliveriesOpened: 2,
	deliveriesVerified: 1,
	repliesReceived: 1,
	alignedVotes: 1,
	totalScoredVotes: 2
};

type HistoryPoint = {
	period: string;
	responsiveness: number | null;
	alignment: number | null;
};

const producedHistory: HistoryPoint[] = [
	{ period: '2026-02', responsiveness: 1, alignment: 0.75 },
	{ period: '2026-01', responsiveness: 0, alignment: 0.25 }
];

function renderPage(
	currentFact: Fact<typeof current>,
	historyFact: Fact<HistoryPoint[]> = absent()
) {
	const { body } = render(ScorecardPage, {
		props: {
			data: {
				decisionMaker: {
					id: 'dm-1',
					name: 'Ada Official',
					title: 'Council Member',
					photoUrl: null,
					party: null,
					district: 'District 1',
					jurisdiction: 'Example City'
				},
				current: currentFact,
				history: historyFact
			}
			} as never
		});
	return body;
}

function renderedHero(body: string): string {
	const hero = body.match(/<p[^>]*data-testid="scorecard-activity"[^>]*>[\s\S]*?<\/p>/)?.[0];
	if (!hero) throw new Error('rendered scorecard activity is missing');
	return hero;
}

function renderedText(body: string): string {
	return body.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('dm scorecard page design contracts', () => {
	it('renders no composite scalar and no badge that carried one', () => {
		const body = renderPage(present(current), present(producedHistory));
		expect(body).not.toContain(DELETED_BADGE);
		// Any casing of the removed multiplied scalar.
		expect(body).not.toMatch(/composite/i);
	});

	it('the deleted badge component is gone, not soft-deprecated', () => {
		expect(fs.existsSync(BADGE_COMPONENT)).toBe(false);
	});

	it('renders no progress bar and no approval-grade colour ramp', () => {
		const body = renderPage(present(current), present(producedHistory));

		expect(body).not.toContain('role="progressbar"');
		expect(body).not.toContain('aria-valuenow');

		// The green/amber ramp the deleted badge used to derive from the
		// scalar. This assertion covers the composed server render, including
		// both count components the route renders.
		expect(body).not.toContain('text-green-');
		expect(body).not.toContain('bg-green-');
		expect(body).not.toContain('#16a34a');
		expect(body).not.toContain('text-amber-');
		expect(body).not.toContain('bg-amber-');
		expect(body).not.toContain('emerald');
		expect(body).not.toContain('>0.5<');
		expect(body).not.toContain('>0.25<');

		const text = renderedText(body);
		expect(text).toContain('Accountability receipts 3');
		expect(text).toContain('Verification links followed 1');
		expect(text).toContain('Replies logged 1');
		expect(text).toContain('Aligned votes 1 / 2');
	});

	it('renders the present receipt and response counts in the hero', () => {
		const hero = renderedHero(renderPage(present(current)));
		const heroText = renderedText(hero);

		expect(heroText).toContain('3 accountability receipts recorded');
		expect(heroText).toContain('1 with a verification link followed');
		expect(heroText).toContain('1 with a reply logged');

		// No denominator, no arc, no bar: a count is not scored out of
		// anything.
		expect(heroText).not.toContain('/ 100');
		expect(hero).not.toContain('<svg');
		expect(hero).not.toContain('role="progressbar"');

		// No colour encoding in the hero markup itself. The blue/red party
		// chip is a categorical identifier resolved inside `partyColor`, not
		// a value derived from any measured axis — it is pre-existing and
		// outside this gate.
		expect(hero).not.toMatch(/(?:text|bg|border)-(?:green|amber|red|emerald)-/);
	});

	it('renders observed absence separately from blocked and withheld activity', () => {
		const absentRender = renderPage(absent());
		expect(absentRender).toContain(
			'No accountability receipts are recorded for this official.'
		);
		expect(absentRender).toContain('No receipt activity is recorded.');
		expect(absentRender).toContain('No scored votes are recorded.');
		expect(absentRender).toContain('No activity counts are recorded.');
		expect(absentRender).toContain('No scorecard snapshot is recorded.');

		const blockedRender = renderPage(blocked('scheduled computation unavailable'));
		expect(blockedRender).toContain(
			'Accountability counts are temporarily unavailable.'
		);
		expect(blockedRender).toContain('Activity counts are temporarily unavailable.');
		expect(blockedRender).toContain('Vote counts are temporarily unavailable.');
		expect(blockedRender).toContain('Snapshot details are temporarily unavailable.');

		const withheldRender = renderPage(withheld('below public disclosure floor'));
		expect(withheldRender).toContain(
			'Accountability activity is recorded, but public counts are withheld.'
		);
		expect(withheldRender).toContain('Public activity counts are withheld.');
		expect(withheldRender).toContain('Public vote counts are withheld.');
		expect(withheldRender).toContain('Public snapshot details are withheld.');
	});

	it('renders historical absence separately from blocked, withheld, and present snapshots', () => {
		const currentFact = present(current);
		expect(renderPage(currentFact, absent())).toContain('No historical snapshots are recorded.');
		expect(renderPage(currentFact, blocked('scheduled computation unavailable'))).toContain(
			'Historical trends are temporarily unavailable.'
		);
		expect(renderPage(currentFact, withheld('below public disclosure floor'))).toContain(
			'Public historical trends are withheld.'
		);

		const presentWithoutAxes = renderPage(
			currentFact,
			present([
				{ period: '2026-02', responsiveness: null, alignment: null },
				{ period: '2026-01', responsiveness: null, alignment: null }
			])
		);
		expect(renderedText(presentWithoutAxes)).toContain('Historical activity (2 periods)');
		expect(presentWithoutAxes).not.toContain('No historical snapshots are recorded.');
	});

	it('the trend chart plots the single axes only, never their product', () => {
		const body = renderPage(present(current), present(producedHistory));

		expect(body).not.toMatch(/composite/i);

		// The producer emits [0, 1] ratios. A zero-to-one series therefore
		// spans the full 125px chart height instead of being divided by 100.
		expect(body).toContain('d="M35,135 L390,10"');
		expect(body).toContain('d="M35,103.75 L390,41.25"');
		expect(body).toContain('<span>Responsiveness</span>');
		expect(body).toContain('<span>Alignment</span>');
	});
});
