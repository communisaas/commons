import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAuth } from './_authHelpers';
import type { Doc, Id } from './_generated/dataModel';
import { selectActiveCredentialForUser } from './_credentialSelect';

const GROUND_VAULT_SCHEMA_VERSION = 1;
const GROUND_VAULT_DEK_VERSION = 1;
const GROUND_VAULT_ENCRYPTION_VERSION = 'aes-256-gcm:v1';
const GROUND_VAULT_PURPOSE = 'commons.ground-vault';

const vaultArgs = v.object({
	status: v.string(),
	ciphertext: v.string(),
	nonce: v.string(),
	schemaVersion: v.number(),
	encryptionVersion: v.string(),
	dekVersion: v.number(),
	aeadAssociatedData: v.string(),
	associatedDataHash: v.string(),
	resolveResultHash: v.optional(v.string()),
	resolveSigningKeyId: v.optional(v.string()),
	createdByMethod: v.string(),
	migrationSource: v.optional(v.string())
});

const cellArgs = v.object({
	districtCredentialId: v.id('districtCredentials'),
	cellId: v.optional(v.string()),
	h3Cell: v.optional(v.string()),
	cellMapRoot: v.optional(v.string()),
	cellMapVersion: v.optional(v.string()),
	atlasRoot: v.optional(v.string()),
	atlasVersion: v.optional(v.string()),
	districtCommitment: v.optional(v.string()),
	districts: v.optional(v.array(v.string())),
	slotCount: v.optional(v.number()),
	source: v.string(),
	confidence: v.optional(v.float64()),
	resolveResultHash: v.optional(v.string()),
	resolveSigningKeyId: v.optional(v.string()),
	issuedAt: v.number(),
	expiresAt: v.optional(v.number())
});

const wrapperArgs = v.object({
	passkeyCredentialId: v.string(),
	rpId: v.string(),
	prfSaltId: v.string(),
	prfSalt: v.string(),
	saltVersion: v.number(),
	wrappedDek: v.string(),
	wrapAlg: v.string(),
	hkdfInfo: v.string(),
	wrapperVersion: v.number(),
	status: v.string()
});

const rewrapVaultArgs = v.object({
	ciphertext: v.string(),
	nonce: v.string(),
	schemaVersion: v.number(),
	encryptionVersion: v.string(),
	dekVersion: v.number(),
	aeadAssociatedData: v.string(),
	associatedDataHash: v.string()
});

function assertVaultEnvelopeForUser(
	vault: {
		schemaVersion: number;
		encryptionVersion: string;
		dekVersion: number;
		aeadAssociatedData: string;
	},
	userId: Id<'users'>
) {
	if (
		vault.schemaVersion !== GROUND_VAULT_SCHEMA_VERSION ||
		vault.dekVersion !== GROUND_VAULT_DEK_VERSION ||
		vault.encryptionVersion !== GROUND_VAULT_ENCRYPTION_VERSION
	) {
		throw new Error('GROUND_VAULT_UNSUPPORTED_VERSION');
	}

	let aad: unknown;
	try {
		aad = JSON.parse(vault.aeadAssociatedData);
	} catch {
		throw new Error('GROUND_VAULT_BAD_AAD');
	}
	if (!aad || typeof aad !== 'object') {
		throw new Error('GROUND_VAULT_BAD_AAD');
	}
	const record = aad as {
		purpose?: unknown;
		userId?: unknown;
		version?: unknown;
		dekVersion?: unknown;
	};
	if (
		record.purpose !== GROUND_VAULT_PURPOSE ||
		record.userId !== String(userId) ||
		record.version !== GROUND_VAULT_SCHEMA_VERSION ||
		record.dekVersion !== GROUND_VAULT_DEK_VERSION
	) {
		throw new Error('GROUND_VAULT_AAD_MISMATCH');
	}
}

async function collectGroundVaultsByStatuses(
	ctx: { db: any },
	userId: Id<'users'>,
	statuses: string[]
): Promise<Array<Doc<'groundVaults'>>> {
	const batches = await Promise.all(
		statuses.map((status) =>
			ctx.db
				.query('groundVaults')
				.withIndex('by_userId_status', (q: any) => q.eq('userId', userId).eq('status', status))
				.collect()
		)
	);
	return batches.flat() as Array<Doc<'groundVaults'>>;
}

async function getReadableGroundVaultForUser(
	ctx: { db: any },
	userId: Id<'users'>
): Promise<Doc<'groundVaults'> | null> {
	const active = (await ctx.db
		.query('groundVaults')
		.withIndex('by_userId_status', (q: any) => q.eq('userId', userId).eq('status', 'active'))
		.order('desc')
		.first()) as Doc<'groundVaults'> | null;
	if (active) return active;

	return (await ctx.db
		.query('groundVaults')
		.withIndex('by_userId_status', (q: any) => q.eq('userId', userId).eq('status', 'rewrap_needed'))
		.order('desc')
		.first()) as Doc<'groundVaults'> | null;
}

function assertCellMetadataForCredential(
	cell: {
		districtCommitment?: string;
		districts?: string[];
		slotCount?: number;
	},
	credential: Doc<'districtCredentials'>
) {
	if (cell.districtCommitment && !credential.districtCommitment) {
		throw new Error('GROUND_CREDENTIAL_COMMITMENT_MISSING');
	}
	if (
		credential.districtCommitment &&
		cell.districtCommitment &&
		cell.districtCommitment !== credential.districtCommitment
	) {
		throw new Error('GROUND_CELL_COMMITMENT_MISMATCH');
	}
	if (
		credential.slotCount !== undefined &&
		cell.slotCount !== undefined &&
		cell.slotCount !== credential.slotCount
	) {
			throw new Error('GROUND_CELL_SLOT_COUNT_MISMATCH');
	}

	const credentialDistrict = credential.congressionalDistrict.trim();
	const hasPlaintextDistrictSlots =
		Array.isArray(cell.districts) &&
		cell.districts.some((district) => /^[A-Z]{2}-(\d{2}|AL|00)$/.test(district));
	if (
		credentialDistrict &&
		hasPlaintextDistrictSlots &&
		!cell.districts?.includes(credentialDistrict)
	) {
		throw new Error('GROUND_CELL_DISTRICT_MISMATCH');
	}
}

/**
 * Persist a ground vault, disclosed cell metadata, and optional PRF wrapper in
 * one Convex mutation. This is the atomic write boundary required by the ground
 * vault state machine; higher-level services should call this after the server
 * has resolved/signed location and the client has encrypted the vault payload.
 */
export const persistGroundBundle = mutation({
	args: {
		vault: vaultArgs,
		cell: cellArgs,
		wrapper: v.optional(wrapperArgs)
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		const now = Date.now();
		assertVaultEnvelopeForUser(args.vault, userId);

		const credential = (await ctx.db.get(
			args.cell.districtCredentialId
		)) as Doc<'districtCredentials'> | null;
		if (!credential || credential.userId !== userId) {
			throw new Error('GROUND_CREDENTIAL_NOT_FOUND');
		}
		if (credential.revokedAt) {
			throw new Error('GROUND_CREDENTIAL_REVOKED');
		}
		assertCellMetadataForCredential(args.cell, credential);
		if (args.wrapper) {
			const user = (await ctx.db.get(userId)) as Doc<'users'> | null;
			if (!user || user.passkeyCredentialId !== args.wrapper.passkeyCredentialId) {
				throw new Error('GROUND_PASSKEY_NOT_REGISTERED');
			}
		}

			const priorActiveVaults = await collectGroundVaultsByStatuses(ctx, userId, [
				'active',
				'rewrap_needed'
			]);

			for (const vault of priorActiveVaults) {
				await ctx.db.patch(vault._id, {
					status: 'retired',
					retiredAt: now,
					retiredReason: 'superseded_by_ground_bundle',
					updatedAt: now
				});
				const wrappers = (await ctx.db
					.query('passkeyVaultWrappers')
					.withIndex('by_groundVaultId_status', (q) =>
						q.eq('groundVaultId', vault._id).eq('status', 'active')
					)
					.collect()) as Array<Doc<'passkeyVaultWrappers'>>;
				for (const wrapper of wrappers) {
					await ctx.db.patch(wrapper._id, {
						status: 'retired',
						updatedAt: now
					});
				}
			}

			const groundVaultId = await ctx.db.insert('groundVaults', {
			userId,
			status: 'active',
			ciphertext: args.vault.ciphertext,
			nonce: args.vault.nonce,
			schemaVersion: args.vault.schemaVersion,
			encryptionVersion: args.vault.encryptionVersion,
			dekVersion: args.vault.dekVersion,
			aeadAssociatedData: args.vault.aeadAssociatedData,
			associatedDataHash: args.vault.associatedDataHash,
			resolveResultHash: args.vault.resolveResultHash,
			resolveSigningKeyId: args.vault.resolveSigningKeyId,
			activeCredentialId: args.cell.districtCredentialId,
			createdByMethod: args.vault.createdByMethod,
			migrationSource: args.vault.migrationSource,
			updatedAt: now
		});

		const groundCellMetadataId = await ctx.db.insert('groundCellMetadata', {
			userId,
			districtCredentialId: args.cell.districtCredentialId,
			groundVaultId,
			cellId: args.cell.cellId,
			h3Cell: args.cell.h3Cell,
			cellMapRoot: args.cell.cellMapRoot,
			cellMapVersion: args.cell.cellMapVersion,
			atlasRoot: args.cell.atlasRoot,
			atlasVersion: args.cell.atlasVersion,
			districtCommitment: credential.districtCommitment ?? args.cell.districtCommitment,
			districts: args.cell.districts,
			slotCount: credential.slotCount ?? args.cell.slotCount,
			source: credential.verificationMethod,
			confidence: args.cell.confidence,
			resolveResultHash: args.cell.resolveResultHash,
			resolveSigningKeyId: args.cell.resolveSigningKeyId,
			issuedAt: credential.issuedAt,
			expiresAt: credential.expiresAt,
			updatedAt: now
		});

		let passkeyVaultWrapperId = null;
		if (args.wrapper) {
			passkeyVaultWrapperId = await ctx.db.insert('passkeyVaultWrappers', {
				userId,
				groundVaultId,
				passkeyCredentialId: args.wrapper.passkeyCredentialId,
				rpId: args.wrapper.rpId,
				prfSaltId: args.wrapper.prfSaltId,
				prfSalt: args.wrapper.prfSalt,
				saltVersion: args.wrapper.saltVersion,
				wrappedDek: args.wrapper.wrappedDek,
				wrapAlg: args.wrapper.wrapAlg,
				hkdfInfo: args.wrapper.hkdfInfo,
				wrapperVersion: args.wrapper.wrapperVersion,
				status: 'active',
				updatedAt: now
			});
		}

		await ctx.db.patch(groundVaultId, {
			activeGroundCellMetadataId: groundCellMetadataId,
			updatedAt: now
		});

		return {
			groundVaultId,
			groundCellMetadataId,
			passkeyVaultWrapperId
		};
	}
});

/**
 * Re-encrypt the active ground vault from client-side plaintext and attach a
 * passkey PRF wrapper. This is used when a user registers a passkey after the
 * vault already exists without a wrapper; the server never receives plaintext.
 */
export const addPasskeyWrapperToActiveVault = mutation({
	args: {
		groundVaultId: v.id('groundVaults'),
		vault: rewrapVaultArgs,
		wrapper: wrapperArgs
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		const now = Date.now();
		assertVaultEnvelopeForUser(args.vault, userId);
		const activeVault = (await ctx.db.get(args.groundVaultId)) as Doc<'groundVaults'> | null;
		if (
			!activeVault ||
			activeVault.userId !== userId ||
			!['active', 'rewrap_needed'].includes(activeVault.status)
		) {
			throw new Error('GROUND_ACTIVE_VAULT_NOT_FOUND');
		}

		const user = (await ctx.db.get(userId)) as Doc<'users'> | null;
		if (!user || user.passkeyCredentialId !== args.wrapper.passkeyCredentialId) {
			throw new Error('GROUND_PASSKEY_NOT_REGISTERED');
		}

			const existingWrappers = (await ctx.db
				.query('passkeyVaultWrappers')
				.withIndex('by_groundVaultId_status', (q) =>
					q.eq('groundVaultId', args.groundVaultId).eq('status', 'active')
				)
				.collect()) as Array<Doc<'passkeyVaultWrappers'>>;
			const currentPasskeyWrapper = existingWrappers.find(
				(wrapper) => wrapper.passkeyCredentialId === args.wrapper.passkeyCredentialId
			);
			if (currentPasskeyWrapper) {
				return {
					groundVaultId: args.groundVaultId,
					passkeyVaultWrapperId: currentPasskeyWrapper._id,
					status: 'already-wrapped'
				};
			}

			for (const wrapper of existingWrappers) {
				await ctx.db.patch(wrapper._id, {
					status: 'retired',
					updatedAt: now
				});
			}

		await ctx.db.patch(args.groundVaultId, {
			status: 'active',
			ciphertext: args.vault.ciphertext,
			nonce: args.vault.nonce,
			schemaVersion: args.vault.schemaVersion,
			encryptionVersion: args.vault.encryptionVersion,
			dekVersion: args.vault.dekVersion,
			aeadAssociatedData: args.vault.aeadAssociatedData,
			associatedDataHash: args.vault.associatedDataHash,
			updatedAt: now
		});

		const passkeyVaultWrapperId = await ctx.db.insert('passkeyVaultWrappers', {
			userId,
			groundVaultId: args.groundVaultId,
			passkeyCredentialId: args.wrapper.passkeyCredentialId,
			rpId: args.wrapper.rpId,
			prfSaltId: args.wrapper.prfSaltId,
			prfSalt: args.wrapper.prfSalt,
			saltVersion: args.wrapper.saltVersion,
			wrappedDek: args.wrapper.wrappedDek,
			wrapAlg: args.wrapper.wrapAlg,
			hkdfInfo: args.wrapper.hkdfInfo,
			wrapperVersion: args.wrapper.wrapperVersion,
			status: 'active',
			updatedAt: now
		});

		return {
			groundVaultId: args.groundVaultId,
			passkeyVaultWrapperId,
			status: 'wrapper-added'
		};
	}
});

export const getMyGroundState = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const activeVault = await getReadableGroundVaultForUser(ctx, userId);

		if (!activeVault) {
			return {
				vault: null,
				cell: null,
				wrappers: []
			};
		}

		const cell = activeVault.activeGroundCellMetadataId
			? ((await ctx.db.get(
					activeVault.activeGroundCellMetadataId
				)) as Doc<'groundCellMetadata'> | null)
			: null;
		const wrappers = (await ctx.db
			.query('passkeyVaultWrappers')
			.withIndex('by_groundVaultId_status', (q) =>
				q.eq('groundVaultId', activeVault._id).eq('status', 'active')
			)
			.collect()) as Array<Doc<'passkeyVaultWrappers'>>;

		return {
			vault: activeVault,
			cell,
			wrappers
		};
	}
});

/**
 * Return the active district credential metadata needed to restore a readable
 * ground vault after browser storage is erased. This does not expose plaintext
 * address; it returns only the active credential id and disclosed credential
 * binding material already required for proof/delivery state.
 */
export const getMyGroundRestoreState = query({
	args: {},
	handler: async (ctx) => {
		const { userId } = await requireAuth(ctx);
		const active = await selectActiveCredentialForUser(ctx, userId);
		if (!active) {
			return { credential: null };
		}

		return {
			credential: {
				districtCredentialId: active._id,
				district: active.congressionalDistrict || null,
				districtCommitment: active.districtCommitment ?? null,
				slotCount: active.slotCount ?? null,
				source: active.verificationMethod,
				issuedAt: active.issuedAt,
				expiresAt: active.expiresAt
			}
		};
	}
});
