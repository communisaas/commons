import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { requireAuth } from './_authHelpers';
import type { Doc } from './_generated/dataModel';

const CEREMONY_TTL_MAX_MS = 10 * 60 * 1000;
const SERVER_PROOF_WINDOW_MS = 5 * 60 * 1000;
const PROOF_SEPARATOR = '\u001f';

function proofMessage(parts: Array<string | number>): string {
	return parts.map((part) => String(part)).join(PROOF_SEPARATOR);
}

function hexToBytes(hex: string): Uint8Array {
	if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
		throw new Error('PASSKEY_INVALID_PROOF');
	}
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function rawBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer as ArrayBuffer;
}

async function verifyServerProof(parts: Array<string | number>, proof: string): Promise<void> {
	// Dual-secret rotation support — try active first, then optional
	// _PREVIOUS so passkey login keeps working through a SESSION_CREATION_SECRET
	// rotation. Mirrors authOps.createSession's verify path. SvelteKit signs
	// only with the active secret; verify accepts either.
	const activeSecret = process.env.SESSION_CREATION_SECRET;
	if (!activeSecret) throw new Error('SESSION_CREATION_SECRET not configured');
	if (activeSecret.length < 32) {
		throw new Error('SESSION_CREATION_SECRET must be >= 32 bytes');
	}
	const previousSecret = process.env.SESSION_CREATION_SECRET_PREVIOUS;
	const candidates = previousSecret ? [activeSecret, previousSecret] : [activeSecret];

	const encoder = new TextEncoder();
	const proofBytes = rawBuffer(hexToBytes(proof));
	const messageBytes = rawBuffer(encoder.encode(proofMessage(parts)));

	let valid = false;
	for (const secret of candidates) {
		const key = await crypto.subtle.importKey(
			'raw',
			rawBuffer(encoder.encode(secret)),
			{ name: 'HMAC', hash: 'SHA-256' },
			false,
			['verify']
		);
		const candidateValid = await crypto.subtle.verify('HMAC', key, proofBytes, messageBytes);
		if (candidateValid) {
			valid = true;
			// Don't break early — keep timing comparable between rotation
			// and single-secret modes.
		}
	}
	if (!valid) throw new Error('PASSKEY_INVALID_PROOF');
}

function assertFreshIssuedAt(issuedAt: number): void {
	const now = Date.now();
	if (Math.abs(now - issuedAt) > SERVER_PROOF_WINDOW_MS) {
		throw new Error('PASSKEY_PROOF_EXPIRED');
	}
}

function assertReasonableExpiry(expiresAt: number): void {
	const now = Date.now();
	if (expiresAt <= now || expiresAt > now + CEREMONY_TTL_MAX_MS) {
		throw new Error('PASSKEY_INVALID_EXPIRY');
	}
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function serializeTransports(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const transports = value.filter((item): item is string => typeof item === 'string');
	return transports.length > 0 ? transports : undefined;
}

/**
 * Server-protected lookup for passkey sign-in. Convex query functions are public
 * by default, so this uses the same HMAC proof boundary as session creation.
 */
export const getAuthMaterialByEmail = query({
	args: {
		email: v.string(),
		issuedAt: v.number(),
		proof: v.string()
	},
	handler: async (ctx, args) => {
		const email = normalizeEmail(args.email);
		assertFreshIssuedAt(args.issuedAt);
		await verifyServerProof(['passkey-email', email, args.issuedAt], args.proof);

		const user = (await ctx.db
			.query('users')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first()) as Doc<'users'> | null;
		if (!user) return null;

		return {
			userId: user._id,
			email: user.email ?? email,
			hasPasskey: Boolean(user.passkeyCredentialId),
			credentialId: user.passkeyCredentialId ?? null,
			publicKey: user.passkeyPublicKey ?? null,
			counter: user.passkeyCounter ?? 0,
			transports: serializeTransports(user.passkeyTransports),
			deviceType: user.passkeyDeviceType ?? null,
			backedUp: user.passkeyBackedUp ?? null
		};
	}
});

export const createRegistrationCeremony = mutation({
	args: {
		challenge: v.string(),
		expiresAt: v.number()
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		assertReasonableExpiry(args.expiresAt);
		const user = (await ctx.db.get(userId)) as Doc<'users'> | null;
		if (!user) throw new Error('User not found');

		const now = Date.now();
		return await ctx.db.insert('passkeyCeremonySessions', {
			userId,
			email: user.email,
			type: 'registration',
			challenge: args.challenge,
			passkeyCredentialId: user.passkeyCredentialId,
			status: 'pending',
			expiresAt: args.expiresAt,
			updatedAt: now
		});
	}
});

export const consumeRegistrationCeremony = mutation({
	args: {
		sessionId: v.id('passkeyCeremonySessions')
	},
	handler: async (ctx, args) => {
		const { userId } = await requireAuth(ctx);
		const ceremony = (await ctx.db.get(args.sessionId)) as
			| Doc<'passkeyCeremonySessions'>
			| null;
		if (!ceremony || ceremony.userId !== userId || ceremony.type !== 'registration') {
			throw new Error('PASSKEY_CEREMONY_NOT_FOUND');
		}
		if (ceremony.status !== 'pending') throw new Error('PASSKEY_CEREMONY_USED');
		if (ceremony.expiresAt <= Date.now()) {
			await ctx.db.patch(ceremony._id, { status: 'expired', updatedAt: Date.now() });
			throw new Error('PASSKEY_CEREMONY_EXPIRED');
		}

		const now = Date.now();
		await ctx.db.patch(ceremony._id, {
			status: 'consumed',
			consumedAt: now,
			updatedAt: now
		});

		return {
			challenge: ceremony.challenge
		};
	}
});

export const createAuthenticationCeremony = mutation({
	args: {
		userId: v.id('users'),
		email: v.string(),
		passkeyCredentialId: v.string(),
		challenge: v.string(),
		expiresAt: v.number(),
		proof: v.string()
	},
	handler: async (ctx, args) => {
		assertReasonableExpiry(args.expiresAt);
		await verifyServerProof(
			[
				'passkey-create-authentication',
				args.userId,
				args.passkeyCredentialId,
				args.challenge,
				args.expiresAt
			],
			args.proof
		);

		const user = (await ctx.db.get(args.userId)) as Doc<'users'> | null;
		if (!user || user.passkeyCredentialId !== args.passkeyCredentialId) {
			throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');
		}

		const now = Date.now();
		return await ctx.db.insert('passkeyCeremonySessions', {
			userId: args.userId,
			email: normalizeEmail(args.email),
			type: 'authentication',
			challenge: args.challenge,
			passkeyCredentialId: args.passkeyCredentialId,
			status: 'pending',
			expiresAt: args.expiresAt,
			updatedAt: now
		});
	}
});

export const consumeAuthenticationCeremony = mutation({
	args: {
		sessionId: v.id('passkeyCeremonySessions'),
		proof: v.string()
	},
	handler: async (ctx, args) => {
		await verifyServerProof(['passkey-consume-authentication', args.sessionId], args.proof);

		const ceremony = (await ctx.db.get(args.sessionId)) as
			| Doc<'passkeyCeremonySessions'>
			| null;
		if (!ceremony || ceremony.type !== 'authentication') {
			throw new Error('PASSKEY_CEREMONY_NOT_FOUND');
		}
		if (ceremony.status !== 'pending') throw new Error('PASSKEY_CEREMONY_USED');
		if (ceremony.expiresAt <= Date.now()) {
			await ctx.db.patch(ceremony._id, { status: 'expired', updatedAt: Date.now() });
			throw new Error('PASSKEY_CEREMONY_EXPIRED');
		}

		const user = (await ctx.db.get(ceremony.userId)) as Doc<'users'> | null;
		if (!user || !ceremony.passkeyCredentialId) {
			throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');
		}
		if (user.passkeyCredentialId !== ceremony.passkeyCredentialId || !user.passkeyPublicKey) {
			throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');
		}

		const now = Date.now();
		await ctx.db.patch(ceremony._id, {
			status: 'consumed',
			consumedAt: now,
			updatedAt: now
		});

		return {
			userId: user._id,
			email: user.email ?? ceremony.email ?? null,
			challenge: ceremony.challenge,
			credentialId: user.passkeyCredentialId,
			publicKey: user.passkeyPublicKey,
			counter: user.passkeyCounter ?? 0,
			transports: serializeTransports(user.passkeyTransports),
			deviceType: user.passkeyDeviceType ?? null,
			backedUp: user.passkeyBackedUp ?? null
		};
	}
});

export const updatePasskeyAfterAuthentication = mutation({
	args: {
		userId: v.id('users'),
		credentialId: v.string(),
		newCounter: v.number(),
		deviceType: v.optional(v.string()),
		backedUp: v.optional(v.boolean()),
		proof: v.string()
	},
	handler: async (ctx, args) => {
		await verifyServerProof(
			['passkey-authenticated', args.userId, args.credentialId, args.newCounter],
			args.proof
		);

		const user = (await ctx.db.get(args.userId)) as Doc<'users'> | null;
		if (!user || user.passkeyCredentialId !== args.credentialId) {
			throw new Error('PASSKEY_CREDENTIAL_NOT_FOUND');
		}

		const now = Date.now();
		await ctx.db.patch(args.userId, {
			passkeyCounter: args.newCounter,
			passkeyDeviceType: args.deviceType ?? user.passkeyDeviceType,
			passkeyBackedUp: args.backedUp ?? user.passkeyBackedUp,
			passkeyLastUsedAt: now,
			updatedAt: now
		});
	}
});
