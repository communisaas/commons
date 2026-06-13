// CONVEX: Fully migrated — form actions use Convex tag mutations
import { fail, redirect } from '@sveltejs/kit';

import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { PeopleSegmentationGroundData } from '$lib/components/org/os/spaces';

import type { PageServerLoad, Actions } from './$types';

const PAGE_SIZE = 50;

type SupporterListResult = {
	supporters: Array<{
		_id: string;
		_creationTime: number;
		encryptedEmail?: string | null;
		emailHash?: string | null;
		encryptedName?: string | null;
		encryptedPhone?: string | null;
		postalCode?: string | null;
		stateCode?: string | null;
		congressionalDistrict?: string | null;
		country?: string | null;
		identityVerified?: boolean;
		verified?: boolean;
		emailStatus?: string;
		source?: string | null;
		tags?: Array<{ _id: string; name: string }>;
	}>;
	hasMore: boolean;
	nextCursor: string | null;
	truncated?: boolean;
	scanLimit?: number;
};

type CampaignListResult = {
	page: Array<{ _id: string; title: string }>;
};

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asNumberRecord(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object') return {};
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>(
		(record, [key, count]) => {
			if (typeof key === 'string' && typeof count === 'number' && Number.isFinite(count)) {
				record[key] = count;
			}
			return record;
		},
		{}
	);
}

function segmentConditionsFromFilters(filters: unknown): Record<string, unknown>[] {
	if (!filters || typeof filters !== 'object') return [];
	const conditions = (filters as { conditions?: unknown }).conditions;
	if (!Array.isArray(conditions)) return [];
	return conditions.filter(
		(condition): condition is Record<string, unknown> =>
			Boolean(condition) && typeof condition === 'object'
	);
}

function segmentConditionCount(
	conditions: Record<string, unknown>[],
	fields: readonly string[]
): number {
	const fieldSet = new Set(fields);
	return conditions.filter((condition) => fieldSet.has(asString(condition.field))).length;
}

function buildPeopleSegmentationGround(
	segments: Record<string, unknown>[]
): PeopleSegmentationGroundData {
	const conditions = segments.flatMap((segment) => segmentConditionsFromFilters(segment.filters));

	return {
		segmentCount: segments.length,
		conditionCount: conditions.length,
		tagConditionCount: segmentConditionCount(conditions, ['tag']),
		verificationConditionCount: segmentConditionCount(conditions, ['verification']),
		sourceConditionCount: segmentConditionCount(conditions, ['source']),
		emailStatusConditionCount: segmentConditionCount(conditions, ['emailStatus']),
		dateConditionCount: segmentConditionCount(conditions, ['dateRange']),
		postalCountryConditionCount: segmentConditionCount(conditions, ['postalCode', 'country']),
		stateCodeConditionCount: segmentConditionCount(conditions, ['stateCode']),
		congressionalDistrictConditionCount: segmentConditionCount(conditions, [
			'congressionalDistrict'
		]),
		campaignParticipationConditionCount: segmentConditionCount(conditions, [
			'campaignParticipation'
		]),
		actionDistrictHashConditionCount: segmentConditionCount(conditions, ['actionDistrict']),
		actionDistrictLabelConditionCount: segmentConditionCount(conditions, ['actionDistrictLabel']),
		engagementTierConditionCount: segmentConditionCount(conditions, ['engagementTier']),
		humanReadableGeographyConditionCount: segmentConditionCount(conditions, [
			'state',
			'stateCode',
			'district',
			'congressionalDistrict',
			'actionDistrictLabel',
			'stateLegislativeDistrict',
			'localDistrict',
			'specialDistrict',
			'civicGeography'
		])
	};
}

function tagActionError(error: unknown, fallback: string): string {
	const message = error instanceof Error ? error.message : '';
	if (message.includes('TAG_NAME_EXISTS')) return 'A tag with this name already exists.';
	if (message.includes('TAG_NAME_REQUIRED')) return 'Tag name is required.';
	if (message.includes('TAG_NAME_TOO_LONG')) return 'Tag names must be 48 characters or fewer.';
	if (message.includes('TAG_NOT_FOUND')) return 'Tag not found.';
	if (message.includes('Unauthorized') || message.includes('Forbidden')) {
		return 'You need editor access to manage tags.';
	}
	return fallback;
}

export const load: PageServerLoad = async ({ parent, url }) => {
	const { org, membership } = await parent();

	// Parse filter params. Free-text search is client-side (PII is org-key
	// encrypted; the server cannot match against it), so no text param here.
	const status = url.searchParams.get('status') || '';
	const verified = url.searchParams.get('verified') || '';
	const tagId = url.searchParams.get('tag') || '';
	const source = url.searchParams.get('source') || '';
	const cursor = url.searchParams.get('cursor') || '';
	const filters = { status, verified, tagId, source };

	const convexFilters: Record<string, unknown> = {};
	if (status && ['subscribed', 'unsubscribed', 'bounced', 'complained'].includes(status)) {
		convexFilters.emailStatus = status;
	}
	if (verified === 'true') convexFilters.verified = true;
	else if (verified === 'false') convexFilters.verified = false;
	if (source && source.length <= 50) {
		convexFilters.source = source;
	}
	if (tagId) {
		convexFilters.tagId = tagId;
	}

	// Load encryption verifier for client-side PII decryption
	const isEditor = membership.role === 'owner' || membership.role === 'editor';
	const keyInfo = isEditor
		? await serverQuery(api.organizations.getOrgKeyVerifier, { slug: org.slug })
		: { orgKeyVerifier: null };

	const [convexResult, summaryStats, districtVerifiedResult, tags, campaigns, segmentsResult] =
		await Promise.all([
			serverQuery(api.supporters.list, {
				orgSlug: org.slug,
				paginationOpts: { cursor: cursor || null, numItems: PAGE_SIZE },
				filters: Object.keys(convexFilters).length > 0 ? convexFilters : undefined
			}) as Promise<SupporterListResult>,
			serverQuery(api.supporters.getSummaryStats, { orgSlug: org.slug }),
			// District-of-record is set cardinality — served by a separate
			// bounded query, not the always-on funnel summary.
			serverQuery(api.supporters.getDistrictVerifiedCount, { orgSlug: org.slug }).catch(() => null),
			serverQuery(api.supporters.getTags, { orgSlug: org.slug }),
			serverQuery(api.campaigns.list, {
				slug: org.slug,
				paginationOpts: { cursor: null, numItems: 100 }
			}) as Promise<CampaignListResult>,
			serverQuery(api.segments.list, { slug: org.slug }).catch(() => null)
		]);

	// Pass encrypted blobs through — client decrypts with org key
	const supporters = convexResult.supporters.map((s) => ({
		id: s._id,
		encryptedEmail: s.encryptedEmail ?? null,
		emailHash: isEditor ? (s.emailHash ?? null) : null,
		encryptedName: s.encryptedName ?? null,
		encryptedPhone: s.encryptedPhone ?? null,
		postalCode: s.postalCode ?? null,
		stateCode: s.stateCode ?? null,
		congressionalDistrict: s.congressionalDistrict ?? null,
		country: s.country ?? null,
		identityVerified: s.identityVerified ?? false,
		verified: s.verified ?? false,
		emailStatus: s.emailStatus ?? 'subscribed',
		source: s.source ?? null,
		createdAt: new Date(s._creationTime).toISOString(),
		tags: (s.tags ?? []).map((t) => ({
			id: t._id,
			name: t.name
		}))
	}));

	return {
		supporters,
		total: summaryStats.total,
		hasMore: convexResult.hasMore,
		nextCursor: convexResult.nextCursor,
		// When the org exceeds the per-query scan cap, the list reflects only the
		// most recent `scanLimit` rows — surface it so the page can say so.
		scanCapped: convexResult.truncated ?? false,
		scanLimit: convexResult.scanLimit ?? null,
		tags: (tags ?? []).map((t: Record<string, unknown>) => ({
			id: t._id ?? t.id,
			name: t.name,
			supporterCount: t.supporterCount ?? 0
		})),
		campaigns: campaigns.page.map((c) => ({ id: c._id, title: c.title })),
		summary: {
			verified: summaryStats.identityVerified,
			postal: summaryStats.postalResolved,
			district: districtVerifiedResult?.districtVerified ?? 0,
			imported: summaryStats.imported
		},
		emailHealth: summaryStats.emailHealth,
		consentEvidence: summaryStats.consentEvidence,
		sourceCounts: asNumberRecord(summaryStats.sourceCounts),
		segmentation: Array.isArray(segmentsResult?.segments)
			? buildPeopleSegmentationGround(segmentsResult.segments as Record<string, unknown>[])
			: null,
		encryption: { orgKeyVerifier: keyInfo.orgKeyVerifier },
		filters
	};
};

export const actions: Actions = {
	createTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}

		const formData = await request.formData();
		const name = formData.get('name')?.toString()?.trim();

		if (!name) {
			return fail(400, { error: 'Tag name is required', action: 'createTag' });
		}

		const org = await serverQuery(api.organizations.getBySlug, { slug: params.slug });
		if (!org) {
			return fail(404, { error: 'Organization not found', action: 'createTag' });
		}

		try {
			await serverMutation(api.supporters.createTag, { orgSlug: params.slug, name });
			return { action: 'createTag' };
		} catch (error) {
			return fail(400, {
				error: tagActionError(error, 'Failed to create tag'),
				action: 'createTag'
			});
		}
	},

	renameTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();
		const name = formData.get('name')?.toString()?.trim();

		if (!tagId || !name) {
			return fail(400, { error: 'Tag ID and name are required', action: 'renameTag' });
		}

		const org = await serverQuery(api.organizations.getBySlug, { slug: params.slug });
		if (!org) {
			return fail(404, { error: 'Organization not found', action: 'renameTag' });
		}

		try {
			await serverMutation(api.supporters.renameTag, {
				orgSlug: params.slug,
				tagId: tagId as Id<'tags'>,
				name
			});
			return { action: 'renameTag' };
		} catch (error) {
			return fail(400, {
				error: tagActionError(error, 'Failed to rename tag'),
				action: 'renameTag'
			});
		}
	},

	deleteTag: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/supporters`);
		}

		const formData = await request.formData();
		const tagId = formData.get('tagId')?.toString();

		if (!tagId) {
			return fail(400, { error: 'Tag ID is required', action: 'deleteTag' });
		}

		const org = await serverQuery(api.organizations.getBySlug, { slug: params.slug });
		if (!org) {
			return fail(404, { error: 'Organization not found', action: 'deleteTag' });
		}

		try {
			await serverMutation(api.supporters.deleteTag, {
				orgSlug: params.slug,
				tagId: tagId as Id<'tags'>
			});
			return { action: 'deleteTag' };
		} catch (error) {
			return fail(400, {
				error: tagActionError(error, 'Failed to delete tag'),
				action: 'deleteTag'
			});
		}
	}
};
