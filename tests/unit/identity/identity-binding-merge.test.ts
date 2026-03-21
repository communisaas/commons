/**
 * Unit tests for mergeAccountsInTx (via bindIdentityCommitment)
 *
 * Tests the account merge path in identity-binding.ts:
 *   - Basic merge: source user records moved to target, source deleted
 *   - Unique constraint conflicts: orgMembership same org → higher role wins
 *   - Subscription conflict: higher-priced subscription wins
 *   - ShadowAtlasRegistration: target kept when both exist
 *   - EncryptedDeliveryData: target kept when both exist
 *   - DistrictCredential: target kept when both exist
 *   - UserDMRelation: duplicate DM removed, unique DM moved
 *   - Source user deletion after merge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockAccount = vi.hoisted(() => ({
	count: vi.fn(),
	updateMany: vi.fn()
}));

const mockVerificationSession = vi.hoisted(() => ({
	updateMany: vi.fn()
}));

const mockVerificationAudit = vi.hoisted(() => ({
	updateMany: vi.fn()
}));

const mockTemplate = vi.hoisted(() => ({
	updateMany: vi.fn()
}));

const mockTemplateCampaign = vi.hoisted(() => ({
	updateMany: vi.fn()
}));

const mockUserDMRelation = vi.hoisted(() => ({
	findMany: vi.fn(),
	delete: vi.fn(),
	update: vi.fn()
}));

const mockShadowAtlasRegistration = vi.hoisted(() => ({
	findFirst: vi.fn(),
	delete: vi.fn(),
	update: vi.fn()
}));

const mockSegment = vi.hoisted(() => ({
	updateMany: vi.fn()
}));

const mockOrgMembership = vi.hoisted(() => ({
	findMany: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}));

const mockSubscription = vi.hoisted(() => ({
	findFirst: vi.fn(),
	delete: vi.fn(),
	update: vi.fn()
}));

const mockEncryptedDeliveryData = vi.hoisted(() => ({
	findFirst: vi.fn(),
	delete: vi.fn(),
	update: vi.fn()
}));

const mockDistrictCredential = vi.hoisted(() => ({
	findMany: vi.fn(),
	findFirst: vi.fn(),
	deleteMany: vi.fn(),
	updateMany: vi.fn()
}));

const mockUser = vi.hoisted(() => ({
	findUnique: vi.fn(),
	update: vi.fn(),
	delete: vi.fn()
}));

const mockQueryRaw = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());

const mockPrisma = vi.hoisted(() => ({
	$transaction: mockTransaction,
	$queryRaw: mockQueryRaw,
	user: mockUser
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('$lib/core/db', () => ({
	prisma: mockPrisma,
	db: mockPrisma
}));

vi.mock('$lib/core/crypto/bn254', () => ({
	BN254_MODULUS: 21888242871839275222246405745257275088548364400416034343698204186575808495617n
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import { bindIdentityCommitment } from '../../../src/lib/core/identity/identity-binding';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SOURCE_USER_ID = 'user-source-001';
const TARGET_USER_ID = 'user-target-002';
const COMMITMENT = 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233';

function makeTxClient() {
	// Reset all mocks for the tx client
	for (const mock of [
		mockAccount.count, mockAccount.updateMany,
		mockVerificationSession.updateMany,
		mockVerificationAudit.updateMany,
		mockTemplate.updateMany,
		mockTemplateCampaign.updateMany,
		mockUserDMRelation.findMany, mockUserDMRelation.delete, mockUserDMRelation.update,
		mockShadowAtlasRegistration.findFirst, mockShadowAtlasRegistration.delete, mockShadowAtlasRegistration.update,
		mockSegment.updateMany,
		mockOrgMembership.findMany, mockOrgMembership.update, mockOrgMembership.delete,
		mockSubscription.findFirst, mockSubscription.delete, mockSubscription.update,
		mockEncryptedDeliveryData.findFirst, mockEncryptedDeliveryData.delete, mockEncryptedDeliveryData.update,
		mockDistrictCredential.findMany, mockDistrictCredential.findFirst, mockDistrictCredential.deleteMany, mockDistrictCredential.updateMany,
	]) {
		mock.mockReset();
	}

	// Default: minimal records, no conflicts
	mockAccount.count.mockResolvedValue(2);
	mockAccount.updateMany.mockResolvedValue({ count: 2 });
	mockVerificationSession.updateMany.mockResolvedValue({ count: 0 });
	mockVerificationAudit.updateMany.mockResolvedValue({ count: 0 });
	mockTemplate.updateMany.mockResolvedValue({ count: 0 });
	mockTemplateCampaign.updateMany.mockResolvedValue({ count: 0 });
	mockUserDMRelation.findMany.mockResolvedValue([]);
	mockShadowAtlasRegistration.findFirst.mockResolvedValue(null);
	mockSegment.updateMany.mockResolvedValue({ count: 0 });
	mockOrgMembership.findMany.mockResolvedValue([]);
	mockSubscription.findFirst.mockResolvedValue(null);
	mockEncryptedDeliveryData.findFirst.mockResolvedValue(null);
	mockDistrictCredential.findMany.mockResolvedValue([]);

	const txQueryRaw = vi.fn().mockResolvedValue([]);
	const txUserDelete = vi.fn().mockResolvedValue({});

	return {
		account: mockAccount,
		verificationSession: mockVerificationSession,
		verificationAudit: mockVerificationAudit,
		template: mockTemplate,
		template_campaign: mockTemplateCampaign,
		userDMRelation: mockUserDMRelation,
		shadowAtlasRegistration: mockShadowAtlasRegistration,
		segment: mockSegment,
		orgMembership: mockOrgMembership,
		subscription: mockSubscription,
		encryptedDeliveryData: mockEncryptedDeliveryData,
		districtCredential: mockDistrictCredential,
		user: {
			findUnique: vi.fn(),
			update: vi.fn().mockResolvedValue({}),
			delete: txUserDelete
		},
		$queryRaw: txQueryRaw
	};
}

/**
 * Set up mockTransaction to invoke the callback with a tx client,
 * and configure the tx to trigger a merge (commitment exists on target user).
 */
function setupMergeScenario(tx: ReturnType<typeof makeTxClient>, overrides?: {
	sourceEmail?: string;
	targetEmail?: string;
}) {
	const sourceEmail = overrides?.sourceEmail ?? 'source@example.com';
	const targetEmail = overrides?.targetEmail ?? 'target@example.com';

	// First $queryRaw: FOR UPDATE lock on current user
	// Second $queryRaw: find existing user by commitment
	tx.$queryRaw
		.mockResolvedValueOnce([{ id: SOURCE_USER_ID }])  // lock source
		.mockResolvedValueOnce([{ id: TARGET_USER_ID, email: targetEmail }]);  // existing user with commitment

	// findUnique for current user
	tx.user.findUnique.mockResolvedValue({
		id: SOURCE_USER_ID,
		email: sourceEmail,
		identity_commitment: null
	});

	mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
		return fn(tx);
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mergeAccountsInTx (via bindIdentityCommitment)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should move source records to target and delete source user', async () => {
		const tx = makeTxClient();
		setupMergeScenario(tx);

		const result = await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

		expect(result.success).toBe(true);
		expect(result.linkedToExisting).toBe(true);
		expect(result.userId).toBe(TARGET_USER_ID);
		expect(result.previousUserId).toBe(SOURCE_USER_ID);
		expect(result.requireReauth).toBe(true);
		expect(result.mergeDetails?.accountsMoved).toBe(2);

		// Verify accounts moved
		expect(mockAccount.updateMany).toHaveBeenCalledWith({
			where: { user_id: SOURCE_USER_ID },
			data: { user_id: TARGET_USER_ID }
		});

		// Verify source user deleted
		expect(tx.user.delete).toHaveBeenCalledWith({
			where: { id: SOURCE_USER_ID }
		});
	});

	it('should move verification sessions and audits', async () => {
		const tx = makeTxClient();
		setupMergeScenario(tx);

		await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

		expect(mockVerificationSession.updateMany).toHaveBeenCalledWith({
			where: { user_id: SOURCE_USER_ID },
			data: { user_id: TARGET_USER_ID }
		});
		expect(mockVerificationAudit.updateMany).toHaveBeenCalledWith({
			where: { user_id: SOURCE_USER_ID },
			data: { user_id: TARGET_USER_ID }
		});
	});

	it('should move templates and template_campaigns', async () => {
		const tx = makeTxClient();
		setupMergeScenario(tx);

		await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

		expect(mockTemplate.updateMany).toHaveBeenCalledWith({
			where: { userId: SOURCE_USER_ID },
			data: { userId: TARGET_USER_ID }
		});
		expect(mockTemplateCampaign.updateMany).toHaveBeenCalledWith({
			where: { user_id: SOURCE_USER_ID },
			data: { user_id: TARGET_USER_ID }
		});
	});

	it('should move segments', async () => {
		const tx = makeTxClient();
		setupMergeScenario(tx);

		await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

		expect(mockSegment.updateMany).toHaveBeenCalledWith({
			where: { createdBy: SOURCE_USER_ID },
			data: { createdBy: TARGET_USER_ID }
		});
	});

	// ---------------------------------------------------------------------------
	// UserDMRelation: per-row merge
	// ---------------------------------------------------------------------------

	describe('UserDMRelation merge', () => {
		it('should move non-conflicting DM relations to target', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			// Source has DM relation; target has none for that DM
			mockUserDMRelation.findMany
				.mockResolvedValueOnce([{ id: 'rel-1', userId: SOURCE_USER_ID, decisionMakerId: 'dm-1' }])
				.mockResolvedValueOnce([]);  // target has no DM relations
			mockUserDMRelation.update.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockUserDMRelation.update).toHaveBeenCalledWith({
				where: { id: 'rel-1' },
				data: { userId: TARGET_USER_ID }
			});
		});

		it('should delete source DM relation when target already has same DM', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockUserDMRelation.findMany
				.mockResolvedValueOnce([{ id: 'rel-src', userId: SOURCE_USER_ID, decisionMakerId: 'dm-1' }])
				.mockResolvedValueOnce([{ decisionMakerId: 'dm-1' }]);  // target already has dm-1
			mockUserDMRelation.delete.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockUserDMRelation.delete).toHaveBeenCalledWith({
				where: { id: 'rel-src' }
			});
		});
	});

	// ---------------------------------------------------------------------------
	// OrgMembership: unique constraint, higher role wins
	// ---------------------------------------------------------------------------

	describe('OrgMembership merge', () => {
		it('should move membership when target is not in same org', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockOrgMembership.findMany
				.mockResolvedValueOnce([{ id: 'mem-src', orgId: 'org-1', role: 'member', userId: SOURCE_USER_ID }])
				.mockResolvedValueOnce([]);  // target has no memberships
			mockOrgMembership.update.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockOrgMembership.update).toHaveBeenCalledWith({
				where: { id: 'mem-src' },
				data: { userId: TARGET_USER_ID }
			});
		});

		it('should keep higher role when both users are in same org (source has owner)', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockOrgMembership.findMany
				.mockResolvedValueOnce([
					{ id: 'mem-src', orgId: 'org-1', role: 'owner', userId: SOURCE_USER_ID }
				])
				.mockResolvedValueOnce([
					{ orgId: 'org-1', id: 'mem-tgt', role: 'member' }
				]);
			mockOrgMembership.update.mockResolvedValue({});
			mockOrgMembership.delete.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			// Target's membership should be upgraded to owner
			expect(mockOrgMembership.update).toHaveBeenCalledWith({
				where: { id: 'mem-tgt' },
				data: { role: 'owner' }
			});
			// Source membership should be deleted
			expect(mockOrgMembership.delete).toHaveBeenCalledWith({
				where: { id: 'mem-src' }
			});
		});

		it('should keep target role when target has higher role', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockOrgMembership.findMany
				.mockResolvedValueOnce([
					{ id: 'mem-src', orgId: 'org-1', role: 'member', userId: SOURCE_USER_ID }
				])
				.mockResolvedValueOnce([
					{ orgId: 'org-1', id: 'mem-tgt', role: 'owner' }
				]);
			mockOrgMembership.delete.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			// Should NOT upgrade target (already higher)
			expect(mockOrgMembership.update).not.toHaveBeenCalled();
			// Source membership deleted
			expect(mockOrgMembership.delete).toHaveBeenCalledWith({
				where: { id: 'mem-src' }
			});
		});
	});

	// ---------------------------------------------------------------------------
	// Subscription: higher price wins
	// ---------------------------------------------------------------------------

	describe('Subscription merge', () => {
		it('should move subscription when target has none', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockSubscription.findFirst
				.mockResolvedValueOnce({ id: 'sub-src', userId: SOURCE_USER_ID, price_cents: 999 })
				.mockResolvedValueOnce(null);  // target has no subscription
			mockSubscription.update.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockSubscription.update).toHaveBeenCalledWith({
				where: { id: 'sub-src' },
				data: { userId: TARGET_USER_ID }
			});
		});

		it('should keep source subscription when it has higher price', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockSubscription.findFirst
				.mockResolvedValueOnce({ id: 'sub-src', userId: SOURCE_USER_ID, price_cents: 1999 })
				.mockResolvedValueOnce({ id: 'sub-tgt', userId: TARGET_USER_ID, price_cents: 999 });
			mockSubscription.delete.mockResolvedValue({});
			mockSubscription.update.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			// Delete target's lower sub
			expect(mockSubscription.delete).toHaveBeenCalledWith({
				where: { id: 'sub-tgt' }
			});
			// Move source's higher sub to target
			expect(mockSubscription.update).toHaveBeenCalledWith({
				where: { id: 'sub-src' },
				data: { userId: TARGET_USER_ID }
			});
		});

		it('should keep target subscription when it has higher price', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockSubscription.findFirst
				.mockResolvedValueOnce({ id: 'sub-src', userId: SOURCE_USER_ID, price_cents: 499 })
				.mockResolvedValueOnce({ id: 'sub-tgt', userId: TARGET_USER_ID, price_cents: 1999 });
			mockSubscription.delete.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			// Delete source's lower sub
			expect(mockSubscription.delete).toHaveBeenCalledWith({
				where: { id: 'sub-src' }
			});
			// Target's sub should NOT be moved
			expect(mockSubscription.update).not.toHaveBeenCalled();
		});
	});

	// ---------------------------------------------------------------------------
	// ShadowAtlasRegistration: unique per user
	// ---------------------------------------------------------------------------

	describe('ShadowAtlasRegistration merge', () => {
		it('should move registration when target has none', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockShadowAtlasRegistration.findFirst
				.mockResolvedValueOnce({ id: 'sar-src', user_id: SOURCE_USER_ID })
				.mockResolvedValueOnce(null);
			mockShadowAtlasRegistration.update.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockShadowAtlasRegistration.update).toHaveBeenCalledWith({
				where: { id: 'sar-src' },
				data: { user_id: TARGET_USER_ID }
			});
		});

		it('should delete source registration when target already has one', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockShadowAtlasRegistration.findFirst
				.mockResolvedValueOnce({ id: 'sar-src', user_id: SOURCE_USER_ID })
				.mockResolvedValueOnce({ id: 'sar-tgt', user_id: TARGET_USER_ID });
			mockShadowAtlasRegistration.delete.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockShadowAtlasRegistration.delete).toHaveBeenCalledWith({
				where: { id: 'sar-src' }
			});
		});
	});

	// ---------------------------------------------------------------------------
	// EncryptedDeliveryData: unique per user
	// ---------------------------------------------------------------------------

	describe('EncryptedDeliveryData merge', () => {
		it('should move data when target has none', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockEncryptedDeliveryData.findFirst
				.mockResolvedValueOnce({ id: 'edd-src', user_id: SOURCE_USER_ID })
				.mockResolvedValueOnce(null);
			mockEncryptedDeliveryData.update.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockEncryptedDeliveryData.update).toHaveBeenCalledWith({
				where: { id: 'edd-src' },
				data: { user_id: TARGET_USER_ID }
			});
		});

		it('should keep target data when both exist', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockEncryptedDeliveryData.findFirst
				.mockResolvedValueOnce({ id: 'edd-src', user_id: SOURCE_USER_ID })
				.mockResolvedValueOnce({ id: 'edd-tgt', user_id: TARGET_USER_ID });
			mockEncryptedDeliveryData.delete.mockResolvedValue({});

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockEncryptedDeliveryData.delete).toHaveBeenCalledWith({
				where: { id: 'edd-src' }
			});
		});
	});

	// ---------------------------------------------------------------------------
	// DistrictCredential: unique per user
	// ---------------------------------------------------------------------------

	describe('DistrictCredential merge', () => {
		it('should move credentials when target has none', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockDistrictCredential.findMany.mockResolvedValue([
				{ id: 'dc-src', user_id: SOURCE_USER_ID }
			]);
			mockDistrictCredential.findFirst.mockResolvedValue(null);
			mockDistrictCredential.updateMany.mockResolvedValue({ count: 1 });

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockDistrictCredential.updateMany).toHaveBeenCalledWith({
				where: { user_id: SOURCE_USER_ID },
				data: { user_id: TARGET_USER_ID }
			});
		});

		it('should delete source credentials when target already has one', async () => {
			const tx = makeTxClient();
			setupMergeScenario(tx);

			mockDistrictCredential.findMany.mockResolvedValue([
				{ id: 'dc-src', user_id: SOURCE_USER_ID }
			]);
			mockDistrictCredential.findFirst.mockResolvedValue({ id: 'dc-tgt', user_id: TARGET_USER_ID });
			mockDistrictCredential.deleteMany.mockResolvedValue({ count: 1 });

			await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(mockDistrictCredential.deleteMany).toHaveBeenCalledWith({
				where: { user_id: SOURCE_USER_ID }
			});
		});
	});

	// ---------------------------------------------------------------------------
	// No merge: new binding
	// ---------------------------------------------------------------------------

	describe('no merge path', () => {
		it('should bind commitment to current user when no existing user has it', async () => {
			const tx = makeTxClient();

			tx.$queryRaw
				.mockResolvedValueOnce([{ id: SOURCE_USER_ID }])  // lock
				.mockResolvedValueOnce([]);  // no existing user with commitment

			tx.user.findUnique.mockResolvedValue({
				id: SOURCE_USER_ID,
				email: 'user@example.com',
				identity_commitment: null
			});
			tx.user.update.mockResolvedValue({});

			mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
				return fn(tx);
			});

			const result = await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(result.success).toBe(true);
			expect(result.linkedToExisting).toBe(false);
			expect(result.userId).toBe(SOURCE_USER_ID);
			expect(tx.user.update).toHaveBeenCalledWith({
				where: { id: SOURCE_USER_ID },
				data: { identity_commitment: COMMITMENT }
			});
		});
	});

	// ---------------------------------------------------------------------------
	// Security: cannot rebind to different commitment
	// ---------------------------------------------------------------------------

	describe('security guard', () => {
		it('should reject binding a different commitment to already-verified user', async () => {
			const tx = makeTxClient();
			const existingCommitment = 'eeeeeeee00000000eeeeeeee00000000eeeeeeee00000000eeeeeeee00000000';

			tx.$queryRaw
				.mockResolvedValueOnce([{ id: SOURCE_USER_ID }])
				.mockResolvedValueOnce([]);

			tx.user.findUnique.mockResolvedValue({
				id: SOURCE_USER_ID,
				email: 'user@example.com',
				identity_commitment: existingCommitment  // already has a different one
			});

			mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
				return fn(tx);
			});

			await expect(bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT))
				.rejects.toThrow('Cannot bind different identity to already verified user');
		});
	});

	// ---------------------------------------------------------------------------
	// Source already merged (idempotency guard)
	// ---------------------------------------------------------------------------

	describe('idempotency', () => {
		it('should return canonical user when source was already merged away', async () => {
			const tx = makeTxClient();

			tx.$queryRaw.mockResolvedValueOnce([{ id: SOURCE_USER_ID }]);
			tx.user.findUnique
				.mockResolvedValueOnce(null)  // source user already deleted
				.mockResolvedValueOnce(null); // not used — findUnique by commitment is separate

			// The code uses findUnique with identity_commitment when user is null
			// We need a second findUnique mock that returns the canonical user
			tx.user.findUnique = vi.fn()
				.mockResolvedValueOnce(null)  // current user not found
				.mockResolvedValueOnce({ id: TARGET_USER_ID });  // canonical by commitment

			mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
				return fn(tx);
			});

			const result = await bindIdentityCommitment(SOURCE_USER_ID, COMMITMENT);

			expect(result.success).toBe(true);
			expect(result.linkedToExisting).toBe(true);
			expect(result.userId).toBe(TARGET_USER_ID);
			expect(result.requireReauth).toBe(true);
		});
	});
});
