import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The analytics client early-returns unless it believes it's in the browser.
vi.mock('$app/environment', () => ({ browser: true }));

import {
	analytics,
	trackBaseRateRelation,
	trackTemplateShare,
	trackFrontDoorIntent
} from '$lib/core/analytics/client';
import { METRICS } from '$lib/types/analytics';

describe('trackBaseRateRelation — coarse relation encoded into utm_source', () => {
	let spy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		spy = vi.spyOn(analytics, 'increment').mockImplementation(() => {});
	});

	afterEach(() => {
		spy.mockRestore();
	});

	it('encodes "same" as rel_same on the base_rate_relation metric', () => {
		trackBaseRateRelation('same');
		expect(spy).toHaveBeenCalledWith(METRICS.base_rate_relation, { utm_source: 'rel_same' });
	});

	it('encodes "diff" as rel_diff', () => {
		trackBaseRateRelation('diff');
		expect(spy).toHaveBeenCalledWith(METRICS.base_rate_relation, { utm_source: 'rel_diff' });
	});

	it('encodes "unknown" as rel_unknown', () => {
		trackBaseRateRelation('unknown');
		expect(spy).toHaveBeenCalledWith(METRICS.base_rate_relation, { utm_source: 'rel_unknown' });
	});

	it('never emits a district identifier — only the coarse relation tag', () => {
		trackBaseRateRelation('diff');
		const [, dims] = spy.mock.calls[0] as [string, { utm_source?: string }];
		expect(dims.utm_source).toMatch(/^rel_(same|diff|unknown)$/);
	});
});

describe('trackTemplateShare — coarse ?via= channel tag', () => {
	let spy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		spy = vi.spyOn(analytics, 'increment').mockImplementation(() => {});
	});

	afterEach(() => {
		spy.mockRestore();
	});

	it('rides the existing utm_source dimension with the share channel tag', () => {
		trackTemplateShare('tmpl_123', 'share');
		expect(spy).toHaveBeenCalledWith(METRICS.template_share, {
			template_id: 'tmpl_123',
			utm_source: 'share'
		});
	});
});

describe('trackFrontDoorIntent — coarse front-door persona on its own metric', () => {
	let spy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		spy = vi.spyOn(analytics, 'increment').mockImplementation(() => {});
	});

	afterEach(() => {
		spy.mockRestore();
	});

	it('encodes "find" as fd_find on the front_door_intent metric', () => {
		trackFrontDoorIntent('find');
		expect(spy).toHaveBeenCalledWith(METRICS.front_door_intent, { utm_source: 'fd_find' });
	});

	it('encodes "author" as fd_author', () => {
		trackFrontDoorIntent('author');
		expect(spy).toHaveBeenCalledWith(METRICS.front_door_intent, { utm_source: 'fd_author' });
	});

	it('does not blend into the funnel_1 metric', () => {
		trackFrontDoorIntent('find');
		expect(spy).not.toHaveBeenCalledWith(METRICS.funnel_1, expect.anything());
	});
});
