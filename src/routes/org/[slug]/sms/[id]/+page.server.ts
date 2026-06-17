// CONVEX: Keep SvelteKit — SMS/Twilio integration
import { error, redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
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
	_creationTime: number;
	sentAt?: number | null;
};

type SmsMessage = {
	_id: string;
	recipientName: string | null;
	to: string;
	status: string;
	errorCode?: string | null;
	_creationTime: number;
};

type SmsReply = {
	_id: string;
	body: string;
	matchedSupporter: boolean;
	linkedBlastId?: string | null;
	receivedAt: number;
};

type SmsBlastDetail = {
	blast: SmsBlast;
	messages: SmsMessage[];
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

	const { org, spaces, membership } = await parent();
	const keyInfo =
		membership.role === 'owner' || membership.role === 'editor'
			? await serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug }).catch(() => null)
			: null;
	const [result, replies] = (await Promise.all([
		serverQuery(api.sms.getBlast, {
			slug: params.slug,
			blastId: params.id as Id<'smsBlasts'>
		}),
		serverQuery(api.sms.listReplies, {
			slug: params.slug,
			blastId: params.id as Id<'smsBlasts'>,
			limit: 20
		})
	])) as [SmsBlastDetail | null, SmsReply[]];

	if (!result) throw error(404, 'SMS draft not found');

	return {
		org: { id: org.id, name: org.name, slug: org.slug },
		orgKeyVerifier: keyInfo?.orgKeyVerifier ?? null,
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
		blast: {
			id: result.blast._id,
			body: result.blast.body,
			status: result.blast.status,
			sentCount: result.blast.sentCount,
			deliveredCount: result.blast.deliveredCount,
			failedCount: result.blast.failedCount,
			totalRecipients: result.blast.totalRecipients,
			createdAt: new Date(result.blast._creationTime).toISOString(),
			sentAt: result.blast.sentAt ? new Date(result.blast.sentAt).toISOString() : null
		},
		messages: result.messages.map((m) => ({
			id: m._id,
			recipientName: m.recipientName ?? 'Unknown',
			to: m.to,
			status: m.status,
			errorCode: m.errorCode ?? null,
			createdAt: new Date(m._creationTime).toISOString()
		})),
		replies: replies.map((reply) => ({
			id: reply._id,
			body: reply.body,
			matchedSupporter: reply.matchedSupporter,
			linkedBlastId: reply.linkedBlastId ?? null,
			receivedAt: new Date(reply.receivedAt).toISOString()
		}))
	};
};
