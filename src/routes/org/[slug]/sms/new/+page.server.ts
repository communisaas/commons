// CONVEX: Keep SvelteKit — SMS/Twilio integration
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { Id } from '$convex/_generated/dataModel';
import type { PageServerLoad } from './$types';

type CampaignOption = {
	_id: string;
	title: string;
};

type CampaignPage = {
	page: CampaignOption[];
};

type TagOption = {
	_id?: string;
	id?: string;
	name?: string;
};

type SegmentList = {
	segments?: Array<{
		_id?: string;
		id?: string;
		name?: string;
	}>;
};

type AudienceCountResult = {
	eligibleCount: number;
	batchLimit: number;
	hasMoreThanBatchLimit: boolean;
};

const EMPTY_SMS_HEALTH = {
	subscribed: 0,
	unsubscribed: 0,
	stopped: 0,
	none: 0,
	phonePresent: 0
};
const EMPTY_CONSENT_EVIDENCE = {
	email: 0,
	emailSubscribed: 0,
	sms: 0,
	smsSubscribed: 0
};

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function canEdit(role: string): boolean {
	return role === 'owner' || role === 'editor';
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const { org, spaces, membership } = await parent();
	const canShapeAudience = canEdit(membership.role);
	const [campaigns, tags, segments, initialAudience] = (await Promise.all([
		serverQuery(api.campaigns.list, {
			slug: params.slug,
			paginationOpts: { numItems: 100, cursor: null }
		}),
		serverQuery(api.supporters.getTags, { orgSlug: params.slug }),
		serverQuery(api.segments.list, { slug: params.slug }),
		canShapeAudience
			? serverQuery(api.sms.countEligibleRecipientsForFilter, {
					slug: params.slug,
					recipientFilter: undefined
				}).catch(() => null)
			: Promise.resolve(null)
	])) as [CampaignPage, TagOption[], SegmentList, AudienceCountResult | null];

	return {
		org: { name: org.name, slug: org.slug },
		smsHealth: spaces.base?.smsHealth ?? EMPTY_SMS_HEALTH,
		consentEvidence: spaces.base?.consentEvidence ?? EMPTY_CONSENT_EVIDENCE,
		textDispatchRuntimeReady: spaces.operating.textDelivery?.dispatchRuntimeReady ?? false,
		textDispatchRuntimeMissing: spaces.operating.textDelivery?.dispatchRuntimeMissing ?? [],
		textDispatchRuntimeDependency:
			spaces.operating.textDelivery?.dispatchRuntimeDependency ??
			'text dispatch gate, browser phone custody, Twilio dispatch runner, and transport credentials',
		textDispatchRuntimeMessage:
			spaces.operating.textDelivery?.dispatchRuntimeMessage ??
			'Bulk text dispatch is dependency-bound. Drafts are preserved until carrier delivery dependencies are configured.',
		textDispatchClientBatchRouteMounted:
			spaces.operating.textDelivery?.dispatchClientBatchRouteMounted ?? false,
		initialAudienceCount: initialAudience?.eligibleCount ?? 0,
		initialAudienceBatchLimit: initialAudience?.batchLimit ?? 100,
		initialAudienceHasMoreThanBatchLimit: initialAudience?.hasMoreThanBatchLimit ?? false,
		tags: (tags ?? []).map((tag) => ({
			id: asString(tag._id ?? tag.id) as Id<'tags'>,
			name: asString(tag.name, 'Untitled tag')
		})),
		segments: (segments?.segments ?? []).map((segment) => ({
			id: asString(segment._id ?? segment.id) as Id<'segments'>,
			name: asString(segment.name, 'Untitled segment')
		})),
		campaigns: campaigns.page.map((c) => ({ id: c._id, title: c.title }))
	};
};
