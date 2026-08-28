import { describe, expect, it } from 'vitest';

import {
	gappedIdentityIndexes,
	seatHopHostKey,
	seatHopPathPrior,
	selectSeatHopTargets
} from '$lib/core/agents/seat-hop';

const page = (
	url: string,
	attributedTo: number[],
	emails: string[] = []
): {
	url: string;
	attributedTo: number[];
	contactHints: { emails: string[] };
} => ({ url, attributedTo, contactHints: { emails } });

describe('seat-hop selection', () => {
	it('orders contact ahead of staff and returns zero for an unmatched path', () => {
		expect(seatHopPathPrior('https://city.gov/contact')).toBeGreaterThan(
			seatHopPathPrior('https://city.gov/staff')
		);
		expect(seatHopPathPrior('https://city.gov/services/water')).toBe(0);
	});

	it('folds at most one leading www label into the same host key', () => {
		expect(seatHopHostKey('https://WWW.City.Gov/staff')).toBe('city.gov');
		expect(seatHopHostKey('https://city.gov/contact')).toBe('city.gov');
		expect(seatHopHostKey('not a URL')).toBeNull();
	});

	it('treats noreply-only evidence as gapped but a real address as filled', () => {
		const pages = [
			page('https://city.gov/mayor', [0], ['noreply@city.gov']),
			page('https://city.gov/clerk', [1], ['clerk@city.gov'])
		];

		expect(gappedIdentityIndexes(pages, 2)).toEqual([0]);
	});

	it('refuses cross-host and already-fetched links', () => {
		const pages = [page('https://city.gov/mayor', [0], ['noreply@city.gov'])];
		const targets = selectSeatHopTargets({
			pages,
			linksByUrl: new Map([
				[
					'https://city.gov/mayor',
					[
						'https://attacker.invalid/contact',
						'https://city.gov/contact',
						'https://city.gov/staff'
					]
				]
			]),
			alreadyFetchedUrls: new Set(['https://city.gov/mayor', 'https://city.gov/contact']),
			identityCount: 1,
			maxTargets: 4
		});

		expect(targets).toEqual([{ url: 'https://city.gov/staff', identityIndexes: [0] }]);
	});

	it('does not hop for an identity whose attributed page has a usable address', () => {
		const pages = [page('https://city.gov/mayor', [0], ['mayor@city.gov'])];
		expect(
			selectSeatHopTargets({
				pages,
				linksByUrl: new Map([['https://city.gov/mayor', ['https://city.gov/contact']]]),
				alreadyFetchedUrls: new Set(['https://city.gov/mayor']),
				identityCount: 1,
				maxTargets: 4
			})
		).toEqual([]);
	});

	it('merges identities that select the same hop URL', () => {
		const pages = [
			page('https://city.gov/mayor', [0]),
			page('https://city.gov/clerk', [1])
		];
		const targets = selectSeatHopTargets({
			pages,
			linksByUrl: new Map([
				['https://city.gov/mayor', ['https://city.gov/contact']],
				['https://city.gov/clerk', ['https://city.gov/contact']]
			]),
			alreadyFetchedUrls: new Set(pages.map(({ url }) => url)),
			identityCount: 2,
			maxTargets: 4
		});

		expect(targets).toEqual([{ url: 'https://city.gov/contact', identityIndexes: [0, 1] }]);
	});

	it('caps distinct targets and emits byte-identical output on repeated input', () => {
		const pages = [
			page('https://one.gov/bio', [0]),
			page('https://two.gov/bio', [1]),
			page('https://three.gov/bio', [2])
		];
		const input = {
			pages,
			linksByUrl: new Map([
				['https://one.gov/bio', ['https://one.gov/contact']],
				['https://two.gov/bio', ['https://two.gov/contact']],
				['https://three.gov/bio', ['https://three.gov/contact']]
			]),
			alreadyFetchedUrls: new Set(pages.map(({ url }) => url)),
			identityCount: 3,
			maxTargets: 2
		};

		const first = selectSeatHopTargets(input);
		const second = selectSeatHopTargets(input);
		expect(first).toHaveLength(2);
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});
});
