import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIssueDistrictCredential, mockServerMutation, mockServerQuery } = vi.hoisted(() => ({
	mockIssueDistrictCredential: vi.fn(),
	mockServerMutation: vi.fn(),
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/server/convex-work-budget', () => ({
	serverMutation: (...args: unknown[]) => mockServerMutation(...args),
	serverQuery: (...args: unknown[]) => mockServerQuery(...args)
}));

vi.mock('$lib/convex', () => ({
	api: {
		users: {
			getDidKey: 'users.getDidKey',
			verifyAddress: 'users.verifyAddress'
		}
	}
}));

vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'test-internal-secret'
}));

vi.mock('$lib/core/identity/district-credential', () => ({
	hashCredential: vi.fn().mockResolvedValue('credential-hash'),
	hashDistrict: vi.fn().mockResolvedValue('district-hash'),
	issueDistrictCredential: (...args: unknown[]) => mockIssueDistrictCredential(...args)
}));

vi.mock('$lib/core/identity/credential-policy', () => ({
	TIER_CREDENTIAL_TTL: { 2: 60_000 }
}));

vi.mock('$lib/server/auth/address-resolution-token', () => ({
	verifyAddressResolutionToken: vi.fn().mockResolvedValue({ valid: true, mode: 'geo' })
}));

import {
	issueGroundCredential,
	type GroundVerificationInput
} from '../../../src/lib/server/ground/ground-service';
import { POST } from '../../../src/routes/api/identity/verify-address/+server';

const BASE_INPUT: GroundVerificationInput = {
	verification_method: 'shadow_atlas'
};

function mutationArgs(): Record<string, unknown> {
	const call = mockServerMutation.mock.calls.at(-1);
	if (!call) throw new Error('verifyAddress mutation was not called');
	return call[1] as Record<string, unknown>;
}

function requestEvent(body: unknown): Parameters<typeof POST>[0] {
	return {
		request: { json: async () => body },
		locals: { user: { id: 'user-1' } }
	} as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
	mockServerQuery.mockResolvedValue({ didKey: null });
	mockServerMutation.mockResolvedValue({ districtCredentialId: 'credential-1' });
	mockIssueDistrictCredential.mockResolvedValue({ type: 'DistrictResidencyCredential' });
});

describe('ground credential containment', () => {
	it('forwards a derived county FIPS with provenance stored beside that slot', async () => {
		await issueGroundCredential('user-1', {
			...BASE_INPUT,
			derived_containment: [
				{ slot: 4, districtType: 'county', districtId: 'county-27115' }
			]
		});

		expect(mutationArgs()).toMatchObject({
			countyFips: '27115',
			countyFipsSource: 'atlas-derived'
		});
		expect(mutationArgs()).not.toHaveProperty('containmentSource');
	});

	it('omits county and provenance when no authenticated containment is available', async () => {
		await issueGroundCredential('user-1', BASE_INPUT);

		const args = mutationArgs();
		expect(args).not.toHaveProperty('countyFips');
		expect(args).not.toHaveProperty('countyFipsSource');
		expect(args).not.toHaveProperty('congressionalDistrictSource');
		expect(args).not.toHaveProperty('stateSenateDistrictSource');
		expect(args).not.toHaveProperty('stateAssemblyDistrictSource');
	});

	it('never forwards a county_fips key smuggled onto the request-shaped input', async () => {
		const response = await POST(
			requestEvent({
				district: 'MN-08',
				verification_method: 'civic_api',
				county_fips: '99999',
				county_fips_source: 'self-reported',
				containment_source: 'atlas-derived'
			})
		);

		expect(response.status).toBe(200);
		const args = mutationArgs();
		expect(args).not.toHaveProperty('countyFips');
		expect(args).not.toHaveProperty('countyFipsSource');
		expect(args).not.toHaveProperty('county_fips');
		expect(args).not.toHaveProperty('county_fips_source');
		expect(args).not.toHaveProperty('containment_source');
	});

	it('prefers an atlas-derived state senate district over a disagreeing client value', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await issueGroundCredential('user-1', {
			...BASE_INPUT,
			district: 'MN-08',
			state_senate_district: 'client-asserted',
			derived_containment: [
				{ slot: 2, districtType: 'state-senate', districtId: 'sldu-27011' }
			]
		});

		expect(mutationArgs()).toMatchObject({
			stateSenateDistrict: 'sldu-27011',
			congressionalDistrictSource: 'self-reported',
			stateSenateDistrictSource: 'atlas-derived'
		});
		expect(mutationArgs()).not.toHaveProperty('stateAssemblyDistrictSource');
		expect(warn).toHaveBeenCalledWith(
			'[ground] client district disagrees with atlas-derived slot',
			{ slot: 2 }
		);
		expect(mockIssueDistrictCredential).toHaveBeenCalledWith(
			expect.objectContaining({ stateSenate: 'sldu-27011' })
		);
	});

	it('labels each client-supplied district independently as self-reported', async () => {
		await issueGroundCredential('user-1', {
			...BASE_INPUT,
			district: 'MN-08',
			state_senate_district: '11',
			state_assembly_district: '11B'
		});

		expect(mutationArgs()).toMatchObject({
			congressionalDistrictSource: 'self-reported',
			stateSenateDistrictSource: 'self-reported',
			stateAssemblyDistrictSource: 'self-reported'
		});
	});
});
