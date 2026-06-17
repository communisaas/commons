// CONVEX: Keep SvelteKit — SMS/Twilio integration
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad } from './$types';

type SmsBlast = {
	_id: string;
	body: string;
	status: string;
	sentCount: number;
	deliveredCount: number;
	failedCount: number;
	totalRecipients: number;
	messageCount: number;
	_creationTime: number;
	sentAt?: number | null;
};

type SmsReplySummary = {
	replyCount: number;
	matchedSupporterCount: number;
	linkedBlastCount: number;
	latestReceivedAt?: number | null;
};

type SmsReply = {
	_id: string;
	body: string;
	matchedSupporter: boolean;
	linkedBlastId?: string | null;
	receivedAt: number;
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

export const load: PageServerLoad = async ({ params, locals, parent }) => {
	if (!FEATURES.SMS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const { org, spaces } = await parent();
	const [blasts, replySummary, recentReplies] = (await Promise.all([
		serverQuery(api.sms.listBlasts, { slug: params.slug }),
		serverQuery(api.sms.getReplySummary, { slug: params.slug }),
		serverQuery(api.sms.listReplies, { slug: params.slug, limit: 6 })
	])) as [SmsBlast[], SmsReplySummary, SmsReply[]];

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
		replySummary: {
			replyCount: replySummary.replyCount,
			matchedSupporterCount: replySummary.matchedSupporterCount,
			linkedBlastCount: replySummary.linkedBlastCount,
			latestReceivedAt: replySummary.latestReceivedAt
				? new Date(replySummary.latestReceivedAt).toISOString()
				: null
		},
		recentReplies: recentReplies.map((reply) => ({
			id: reply._id,
			body: reply.body,
			matchedSupporter: reply.matchedSupporter,
			linkedBlastId: reply.linkedBlastId ?? null,
			receivedAt: new Date(reply.receivedAt).toISOString()
		})),
		blasts: blasts.map((b) => ({
			id: b._id,
			body: b.body,
			status: b.status,
			sentCount: b.sentCount,
			deliveredCount: b.deliveredCount,
			failedCount: b.failedCount,
			totalRecipients: b.totalRecipients,
			messageCount: b.messageCount,
			createdAt: new Date(b._creationTime).toISOString(),
			sentAt: b.sentAt ? new Date(b.sentAt).toISOString() : null
		}))
	};
};
