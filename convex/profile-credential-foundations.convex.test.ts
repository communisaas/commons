/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const SECRET = 'credential-foundation-test-secret-32-bytes';
type Harness = TestConvex<typeof schema>;

function userValue(
	suffix: string,
	options: { trustTier?: number; emailHash?: string } = {}
): Omit<Doc<'users'>, '_id' | '_creationTime'> {
	return {
		tokenIdentifier: `https://issuer.example|${suffix}`,
		email: `${suffix}@example.test`,
		emailHash: options.emailHash,
		updatedAt: NOW,
		isVerified: true,
		authorityLevel: options.trustTier ?? 1,
		trustTier: options.trustTier ?? 1,
		trustScore: 0,
		reputationTier: 'new',
		districtVerified: false,
		templatesContributed: 0,
		templateAdoptionRate: 0,
		peerEndorsements: 0,
		activeMonths: 0,
		profileVisibility: 'private'
	};
}

function credentialValue(
	userId: Id<'users'>,
	suffix: string,
	overrides: Partial<Omit<Doc<'districtCredentials'>, '_id' | '_creationTime'>> = {}
): Omit<Doc<'districtCredentials'>, '_id' | '_creationTime'> {
	return {
		userId,
		credentialType: 'district_residency',
		congressionalDistrict: 'CA-12',
		verificationMethod: 'postal',
		issuedAt: NOW - 30 * DAY,
		expiresAt: NOW + 365 * DAY,
		credentialHash: `credential-${suffix}`,
		...overrides
	};
}

function authenticated(t: Harness, suffix: string) {
	return t.withIdentity({
		subject: suffix,
		issuer: 'https://issuer.example',
		tokenIdentifier: `https://issuer.example|${suffix}`,
		email: `${suffix}@example.test`
	});
}

function verifyArgs(userId: Id<'users'>) {
	return {
		_secret: SECRET,
		userId,
		district: 'CA-12',
		verificationMethod: 'postal',
		expiresAt: NOW + 365 * DAY,
		isCommitmentOnly: false
	};
}

async function insertCredentials(
	t: Harness,
	userId: Id<'users'>,
	count: number,
	value: (index: number) => Omit<Doc<'districtCredentials'>, '_id' | '_creationTime'>
) {
	for (let start = 0; start < count; start += 100) {
		await t.run(async (ctx) => {
			for (let index = start; index < Math.min(start + 100, count); index += 1) {
				await ctx.db.insert('districtCredentials', value(index));
			}
		});
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.stubEnv('INTERNAL_API_SECRET', SECRET);
	vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('credential read foundations', () => {
	it('selects the newest unrevoked issuance deterministically without reading revoked future rows', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: { documentsRead: 3, databaseQueries: 3, bytesRead: 30_000 }
		});
		const suffix = 'selector-drift';
		const userId = await t.run((ctx) => ctx.db.insert('users', userValue(suffix)));
		await t.run(async (ctx) => {
			await ctx.db.insert(
				'districtCredentials',
				credentialValue(userId, 'older-active', { issuedAt: NOW - 10 * DAY })
			);
			await ctx.db.insert(
				'districtCredentials',
				credentialValue(userId, 'newest-active', { issuedAt: NOW - 5 * DAY })
			);
		});
		await insertCredentials(t, userId, 1_000, (index) =>
			credentialValue(userId, `revoked-future-${index}`, {
				issuedAt: NOW + index,
				expiresAt: NOW + 500 * DAY,
				revokedAt: NOW - DAY
			})
		);

		const auth = authenticated(t, suffix);
		await expect(
			auth.query(api.users.getActiveCredentialHash, {
				_secret: SECRET,
				userId,
				asOf: NOW
			})
		).resolves.toEqual({ credentialHash: 'credential-newest-active' });
		await expect(
			auth.query(api.users.getActiveCredentialHash, {
				_secret: SECRET,
				userId,
				asOf: NOW + 365 * DAY
			})
		).resolves.toBeNull();
	});

	it('bounds the 180-day and email-sibling budget at the exact enforcement caps', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: { documentsRead: 14, databaseQueries: 6, bytesRead: 100_000 }
		});
		const emailHash = 'shared-budget-email-hash';
		vi.setSystemTime(NOW - 200 * DAY);
		await t.run(async (ctx) => {
			for (let index = 0; index < 500; index += 1) {
				await ctx.db.insert('users', userValue(`old-sibling-${index}`, { emailHash }));
			}
		});
		vi.setSystemTime(NOW);
		const suffix = 'bounded-budget';
		const userId = await t.run((ctx) => ctx.db.insert('users', userValue(suffix, { emailHash })));
		await t.run(async (ctx) => {
			for (let index = 0; index < 3; index += 1) {
				await ctx.db.insert('users', userValue(`recent-sibling-${index}`, { emailHash }));
			}
		});
		await insertCredentials(t, userId, 500, (index) =>
			credentialValue(userId, `old-${index}`, {
				issuedAt: NOW - (181 + index) * DAY,
				revokedAt: NOW - 180 * DAY
			})
		);
		await insertCredentials(t, userId, 6, (index) =>
			credentialValue(userId, `recent-${index}`, {
				issuedAt: NOW - (index + 2) * DAY,
				revokedAt: NOW - DAY
			})
		);

		await expect(
			authenticated(t, suffix).query(api.users.getReverificationBudget, {
				_secret: SECRET,
				userId,
				asOf: NOW
			})
		).resolves.toEqual({
			tierBypass: false,
			nextAllowedAt: null,
			recentCount: 6,
			periodCap: 6,
			windowMs: 180 * DAY,
			emailSybilTripped: true
		});
	});

	it('keeps tier bypass constant-cardinality under revoked-history abuse', async () => {
		const t = convexTest({
			schema,
			modules,
			transactionLimits: { documentsRead: 5, databaseQueries: 8, bytesRead: 50_000 }
		});
		const suffix = 'tier-bypass';
		const userId = await t.run((ctx) =>
			ctx.db.insert('users', userValue(suffix, { trustTier: 5 }))
		);
		await insertCredentials(t, userId, 1_000, (index) =>
			credentialValue(userId, `tier-revoked-${index}`, {
				issuedAt: NOW + index,
				expiresAt: NOW + 500 * DAY,
				revokedAt: NOW - DAY
			})
		);

		await expect(
			authenticated(t, suffix).mutation(api.users.verifyAddress, verifyArgs(userId))
		).resolves.toMatchObject({ revokedCredentialIds: [] });
	});

	it('preserves lifetime downgrade, cooldown, 180-day, and email-Sybil enforcement', async () => {
		const downgrade = convexTest({ schema, modules });
		const downgradeSuffix = 'downgrade-guard';
		const downgradeUser = await downgrade.run((ctx) =>
			ctx.db.insert('users', userValue(downgradeSuffix))
		);
		await downgrade.run((ctx) =>
			ctx.db.insert(
				'districtCredentials',
				credentialValue(downgradeUser, 'old-commitment', {
					issuedAt: NOW - 400 * DAY,
					expiresAt: NOW - 200 * DAY,
					revokedAt: NOW - 300 * DAY,
					districtCommitment: `0x${'a'.repeat(64)}`
				})
			)
		);
		await expect(
			authenticated(downgrade, downgradeSuffix).mutation(
				api.users.verifyAddress,
				verifyArgs(downgradeUser)
			)
		).rejects.toThrow('ADDRESS_VERIFICATION_COMMITMENT_DOWNGRADE');

		const cooldown = convexTest({ schema, modules });
		const cooldownSuffix = 'cooldown';
		const cooldownUser = await cooldown.run((ctx) =>
			ctx.db.insert('users', userValue(cooldownSuffix))
		);
		await cooldown.run((ctx) =>
			ctx.db.insert(
				'districtCredentials',
				credentialValue(cooldownUser, 'recent', { issuedAt: NOW - 60_000 })
			)
		);
		await expect(
			authenticated(cooldown, cooldownSuffix).mutation(
				api.users.verifyAddress,
				verifyArgs(cooldownUser)
			)
		).rejects.toThrow('ADDRESS_VERIFICATION_THROTTLED_24H');

		const period = convexTest({ schema, modules });
		const periodSuffix = 'period-cap';
		const periodUser = await period.run((ctx) => ctx.db.insert('users', userValue(periodSuffix)));
		await insertCredentials(period, periodUser, 6, (index) =>
			credentialValue(periodUser, `period-${index}`, {
				issuedAt: NOW - (index + 2) * DAY,
				revokedAt: NOW - DAY
			})
		);
		await expect(
			authenticated(period, periodSuffix).mutation(api.users.verifyAddress, verifyArgs(periodUser))
		).rejects.toThrow('ADDRESS_VERIFICATION_THROTTLED_180D');

		const sybil = convexTest({ schema, modules });
		const sybilHash = 'runtime-sybil-hash';
		const sybilSuffix = 'sybil-actor';
		const sybilUser = await sybil.run((ctx) =>
			ctx.db.insert('users', userValue(sybilSuffix, { emailHash: sybilHash }))
		);
		await sybil.run(async (ctx) => {
			for (let index = 0; index < 3; index += 1) {
				await ctx.db.insert('users', userValue(`sybil-sibling-${index}`, { emailHash: sybilHash }));
			}
		});
		await expect(
			authenticated(sybil, sybilSuffix).mutation(api.users.verifyAddress, verifyArgs(sybilUser))
		).rejects.toThrow('ADDRESS_VERIFICATION_EMAIL_SYBIL');
	});

	it('rejects oversized official rosters before attempting authentication or database reads', async () => {
		const t = convexTest({ schema, modules });
		const userId = await t.run((ctx) => ctx.db.insert('users', userValue('official-limit')));
		const officials = Array.from({ length: 11 }, (_, index) => ({
			name: `Official ${index}`,
			chamber: 'house',
			party: 'Independent',
			state: 'CA',
			district: '12',
			bioguideId: `A${String(index).padStart(6, '0')}`
		}));

		await expect(
			t.mutation(api.users.verifyAddress, { ...verifyArgs(userId), officials })
		).rejects.toThrow('ADDRESS_VERIFICATION_OFFICIALS_LIMIT_EXCEEDED');
	});
});

describe('ground and representative relation invariants', () => {
	it('fails closed on multiple readable vaults or multiple active wrappers without collecting', async () => {
		const makeVault = (userId: Id<'users'>, suffix: string) => ({
			userId,
			status: 'active',
			ciphertext: `cipher-${suffix}`,
			nonce: `nonce-${suffix}`,
			schemaVersion: 1,
			encryptionVersion: 'aes-256-gcm:v1',
			dekVersion: 1,
			aeadAssociatedData: '{}',
			associatedDataHash: `aad-${suffix}`,
			createdByMethod: 'postal',
			updatedAt: NOW
		});
		const makeWrapper = (
			userId: Id<'users'>,
			groundVaultId: Id<'groundVaults'>,
			suffix: string
		) => ({
			userId,
			groundVaultId,
			passkeyCredentialId: `passkey-${suffix}`,
			rpId: 'commons.example',
			prfSaltId: `salt-id-${suffix}`,
			prfSalt: `salt-${suffix}`,
			saltVersion: 1,
			wrappedDek: `wrapped-${suffix}`,
			wrapAlg: 'prf-hkdf-aes-kw',
			hkdfInfo: 'commons-ground-vault',
			wrapperVersion: 1,
			status: 'active',
			updatedAt: NOW
		});

		const vaultDrift = convexTest({ schema, modules });
		const vaultSuffix = 'vault-drift';
		const vaultUser = await vaultDrift.run((ctx) => ctx.db.insert('users', userValue(vaultSuffix)));
		await vaultDrift.run(async (ctx) => {
			await ctx.db.insert('groundVaults', makeVault(vaultUser, 'one'));
			await ctx.db.insert('groundVaults', makeVault(vaultUser, 'two'));
		});
		await expect(
			authenticated(vaultDrift, vaultSuffix).query(api.ground.getMyGroundState, {})
		).rejects.toThrow('GROUND_VAULT_MULTIPLICITY');

		const wrapperDrift = convexTest({ schema, modules });
		const wrapperSuffix = 'wrapper-drift';
		const wrapperUser = await wrapperDrift.run((ctx) =>
			ctx.db.insert('users', userValue(wrapperSuffix))
		);
		const vaultId = await wrapperDrift.run((ctx) =>
			ctx.db.insert('groundVaults', makeVault(wrapperUser, 'sole'))
		);
		await wrapperDrift.run(async (ctx) => {
			await ctx.db.insert('passkeyVaultWrappers', makeWrapper(wrapperUser, vaultId, 'one'));
			await ctx.db.insert('passkeyVaultWrappers', makeWrapper(wrapperUser, vaultId, 'two'));
		});
		await expect(
			authenticated(wrapperDrift, wrapperSuffix).query(api.ground.getMyGroundState, {})
		).rejects.toThrow('GROUND_WRAPPER_MULTIPLICITY');
	});

	it('uses only active user-DM relations for recipient and bounded profile selection', async () => {
		const t = convexTest({ schema, modules });
		const suffix = 'active-relations';
		const userId = await t.run((ctx) => ctx.db.insert('users', userValue(suffix)));
		const { inactiveDmId, activeDmId } = await t.run(async (ctx) => {
			const inactiveDmId = await ctx.db.insert('decisionMakers', {
				type: 'legislator',
				title: 'Representative',
				name: 'Former Representative',
				lastName: 'Former',
				party: 'Old',
				jurisdiction: 'CA',
				district: '01',
				active: false,
				updatedAt: NOW
			});
			const activeDmId = await ctx.db.insert('decisionMakers', {
				type: 'legislator',
				title: 'Representative',
				name: 'Current Representative',
				lastName: 'Current',
				party: 'New',
				jurisdiction: 'CA',
				district: '02',
				active: true,
				updatedAt: NOW
			});
			await ctx.db.insert('userDmRelations', {
				userId,
				decisionMakerId: inactiveDmId,
				relationship: 'constituent',
				isActive: false,
				assignedAt: NOW - DAY,
				source: 'postal'
			});
			await ctx.db.insert('userDmRelations', {
				userId,
				decisionMakerId: activeDmId,
				relationship: 'constituent',
				isActive: true,
				assignedAt: NOW,
				source: 'postal'
			});
			return { inactiveDmId, activeDmId };
		});
		expect(inactiveDmId).not.toBe(activeDmId);

		await expect(
			t.query(api.templatePage.getUserDmRelation, { _secret: SECRET, userId })
		).resolves.toEqual({ districtCode: 'CA-02' });
		await expect(
			authenticated(t, suffix).query(api.users.getMyRepresentatives, {})
		).resolves.toEqual([
			{
				name: 'Current Representative',
				party: 'New',
				chamber: 'house',
				state: 'CA',
				district: '02'
			}
		]);
	});
});
