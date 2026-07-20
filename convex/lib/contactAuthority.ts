import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

export const CONTACT_AUTHORITY_VERSION = 1;
export const CONTACT_AUTHORITY_MIGRATION_KEY = 'contact-authority-v1' as const;
export const CONTACT_AUTHORITY_EPOCH_KEY = 'global' as const;
export const CONTACT_FANOUT_INPUT_MAX = 50;
export const CONTACT_FANOUT_PAGE_SIZE = 32;
export const CONTACT_FANOUT_PAGE_MAX_BYTES = 256 * 1024;
export const CONTACT_FANOUT_CURSOR_MAX_BYTES = 2_048;
export const CONTACT_FANOUT_PAYLOAD_MAX_BYTES = 4 * 1024;
export const CONTACT_FANOUT_MAX_ATTEMPTS = 6;
export const CONTACT_FANOUT_OVERDUE_MS = 5 * 60 * 1000;
export const CONTACT_AUTHORITY_MIGRATION_PAGE_SIZE = 100;
export const CONTACT_AUTHORITY_MIGRATION_PAGE_MAX_BYTES = 512 * 1024;

export type ContactFanoutKind =
	| 'email_set_bounced'
	| 'email_set_complained'
	| 'email_soft_bounce'
	| 'email_reset_soft_bounce'
	| 'sms_stop'
	| 'sms_start'
	| 'sms_reply';

type ContactAuthorityState = Doc<'contactAuthorities'>['state'];
type ContactReadCtx = Pick<QueryCtx | MutationCtx, 'db'>;

const EMAIL_DENY_STATES = new Set<ContactAuthorityState>([
	'email_bounced',
	'email_complained',
	'email_suppressed'
]);

export function contactFanoutPriority(kind: ContactFanoutKind): number {
	if (kind === 'sms_stop') return 0;
	if (kind === 'email_set_complained' || kind === 'email_set_bounced') return 1;
	if (kind === 'email_soft_bounce' || kind === 'email_reset_soft_bounce') return 2;
	if (kind === 'sms_start') return 3;
	return 4;
}

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function assertContactHash(contactHash: string): void {
	if (!contactHash || contactHash.length > 128) throw new Error('CONTACT_AUTHORITY_HASH_INVALID');
}

export async function readContactAuthorityEpoch(ctx: ContactReadCtx): Promise<number> {
	const row = await ctx.db
		.query('contactAuthorityEpochs')
		.withIndex('by_key', (q) => q.eq('key', CONTACT_AUTHORITY_EPOCH_KEY))
		.unique();
	if (!row) return 0;
	if (!Number.isSafeInteger(row.epoch) || row.epoch < 0) {
		throw new Error('CONTACT_AUTHORITY_EPOCH_INVALID');
	}
	return row.epoch;
}

export async function bumpContactAuthorityEpoch(ctx: MutationCtx, now: number): Promise<number> {
	if (!Number.isSafeInteger(now) || now < 0)
		throw new Error('CONTACT_AUTHORITY_EPOCH_TIME_INVALID');
	const existing = await ctx.db
		.query('contactAuthorityEpochs')
		.withIndex('by_key', (q) => q.eq('key', CONTACT_AUTHORITY_EPOCH_KEY))
		.unique();
	const epoch = (existing?.epoch ?? 0) + 1;
	if (!Number.isSafeInteger(epoch)) throw new Error('CONTACT_AUTHORITY_EPOCH_EXHAUSTED');
	if (existing) {
		await ctx.db.patch(existing._id, { epoch, updatedAt: now });
	} else {
		await ctx.db.insert('contactAuthorityEpochs', {
			key: CONTACT_AUTHORITY_EPOCH_KEY,
			epoch,
			updatedAt: now
		});
	}
	return epoch;
}

/**
 * Idempotently adopt pre-cutover denormalized deny state. Positive/subscribed
 * rows never clear an authority written by a sibling organization: complaint
 * dominates every email state, any other email deny dominates active, and one
 * legacy SMS STOP is global until an explicit post-cutover scoped START.
 */
export async function seedContactAuthorityFromSupporter(
	ctx: MutationCtx,
	supporter: Doc<'supporters'>,
	now: number
): Promise<number> {
	let written = 0;
	if (supporter.globalEmailHash) {
		const existing = await readContactAuthority(ctx, 'email', supporter.globalEmailHash);
		const supporterState: ContactAuthorityState =
			supporter.emailStatus === 'complained'
				? 'email_complained'
				: supporter.emailStatus === 'bounced'
					? 'email_bounced'
					: 'email_active';
		const state: ContactAuthorityState =
			existing?.state === 'email_complained' || supporterState === 'email_complained'
				? 'email_complained'
				: existing && EMAIL_DENY_STATES.has(existing.state)
					? existing.state
					: supporterState;
		const softBounceCount = Math.max(
			existing?.softBounceCount ?? 0,
			supporter.softBounceCount ?? 0
		);
		const needsRow = state !== 'email_active' || softBounceCount > 0 || existing !== null;
		if (
			needsRow &&
			(!existing || existing.state !== state || existing.softBounceCount !== softBounceCount)
		) {
			await writeContactAuthority(ctx, {
				channel: 'email',
				contactHash: supporter.globalEmailHash,
				state,
				softBounceCount,
				source: 'migration',
				sourceEventId: String(supporter._id),
				updatedAt: now
			});
			written++;
		}
	}
	if (supporter.globalPhoneHash && supporter.smsStatus === 'stopped') {
		const existing = await readContactAuthority(ctx, 'sms', supporter.globalPhoneHash);
		if (!existing || existing.state !== 'sms_stopped') {
			await writeContactAuthority(ctx, {
				channel: 'sms',
				contactHash: supporter.globalPhoneHash,
				state: 'sms_stopped',
				source: 'migration',
				sourceEventId: String(supporter._id),
				updatedAt: now
			});
			written++;
		}
	}
	return written;
}

export async function readContactAuthority(
	ctx: ContactReadCtx,
	channel: 'email' | 'sms',
	contactHash: string,
	scopeOrgId?: Id<'organizations'>
): Promise<Doc<'contactAuthorities'> | null> {
	assertContactHash(contactHash);
	const rows = await ctx.db
		.query('contactAuthorities')
		.withIndex('by_channel_contactHash_scopeOrgId', (q) =>
			q.eq('channel', channel).eq('contactHash', contactHash).eq('scopeOrgId', scopeOrgId)
		)
		.take(2);
	if (rows.length > 1) throw new Error('CONTACT_AUTHORITY_MULTIPLICITY');
	return rows[0] ?? null;
}

export async function requireContactAuthorityReady(ctx: ContactReadCtx): Promise<void> {
	const migration = await ctx.db
		.query('contactAuthorityMigrations')
		.withIndex('by_key', (q) => q.eq('key', CONTACT_AUTHORITY_MIGRATION_KEY))
		.unique();
	if (
		!migration ||
		migration.status !== 'ready' ||
		migration.cursor !== undefined ||
		migration.failureCode !== undefined ||
		migration.completedAt === undefined
	) {
		throw new Error('CONTACT_AUTHORITY_NOT_READY');
	}
}

export async function filterEmailSendAuthorized<T extends Doc<'supporters'>>(
	ctx: ContactReadCtx,
	supporters: readonly T[]
): Promise<T[]> {
	await requireContactAuthorityReady(ctx);
	const hashes = new Set<string>();
	for (const supporter of supporters) {
		if (!supporter.globalEmailHash) throw new Error('CONTACT_AUTHORITY_EMAIL_HASH_MISSING');
		hashes.add(supporter.globalEmailHash);
	}
	const authorities = new Map<string, Doc<'contactAuthorities'> | null>();
	await Promise.all(
		[...hashes].map(async (hash) => {
			authorities.set(hash, await readContactAuthority(ctx, 'email', hash));
		})
	);
	return supporters.filter((supporter) => {
		const authority = authorities.get(supporter.globalEmailHash as string);
		return !authority || !EMAIL_DENY_STATES.has(authority.state);
	});
}

export async function assertEmailSupporterSendAuthorized(
	ctx: ContactReadCtx,
	supporter: Doc<'supporters'>
): Promise<void> {
	if (supporter.emailStatus !== 'subscribed') {
		throw new Error('CONTACT_AUTHORITY_EMAIL_SUPPORTER_INELIGIBLE');
	}
	const allowed = await filterEmailSendAuthorized(ctx, [supporter]);
	if (allowed.length !== 1) throw new Error('CONTACT_AUTHORITY_EMAIL_DENIED');
}

export async function filterSmsSendAuthorized<T extends Doc<'supporters'>>(
	ctx: ContactReadCtx,
	supporters: readonly T[]
): Promise<T[]> {
	await requireContactAuthorityReady(ctx);
	const pairs = new Map<string, { hash: string; orgId: Id<'organizations'> }>();
	for (const supporter of supporters) {
		if (!supporter.globalPhoneHash) throw new Error('CONTACT_AUTHORITY_PHONE_HASH_MISSING');
		pairs.set(`${supporter.globalPhoneHash}:${supporter.orgId}`, {
			hash: supporter.globalPhoneHash,
			orgId: supporter.orgId
		});
	}
	const decisions = new Map<string, boolean>();
	await Promise.all(
		[...pairs.entries()].map(async ([key, { hash, orgId }]) => {
			const [globalAuthority, scopedAuthority] = await Promise.all([
				readContactAuthority(ctx, 'sms', hash),
				readContactAuthority(ctx, 'sms', hash, orgId)
			]);
			if (!globalAuthority || globalAuthority.state !== 'sms_stopped') {
				decisions.set(key, true);
				return;
			}
			decisions.set(
				key,
				scopedAuthority?.state === 'sms_allowed' &&
					scopedAuthority.updatedAt > globalAuthority.updatedAt
			);
		})
	);
	return supporters.filter((supporter) =>
		decisions.get(`${supporter.globalPhoneHash}:${supporter.orgId}`)
	);
}

async function writeContactAuthority(
	ctx: MutationCtx,
	input: {
		channel: 'email' | 'sms';
		contactHash: string;
		scopeOrgId?: Id<'organizations'>;
		state: ContactAuthorityState;
		softBounceCount?: number;
		source: string;
		sourceEventId?: string;
		updatedAt: number;
	}
): Promise<Doc<'contactAuthorities'>> {
	const existing = await readContactAuthority(
		ctx,
		input.channel,
		input.contactHash,
		input.scopeOrgId
	);
	const effectiveUpdatedAt = Math.max(input.updatedAt, (existing?.updatedAt ?? 0) + 1);
	const value = {
		channel: input.channel,
		contactHash: input.contactHash,
		...(input.scopeOrgId ? { scopeOrgId: input.scopeOrgId } : {}),
		state: input.state,
		...(input.softBounceCount !== undefined ? { softBounceCount: input.softBounceCount } : {}),
		source: input.source.slice(0, 64),
		...(input.sourceEventId ? { sourceEventId: input.sourceEventId.slice(0, 256) } : {}),
		version: CONTACT_AUTHORITY_VERSION,
		projectionBytes: 0,
		updatedAt: effectiveUpdatedAt
	};
	const projectionBytes = byteLength(value);
	if (projectionBytes > CONTACT_FANOUT_PAYLOAD_MAX_BYTES) {
		throw new Error('CONTACT_AUTHORITY_PAYLOAD_TOO_LARGE');
	}
	// Convex OCC serializes concurrent patches of this singleton. Capturing this
	// clock during cohort selection and comparing it at the carrier boundary
	// closes the materialize-then-STOP race without re-reading the whole cohort.
	await bumpContactAuthorityEpoch(ctx, effectiveUpdatedAt);
	if (existing) {
		await ctx.db.patch(existing._id, { ...value, projectionBytes });
		return { ...existing, ...value, projectionBytes };
	}
	const id = await ctx.db.insert('contactAuthorities', { ...value, projectionBytes });
	const inserted = await ctx.db.get(id);
	if (!inserted) throw new Error('CONTACT_AUTHORITY_INSERT_FAILED');
	return inserted;
}

export async function applyEmailAuthorityEvent(
	ctx: MutationCtx,
	input: {
		kind:
			| 'email_set_bounced'
			| 'email_set_complained'
			| 'email_soft_bounce'
			| 'email_reset_soft_bounce';
		contactHash: string;
		source: string;
		sourceEventId?: string;
		now: number;
	}
): Promise<Doc<'contactAuthorities'>> {
	const existing = await readContactAuthority(ctx, 'email', input.contactHash);
	let state: ContactAuthorityState = existing?.state ?? 'email_active';
	let softBounceCount = existing?.softBounceCount ?? 0;
	if (input.kind === 'email_set_complained') {
		state = 'email_complained';
	} else if (input.kind === 'email_set_bounced') {
		if (state !== 'email_complained') state = 'email_bounced';
	} else if (input.kind === 'email_soft_bounce') {
		softBounceCount = Math.min(softBounceCount + 1, 3);
		if (softBounceCount >= 3 && state !== 'email_complained') state = 'email_bounced';
	} else {
		softBounceCount = 0;
	}
	return writeContactAuthority(ctx, {
		channel: 'email',
		contactHash: input.contactHash,
		state,
		softBounceCount,
		source: input.source,
		sourceEventId: input.sourceEventId,
		updatedAt: input.now
	});
}

export async function applyManualEmailSuppressionAuthority(
	ctx: MutationCtx,
	input: { contactHash: string; sourceEventId?: string; now: number }
): Promise<Doc<'contactAuthorities'>> {
	const existing = await readContactAuthority(ctx, 'email', input.contactHash);
	return writeContactAuthority(ctx, {
		channel: 'email',
		contactHash: input.contactHash,
		state: existing?.state === 'email_complained' ? 'email_complained' : 'email_suppressed',
		softBounceCount: existing?.softBounceCount,
		source: 'bounce_consensus',
		sourceEventId: input.sourceEventId,
		updatedAt: input.now
	});
}

export async function applySmsAuthorityEvent(
	ctx: MutationCtx,
	input: {
		kind: 'sms_stop' | 'sms_start';
		contactHash: string;
		scopeOrgId?: Id<'organizations'>;
		sourceEventId?: string;
		now: number;
	}
): Promise<Doc<'contactAuthorities'>> {
	if (input.kind === 'sms_start' && input.scopeOrgId) {
		// Advance the global row as the contact-wide logical clock without
		// changing its STOP/allowed state. This totally orders a scoped START
		// against a same-millisecond later STOP without scanning old overrides.
		const global = await readContactAuthority(ctx, 'sms', input.contactHash);
		const clock = await writeContactAuthority(ctx, {
			channel: 'sms',
			contactHash: input.contactHash,
			state: global?.state === 'sms_stopped' ? 'sms_stopped' : 'sms_allowed',
			source: global?.source ?? 'twilio',
			sourceEventId: global?.sourceEventId,
			updatedAt: input.now
		});
		return writeContactAuthority(ctx, {
			channel: 'sms',
			contactHash: input.contactHash,
			scopeOrgId: input.scopeOrgId,
			state: 'sms_allowed',
			source: 'twilio',
			sourceEventId: input.sourceEventId,
			updatedAt: clock.updatedAt + 1
		});
	}
	return writeContactAuthority(ctx, {
		channel: 'sms',
		contactHash: input.contactHash,
		scopeOrgId: input.kind === 'sms_start' ? input.scopeOrgId : undefined,
		state: input.kind === 'sms_stop' ? 'sms_stopped' : 'sms_allowed',
		source: 'twilio',
		sourceEventId: input.sourceEventId,
		updatedAt: input.now
	});
}

export async function enqueueContactFanoutJob(
	ctx: MutationCtx,
	input: {
		kind: ContactFanoutKind;
		contactHash: string;
		scopeOrgId?: Id<'organizations'>;
		idempotencyKey?: string;
		providerEventId?: string;
		replyBody?: string;
		replyToNumber?: string;
		now: number;
		failureCode?: string;
	}
): Promise<{ jobId: Id<'contactFanoutJobs'>; existing: boolean; failed: boolean }> {
	assertContactHash(input.contactHash);
	if (input.idempotencyKey && input.idempotencyKey.length > 512) {
		throw new Error('CONTACT_FANOUT_IDEMPOTENCY_KEY_TOO_LARGE');
	}
	if (input.providerEventId && input.providerEventId.length > 256) {
		throw new Error('CONTACT_FANOUT_PROVIDER_EVENT_ID_TOO_LARGE');
	}
	if (input.replyBody && input.replyBody.length > 1600) {
		throw new Error('CONTACT_FANOUT_REPLY_TOO_LARGE');
	}
	if (input.replyToNumber && input.replyToNumber.length > 32) {
		throw new Error('CONTACT_FANOUT_DESTINATION_TOO_LARGE');
	}
	if (input.idempotencyKey) {
		const existing = await ctx.db
			.query('contactFanoutJobs')
			.withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', input.idempotencyKey))
			.take(2);
		if (existing.length > 1) throw new Error('CONTACT_FANOUT_IDEMPOTENCY_MULTIPLICITY');
		if (existing[0]) {
			return {
				jobId: existing[0]._id,
				existing: true,
				failed: existing[0].status === 'failed'
			};
		}
	}
	const payload = {
		kind: input.kind,
		contactHash: input.contactHash,
		scopeOrgId: input.scopeOrgId,
		idempotencyKey: input.idempotencyKey,
		providerEventId: input.providerEventId,
		replyBody: input.replyBody,
		replyToNumber: input.replyToNumber
	};
	const payloadBytes = byteLength(payload);
	if (payloadBytes > CONTACT_FANOUT_PAYLOAD_MAX_BYTES) {
		throw new Error('CONTACT_FANOUT_PAYLOAD_TOO_LARGE');
	}
	const failed = input.failureCode !== undefined;
	const jobId = await ctx.db.insert('contactFanoutJobs', {
		kind: input.kind,
		contactHash: input.contactHash,
		...(input.scopeOrgId ? { scopeOrgId: input.scopeOrgId } : {}),
		...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
		...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
		...(input.replyBody ? { replyBody: input.replyBody } : {}),
		...(input.replyToNumber ? { replyToNumber: input.replyToNumber } : {}),
		status: failed ? 'failed' : 'pending',
		priority: contactFanoutPriority(input.kind),
		attempts: 0,
		nextAttemptAt: input.now,
		processedCount: 0,
		changedCount: 0,
		pageCount: 0,
		...(input.failureCode ? { failureCode: input.failureCode.slice(0, 256) } : {}),
		payloadBytes,
		createdAt: input.now,
		updatedAt: input.now,
		...(failed ? { completedAt: input.now } : {})
	});
	if (failed) {
		await ctx.db.insert('contactFanoutJobEvents', {
			jobId,
			type: 'ingress_failed',
			attempt: 0,
			failureCode: input.failureCode?.slice(0, 256),
			createdAt: input.now
		});
	}
	return { jobId, existing: false, failed };
}
