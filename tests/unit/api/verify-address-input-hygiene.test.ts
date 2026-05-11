/**
 * Input-hygiene contract tests for verify-address.
 *
 * Brutalist Finding 2 (codebase domain): `checkCap` silently dropped
 * non-string values for fields like `address_hash`, `atlas_root`, `cell_id`.
 * Cure: throw 400 instead of returning undefined. These tests lock the
 * contract so a future refactor that re-introduces silent-drop fails loudly.
 */

import { describe, it, expect, vi } from 'vitest';

const { envMock } = vi.hoisted(() => ({
	envMock: { ADDRESS_RESOLUTION_TOKEN_SECRET: 'a'.repeat(64) } as Record<
		string,
		string | undefined
	>
}));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

const { mockServerQuery, mockServerMutation } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn()
}));
vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));
vi.mock('$lib/convex', () => ({
	api: {
		users: { getDidKey: 'users.getDidKey', verifyAddress: 'users.verifyAddress' }
	}
}));

import { POST } from '../../../src/routes/api/identity/verify-address/+server';

function buildEvent(body: unknown) {
	return {
		request: { json: async () => body },
		locals: { user: { id: 'user_abc' } }
	} as unknown as Parameters<typeof POST>[0];
}

describe('verify-address input hygiene — non-string fields rejected', () => {
	const NON_STRING_VALUES: Array<[string, unknown]> = [
		['number', 12345],
		['boolean', true],
		['array', ['a', 'b']],
		['object', { evil: 'payload' }],
		['function-shaped object', { call: 'me' }]
	];

	const FIELDS = [
		'address_token',
		'address_hash',
		'cell_id',
		'h3_cell',
		'cell_map_root',
		'cell_map_version',
		'atlas_root',
		'state_senate_district',
		'state_assembly_district'
	] as const;

	for (const field of FIELDS) {
		for (const [label, value] of NON_STRING_VALUES) {
			it(`400 when ${field} is a ${label}`, async () => {
				const response = await POST(
					buildEvent({
						district: 'CA-12',
						verification_method: 'civic_api',
						officials: [],
						[field]: value
					})
				);
				expect(response.status).toBe(400);
				const json = await response.json();
				expect(json.error).toContain(field);
				expect(json.error).toMatch(/must be a string/);
			});
		}
	}

	it('still accepts undefined (legitimate optional)', async () => {
		mockServerQuery.mockResolvedValue({ didKey: null });
		mockServerMutation.mockResolvedValue({
			districtCredentialId: 'cred_123',
			districtHash: 'hash',
			expiresAt: Date.now() + 1_000_000
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: []
				// all optional fields omitted
			})
		);
		// Should NOT be 400 from input hygiene. Whatever happens downstream
		// is covered by other suites.
		const json = await response.json();
		if (response.status === 400) {
			expect(json.error).not.toMatch(/must be a string/);
		}
	});

	it('still accepts null as undefined (legitimate optional)', async () => {
		mockServerQuery.mockResolvedValue({ didKey: null });
		mockServerMutation.mockResolvedValue({
			districtCredentialId: 'cred_123',
			districtHash: 'hash',
			expiresAt: Date.now() + 1_000_000
		});
		const response = await POST(
			buildEvent({
				district: 'CA-12',
				verification_method: 'civic_api',
				officials: [],
				cell_id: null,
				h3_cell: null
			})
		);
		const json = await response.json();
		if (response.status === 400) {
			expect(json.error).not.toMatch(/must be a string/);
		}
	});
});
