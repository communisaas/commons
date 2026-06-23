import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The analytics client early-returns unless it believes it's in the browser.
vi.mock('$app/environment', () => ({ browser: true }));

import { analytics, trackBaseRateRelation, trackTemplateShare } from '$lib/core/analytics/client';
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
