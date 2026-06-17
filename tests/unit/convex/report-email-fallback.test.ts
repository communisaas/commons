/**
 * Guards the live report-email fallback in `convex/campaigns.ts`.
 *
 * `buildReportEmailHtml` is the inline template the dispatcher (`dispatchReportEmails`)
 * falls back to when a delivery has no pre-rendered `packetHtml`. It is a real
 * sent-email path, so its eyebrow must match the standard template, which was
 * renamed from "Verification Report" to "Constituent Report" (verification is an
 * ambient watermark, not the lead). This fallback drifted because it had no test;
 * these assertions pin it to the recentered wording so it can't silently regress.
 */

import { describe, it, expect } from 'vitest';
import { buildReportEmailHtml } from '../../../convex/campaigns';

const baseCampaign = {
	title: 'Floor vote on HR-1',
	orgName: 'Sample Coalition',
	verifiedActionCount: 1234,
	tier3VerifiedActionCount: 300,
	_id: 'k1234567890'
};

describe('buildReportEmailHtml (live email fallback)', () => {
	it('emits the "Constituent Report" eyebrow', () => {
		const html = buildReportEmailHtml(baseCampaign);
		expect(html).toContain('Constituent Report');
	});

	it('does NOT emit the stale "Verification Report" eyebrow', () => {
		const html = buildReportEmailHtml(baseCampaign);
		expect(html).not.toContain('Verification Report');
	});

	it('still renders the action count and verify link (attestation path untouched)', () => {
		const html = buildReportEmailHtml(baseCampaign);
		expect(html).toContain('1,234');
		expect(html).toContain('constituent actions');
		expect(html).toContain('/v/k1234567890');
	});
});
