import { describe, expect, it } from 'vitest';

import * as contactRouteModule from '$lib/core/agents/contact-route-verdict';
import {
	deriveContactRouteVerdict,
	emptyContactRouteCounts,
	tallyContactRoutes,
	type ContactRouteVerdict
} from '$lib/core/agents/contact-route-verdict';

describe('contact route verdict', () => {
	it('applies the categorical precedence in the declared order', () => {
		expect(
			deriveContactRouteVerdict({
				hasEmail: true,
				mxUndeliverable: true,
				emailClaimStripped: true
			})
		).toEqual({ status: 'undeliverable' });
		expect(deriveContactRouteVerdict({ hasEmail: true, emailClaimStripped: true })).toEqual({
			status: 'routed'
		});
		expect(deriveContactRouteVerdict({ hasEmail: false, emailClaimStripped: true })).toEqual({
			status: 'ungrounded'
		});
	});

	it('distinguishes a blocked host from a page that was actually read', () => {
		const sourceUrl = 'https://www.duke-energy.com/leadership';
		expect(
			deriveContactRouteVerdict({
				hasEmail: false,
				sourceUrl,
				blockedHosts: new Set(['www.duke-energy.com']),
				readSources: new Set([sourceUrl])
			})
		).toEqual({ status: 'blocked', hosts: ['www.duke-energy.com'] });
		expect(
			deriveContactRouteVerdict({
				hasEmail: false,
				sourceUrl,
				readSources: new Set([sourceUrl])
			})
		).toEqual({ status: 'absent', readSource: `${sourceUrl}` });
	});

	it('does not manufacture absence from another page on the same host', () => {
		const verdict = deriveContactRouteVerdict({
			hasEmail: false,
			sourceUrl: 'https://read.example.edu/absent',
			readSources: new Set(['https://read.example.edu/one'])
		});

		expect(verdict).toEqual({ status: 'unknown' });
		expect(verdict.status).not.toBe('absent');
	});

	it('returns unknown when no read or block observation supports absence', () => {
		expect(deriveContactRouteVerdict({ hasEmail: false })).toEqual({ status: 'unknown' });
		expect(
			deriveContactRouteVerdict({
				hasEmail: false,
				sourceUrl: 'not a URL',
				readSources: new Set(['https://example.gov/contact'])
			})
		).toEqual({ status: 'unknown' });
		const unobserved = deriveContactRouteVerdict({
			hasEmail: false,
			sourceUrl: 'https://example.gov/leadership',
			blockedHosts: new Set(['other.gov']),
			readSources: new Set(['https://another.gov/contact'])
		});
		expect(unobserved).toEqual({ status: 'unknown' });
		expect(unobserved.status).not.toBe('absent');
	});

	it('tallies every category and ignores candidates with no verdict', () => {
		const verdicts: Array<ContactRouteVerdict | undefined> = [
			{ status: 'routed' },
			{ status: 'ungrounded' },
			{ status: 'undeliverable' },
			{ status: 'blocked', hosts: ['blocked.example'] },
			{ status: 'absent', readSource: 'https://read.example/contact' },
			{ status: 'unknown' },
			{ status: 'routed' },
			undefined
		];

		expect(emptyContactRouteCounts()).toEqual({
			routed: 0,
			ungrounded: 0,
			undeliverable: 0,
			blocked: 0,
			absent: 0,
			unknown: 0
		});
		const counts = tallyContactRoutes(verdicts);
		expect(counts).toEqual({
			routed: 2,
			ungrounded: 1,
			undeliverable: 1,
			blocked: 1,
			absent: 1,
			unknown: 1
		});
	});

	it('exports only categorical operations, with no scalar API', () => {
		expect(Object.keys(contactRouteModule).sort()).toEqual([
			'deriveContactRouteVerdict',
			'describeContactRoute',
			'emptyContactRouteCounts',
			'normalizeContactRouteSource',
			'tallyContactRoutes'
		]);
	});
});
