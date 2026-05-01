import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockServerQuery = vi.hoisted(() => vi.fn());

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery
}));

vi.mock('$lib/convex', () => ({
	api: {
		users: {
			getProfile: 'users.getProfile',
			getMyTemplates: 'users.getMyTemplates',
			getMyRepresentatives: 'users.getMyRepresentatives',
			getReverificationBudget: 'users.getReverificationBudget'
		}
	}
}));

import { load } from '../../../src/routes/profile/+page.server';

describe('profile page load', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
	});

	it('uses Convex verification state for the ground affordance gate', async () => {
		const verifiedAt = 1_710_000_000_000;

		mockServerQuery
			.mockResolvedValueOnce({
				_id: 'user_123',
				_creationTime: 1_700_000_000_000,
				email: 'fresh@example.test',
				name: 'Fresh User',
				avatar: null,
				trustTier: 2,
				isVerified: true,
				verificationMethod: 'shadow_atlas',
				verifiedAt,
				addressVerifiedAt: verifiedAt,
				hasPasskey: false,
				districtHash: 'district_hash',
				districtVerified: true,
				hasWallet: false,
				trustScore: 0,
				reputationTier: 'novice',
				role: null,
				organization: null,
				location: null,
				connection: null,
				profileVisibility: 'private',
				profileCompletedAt: null
			})
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce({
				tierBypass: false,
				nextAllowedAt: null,
				recentCount: 1,
				periodCap: 3,
				windowMs: 15_552_000_000,
				emailSybilTripped: false
			});

		const result = (await load({
			locals: {
				user: {
					id: 'user_123',
					email: 'stale@example.test',
					name: 'Stale User',
					avatar: null,
					trust_tier: 1,
					district_verified: false,
					address_verified_at: null
				}
			}
		} as never)) as Awaited<ReturnType<typeof load>> & {
			user: {
				email: string;
				name: string;
				trust_tier: number;
				district_verified: boolean;
				address_verified_at: string;
			};
		};

		expect(result.user).toMatchObject({
			email: 'fresh@example.test',
			name: 'Fresh User',
			trust_tier: 2,
			district_verified: true,
			address_verified_at: new Date(verifiedAt).toISOString()
		});
	});
});
