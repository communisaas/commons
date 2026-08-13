/**
 * Convex functions backing /api/v1/* public API routes.
 *
 * These use API key auth resolved server-side — Convex functions receive
 * pre-validated orgId from the SvelteKit API key auth middleware.
 */

import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import { campaignType } from './_validators';
import { resolveDmAndCanonical } from './legislation';
import { requireInternalSecret } from './_internalAuth';
import { effectivePlanWithGrace } from './_brandingGate';
import { assertPiiTripleCreate } from './_orgHash';
import { applySupporterStatsDelta } from './_supporterStats';
import {
	CAMPAIGN_ACTIVE_COUNTER_VERSION,
	recordCampaignCreated,
	recordCampaignStatusTransition
} from './lib/campaignOrgCounters';
import {
	PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_KEY,
	PUBLIC_ORGANIZATION_DIRECTORY_VERSION,
	syncPublicOrganizationDirectory
} from './lib/publicOrganizationDirectory';
import {
	requireAccountabilityReadModelReady,
	syncSupporterIdentityReceiptProjections
} from './lib/accountabilityReadModelDb';
import { COALITION_METRICS_VERSION } from './lib/coalitionMetrics';
import {
	CAMPAIGN_READ_MODEL_MIGRATION_KEY,
	CAMPAIGN_READ_MODEL_VERSION
} from './lib/campaignReadModel';
import {
	createOrgWebhook,
	deleteOwnedOrgWebhook,
	getOwnedOrgWebhook,
	publicWebhook,
	rotateOwnedOrgWebhookSecret,
	updateOwnedOrgWebhook
} from './lib/orgWebhookPolicy';
import {
	assertSupporterBrowseReady,
	attachSupporterTagProjection,
	detachAllSupporterTagProjections,
	detachSupporterTagProjection,
	MAX_ORG_TAGS,
	normalizeSupporterBrowseSource,
	normalizeSupporterTagName,
	readSupporterBrowsePage,
	SUPPORTER_BROWSE_VERSION,
	supporterTagNameKey,
	uniqueSupporterTagIds
} from './lib/supporterBrowse';
import { assertSupporterInputBudget } from './lib/supporterInputBudget';
import { detachSupporterAudienceProjection } from './lib/supporterAudience';
import { bumpContactAuthorityEpoch } from './lib/contactAuthority';
// PII returned as encrypted blobs — v1 API consumers decrypt with org key

// =============================================================================
// API KEY AUTH
// =============================================================================

const API_RATE_WINDOW_MS = 60_000;
const API_V1_PAGE_MAX = 50;
const API_V1_CURSOR_MAX_BYTES = 2 * 1024;
const API_V1_PAGE_MAX_BYTES = 1024 * 1024;
const API_KEY_ACTIVE_MAX = 8;
const API_KEY_HISTORY_MAX = 64;
const API_KEY_CREATE_COOLDOWN_MS = 5_000;
const API_V1_SUBMISSION_RECEIPT_MAX = 32;
const API_V1_DELEGATION_PAGE_MAX = 20;
const API_V1_SCORECARD_COMPARE_MAX = 20;
const API_PLAN_REQUEST_LIMITS: Readonly<Record<string, number>> = {
	inactive: 100,
	starter: 300,
	organization: 1_000,
	coalition: 3_000
};

function normalizeV1PageSize(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > API_V1_PAGE_MAX) {
		throw new Error('V1_PAGE_SIZE_INVALID');
	}
	return limit;
}

function normalizeV1Cursor(cursor: string | undefined): string | null {
	if (cursor === undefined || cursor === '') return null;
	if (new TextEncoder().encode(cursor).byteLength > API_V1_CURSOR_MAX_BYTES) {
		throw new Error('V1_CURSOR_INVALID');
	}
	return cursor;
}

function v1Pagination(
	limit: number,
	cursor: string | undefined,
	maximumBytesRead = API_V1_PAGE_MAX_BYTES
) {
	const numItems = normalizeV1PageSize(limit);
	return {
		cursor: normalizeV1Cursor(cursor),
		numItems,
		maximumRowsRead: numItems + 1,
		maximumBytesRead
	};
}

function requireCompleteV1Page(page: { pageStatus?: string | null }, code: string): void {
	if (page.pageStatus === 'SplitRequired') throw new Error(code);
}

/**
 * Authenticate an API key and atomically consume its global request budget.
 *
 * This is deliberately one mutation. The old path queried the credential and
 * then fire-and-forget patched `lastUsedAt`/`requestCount` on that same row,
 * invalidating the hottest auth read after every request. Its second, Worker-
 * local limiter also let concurrent isolates oversubscribe a key — and skipped
 * inactive-plan reads entirely. A single `(keyId, minute)` `rateLimits` row is
 * now both the bounded request telemetry and the OCC serialization point.
 * Credential, scopes, revocation, and plan rows stay read-only on traffic.
 */
export const authenticateApiKey = mutation({
	args: { _secret: v.string(), keyHash: v.string() },
	handler: async (ctx, { _secret, keyHash }) => {
		requireInternalSecret(_secret);
		if (keyHash.length === 0 || keyHash.length > 128) return null;

		const apiKey = await ctx.db
			.query('apiKeys')
			.withIndex('by_keyHash', (q) => q.eq('keyHash', keyHash))
			.unique();

		if (!apiKey) return null;
		const now = Date.now();
		if (apiKey.revokedAt) return null;
		if (apiKey.expiresAt && apiKey.expiresAt < now) return null;

		const subscriptionRows = await ctx.db
			.query('subscriptions')
			.withIndex('by_orgId', (q) => q.eq('orgId', apiKey.orgId))
			.take(2);
		if (subscriptionRows.length > 1) {
			throw new Error('SUBSCRIPTION_CARDINALITY_REPAIR_REQUIRED');
		}
		const sub = subscriptionRows[0] ?? null;
		// Status-aware plan resolution: a canceled/lapsed subscription floors to
		// inactive; past_due keeps its plan only through the shared grace rule.
		const planSlug = effectivePlanWithGrace(sub, now);
		const limit = API_PLAN_REQUEST_LIMITS[planSlug] ?? API_PLAN_REQUEST_LIMITS.inactive;
		const bucketStart = Math.floor(now / API_RATE_WINDOW_MS) * API_RATE_WINDOW_MS;
		const rateKey = `api-v1:${apiKey._id}`;
		const orgRateKey = `api-v1-org:${apiKey.orgId}`;
		const [keyBucket, orgBucket] = await Promise.all([
			ctx.db
				.query('rateLimits')
				.withIndex('by_key_windowStart', (q) => q.eq('key', rateKey).eq('windowStart', bucketStart))
				.unique(),
			ctx.db
				.query('rateLimits')
				.withIndex('by_key_windowStart', (q) =>
					q.eq('key', orgRateKey).eq('windowStart', bucketStart)
				)
				.unique()
		]);
		const keyCount = keyBucket?.count ?? 0;
		const orgCount = orgBucket?.count ?? 0;
		const resetAt = bucketStart + API_RATE_WINDOW_MS;

		if (keyCount >= limit || orgCount >= limit) {
			return {
				status: 'rate_limited' as const,
				planSlug,
				limit,
				remaining: 0,
				rateLimitScope:
					keyCount >= limit && orgCount >= limit
						? ('key_and_organization' as const)
						: keyCount >= limit
							? ('key' as const)
							: ('organization' as const),
				resetAt,
				retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1_000))
			};
		}

		const nextKeyCount = keyCount + 1;
		const nextOrgCount = orgCount + 1;
		if (keyBucket) {
			await ctx.db.patch(keyBucket._id, { count: nextKeyCount, updatedAt: now });
		} else {
			await ctx.db.insert('rateLimits', {
				key: rateKey,
				windowStart: bucketStart,
				count: nextKeyCount,
				updatedAt: now
			});
		}
		if (orgBucket) {
			await ctx.db.patch(orgBucket._id, { count: nextOrgCount, updatedAt: now });
		} else {
			await ctx.db.insert('rateLimits', {
				key: orgRateKey,
				windowStart: bucketStart,
				count: nextOrgCount,
				updatedAt: now
			});
		}

		return {
			status: 'allowed' as const,
			keyId: apiKey._id,
			orgId: apiKey.orgId,
			scopes: apiKey.scopes,
			planSlug,
			limit,
			remaining: Math.min(limit - nextKeyCount, limit - nextOrgCount),
			perKeyRemaining: limit - nextKeyCount,
			organizationRemaining: limit - nextOrgCount,
			resetAt
		};
	}
});

// =============================================================================
// API KEY MANAGEMENT (session-auth, not API key auth)
// =============================================================================

export const createApiKey = mutation({
	args: {
		_secret: v.string(),
		orgSlug: v.string(),
		keyHash: v.string(),
		keyPrefix: v.string(),
		name: v.string(),
		scopes: v.array(v.string()),
		createdBy: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		if (!/^[0-9a-f]{64}$/.test(args.keyHash)) throw new Error('API_KEY_HASH_INVALID');
		if (args.keyPrefix.length < 8 || args.keyPrefix.length > 24) {
			throw new Error('API_KEY_PREFIX_INVALID');
		}
		const name = args.name.trim();
		if (name.length === 0 || new TextEncoder().encode(name).byteLength > 100) {
			throw new Error('API_KEY_NAME_INVALID');
		}
		const scopes = Array.from(new Set(args.scopes));
		if (
			scopes.length === 0 ||
			scopes.length > 2 ||
			scopes.some((scope) => scope !== 'read' && scope !== 'write')
		) {
			throw new Error('API_KEY_SCOPES_INVALID');
		}
		if (new TextEncoder().encode(args.createdBy).byteLength > 256) {
			throw new Error('API_KEY_CREATOR_INVALID');
		}
		const org = await ctx.db
			.query('organizations')
			.withIndex('by_slug', (q) => q.eq('slug', args.orgSlug))
			.first();
		if (!org) throw new Error('Organization not found');
		const now = Date.now();
		const [duplicate, activeKeys, history] = await Promise.all([
			ctx.db
				.query('apiKeys')
				.withIndex('by_keyHash', (q) => q.eq('keyHash', args.keyHash))
				.unique(),
			ctx.db
				.query('apiKeys')
				.withIndex('by_orgId_revokedAt', (q) => q.eq('orgId', org._id).eq('revokedAt', undefined))
				.take(API_KEY_ACTIVE_MAX),
			ctx.db
				.query('apiKeys')
				.withIndex('by_orgId', (q) => q.eq('orgId', org._id))
				.order('desc')
				.take(API_KEY_HISTORY_MAX)
		]);
		if (duplicate) throw new Error('API_KEY_HASH_COLLISION');
		if (activeKeys.length >= API_KEY_ACTIVE_MAX) throw new Error('API_KEY_ACTIVE_LIMIT_EXCEEDED');
		if (history.length >= API_KEY_HISTORY_MAX) throw new Error('API_KEY_HISTORY_LIMIT_EXCEEDED');
		const latestCreatedAt = history[0]?._creationTime;
		if (latestCreatedAt !== undefined && now - latestCreatedAt < API_KEY_CREATE_COOLDOWN_MS) {
			throw new Error('API_KEY_CREATE_THROTTLED');
		}

		const id = await ctx.db.insert('apiKeys', {
			orgId: org._id,
			keyHash: args.keyHash,
			keyPrefix: args.keyPrefix,
			name,
			scopes,
			requestCount: 0,
			createdBy: args.createdBy
		});

		const key = await ctx.db.get(id);
		return key;
	}
});

export const renameApiKey = mutation({
	args: {
		_secret: v.string(),
		keyId: v.string(),
		orgId: v.string(),
		name: v.string()
	},
	handler: async (ctx, { _secret, keyId, orgId, name }) => {
		requireInternalSecret(_secret);
		const normalizedKeyId = ctx.db.normalizeId('apiKeys', keyId);
		const normalizedOrgId = ctx.db.normalizeId('organizations', orgId);
		if (!normalizedKeyId || !normalizedOrgId) return null;
		const key = await ctx.db.get(normalizedKeyId);
		if (key?.orgId !== normalizedOrgId) return null;
		const normalizedName = name.trim();
		if (normalizedName.length === 0 || new TextEncoder().encode(normalizedName).byteLength > 100) {
			throw new Error('API_KEY_NAME_INVALID');
		}
		if (!key) return null;
		await ctx.db.patch(key._id, { name: normalizedName });
		return await ctx.db.get(key._id);
	}
});

export const revokeApiKey = mutation({
	args: {
		_secret: v.string(),
		keyId: v.string(),
		orgId: v.string()
	},
	handler: async (ctx, { _secret, keyId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedKeyId = ctx.db.normalizeId('apiKeys', keyId);
		const normalizedOrgId = ctx.db.normalizeId('organizations', orgId);
		if (!normalizedKeyId || !normalizedOrgId) return false;
		const key = await ctx.db.get(normalizedKeyId);
		if (!key || key.orgId !== normalizedOrgId) return false;
		if (key.revokedAt !== undefined) return true;
		await ctx.db.patch(key._id, { revokedAt: Date.now() });
		return true;
	}
});

// =============================================================================
// SUPPORTERS (v1 API)
// =============================================================================

export const listSupporters = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		emailHash: v.optional(v.string()),
		verified: v.optional(v.boolean()),
		emailStatus: v.optional(v.string()),
		source: v.optional(v.string()),
		tagId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const org = await ctx.db.get(args.orgId);
		if (!org) throw new Error('Organization not found');
		const tagId = args.tagId ? ctx.db.normalizeId('tags', args.tagId) : null;
		if (args.tagId && !tagId) throw new Error('TAG_NOT_FOUND');
		const source =
			args.source === undefined ? undefined : normalizeSupporterBrowseSource(args.source);
		const filters = {
			verified: args.verified,
			emailStatus: args.emailStatus,
			source,
			tagId: tagId ?? undefined
		};

		let items: Array<Doc<'supporters'>>;
		let cursor: string | null;
		let hasMore: boolean;
		let total: number | undefined;
		if (args.emailHash) {
			await assertSupporterBrowseReady(ctx);
			const supporter = await ctx.db
				.query('supporters')
				.withIndex('by_orgId_emailHash', (q) =>
					q.eq('orgId', args.orgId).eq('emailHash', args.emailHash!)
				)
				.first();
			const matches =
				supporter?.supporterBrowseVersion === SUPPORTER_BROWSE_VERSION &&
				(args.verified === undefined || supporter.verified === args.verified) &&
				(!args.emailStatus || supporter.emailStatus === args.emailStatus) &&
				(!source || supporter.browseSource === source) &&
				(!tagId || (supporter.browseTagIds ?? []).some((candidate) => candidate === tagId));
			items = matches && supporter ? [supporter] : [];
			cursor = null;
			hasMore = false;
			total = items.length;
		} else {
			const page = await readSupporterBrowsePage(ctx, {
				orgId: args.orgId,
				cursor: args.cursor ?? null,
				numItems: args.limit,
				filters
			});
			items = page.page;
			cursor = page.continueCursor;
			hasMore = !page.isDone;
			// The denormalized org total is exact only for an unfiltered roster.
			// Filtered cardinalities intentionally remain unknown instead of paying
			// for a full scan on every API page.
			total =
				args.verified === undefined && !args.emailStatus && !source && !tagId
					? (org.supporterCount ?? 0)
					: undefined;
		}

		const tags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.take(MAX_ORG_TAGS + 1);
		if (tags.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');
		const tagById = new Map(tags.map((tag) => [String(tag._id), tag]));
		return {
			items: items.map((supporter) => ({
				...supporter,
				tags: (supporter.browseTagIds ?? []).flatMap((id) => {
					const tag = tagById.get(String(id));
					return tag ? [{ id: tag._id, name: tag.name }] : [];
				})
			})),
			cursor,
			hasMore,
			total
		};
	}
});

export const getSupporterById = query({
	args: { _secret: v.string(), supporterId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, supporterId, orgId }) => {
		requireInternalSecret(_secret);
		await assertSupporterBrowseReady(ctx);
		const normalizedId = ctx.db.normalizeId('supporters', supporterId);
		if (!normalizedId) return null;
		const supporter = await ctx.db.get(normalizedId);
		if (!supporter || supporter.orgId !== orgId) return null;
		if (supporter.supporterBrowseVersion !== SUPPORTER_BROWSE_VERSION) {
			throw new Error('SUPPORTER_BROWSE_ROW_NOT_PROJECTED');
		}
		const orgTags = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(MAX_ORG_TAGS + 1);
		if (orgTags.length > MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');
		const tagById = new Map(orgTags.map((tag) => [String(tag._id), tag]));
		const tags = (supporter.browseTagIds ?? []).flatMap((id) => {
			const tag = tagById.get(String(id));
			return tag ? [{ id: tag._id, name: tag.name }] : [];
		});

		// Return encrypted blobs as-is — client decrypts with org key
		return { ...supporter, tags };
	}
});

export const updateSupporter = mutation({
	args: {
		_secret: v.string(),
		supporterId: v.string(),
		orgId: v.id('organizations'),
		data: v.object({
			postalCode: v.optional(v.string()),
			stateCode: v.optional(v.string()),
			congressionalDistrict: v.optional(v.string()),
			country: v.optional(v.string()),
			encryptedCustomFields: v.optional(v.string())
		})
	},
	handler: async (ctx, { _secret, supporterId, orgId, data }) => {
		requireInternalSecret(_secret);
		assertSupporterInputBudget(data, 'V1_SUPPORTER_UPDATE_INPUT');
		const normalizedId = ctx.db.normalizeId('supporters', supporterId);
		if (!normalizedId) return null;
		const supporter = await ctx.db.get(normalizedId);
		if (!supporter || supporter.orgId !== orgId) return null;
		assertSupporterInputBudget({ ...supporter, ...data }, 'V1_SUPPORTER_UPDATE');

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (data.postalCode !== undefined) updates.postalCode = data.postalCode;
		if (data.stateCode !== undefined) updates.stateCode = data.stateCode;
		if (data.congressionalDistrict !== undefined)
			updates.congressionalDistrict = data.congressionalDistrict;
		if (data.country !== undefined) updates.country = data.country;
		if (data.encryptedCustomFields !== undefined)
			updates.encryptedCustomFields = data.encryptedCustomFields;

		// Build the post-patch shape BEFORE writing so the counter delta sees
		// the transition. postalCode changes shift the postalResolved bucket;
		// without this the funnel drifts on every v1 API update.
		const after = { ...supporter, ...updates };
		await ctx.db.patch(supporter._id, updates);
		await applySupporterStatsDelta(ctx, orgId, supporter, after);
		return { id: supporter._id, updatedAt: Date.now() };
	}
});

export const deleteSupporter = mutation({
	args: { _secret: v.string(), supporterId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, supporterId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('supporters', supporterId);
		if (!normalizedId) return false;
		const supporter = await ctx.db.get(normalizedId);
		if (!supporter || supporter.orgId !== orgId) return false;
		// Drop this row's contributions from the breakdown counters and the
		// total before deleting, mirroring the create path's count bump.
		await applySupporterStatsDelta(ctx, orgId, supporter, null);
		const org = await ctx.db.get(orgId);
		if (org) {
			await ctx.db.patch(orgId, {
				supporterCount: Math.max(0, (org.supporterCount ?? 0) - 1),
				updatedAt: Date.now()
			});
			await syncPublicOrganizationDirectory(ctx, orgId);
		}
		await detachAllSupporterTagProjections(ctx, supporter._id);
		await detachSupporterAudienceProjection(ctx, { orgId, supporterId: supporter._id });
		await ctx.db.delete(supporter._id);
		await bumpContactAuthorityEpoch(ctx, Date.now());
		await syncSupporterIdentityReceiptProjections(ctx, supporter._id, orgId);
		return true;
	}
});

export const createSupporter = mutation({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		encryptedEmail: v.string(),
		emailHash: v.string(),
		// Paired global hashes for cross-org webhook lookup. Same contract
		// as `supporters.create` — optional during rollout but webhook
		// lookups (SES bounce/complaint, TCPA STOP/START) need them to
		// find this row.
		globalEmailHash: v.optional(v.string()),
		encryptedName: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		stateCode: v.optional(v.string()),
		congressionalDistrict: v.optional(v.string()),
		country: v.string(),
		encryptedPhone: v.optional(v.string()),
		phoneHash: v.optional(v.string()),
		globalPhoneHash: v.optional(v.string()),
		source: v.string(),
		encryptedCustomFields: v.optional(v.string()),
		tagIds: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		assertSupporterInputBudget(args, 'V1_SUPPORTER_CREATE');
		// Enforce the PII triple invariant at the v1 API boundary so
		// third-party API consumers can't write partial-coherence rows
		// any more than internal callers can. Shares the same helper +
		// error names as `supporters.create` and `importBatch`.
		assertPiiTripleCreate(args);

		// Check for duplicate by emailHash via the dedicated composite
		// index. A rebuilt fixed window would scan only an early prefix and
		// miss any duplicate past that boundary, so large orgs could create a duplicate
		// via the v1 API. The schema has `by_orgId_emailHash`; use it.
		const dup = await ctx.db
			.query('supporters')
			.withIndex('by_orgId_emailHash', (q) =>
				q.eq('orgId', args.orgId).eq('emailHash', args.emailHash)
			)
			.first();
		if (dup) return { duplicate: true, id: dup._id };

		const org = await ctx.db.get(args.orgId);
		if (!org) throw new Error('Organization not found');
		const source = normalizeSupporterBrowseSource(args.source);
		const tagIds = uniqueSupporterTagIds(
			(args.tagIds ?? []).map((value) => {
				const tagId = ctx.db.normalizeId('tags', value);
				if (!tagId) throw new Error('TAG_NOT_FOUND');
				return tagId;
			})
		);
		for (const tagId of tagIds) {
			const tag = await ctx.db.get(tagId);
			if (!tag || tag.orgId !== args.orgId) throw new Error('TAG_NOT_FOUND');
		}

		const id = await ctx.db.insert('supporters', {
			orgId: args.orgId,
			encryptedEmail: args.encryptedEmail,
			emailHash: args.emailHash,
			globalEmailHash: args.globalEmailHash,
			encryptedName: args.encryptedName,
			postalCode: args.postalCode,
			stateCode: args.stateCode,
			congressionalDistrict: args.congressionalDistrict,
			country: args.country,
			encryptedPhone: args.encryptedPhone,
			phoneHash: args.phoneHash,
			globalPhoneHash: args.globalPhoneHash,
			source: args.source,
			browseSource: source,
			browseTagIds: tagIds,
			supporterBrowseVersion: SUPPORTER_BROWSE_VERSION,
			verified: false,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			encryptedCustomFields: args.encryptedCustomFields,
			updatedAt: Date.now()
		});

		// Create tag links
		for (const tagId of tagIds) {
			await attachSupporterTagProjection(ctx, { supporterId: id, tagId });
		}

		// Maintain org counters for the new row. supporterCount was previously
		// not advanced on the v1 API create path — bring it forward so total and
		// the breakdown stay coherent.
		await ctx.db.patch(args.orgId, {
			supporterCount: (org.supporterCount ?? 0) + 1,
			updatedAt: Date.now()
		});
		await syncPublicOrganizationDirectory(ctx, args.orgId);
		await applySupporterStatsDelta(ctx, args.orgId, null, {
			_id: id,
			globalEmailHash: args.globalEmailHash,
			country: args.country,
			verified: false,
			emailStatus: 'subscribed',
			smsStatus: 'none',
			source: args.source,
			postalCode: args.postalCode,
			encryptedPhone: args.encryptedPhone,
			phoneHash: args.phoneHash
		});

		const supporter = await ctx.db.get(id);
		return { duplicate: false, supporter };
	}
});

// =============================================================================
// TAGS (v1 API)
// =============================================================================

export const listTags = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		await assertSupporterBrowseReady(ctx);
		const page = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.order('asc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_TAG_PAGE_SPLIT_REQUIRED');
		return {
			items: page.page.map((tag) => ({
				id: tag._id,
				name: tag.name,
				supporterCount: tag.supporterCount ?? 0,
				supporterCountTruncated: false
			})),
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

export const createTag = mutation({
	args: { _secret: v.string(), orgId: v.id('organizations'), name: v.string() },
	handler: async (ctx, { _secret, orgId, name }) => {
		requireInternalSecret(_secret);
		const normalizedName = normalizeSupporterTagName(name);
		const nameKey = supporterTagNameKey(normalizedName);
		const duplicate = await ctx.db
			.query('tags')
			.withIndex('by_orgId_nameKey', (q) => q.eq('orgId', orgId).eq('nameKey', nameKey))
			.first();
		if (duplicate) return { duplicate: true, id: duplicate._id };
		const existing = await ctx.db
			.query('tags')
			.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
			.take(MAX_ORG_TAGS);
		if (existing.length >= MAX_ORG_TAGS) throw new Error('ORG_TAG_LIMIT_EXCEEDED');

		const id = await ctx.db.insert('tags', {
			orgId,
			name: normalizedName,
			nameKey,
			supporterCount: 0
		});
		const tag = await ctx.db.get(id);
		return { duplicate: false, tag };
	}
});

export const updateTag = mutation({
	args: { _secret: v.string(), tagId: v.string(), orgId: v.id('organizations'), name: v.string() },
	handler: async (ctx, { _secret, tagId, orgId, name }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('tags', tagId);
		if (!normalizedId) return null;
		const tag = await ctx.db.get(normalizedId);
		if (!tag || tag.orgId !== orgId) return null;
		const normalizedName = normalizeSupporterTagName(name);
		const nameKey = supporterTagNameKey(normalizedName);

		// Check for duplicate name
		const dup = await ctx.db
			.query('tags')
			.withIndex('by_orgId_nameKey', (q) => q.eq('orgId', orgId).eq('nameKey', nameKey))
			.first();
		if (dup && dup._id !== tag._id) return { duplicate: true };

		await ctx.db.patch(tag._id, { name: normalizedName, nameKey });
		return await ctx.db.get(tag._id);
	}
});

export const deleteTag = mutation({
	args: { _secret: v.string(), tagId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, tagId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('tags', tagId);
		if (!normalizedId) return false;
		const tag = await ctx.db.get(normalizedId);
		if (!tag || tag.orgId !== orgId) return false;

		// Delete one bounded batch, then let the shared drain mutation finish a
		// popular tag without exceeding one transaction's write budget.
		const links = await ctx.db
			.query('supporterTags')
			.withIndex('by_tagId', (q) => q.eq('tagId', tag._id))
			.take(64);
		for (const link of links) {
			await detachSupporterTagProjection(ctx, link);
		}

		await ctx.db.delete(tag._id);
		if (links.length >= 64) {
			await ctx.scheduler.runAfter(0, internal.supporters.purgeTagLinks, { tagId: tag._id });
		}
		return true;
	}
});

// =============================================================================
// CAMPAIGNS (v1 API)
// =============================================================================

async function campaignCountProjectionReady(ctx: QueryCtx): Promise<boolean> {
	const migration = await ctx.db
		.query('campaignReadModelMigrations')
		.withIndex('by_key', (q) => q.eq('key', CAMPAIGN_READ_MODEL_MIGRATION_KEY))
		.unique();
	return migration?.status === 'ready';
}

async function v1CampaignCounts(
	ctx: QueryCtx,
	campaign: Doc<'campaigns'>,
	projectionReady: boolean
) {
	if (!projectionReady) {
		return { actions: null, verifiedActions: null, deliveries: null, exact: false };
	}
	const model = await ctx.db
		.query('campaignReadModels')
		.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
		.unique();
	return {
		actions: model?.state.version === CAMPAIGN_READ_MODEL_VERSION ? model.state.actionCount : null,
		verifiedActions:
			model?.state.version === CAMPAIGN_READ_MODEL_VERSION ? model.state.verifiedActionCount : null,
		// The current campaign projection counts sent attempts, not every queued
		// delivery row. Do not relabel it as an exact all-status row count.
		deliveries: null,
		exact: model?.state.version === CAMPAIGN_READ_MODEL_VERSION
	};
}

export const listCampaigns = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		status: v.optional(v.string()),
		type: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const statuses = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'] as const;
		if (args.status && !statuses.includes(args.status as (typeof statuses)[number])) {
			throw new Error('CAMPAIGN_STATUS_INVALID');
		}
		const types = ['LETTER', 'EVENT', 'FORM', 'FUNDRAISER', 'CONGRESSIONAL'] as const;
		if (args.type && !types.includes(args.type as (typeof types)[number])) {
			throw new Error('CAMPAIGN_TYPE_INVALID');
		}
		const source = args.status
			? ctx.db
					.query('campaigns')
					.withIndex('by_orgId_status', (q) =>
						q.eq('orgId', args.orgId).eq('status', args.status as Doc<'campaigns'>['status'])
					)
			: ctx.db.query('campaigns').withIndex('by_orgId', (q) => q.eq('orgId', args.orgId));
		const page = await source.order('desc').paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_CAMPAIGN_PAGE_SPLIT_REQUIRED');
		const projectionReady = await campaignCountProjectionReady(ctx);
		const items = args.type
			? page.page.filter((campaign) => campaign.type === args.type)
			: page.page;
		const campaignsWithCounts = await Promise.all(
			items.map(async (campaign) => ({
				...campaign,
				_count: await v1CampaignCounts(ctx, campaign, projectionReady)
			}))
		);

		return {
			items: campaignsWithCounts,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

export const getCampaignById = query({
	args: { _secret: v.string(), campaignId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, campaignId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('campaigns', campaignId);
		if (!normalizedId) return null;
		const campaign = await ctx.db.get(normalizedId);
		if (!campaign || campaign.orgId !== orgId) return null;
		return {
			...campaign,
			_count: await v1CampaignCounts(ctx, campaign, await campaignCountProjectionReady(ctx))
		};
	}
});

export const createCampaign = mutation({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		title: v.string(),
		type: campaignType,
		body: v.optional(v.string()),
		templateId: v.optional(v.id('templates')),
		targetJurisdiction: v.optional(v.string()),
		targetCountry: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const id = await ctx.db.insert('campaigns', {
			orgId: args.orgId,
			title: args.title,
			type: args.type,
			body: args.body ?? undefined,
			templateId: args.templateId ?? undefined,
			status: 'DRAFT',
			debateEnabled: false,
			debateThreshold: 100,
			targetJurisdiction: args.targetJurisdiction ?? undefined,
			targetCountry: args.targetCountry,
			targets: [],
			actionCount: 0,
			verifiedActionCount: 0,
			raisedAmountCents: 0,
			donorCount: 0,
			donationCurrency: 'USD',
			orgCounterVersion: CAMPAIGN_ACTIVE_COUNTER_VERSION,
			updatedAt: Date.now()
		});
		await recordCampaignCreated(ctx, args.orgId, 'DRAFT');
		await syncPublicOrganizationDirectory(ctx, args.orgId);
		return await ctx.db.get(id);
	}
});

export const updateCampaign = mutation({
	args: {
		_secret: v.string(),
		campaignId: v.string(),
		orgId: v.id('organizations'),
		data: v.object({
			title: v.optional(v.string()),
			body: v.optional(v.string()),
			status: v.optional(v.string()),
			targetJurisdiction: v.optional(v.union(v.string(), v.null())),
			targetCountry: v.optional(v.string())
		})
	},
	handler: async (ctx, { _secret, campaignId, orgId, data }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('campaigns', campaignId);
		if (!normalizedId) return null;
		const campaign = await ctx.db.get(normalizedId);
		if (!campaign || campaign.orgId !== orgId) return null;

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (data.title !== undefined) updates.title = data.title;
		if (data.body !== undefined) updates.body = data.body;
		if (data.status !== undefined) {
			if (!['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETE'].includes(data.status)) {
				throw new Error('Invalid campaign status');
			}
			updates.status = data.status;
		}
		if (data.targetJurisdiction !== undefined) updates.targetJurisdiction = data.targetJurisdiction;
		if (data.targetCountry !== undefined) updates.targetCountry = data.targetCountry;

		if (data.status !== undefined && data.status !== campaign.status) {
			await recordCampaignStatusTransition(ctx, campaign, data.status);
		}
		await ctx.db.patch(campaign._id, updates);
		if (data.status !== undefined && data.status !== campaign.status) {
			await syncPublicOrganizationDirectory(ctx, orgId);
		}
		return { id: campaign._id, updatedAt: Date.now() };
	}
});

// =============================================================================
// CAMPAIGN ACTIONS (v1 API)
// =============================================================================

export const listCampaignActions = query({
	args: {
		_secret: v.string(),
		campaignId: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		verified: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const campaignId = ctx.db.normalizeId('campaigns', args.campaignId);
		if (!campaignId) return null;
		const campaign = await ctx.db.get(campaignId);
		if (!campaign || campaign.orgId !== args.orgId) return null;
		const source =
			args.verified === undefined
				? ctx.db
						.query('campaignActions')
						.withIndex('by_campaignId', (q) => q.eq('campaignId', campaign._id))
				: ctx.db
						.query('campaignActions')
						.withIndex('by_campaignId_verified', (q) =>
							q.eq('campaignId', campaign._id).eq('verified', args.verified!)
						);
		const page = await source.order('desc').paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_CAMPAIGN_ACTION_PAGE_SPLIT_REQUIRED');
		const counts = await v1CampaignCounts(ctx, campaign, await campaignCountProjectionReady(ctx));
		const total =
			counts.actions === null || counts.verifiedActions === null
				? undefined
				: args.verified === true
					? counts.verifiedActions
					: args.verified === false
						? counts.actions - counts.verifiedActions
						: counts.actions;

		return {
			items: page.page,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total
		};
	}
});

// =============================================================================
// CALLS (v1 API)
// =============================================================================

export const listCallsV1 = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		status: v.optional(v.string()),
		campaignId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const page = await ctx.db
			.query('patchThroughCalls')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_CALL_PAGE_SPLIT_REQUIRED');
		const items = page.page.filter(
			(call) =>
				(!args.status || call.status === args.status) &&
				(!args.campaignId || String(call.campaignId) === args.campaignId)
		);
		return {
			items,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

// =============================================================================
// DONATIONS (v1 API)
// =============================================================================

export const listDonationsV1 = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		status: v.optional(v.string()),
		campaignId: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const page = await ctx.db
			.query('donations')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_DONATION_PAGE_SPLIT_REQUIRED');
		const items = page.page.filter(
			(donation) =>
				(!args.status || donation.status === args.status) &&
				(!args.campaignId || String(donation.campaignId) === args.campaignId)
		);
		return {
			items,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

export const getDonationById = query({
	args: { _secret: v.string(), donationId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, donationId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('donations', donationId);
		if (!normalizedId) return null;
		const donation = await ctx.db.get(normalizedId);
		return donation?.orgId === orgId ? donation : null;
	}
});

// =============================================================================
// SMS BLASTS (v1 API)
// =============================================================================

export const listSmsBlastsV1 = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		status: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const page = await ctx.db
			.query('smsBlasts')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_SMS_BLAST_PAGE_SPLIT_REQUIRED');
		return {
			items: args.status ? page.page.filter((blast) => blast.status === args.status) : page.page,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

// =============================================================================
// EVENTS (v1 API)
// =============================================================================

export const listEventsV1 = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		status: v.optional(v.string()),
		eventType: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const statuses = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'] as const;
		if (args.status && !statuses.includes(args.status as (typeof statuses)[number])) {
			throw new Error('EVENT_STATUS_INVALID');
		}
		const source = args.status
			? ctx.db
					.query('events')
					.withIndex('by_orgId_status', (q) =>
						q.eq('orgId', args.orgId).eq('status', args.status as Doc<'events'>['status'])
					)
			: ctx.db.query('events').withIndex('by_orgId', (q) => q.eq('orgId', args.orgId));
		const page = await source.order('desc').paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_EVENT_PAGE_SPLIT_REQUIRED');
		return {
			items: args.eventType
				? page.page.filter((event) => event.eventType === args.eventType)
				: page.page,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

export const getEventById = query({
	args: { _secret: v.string(), eventId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, eventId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('events', eventId);
		if (!normalizedId) return null;
		const event = await ctx.db.get(normalizedId);
		return event?.orgId === orgId ? event : null;
	}
});

// =============================================================================
// WORKFLOWS (v1 API)
// =============================================================================

export const listWorkflowsV1 = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		enabled: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const page = await ctx.db
			.query('workflows')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_WORKFLOW_PAGE_SPLIT_REQUIRED');
		return {
			items:
				args.enabled === undefined
					? page.page
					: page.page.filter((workflow) => workflow.enabled === args.enabled),
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

export const getWorkflowById = query({
	args: { _secret: v.string(), workflowId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, workflowId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedId = ctx.db.normalizeId('workflows', workflowId);
		if (!normalizedId) return null;
		const workflow = await ctx.db.get(normalizedId);
		return workflow?.orgId === orgId ? workflow : null;
	}
});

// =============================================================================
// NETWORKS (v1 API)
// =============================================================================

export const listNetworksV1 = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const page = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_orgId_status', (q) => q.eq('orgId', args.orgId).eq('status', 'active'))
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_NETWORK_PAGE_SPLIT_REQUIRED');

		const networksWithDetails = await Promise.all(
			page.page.map(async (membership) => {
				const [network, aggregate] = await Promise.all([
					ctx.db.get(membership.networkId),
					ctx.db
						.query('coalitionNetworkAggregates')
						.withIndex('by_networkId', (q) => q.eq('networkId', membership.networkId))
						.unique()
				]);
				if (!network) return null;
				const memberCountIsExact =
					aggregate?.version === COALITION_METRICS_VERSION &&
					aggregate.status === 'ready' &&
					aggregate.activeGeneration !== undefined &&
					aggregate.dirtyAt === undefined;
				return {
					id: network._id,
					name: network.name,
					slug: network.slug,
					description: network.description,
					status: network.status,
					ownerOrgId: network.ownerOrgId,
					memberCount: memberCountIsExact ? aggregate.memberCount : null,
					memberCountExact: memberCountIsExact,
					role: membership.role,
					joinedAt: membership.joinedAt,
					createdAt: network._creationTime,
					updatedAt: network.updatedAt
				};
			})
		);

		return {
			items: networksWithDetails.filter(Boolean),
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

export const getNetworkByIdV1 = query({
	args: { _secret: v.string(), networkId: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, networkId, orgId }) => {
		requireInternalSecret(_secret);
		const normalizedNetworkId = ctx.db.normalizeId('orgNetworks', networkId);
		if (!normalizedNetworkId) return null;
		const membership = await ctx.db
			.query('orgNetworkMembers')
			.withIndex('by_networkId_orgId', (q) =>
				q.eq('networkId', normalizedNetworkId).eq('orgId', orgId)
			)
			.unique();
		if (!membership) return { forbidden: true };
		if (membership.status !== 'active') return { forbidden: true };

		const network = await ctx.db.get(normalizedNetworkId);
		if (!network) return null;

		const [ownerOrg, aggregate] = await Promise.all([
			ctx.db
				.query('publicOrganizationDirectory')
				.withIndex('by_orgId', (q) => q.eq('orgId', network.ownerOrgId))
				.unique(),
			ctx.db
				.query('coalitionNetworkAggregates')
				.withIndex('by_networkId', (q) => q.eq('networkId', network._id))
				.unique()
		]);
		const memberCountIsExact =
			aggregate?.version === COALITION_METRICS_VERSION &&
			aggregate.status === 'ready' &&
			aggregate.activeGeneration !== undefined &&
			aggregate.dirtyAt === undefined;

		return {
			forbidden: false,
			network: {
				id: network._id,
				name: network.name,
				slug: network.slug,
				description: network.description,
				status: network.status,
				ownerOrgId: network.ownerOrgId,
				memberCount: memberCountIsExact ? aggregate.memberCount : null,
				memberCountExact: memberCountIsExact,
				ownerOrg: ownerOrg
					? { id: ownerOrg.orgId, name: ownerOrg.name, slug: ownerOrg.slug }
					: null,
				members: null,
				membersAvailable: false,
				createdAt: network._creationTime,
				updatedAt: network.updatedAt
			}
		};
	}
});

// =============================================================================
// REPRESENTATIVES (v1 API — international DMs)
// =============================================================================

export const listRepresentativesV1 = query({
	args: {
		_secret: v.string(),
		limit: v.number(),
		cursor: v.optional(v.string()),
		country: v.string()
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const country = args.country.trim();
		if (!country || new TextEncoder().encode(country).byteLength > 100) {
			throw new Error('V1_REPRESENTATIVE_COUNTRY_INVALID');
		}

		const page = await ctx.db
			.query('decisionMakers')
			.withIndex('by_jurisdiction_jurisdictionLevel', (q) =>
				q.eq('jurisdiction', country).eq('jurisdictionLevel', 'international')
			)
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_REPRESENTATIVE_PAGE_SPLIT_REQUIRED');
		const items = page.page.map((dm) => ({
			_id: dm._id,
			_creationTime: dm._creationTime,
			jurisdiction: dm.jurisdiction ?? null,
			constituencyId: null,
			district: dm.district ?? null,
			name: dm.name,
			party: dm.party ?? null,
			title: dm.title ?? null,
			phone: dm.phone ?? null,
			email: dm.email ?? null,
			websiteUrl: dm.websiteUrl ?? null,
			photoUrl: dm.photoUrl ?? null,
			updatedAt: dm.updatedAt
		}));
		return {
			items,
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

// =============================================================================
// ORG (v1 API — org detail)
// =============================================================================

export const getOrgForApiKey = query({
	args: { _secret: v.string(), orgId: v.id('organizations') },
	handler: async (ctx, { _secret, orgId }) => {
		requireInternalSecret(_secret);
		const [migration, org] = await Promise.all([
			ctx.db
				.query('publicOrganizationDirectoryMigrations')
				.withIndex('by_key', (q) => q.eq('key', PUBLIC_ORGANIZATION_DIRECTORY_MIGRATION_KEY))
				.unique(),
			ctx.db
				.query('publicOrganizationDirectory')
				.withIndex('by_orgId', (q) => q.eq('orgId', orgId))
				.unique()
		]);
		if (migration?.status !== 'ready' || org?.version !== PUBLIC_ORGANIZATION_DIRECTORY_VERSION) {
			return { projectionUnavailable: true as const };
		}

		return {
			projectionUnavailable: false as const,
			id: org.orgId,
			name: org.name,
			slug: org.slug,
			description: org.description,
			avatar: org.avatar,
			createdAt: null,
			counts: {
				supporters: org.supporterCount,
				campaigns: org.campaignCount,
				templates: null
			},
			countsExact: {
				supporters: true,
				campaigns: true,
				templates: false
			}
		};
	}
});

// =============================================================================
// SCORECARDS (public, no auth)
// =============================================================================

export const getDmScorecard = query({
	args: {
		_secret: v.string(),
		identifier: v.string(),
		// T6-8 — optional methodology pin. Without it, returns the latest
		// methodology snapshots; with it, returns the requested version for
		// backwards-compatible reads. Canonical changelog at
		// docs/design/SCORECARD-METHODOLOGY-CHANGELOG.md.
		methodologyVersion: v.optional(v.number())
	},
	handler: async (ctx, { _secret, identifier, methodologyVersion }) => {
		requireInternalSecret(_secret);
		const resolved = await resolveDmAndCanonical(ctx, identifier);
		if (!resolved) return null;
		const { dm, canonicalSlug } = resolved;

		const rawSnapshots = await ctx.db
			.query('scorecardSnapshots')
			.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', dm._id))
			.order('desc')
			.take(52); // wider take so the version filter still yields 13 results

		// Default: take the most recent snapshot's methodology and stay
		// consistent through the history window. Lets a consumer overlay v1 and
		// v2 history by passing methodologyVersion explicitly per request.
		const defaultVersion = rawSnapshots[0]?.methodologyVersion ?? null;
		const targetVersion = methodologyVersion ?? defaultVersion;
		const snapshots =
			targetVersion === null
				? rawSnapshots.slice(0, 13)
				: rawSnapshots.filter((s) => s.methodologyVersion === targetVersion).slice(0, 13);

		const latest = snapshots[0] ?? null;
		const history = snapshots.slice(1);

		return {
			canonicalSlug,
			decisionMaker: {
				id: dm._id,
				name: dm.name,
				title: dm.title,
				party: dm.party,
				district: dm.district,
				jurisdiction: dm.jurisdiction
			},
			current: latest
				? {
						responsiveness: latest.responsiveness,
						alignment: latest.alignment,
						composite: latest.composite,
						period: {
							start: new Date(latest.periodStart).toISOString().slice(0, 10),
							end: new Date(latest.periodEnd).toISOString().slice(0, 10)
						},
						attestationHash: latest.snapshotHash,
						methodologyVersion: latest.methodologyVersion
					}
				: null,
			history: history.map((s) => ({
				period: new Date(s.periodEnd).toISOString().slice(0, 7),
				responsiveness: s.responsiveness,
				alignment: s.alignment,
				composite: s.composite
			})),
			transparency: latest
				? {
						deliveriesSent: latest.deliveriesSent,
						deliveriesOpened: latest.deliveriesOpened,
						deliveriesVerified: latest.deliveriesVerified,
						repliesReceived: latest.repliesReceived,
						alignedVotes: latest.alignedVotes,
						totalScoredVotes: latest.totalScoredVotes
					}
				: null
		};
	}
});

export const compareDmScorecards = query({
	args: { _secret: v.string(), dmIds: v.array(v.string()) },
	handler: async (ctx, { _secret, dmIds }) => {
		requireInternalSecret(_secret);
		if (dmIds.length === 0 || dmIds.length > API_V1_SCORECARD_COMPARE_MAX) {
			throw new Error('V1_SCORECARD_COMPARE_SIZE_INVALID');
		}
		const normalizedDmIds = dmIds.map((dmId) => {
			const normalized = ctx.db.normalizeId('decisionMakers', dmId);
			if (!normalized) throw new Error('V1_DECISION_MAKER_ID_INVALID');
			return normalized;
		});
		const results = await Promise.all(
			normalizedDmIds.map(async (dmId) => {
				const dm = await ctx.db.get(dmId);
				if (!dm) return null;

				const latest = await ctx.db
					.query('scorecardSnapshots')
					.withIndex('by_decisionMakerId', (q) => q.eq('decisionMakerId', dm._id))
					.order('desc')
					.first();

				return {
					decisionMaker: {
						id: dm._id,
						name: dm.name,
						title: dm.title,
						party: dm.party,
						district: dm.district,
						jurisdiction: dm.jurisdiction
					},
					current: latest
						? {
								responsiveness: latest.responsiveness,
								alignment: latest.alignment,
								composite: latest.composite,
								period: {
									start: new Date(latest.periodStart).toISOString().slice(0, 10),
									end: new Date(latest.periodEnd).toISOString().slice(0, 10)
								},
								attestationHash: latest.snapshotHash,
								methodologyVersion: latest.methodologyVersion
							}
						: null
				};
			})
		);

		return results.filter(Boolean);
	}
});

// =============================================================================
// CAMPAIGN STATS (public, no auth)
// =============================================================================

export const getCampaignStats = query({
	args: { _secret: v.string(), campaignId: v.id('campaigns') },
	handler: async (ctx, { _secret, campaignId }) => {
		requireInternalSecret(_secret);
		const campaign = await ctx.db.get(campaignId);
		if (!campaign) return null;
		return {
			raisedAmountCents: campaign.raisedAmountCents,
			donorCount: campaign.donorCount,
			goalAmountCents: campaign.goalAmountCents ?? null,
			currency: campaign.donationCurrency
		};
	}
});

// =============================================================================
// EVENT STATS (public, no auth)
// =============================================================================

export const getEventStats = query({
	args: { _secret: v.string(), eventId: v.string() },
	handler: async (ctx, { _secret, eventId }) => {
		requireInternalSecret(_secret);
		if (eventId.length === 0 || eventId.length > 128) return null;
		const normalizedEventId = ctx.db.normalizeId('events', eventId);
		if (!normalizedEventId) return null;
		const event = await ctx.db.get(normalizedEventId);
		if (!event || event.status === 'DRAFT') return null;
		const kFloor = (count: number | undefined): number | null =>
			count === undefined || count < 5 ? null : count;

		return {
			rsvpCount: kFloor(event.rsvpCount),
			attendeeCount: kFloor(event.attendeeCount),
			verifiedAttendees: kFloor(event.verifiedAttendees),
			goingCount: kFloor(event.goingCount),
			maybeCount: kFloor(event.maybeCount),
			kAnonymityThreshold: 5
		};
	}
});

// =============================================================================
// SUBMISSION STATUS (authenticated)
// =============================================================================

export const getSubmissionStatus = query({
	args: { _secret: v.string(), submissionId: v.string(), pseudonymousId: v.string() },
	handler: async (ctx, { _secret, submissionId, pseudonymousId }) => {
		requireInternalSecret(_secret);
		const normalizedSubmissionId = ctx.db.normalizeId('submissions', submissionId);
		if (!normalizedSubmissionId) return null;
		const submission = await ctx.db.get(normalizedSubmissionId);
		if (!submission) return null;
		if (submission.pseudonymousId !== pseudonymousId) return { forbidden: true };

		const receipts = await ctx.db
			.query('submissionDeliveryReceipts')
			.withIndex('by_submissionId', (q) => q.eq('submissionId', submission._id))
			.take(API_V1_SUBMISSION_RECEIPT_MAX + 1);
		if (receipts.length > API_V1_SUBMISSION_RECEIPT_MAX) {
			throw new Error('V1_SUBMISSION_RECEIPT_LIMIT_EXCEEDED');
		}

		const deliveredReceiptCount = receipts.filter((r) => r.status === 'delivered').length;
		const demoReceiptCount = receipts.filter((r) => r.status === 'demo').length;
		const deliveryCount =
			receipts.length > 0
				? deliveredReceiptCount
				: submission.cwcSubmissionId
					? submission.cwcSubmissionId.split(',').length
					: 0;

		return {
			forbidden: false,
			status: submission.deliveryStatus,
			deliveryCount,
			deliveredAt: submission.deliveredAt,
			error: submission.deliveryError
				? 'Delivery encountered an issue. Please try again or contact support.'
				: null,
			// Proof chain surface: verificationStatus is the TEE three-gate result
			// (pending → verified|rejected), anchorStatus is the async on-chain
			// Noir/UltraHonk verifier trail. Surfaced for the inline proof footer
			// so users see what cryptographically supports their delivery receipt.
			verificationStatus: submission.verificationStatus,
			verifiedAt: submission.verifiedAt,
			anchorStatus: submission.anchorStatus,
			anchorTxHash: submission.anchorTxHash,
			anchorAt: submission.anchorAt,
			receipts: receipts.map((receipt) => ({
				recipientKey: receipt.recipientKey,
				recipientName: receipt.recipientName ?? null,
				chamber: receipt.chamber ?? null,
				provider: receipt.provider,
				status: receipt.status,
				providerReceiptId: receipt.providerReceiptId ?? null,
				errorCode: receipt.errorCode ?? null,
				deliveredAt: receipt.deliveredAt ?? null,
				updatedAt: receipt.updatedAt
			})),
			receiptSummary: {
				total: receipts.length,
				delivered: deliveredReceiptCount,
				failed: receipts.filter((r) => r.status === 'failed').length,
				demo: demoReceiptCount
			}
		};
	}
});

// =============================================================================
// EMAIL CONFIRMATION
// =============================================================================

export const confirmEmailDelivery = mutation({
	args: { _secret: v.string(), submissionId: v.string() },
	handler: async (ctx, { _secret, submissionId }) => {
		requireInternalSecret(_secret);
		const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

		const normalizedSubmissionId = ctx.db.normalizeId('submissions', submissionId);
		const submission = normalizedSubmissionId ? await ctx.db.get(normalizedSubmissionId) : null;

		if (!submission) {
			return { confirmed: false, message: 'No pending submission found for this confirmation' };
		}
		if (submission._creationTime < sevenDaysAgo) {
			return { confirmed: false, message: 'Confirmation token is too old for this submission' };
		}
		if (submission.deliveryStatus === 'user_confirmed') {
			return {
				confirmed: true,
				already_confirmed: true,
				message: 'Delivery was already confirmed'
			};
		}
		if (submission.deliveryStatus !== 'pending' && submission.deliveryStatus !== 'delivered') {
			return { confirmed: false, message: 'Submission is not awaiting email confirmation' };
		}

		await ctx.db.patch(submission._id, {
			deliveryStatus: 'user_confirmed',
			deliveredAt: Date.now()
		});

		return { confirmed: true, message: 'Thank you! Your email delivery has been confirmed.' };
	}
});

// =============================================================================
// DELEGATION (authenticated)
// =============================================================================

export const getDelegationGrant = query({
	args: { _secret: v.string(), grantId: v.string() },
	handler: async (ctx, { _secret, grantId }) => {
		requireInternalSecret(_secret);
		const normalizedGrantId = ctx.db.normalizeId('delegationGrants', grantId);
		if (!normalizedGrantId) return null;
		const grant = await ctx.db.get(normalizedGrantId);
		if (!grant) return null;

		const actions = await ctx.db
			.query('delegatedActions')
			.withIndex('by_grantId', (q) => q.eq('grantId', grant._id))
			.order('desc')
			.take(API_V1_DELEGATION_PAGE_MAX + 1);

		const reviews = await ctx.db
			.query('delegationReviews')
			.withIndex('by_grantId_decision', (q) => q.eq('grantId', grant._id).eq('decision', undefined))
			.order('desc')
			.take(API_V1_DELEGATION_PAGE_MAX + 1);

		return {
			...grant,
			actions: actions.slice(0, API_V1_DELEGATION_PAGE_MAX),
			actionsTruncated: actions.length > API_V1_DELEGATION_PAGE_MAX,
			reviewQueue: reviews.slice(0, API_V1_DELEGATION_PAGE_MAX),
			reviewQueueTruncated: reviews.length > API_V1_DELEGATION_PAGE_MAX
		};
	}
});

export const updateDelegationGrant = mutation({
	args: {
		_secret: v.string(),
		grantId: v.string(),
		userId: v.string(),
		data: v.object({
			status: v.optional(v.string()),
			maxActionsPerDay: v.optional(v.number()),
			requireReviewAbove: v.optional(v.number()),
			issueFilter: v.optional(v.array(v.string())),
			orgFilter: v.optional(v.array(v.string())),
			policyText: v.optional(v.string())
		})
	},
	handler: async (ctx, { _secret, grantId, userId, data }) => {
		requireInternalSecret(_secret);
		const normalizedGrantId = ctx.db.normalizeId('delegationGrants', grantId);
		if (!normalizedGrantId) return null;
		const grant = await ctx.db.get(normalizedGrantId);
		if (!grant) return null;
		if (String(grant.userId) !== userId) return { forbidden: true };
		if (grant.status === 'revoked') return { revoked: true };

		const updates: Record<string, unknown> = { updatedAt: Date.now() };
		if (data.status !== undefined) updates.status = data.status;
		if (data.maxActionsPerDay !== undefined) updates.maxActionsPerDay = data.maxActionsPerDay;
		if (data.requireReviewAbove !== undefined) updates.requireReviewAbove = data.requireReviewAbove;
		if (data.issueFilter !== undefined) updates.issueFilter = data.issueFilter;
		if (data.orgFilter !== undefined) updates.orgFilter = data.orgFilter;
		if (data.policyText !== undefined) updates.policyText = data.policyText;

		await ctx.db.patch(grant._id, updates);
		return await ctx.db.get(grant._id);
	}
});

export const submitDelegationReview = mutation({
	args: {
		_secret: v.string(),
		reviewId: v.string(),
		userId: v.string(),
		decision: v.string()
	},
	handler: async (ctx, { _secret, reviewId, userId, decision }) => {
		requireInternalSecret(_secret);
		const normalizedReviewId = ctx.db.normalizeId('delegationReviews', reviewId);
		if (!normalizedReviewId) return null;
		const review = await ctx.db.get(normalizedReviewId);
		if (!review) return null;

		const grant = await ctx.db.get(review.grantId);
		if (!grant || String(grant.userId) !== userId) return { forbidden: true };
		if (review.decision !== null && review.decision !== undefined) return { alreadyDecided: true };

		await ctx.db.patch(review._id, {
			decision,
			decidedAt: Date.now()
		});

		return { message: `Review ${decision}d` };
	}
});

// =============================================================================
// WEBHOOKS — outbound event subscriptions (T9-3, Cluster 3 Composability)
// =============================================================================

type WebhookTestDeliveryResult =
	| {
			error: null;
			deliveryId: Id<'orgWebhookDeliveries'>;
			event: 'webhook.test';
			queuedAt: number;
	  }
	| { error: 'not_found' | 'disabled' };

export const listWebhooks = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const page = await ctx.db
			.query('orgWebhooks')
			.withIndex('by_orgId', (q) => q.eq('orgId', args.orgId))
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_WEBHOOK_PAGE_SPLIT_REQUIRED');
		// Never return signingSecret/signingSecretPrevious to API consumers
		// after creation — the create endpoint returns it once, then it's
		// server-only. Listing returns the metadata + URL + events only.
		return {
			items: page.page.map(publicWebhook),
			cursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

export const createWebhook = mutation({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		url: v.string(),
		events: v.array(v.string()),
		description: v.optional(v.string())
	},
	handler: async (ctx, { _secret, orgId, url, events, description }) => {
		requireInternalSecret(_secret);
		const result = await createOrgWebhook(ctx, {
			orgId,
			url,
			events,
			description
		});
		if (result.error !== null) return result;
		return {
			error: null,
			webhook: { ...result.webhook, signingSecret: result.signingSecret }
		};
	}
});

export const getWebhook = query({
	args: { _secret: v.string(), orgId: v.id('organizations'), webhookId: v.string() },
	handler: async (ctx, { _secret, orgId, webhookId }) => {
		requireInternalSecret(_secret);
		const webhook = await getOwnedOrgWebhook(ctx, orgId, webhookId);
		return webhook ? publicWebhook(webhook) : null;
	}
});

export const updateWebhook = mutation({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		webhookId: v.string(),
		url: v.optional(v.string()),
		events: v.optional(v.array(v.string())),
		enabled: v.optional(v.boolean()),
		description: v.optional(v.string())
	},
	handler: async (ctx, { _secret, orgId, webhookId, url, events, enabled, description }) => {
		requireInternalSecret(_secret);
		return await updateOwnedOrgWebhook(ctx, {
			orgId,
			webhookId,
			url,
			events,
			enabled,
			description
		});
	}
});

// Rotate the signing secret. Moves current secret to signingSecretPrevious
// (rotation window) and generates a new active secret. Returns the new
// secret ONCE — caller must update their verifier config. Receivers can
// verify against either secret during the window; on next rotation the
// previous is dropped.
export const rotateWebhookSecret = mutation({
	args: { _secret: v.string(), orgId: v.id('organizations'), webhookId: v.string() },
	handler: async (ctx, { _secret, orgId, webhookId }) => {
		requireInternalSecret(_secret);
		return await rotateOwnedOrgWebhookSecret(ctx, orgId, webhookId);
	}
});

export const testWebhook = mutation({
	args: { _secret: v.string(), orgId: v.id('organizations'), webhookId: v.string() },
	handler: async (ctx, { _secret, orgId, webhookId }): Promise<WebhookTestDeliveryResult> => {
		requireInternalSecret(_secret);
		const h = await getOwnedOrgWebhook(ctx, orgId, webhookId);
		if (!h) return { error: 'not_found' as const };

		return (await ctx.runMutation(internal.orgWebhooks.enqueueTestDelivery, {
			orgId,
			webhookId: h._id,
			trigger: 'api'
		})) as WebhookTestDeliveryResult;
	}
});

export const deleteWebhook = mutation({
	args: { _secret: v.string(), orgId: v.id('organizations'), webhookId: v.string() },
	handler: async (ctx, { _secret, orgId, webhookId }) => {
		requireInternalSecret(_secret);
		return await deleteOwnedOrgWebhook(ctx, orgId, webhookId);
	}
});

// =============================================================================
// ACTIVITY FEED (T9-6) — public API surface mirroring the internal feed.
// =============================================================================

export const listActivityFeed = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		limit: v.number(),
		cursor: v.optional(v.string()),
		decisionMakerId: v.string(),
		activityType: v.union(v.literal('vote'), v.literal('sponsor'), v.literal('receipt'))
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		const decisionMakerId = ctx.db.normalizeId('decisionMakers', args.decisionMakerId);
		if (!decisionMakerId) return { invalidDecisionMakerId: true as const };
		const follow = await ctx.db
			.query('orgDmFollows')
			.withIndex('by_orgId_decisionMakerId', (q) =>
				q.eq('orgId', args.orgId).eq('decisionMakerId', decisionMakerId)
			)
			.unique();
		if (!follow) return { forbidden: true as const };

		if (args.activityType === 'receipt') {
			await requireAccountabilityReadModelReady(ctx);
			const page = await ctx.db
				.query('accountabilityReceiptProjections')
				.withIndex('by_orgId_decisionMakerId_proofDeliveredAt', (q) =>
					q.eq('orgId', args.orgId).eq('decisionMakerId', decisionMakerId)
				)
				.order('desc')
				.paginate(v1Pagination(args.limit, args.cursor));
			requireCompleteV1Page(page, 'V1_ACTIVITY_PAGE_SPLIT_REQUIRED');
			return {
				forbidden: false as const,
				items: page.page.map((receipt) => ({
					type: 'receipt' as const,
					id: receipt.receiptId,
					date: receipt.proofDeliveredAt,
					decisionMakerId: receipt.decisionMakerId,
					billId: receipt.billId,
					status: receipt.status,
					causalityClass: receipt.causalityClass,
					attestationDigest: receipt.attestationDigest
				})),
				nextCursor: page.isDone ? null : page.continueCursor,
				hasMore: !page.isDone,
				total: undefined,
				pageScanned: page.page.length
			};
		}

		const page = await ctx.db
			.query('legislativeActions')
			.withIndex('by_decisionMakerId_occurredAt', (q) => q.eq('decisionMakerId', decisionMakerId))
			.order('desc')
			.paginate(v1Pagination(args.limit, args.cursor));
		requireCompleteV1Page(page, 'V1_ACTIVITY_PAGE_SPLIT_REQUIRED');
		const items = page.page.flatMap((action) => {
			const isVote = action.action.startsWith('voted_') || action.action === 'abstained';
			const type: 'vote' | 'sponsor' = isVote ? 'vote' : 'sponsor';
			if (type !== args.activityType) return [];
			return [
				{
					type,
					id: action._id,
					date: action.occurredAt,
					decisionMakerId,
					billId: action.billId,
					value: action.action,
					detail: action.detail ?? null
				}
			];
		});
		return {
			forbidden: false as const,
			items,
			nextCursor: page.isDone ? null : page.continueCursor,
			hasMore: !page.isDone,
			total: undefined,
			pageScanned: page.page.length
		};
	}
});

/**
 * Poll the orgEvents stream for one org. Used by the SSE endpoint to fan out
 * new events to subscribers. Returns events strictly newer than the `since`
 * cursor (ms epoch). T9-7.
 */
export const pollOrgEvents = query({
	args: {
		_secret: v.string(),
		orgId: v.id('organizations'),
		sinceMs: v.number(),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		requireInternalSecret(args._secret);
		if (!Number.isFinite(args.sinceMs) || args.sinceMs < 0) {
			throw new Error('V1_EVENT_CURSOR_INVALID');
		}
		const limit = args.limit ?? API_V1_PAGE_MAX;
		normalizeV1PageSize(limit);
		const events = await ctx.db
			.query('orgEvents')
			.withIndex('by_orgId_emittedAt', (q) =>
				q.eq('orgId', args.orgId).gt('emittedAt', args.sinceMs)
			)
			.order('asc')
			.take(limit);
		return events.map((e) => ({
			id: e._id,
			event: e.event,
			payload: e.payload,
			emittedAt: e.emittedAt
		}));
	}
});
