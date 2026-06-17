// @vitest-environment jsdom
/**
 * Studio → campaigns/new congressional handoff (B2). Locks: the unified
 * readiness predicate (no static-flag drift), the artifact carry (campaign
 * shell + GeoScope mapping), and the wiring (one SSOT both surfaces import;
 * takeToCongressional carries a draft id).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { congressionalDeliveryAvailable } from '$lib/congressional-readiness';
import { saveStudioProcessAsCampaignDraft } from '$lib/components/org/studio/studio-draft-bridge';
import { getOrgCampaignDraft } from '$lib/stores/orgCampaignDraft';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockProc(scope: any): any {
	return {
		id: 'proc_1',
		title: 'Process Title',
		composedMessage: 'Dear Senator, please support the watershed bill.',
		intent: { subjectLine: 'Protect the Watershed' },
		geographicScope: scope,
		geographicScopeLabel: 'California',
		decisionMakers: [{}, {}, {}],
		sources: [{}, {}]
	};
}

describe('congressionalDeliveryAvailable (SSOT)', () => {
	it('is true ONLY when launched AND ready', () => {
		expect(congressionalDeliveryAvailable({ launched: true, ready: true })).toBe(true);
		expect(congressionalDeliveryAvailable({ launched: true, ready: false })).toBe(false);
		expect(congressionalDeliveryAvailable({ launched: false, ready: false })).toBe(false);
		expect(congressionalDeliveryAvailable(null)).toBe(false);
		expect(congressionalDeliveryAvailable(undefined)).toBe(false);
		expect(congressionalDeliveryAvailable({})).toBe(false);
	});
});

describe('saveStudioProcessAsCampaignDraft', () => {
	beforeEach(() => {
		const store = new Map<string, string>();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).localStorage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v),
			removeItem: (k: string) => store.delete(k),
			clear: () => store.clear(),
			key: () => null,
			length: 0
		};
	});

	it('carries the campaign shell (title=subjectLine, body=PLAIN message, type) + counts', () => {
		const d = getOrgCampaignDraft(
			saveStudioProcessAsCampaignDraft(mockProc({ type: 'nationwide', country: 'US' }))
		)!;
		expect(d.title).toBe('Protect the Watershed');
		expect(d.body).toBe('Dear Senator, please support the watershed bill.');
		expect(d.body).not.toMatch(/<[a-z]/i); // plain message, not the email-HTML serializer
		expect(d.type).toBe('CONGRESSIONAL');
		expect(d.targetCountry).toBe('US');
		expect(d.metadata.decisionMakerCount).toBe(3);
		expect(d.metadata.sourceCount).toBe(2);
	});

	it('maps every GeoScope arm without crashing', () => {
		const sub = getOrgCampaignDraft(
			saveStudioProcessAsCampaignDraft(mockProc({ type: 'subnational', country: 'US', subdivision: 'CA' }))
		)!;
		expect(sub.targetCountry).toBe('US');
		expect(sub.targetJurisdiction).toBe('CA');

		const intl = getOrgCampaignDraft(
			saveStudioProcessAsCampaignDraft(mockProc({ type: 'international' }))
		)!;
		expect(intl.targetCountry).toBeUndefined();
		expect(intl.targetJurisdiction).toBeUndefined();

		const none = getOrgCampaignDraft(saveStudioProcessAsCampaignDraft(mockProc(null)))!;
		expect(none.targetCountry).toBeUndefined();
		expect(none.targetJurisdiction).toBeUndefined();
	});
});

describe('handoff wiring (source pins)', () => {
	const server = readFileSync(
		join(process.cwd(), 'src/routes/org/[slug]/campaigns/new/+page.server.ts'),
		'utf8'
	);
	const studio = readFileSync(
		join(process.cwd(), 'src/lib/components/org/os/StudioSpace.svelte'),
		'utf8'
	);

	it('campaigns/new derives congressional from readiness, NOT FEATURES.CONGRESSIONAL', () => {
		expect(server).toContain('congressionalDeliveryAvailable');
		expect(server).not.toContain('FEATURES.CONGRESSIONAL');
	});

	it('takeToCongressional carries a draft id (artifact, not a bare type hint)', () => {
		const i = studio.indexOf('function takeToCongressional');
		const fn = studio.slice(i, i + 1000);
		expect(fn).toContain('saveStudioProcessAsCampaignDraft');
		expect(fn).toContain('studioDraft=');
	});

	it('Studio and campaigns/new import the SAME availability SSOT', () => {
		expect(studio).toContain("from '$lib/congressional-readiness'");
		expect(server).toContain("from '$lib/congressional-readiness'");
	});
});
