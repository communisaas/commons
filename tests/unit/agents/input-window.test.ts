import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	INPUT_WINDOW_NOT_RESOLVED,
	formatInputWindow,
	inputWindowNonePublished,
	inputWindowSortBucket,
	resolveInputWindowFromPage
} from '$lib/core/agents/input-window';
import type { InputWindow } from '$lib/core/agents/input-window';

const SOURCE = 'https://city.example.gov/agenda/MeetingDetail.aspx?ID=1182';
const PUBLISHED = 'Written comment accepted through August 14, 2026';
const PAGE = `Council agenda. ${PUBLISHED}. Submit via the clerk's office.`;

function resolve(overrides: Partial<Parameters<typeof resolveInputWindowFromPage>[0]> = {}) {
	return resolveInputWindowFromPage({
		publishedText: PUBLISHED,
		isoDate: '2026-08-14',
		source: SOURCE,
		pageText: PAGE,
		asOf: new Date('2026-08-01T00:00:00Z'),
		...overrides
	});
}

describe('formatInputWindow', () => {
	it('reads an absent window exactly like an explicitly unresolved one', () => {
		expect(formatInputWindow(undefined)).toBe('input window: not resolved');
		expect(formatInputWindow(INPUT_WINDOW_NOT_RESOLVED)).toBe('input window: not resolved');
		expect(formatInputWindow(undefined)).toBe(formatInputWindow(INPUT_WINDOW_NOT_RESOLVED));
	});

	it('keeps none-published distinct from not-resolved in the rendered string', () => {
		const nonePublished = inputWindowNonePublished(SOURCE);
		expect(formatInputWindow(nonePublished)).toBe('input window: none published');
		expect(formatInputWindow(nonePublished)).not.toBe(formatInputWindow(INPUT_WINDOW_NOT_RESOLVED));
	});

	it('interpolates the published date into the open and closed strings', () => {
		const open: InputWindow = {
			state: 'open',
			closesOn: '2026-08-14',
			publishedText: PUBLISHED,
			source: SOURCE
		};
		const closed: InputWindow = {
			state: 'closed',
			closedOn: '2026-03-02',
			publishedText: PUBLISHED,
			source: SOURCE
		};
		expect(formatInputWindow(open)).toBe('input window: open until 2026-08-14');
		expect(formatInputWindow(closed)).toBe('input window: closed 2026-03-02');
	});
});

describe('inputWindowNonePublished', () => {
	it('records a page we read that names no deadline', () => {
		expect(inputWindowNonePublished(SOURCE)).toEqual({ state: 'none_published', source: SOURCE });
	});

	it('refuses a source that fails the https check', () => {
		expect(inputWindowNonePublished('http://city.example.gov/agenda')).toBe(
			INPUT_WINDOW_NOT_RESOLVED
		);
		expect(inputWindowNonePublished('not a url')).toBe(INPUT_WINDOW_NOT_RESOLVED);
	});
});

describe('resolveInputWindowFromPage — grounding is byte containment', () => {
	it('resolves when the published phrase literally appears in the page', () => {
		expect(resolve()).toEqual({
			state: 'open',
			closesOn: '2026-08-14',
			publishedText: PUBLISHED,
			source: SOURCE
		});
	});

	it('refuses when the phrase is absent from the page', () => {
		expect(resolve({ pageText: 'Council agenda. Nothing about comment deadlines here.' })).toBe(
			INPUT_WINDOW_NOT_RESOLVED
		);
	});

	it('refuses a one-character near-miss rather than matching fuzzily', () => {
		const nearMiss = PAGE.replace('August 14, 2026', 'August 14, 2027');
		expect(nearMiss).not.toContain(PUBLISHED);
		expect(resolve({ pageText: nearMiss })).toBe(INPUT_WINDOW_NOT_RESOLVED);
	});

	it('matches across NBSP-vs-space and wrapped whitespace after NFKC normalization', () => {
		const nbspPage = `Council agenda.\n  ${PUBLISHED.replace(/ /g, '\u00a0')}.\n`;
		expect(nbspPage).not.toContain(PUBLISHED);
		expect(resolve({ pageText: nbspPage })).toMatchObject({ state: 'open' });
	});

	it('refuses a blank published phrase', () => {
		expect(resolve({ publishedText: '' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
		expect(resolve({ publishedText: '   ' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
	});
});

describe('resolveInputWindowFromPage — never infer a deadline nobody published', () => {
	it('refuses a human-written date that is not an ISO calendar day', () => {
		expect(resolve({ isoDate: 'August 14, 2026' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
		expect(resolve({ isoDate: '2026-8-14' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
	});

	it('refuses ISO-shaped dates that are not real calendar days', () => {
		expect(resolve({ isoDate: '2026-13-01' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
		expect(resolve({ isoDate: '2026-02-30' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
	});

	it('accepts a real leap day', () => {
		const page = `Comments close 2028-02-29 sharp.`;
		expect(
			resolve({
				isoDate: '2028-02-29',
				publishedText: 'Comments close 2028-02-29',
				pageText: page
			})
		).toMatchObject({ state: 'open', closesOn: '2028-02-29' });
	});

	it('refuses a non-https or unparseable source', () => {
		expect(resolve({ source: 'http://city.example.gov/agenda' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
		expect(resolve({ source: 'city.example.gov/agenda' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
		expect(resolve({ source: '' })).toBe(INPUT_WINDOW_NOT_RESOLVED);
	});

	it('refuses an invalid comparison clock rather than falling back to ambient time', () => {
		expect(resolve({ asOf: new Date('nope') })).toBe(INPUT_WINDOW_NOT_RESOLVED);
	});
});

describe('resolveInputWindowFromPage — the published day itself counts as open', () => {
	it('is open through the last millisecond of the published UTC day', () => {
		expect(resolve({ asOf: new Date('2026-08-14T23:59:59.999Z') })).toMatchObject({
			state: 'open',
			closesOn: '2026-08-14'
		});
	});

	it('is closed at the first millisecond of the following UTC day', () => {
		expect(resolve({ asOf: new Date('2026-08-15T00:00:00.000Z') })).toMatchObject({
			state: 'closed',
			closedOn: '2026-08-14'
		});
	});

	it('carries no days-remaining field in either verdict', () => {
		const open = resolve({ asOf: new Date('2026-08-14T23:59:59.999Z') });
		const closed = resolve({ asOf: new Date('2026-08-15T00:00:00.000Z') });
		expect(Object.keys(open).sort()).toEqual(['closesOn', 'publishedText', 'source', 'state']);
		expect(Object.keys(closed).sort()).toEqual(['closedOn', 'publishedText', 'source', 'state']);
	});
});

describe('inputWindowSortBucket', () => {
	const open: InputWindow = {
		state: 'open',
		closesOn: '2026-08-14',
		publishedText: PUBLISHED,
		source: SOURCE
	};
	const closed: InputWindow = {
		state: 'closed',
		closedOn: '2026-03-02',
		publishedText: PUBLISHED,
		source: SOURCE
	};
	const nonePublished: InputWindow = { state: 'none_published', source: SOURCE };

	it('orders open before the middle bucket before closed', () => {
		expect(inputWindowSortBucket(open)).toBe(0);
		expect(inputWindowSortBucket(nonePublished)).toBe(1);
		expect(inputWindowSortBucket(INPUT_WINDOW_NOT_RESOLVED)).toBe(1);
		expect(inputWindowSortBucket(undefined)).toBe(1);
		expect(inputWindowSortBucket(closed)).toBe(2);
	});

	// Two rows we cannot distinguish must sort — and therefore render — as ties.
	it('gives none_published and not_resolved the same bucket', () => {
		expect(inputWindowSortBucket(nonePublished)).toBe(
			inputWindowSortBucket(INPUT_WINDOW_NOT_RESOLVED)
		);
	});
});

// `positionSourceDate` (src/lib/types/template.ts) is the failure mode these
// guards exist to prevent: declared on the type, bridged through persistence,
// but rendered only behind an `{#if}` and written by nothing — so nobody could
// see that it was never populated. The clock renders unconditionally instead.
describe('input-window surface contract', () => {
	const componentPath = 'src/lib/components/template/creator/DecisionMakerGrouped.svelte';
	const component = readFileSync(componentPath, 'utf8');

	it('renders the clock on every authoring resolution row', () => {
		expect(component).toContain('formatInputWindow(member.inputWindow)');
	});

	it('does not hide the row when the window is unresolved', () => {
		expect(component).not.toContain('{#if member.inputWindow');
	});

	it('renders the clock as a plain fact, with no colour on the clock line', () => {
		const clockLines = component
			.split('\n')
			.filter((line) => line.includes('formatInputWindow(member.inputWindow)'));
		expect(clockLines).toHaveLength(1);
		// Line-scoped on purpose: the component carries unrelated green/red/amber
		// markup for the email affordances, which is out of this node's scope.
		for (const token of ['text-green', 'bg-green', 'text-red', 'bg-red']) {
			expect(clockLines[0]).not.toContain(token);
		}
	});

	it('carries a resolved window through both persistence mappers', () => {
		for (const path of [
			'src/lib/stores/templateDraft.ts',
			'src/lib/components/org/studio/studio-draft-bridge.ts'
		]) {
			expect(readFileSync(path, 'utf8')).toContain('inputWindow: dm.inputWindow');
		}
	});
});
