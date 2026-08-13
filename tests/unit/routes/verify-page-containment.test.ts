// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

const { mockServerQuery } = vi.hoisted(() => ({
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/server/convex-work-budget', () => ({
	serverQuery: (...args: unknown[]) => mockServerQuery(...args)
}));

vi.mock('$lib/convex', () => ({
	api: {
		campaigns: {
			getStats: 'campaigns.getStats',
			getCampaignPacketSummary: 'campaigns.getCampaignPacketSummary'
		},
		users: { resolveCredentialHash: 'users.resolveCredentialHash' }
	}
}));

vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'test-internal-secret'
}));

import VerifyPage from '../../../src/routes/v/[hash]/+page.svelte';
import { load } from '../../../src/routes/v/[hash]/+page.server';

interface CredentialFixture {
	trustTier: number;
	verificationMethod: string;
	congressionalDistrict: string | null;
	stateSenateDistrict: string | null;
	stateAssemblyDistrict: string | null;
	countyFips: string | null;
	congressionalDistrictSource: string | null;
	stateSenateDistrictSource: string | null;
	stateAssemblyDistrictSource: string | null;
	countyFipsSource: string | null;
	issuedAt: number;
	expiresAt: number;
	hasDistrictCommitment: boolean;
	boundaryAsOf: string | null;
	officialsAsOf: string | null;
	tigerVintage: string | null;
	resolutionConfidence: number | null;
}

const CREDENTIAL: CredentialFixture = {
	trustTier: 2,
	verificationMethod: 'civic_api',
	congressionalDistrict: 'MN-08',
	stateSenateDistrict: 'sldu-27011',
	stateAssemblyDistrict: 'sldl-2711B',
	countyFips: '27115',
	congressionalDistrictSource: 'self-reported',
	stateSenateDistrictSource: 'atlas-derived',
	stateAssemblyDistrictSource: 'atlas-derived',
	countyFipsSource: 'atlas-derived',
	issuedAt: Date.UTC(2026, 0, 2),
	expiresAt: Date.UTC(2027, 0, 2),
	hasDistrictCommitment: true,
	boundaryAsOf: null,
	officialsAsOf: null,
	tigerVintage: null,
	resolutionConfidence: null
};

async function renderCredential(overrides: Partial<CredentialFixture> = {}): Promise<string> {
	const credential = { ...CREDENTIAL, ...overrides };
	mockServerQuery.mockImplementation(async (reference: unknown) => {
		if (reference === 'campaigns.getStats') return null;
		if (reference === 'users.resolveCredentialHash') return credential;
		throw new Error(`unexpected query: ${String(reference)}`);
	});

	const data = await load({ params: { hash: 'abcdef123456' } } as Parameters<typeof load>[0]);
	return render(VerifyPage, { props: { data } as never }).body;
}

function containmentRow(body: string, slot: number): string {
	const marker = `data-containment-slot="${slot}"`;
	const start = body.indexOf(marker);
	if (start < 0) throw new Error(`missing rendered containment slot ${slot}`);
	const end = body.indexOf('</div>', start + marker.length);
	if (end < 0) throw new Error(`unterminated rendered containment slot ${slot}`);
	return body.slice(start, end);
}

beforeEach(() => {
	mockServerQuery.mockReset();
});

describe('/v/[hash] containment rendering', () => {
	it('renders each carried slot with only its own persisted provenance', async () => {
		const body = await renderCredential();
		const congressional = containmentRow(body, 0);
		const stateSenate = containmentRow(body, 2);
		const stateAssembly = containmentRow(body, 3);
		const county = containmentRow(body, 4);

		expect(body).toContain('Containment');
		expect(congressional).toContain('Congressional district');
		expect(congressional).toContain('MN-08');
		expect(congressional).toContain('self-reported');
		expect(congressional).not.toContain('atlas-derived');
		expect(stateSenate).toContain('State senate district');
		expect(stateSenate).toContain('sldu-27011');
		expect(stateSenate).toContain('atlas-derived');
		expect(stateSenate).not.toContain('self-reported');
		expect(stateAssembly).toContain('State assembly district');
		expect(stateAssembly).toContain('sldl-2711B');
		expect(stateAssembly).toContain('atlas-derived');
		expect(stateAssembly).not.toContain('self-reported');
		expect(county).toContain('County (FIPS)');
		expect(county).toContain('27115');
		expect(county).toContain('atlas-derived');
		expect(county).not.toContain('self-reported');
		expect(body.match(/provenance:/g)).toHaveLength(4);
		expect(body).not.toContain('Proven Jurisdictions');
		expect(body).not.toContain('Proven at the district level');
	});

	it('renders an uncarried county and its provenance as ABSENT', async () => {
		const body = await renderCredential({
			countyFips: null,
			countyFipsSource: null
		});
		const county = containmentRow(body, 4);

		expect(county).toContain('County (FIPS)');
		expect(county.match(/ABSENT/g)).toHaveLength(2);
		expect(county).toContain('not carried by credential');
		expect(county).not.toContain('atlas-derived');
		expect(county).not.toContain('self-reported');
		expect(county).not.toContain('BLOCKED');
	});

	it('renders a carried but malformed county as BLOCKED rather than ABSENT', async () => {
		const body = await renderCredential({ countyFips: '2711' });
		const county = containmentRow(body, 4);

		expect(county).toContain('County (FIPS)');
		expect(county.match(/BLOCKED/g)).toHaveLength(2);
		expect(county).toContain('credential carried an unresolvable value');
		expect(county).not.toContain('atlas-derived');
		expect(county).not.toContain('not carried by credential');
		expect(county).not.toContain('2711</span>');
	});

	it('distinguishes an omitted slot from a carried empty slot in rendered output', async () => {
		const absentBody = await renderCredential({
			congressionalDistrict: null,
			congressionalDistrictSource: null
		});
		const blockedBody = await renderCredential({ congressionalDistrict: '' });
		const absentRow = containmentRow(absentBody, 0);
		const blockedRow = containmentRow(blockedBody, 0);

		expect(absentRow.match(/ABSENT/g)).toHaveLength(2);
		expect(absentRow).toContain('not carried by credential');
		expect(absentRow).not.toContain('credential carried an empty value');
		expect(blockedRow.match(/BLOCKED/g)).toHaveLength(2);
		expect(blockedRow).toContain('credential carried an empty value');
		expect(blockedRow).not.toContain('self-reported');
		expect(blockedRow).not.toContain('not carried by credential');
	});

	it('does not invent self-reported provenance when a carried slot has no source', async () => {
		const body = await renderCredential({ congressionalDistrictSource: null });
		const congressional = containmentRow(body, 0);

		expect(congressional).toContain('MN-08');
		expect(congressional).toContain('provenance:');
		expect(congressional).toContain('ABSENT');
		expect(congressional).not.toContain('self-reported');
		expect(congressional).not.toContain('atlas-derived');
	});

	it('does not put self-reported congressional geography in the tier-2 verification claim', async () => {
		const body = await renderCredential({ trustTier: 2 });

		expect(body).toContain(
			'The person who sent you this message verified their address before sending.'
		);
		expect(body).not.toContain('verified their address in MN before sending');
	});

	it('puts congressional geography in the tier-2 claim only when that slot is atlas-derived', async () => {
		const body = await renderCredential({
			trustTier: 2,
			congressionalDistrictSource: 'atlas-derived'
		});

		expect(body).toContain(
			'The person who sent you this message verified their address in MN before sending.'
		);
	});

	it.each([3, 4, 5])(
		'does not put self-reported congressional geography in the tier-%i government claim',
		async (trustTier) => {
			const body = await renderCredential({ trustTier });

			expect(body).toContain(
				'The person who sent you this message proved their identity and residency with a government credential.'
			);
			expect(body).not.toContain('identity and residency in MN');
		}
	);

	it.each([3, 4, 5])(
		'puts congressional geography in the tier-%i government claim when that slot is atlas-derived',
		async (trustTier) => {
			const body = await renderCredential({
				trustTier,
				congressionalDistrictSource: 'atlas-derived'
			});

			expect(body).toContain(
				'The person who sent you this message proved their identity and residency in MN with a government credential.'
			);
		}
	);

	it.each([
		[0, 'This sender has not completed verification.'],
		[1, 'The person who sent you this message authenticated their account via email before sending.']
	])('keeps the tier-%i lead non-geographic regardless of containment provenance', async (trustTier, lead) => {
		const body = await renderCredential({
			trustTier,
			congressionalDistrictSource: 'atlas-derived'
		});

		expect(body).toContain(lead);
		expect(body).not.toContain('residency in MN');
		expect(body).not.toContain('address in MN');
	});
});
