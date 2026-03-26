// CONVEX: Keep SvelteKit — partially migrated, Prisma retained for: buildSegmentWhere, SES engine, pgvector, Groq/Gemini APIs
// CONVEX: Load migrated. Form actions partially migrated — blast creation uses Convex mutations.
// KEEP: countRecipients, resolveRecipients, sendBlast, compileEmail, sanitizeEmailBody (SvelteKit server modules)
// KEEP: db import for campaignId validation (campaignId is Prisma string ID, not Convex ID)
import { fail, redirect } from '@sveltejs/kit';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import {
	compileEmail,
	buildTierContext,
	type MergeContext,
	type VerificationBlock
} from '$lib/server/email/compiler';
import { sanitizeEmailBody } from '$lib/server/email/sanitize';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad, Actions } from './$types';

import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org } = await parent();

	const [convexCampaigns, convexSupporterStats, convexTags] = await Promise.all([
		serverQuery(api.campaigns.list, {
			slug: params.slug,
			paginationOpts: { numItems: 50, cursor: null }
		}),
		serverQuery(api.supporters.getSummaryStats, { orgSlug: params.slug }),
		serverQuery(api.supporters.getTags, { orgSlug: params.slug })
	]);

	// A/B testing still needs Prisma billing check
	const abTestingAllowed = FEATURES.AB_TESTING && await orgMeetsPlan(org.id, 'starter');

	return {
		campaigns: convexCampaigns.page.map((c: Record<string, unknown>) => ({
			id: c._id,
			title: c.title,
			status: c.status
		})),
		tags: (convexTags ?? []).map((t: Record<string, unknown>) => ({ id: t._id ?? t.id, name: t.name })),
		subscribedCount: convexSupporterStats.emailHealth?.subscribed ?? 0,
		abTestingAllowed
	};
};

function parseFilter(formData: FormData): RecipientFilter {
	const tagIds = formData.getAll('tagIds').map(String).filter(Boolean);
	const verified = formData.get('verified')?.toString() || 'any';
	return {
		tagIds: tagIds.length > 0 ? tagIds : undefined,
		verified: verified as 'any' | 'verified' | 'unverified'
	};
}

export const actions: Actions = {
	// KEEP: countRecipients uses buildSegmentWhere (Prisma query builder)
	count: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const countLimit = await getRateLimiter().check(`ratelimit:compose:count:org:${org.id}`, {
			maxRequests: 30,
			windowMs: 60_000
		});
		if (!countLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		const formData = await request.formData();
		const filter = parseFilter(formData);
		const count = await countRecipients(org.id, filter);

		return { count };
	},

	preview: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const previewLimit = await getRateLimiter().check(`ratelimit:compose:preview:org:${org.id}`, {
			maxRequests: 20,
			windowMs: 60_000
		});
		if (!previewLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		const formData = await request.formData();
		const subject = formData.get('subject')?.toString().trim() || '(No subject)';
		const rawBodyHtml = formData.get('bodyHtml')?.toString() || '';
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		const sampleMerge: MergeContext = {
			firstName: 'Jane',
			lastName: 'Doe',
			email: 'jane@example.com',
			postalCode: '90210',
			verificationStatus: 'verified',
			tierLabel: 'Established',
			tierContext: buildTierContext('verified')
		};

		const sampleVerification: VerificationBlock = {
			totalRecipients: 150,
			verifiedCount: 45,
			verifiedPct: 30,
			districtCount: 8,
			tierSummary: '3 Pillars, 12 Veterans, 30 Established'
		};

		const compiledHtml = compileEmail(bodyHtml, sampleMerge, sampleVerification, 'https://commons.email/unsubscribe/sample/token');

		return { previewHtml: compiledHtml, previewSubject: subject };
	},

	send: async ({ request, params, locals, platform }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		const sendLimit = await getRateLimiter().check(`ratelimit:compose:send:org:${org.id}`, {
			maxRequests: 5,
			windowMs: 60 * 60_000
		});
		if (!sendLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		// Billing usage check — enforce email send limits
		const usage = await getOrgUsage(org.id);
		if (isOverLimit(usage).emails) {
			return fail(403, { error: 'Email send limit reached for the current billing period. Upgrade your plan to send more.' });
		}

		const formData = await request.formData();
		const rawSubject = formData.get('subject')?.toString().trim();
		const subject = rawSubject?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const rawBodyHtml = formData.get('bodyHtml')?.toString();
		const rawFromName = formData.get('fromName')?.toString().trim() || org.name;
		const fromName = rawFromName.replace(/[\x00-\x1f\x7f<>"]/g, '').slice(0, 64);
		if (!fromName) {
			return fail(400, { error: 'From name is required' });
		}
		const fromEmail = `${org.slug}@commons.email`;
		const campaignId = formData.get('campaignId')?.toString() || null;

		if (!subject) {
			return fail(400, { error: 'Subject is required' });
		}
		if (!rawBodyHtml) {
			return fail(400, { error: 'Email body is required' });
		}
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		// KEEP: campaignId validation uses Prisma (campaignId is Prisma string ID)
		if (campaignId) {
			const campaign = await db.campaign.findFirst({
				where: { id: campaignId, orgId: org.id }
			});
			if (!campaign) {
				return fail(400, { error: 'Invalid campaign selection' });
			}
		}

		const filter = parseFilter(formData);

		// KEEP: countRecipients uses buildSegmentWhere (Prisma query builder)
		const recipientCount = await countRecipients(org.id, filter);
		if (recipientCount === 0) {
			return fail(400, { error: 'No recipients match your filters. Adjust filters and try again.' });
		}

		// Create blast via Convex
		const blastResult = await serverMutation(api.email.createBlast, {
			orgSlug: params.slug,
			subject,
			bodyHtml,
			fromName,
			fromEmail,
			recipientFilter: filter,
			campaignId: campaignId ?? undefined
		});

		// KEEP: sendBlast uses SES engine (SvelteKit server module)
		const blastPromise = sendBlast(blastResult.id).catch((err) => {
			console.error(`[email-engine] Blast ${blastResult.id} async error:`, err);
		});
		if (platform?.context?.waitUntil) {
			platform.context.waitUntil(blastPromise);
		} else {
			await blastPromise;
		}

		throw redirect(302, `/org/${params.slug}/emails`);
	},

	sendAbTest: async ({ request, params, locals, platform }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const { org, membership } = await loadOrgContext(params.slug, locals.user.id);
		requireRole(membership.role, 'editor');

		if (!FEATURES.AB_TESTING || !(await orgMeetsPlan(org.id, 'starter'))) {
			return fail(403, { error: 'A/B testing requires a Starter plan or above.' });
		}

		const sendLimit = await getRateLimiter().check(`ratelimit:compose:send:org:${org.id}`, {
			maxRequests: 5,
			windowMs: 60 * 60_000
		});
		if (!sendLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		// Billing usage check — enforce email send limits
		const abUsage = await getOrgUsage(org.id);
		if (isOverLimit(abUsage).emails) {
			return fail(403, { error: 'Email send limit reached for the current billing period. Upgrade your plan to send more.' });
		}

		const formData = await request.formData();
		const subjectA = formData.get('subjectA')?.toString().trim()?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const subjectB = formData.get('subjectB')?.toString().trim()?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const rawBodyHtmlA = formData.get('bodyHtmlA')?.toString();
		const rawBodyHtmlB = formData.get('bodyHtmlB')?.toString();
		const rawFromName = formData.get('fromName')?.toString().trim() || org.name;
		const fromName = rawFromName.replace(/[\x00-\x1f\x7f<>"]/g, '').slice(0, 64);
		if (!fromName) return fail(400, { error: 'From name is required' });
		const fromEmail = `${org.slug}@commons.email`;
		const campaignId = formData.get('campaignId')?.toString() || null;

		if (!subjectA || !subjectB) return fail(400, { error: 'Both variant subjects are required' });
		if (!rawBodyHtmlA || !rawBodyHtmlB) return fail(400, { error: 'Both variant bodies are required' });

		const bodyHtmlA = sanitizeEmailBody(rawBodyHtmlA);
		const bodyHtmlB = sanitizeEmailBody(rawBodyHtmlB);

		const splitPct = Math.max(10, Math.min(90, parseInt(formData.get('splitPct')?.toString() || '50')));
		const testGroupPct = Math.max(10, Math.min(50, parseInt(formData.get('testGroupPct')?.toString() || '20')));
		const winnerMetric = (['open', 'click', 'verified_action'].includes(formData.get('winnerMetric')?.toString() || '')
			? formData.get('winnerMetric')!.toString()
			: 'open') as 'open' | 'click' | 'verified_action';

		const durationMap: Record<string, number> = {
			'1h': 60 * 60 * 1000,
			'4h': 4 * 60 * 60 * 1000,
			'24h': 24 * 60 * 60 * 1000
		};
		const testDuration = formData.get('testDuration')?.toString() || '4h';
		const testDurationMs = durationMap[testDuration] ?? durationMap['4h'];

		// KEEP: campaignId validation uses Prisma (campaignId is Prisma string ID)
		if (campaignId) {
			const campaign = await db.campaign.findFirst({
				where: { id: campaignId, orgId: org.id }
			});
			if (!campaign) return fail(400, { error: 'Invalid campaign selection' });
		}

		const filter = parseFilter(formData);

		// KEEP: resolveRecipients uses buildSegmentWhere + PII decryption (Prisma)
		const allRecipients = await resolveRecipients(org.id, filter);
		if (allRecipients.length === 0) {
			return fail(400, { error: 'No recipients match your filters.' });
		}

		// Shuffle recipients for random assignment
		const shuffled = [...allRecipients];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}

		const testGroupSize = Math.max(2, Math.round(shuffled.length * (testGroupPct / 100)));
		const testGroup = shuffled.slice(0, testGroupSize);
		const splitPoint = Math.round(testGroup.length * (splitPct / 100));
		const groupA = testGroup.slice(0, splitPoint);
		const groupB = testGroup.slice(splitPoint);

		if (groupA.length === 0 || groupB.length === 0) {
			return fail(400, { error: 'Not enough recipients for an A/B test. Need at least 2 per variant.' });
		}

		const abParentId = crypto.randomUUID();
		const abTestConfig = { splitPct, winnerMetric, testDurationMs, testGroupPct };

		// Create variant A blast via Convex
		const blastAResult = await serverMutation(api.email.createBlast, {
			orgSlug: params.slug,
			subject: subjectA,
			bodyHtml: bodyHtmlA,
			fromName,
			fromEmail,
			recipientFilter: { ...filter, testRecipientIds: groupA.map((r) => r.id) },
			campaignId: campaignId ?? undefined,
			isAbTest: true,
			abVariant: 'A',
			abParentId,
			abTestConfig
		});

		// Create variant B blast via Convex
		const blastBResult = await serverMutation(api.email.createBlast, {
			orgSlug: params.slug,
			subject: subjectB,
			bodyHtml: bodyHtmlB,
			fromName,
			fromEmail,
			recipientFilter: { ...filter, testRecipientIds: groupB.map((r) => r.id) },
			campaignId: campaignId ?? undefined,
			isAbTest: true,
			abVariant: 'B',
			abParentId,
			abTestConfig
		});

		// KEEP: sendBlast uses SES engine (SvelteKit server module)
		const sendPromise = Promise.all([
			sendBlast(blastAResult.id),
			sendBlast(blastBResult.id)
		]).catch((err) => {
			console.error(`[email-engine] A/B test ${abParentId} send error:`, err);
		});

		if (platform?.context?.waitUntil) {
			platform.context.waitUntil(sendPromise);
		} else {
			await sendPromise;
		}

		throw redirect(302, `/org/${params.slug}/emails`);
	}
};
