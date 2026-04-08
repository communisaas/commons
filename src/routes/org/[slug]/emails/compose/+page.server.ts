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

interface RecipientFilter {
	tagIds?: string[];
	verified?: 'any' | 'verified' | 'unverified';
}

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org } = await parent();

	const [convexCampaigns, convexSupporterStats, convexTags, sub, orgKeyResult] = await Promise.all([
		serverQuery(api.campaigns.list, {
			slug: params.slug,
			paginationOpts: { numItems: 50, cursor: null }
		}),
		serverQuery(api.supporters.getSummaryStats, { orgSlug: params.slug }),
		serverQuery(api.supporters.getTags, { orgSlug: params.slug }),
		serverQuery(api.subscriptions.getByOrg, { slug: params.slug }),
		serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug })
	]);

	// A/B testing allowed if org has starter+ plan
	const abTestingAllowed = FEATURES.AB_TESTING && (sub?.plan !== 'free');

	return {
		campaigns: convexCampaigns.page.map((c: Record<string, unknown>) => ({
			id: c._id,
			title: c.title,
			status: c.status
		})),
		tags: (convexTags ?? []).map((t: Record<string, unknown>) => ({ id: t._id ?? t.id, name: t.name })),
		subscribedCount: convexSupporterStats.emailHealth?.subscribed ?? 0,
		abTestingAllowed,
		orgKeyVerifier: orgKeyResult?.orgKeyVerifier ?? null
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
	count: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const countLimit = await getRateLimiter().check(`ratelimit:compose:count:org:${ctx.org._id}`, {
			maxRequests: 30,
			windowMs: 60_000
		});
		if (!countLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		const formData = await request.formData();
		const filter = parseFilter(formData);
		const count = await serverQuery(api.supporters.countByFilter, {
			orgSlug: params.slug,
			filter
		});

		return { count };
	},

	preview: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const previewLimit = await getRateLimiter().check(`ratelimit:compose:preview:org:${ctx.org._id}`, {
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

	send: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const sendLimit = await getRateLimiter().check(`ratelimit:compose:send:org:${ctx.org._id}`, {
			maxRequests: 5,
			windowMs: 60 * 60_000
		});
		if (!sendLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		// Billing usage check via Convex
		const limits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug });
		if (limits?.current && (limits.current as any).emailsSent >= (limits.limits as any).maxEmails) {
			return fail(403, { error: 'Email send limit reached for the current billing period. Upgrade your plan to send more.' });
		}

		const formData = await request.formData();
		const rawSubject = formData.get('subject')?.toString().trim();
		const subject = rawSubject?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const rawBodyHtml = formData.get('bodyHtml')?.toString();
		const rawFromName = formData.get('fromName')?.toString().trim() || ctx.org.name;
		const fromName = rawFromName.replace(/[\x00-\x1f\x7f<>"]/g, '').slice(0, 64);
		if (!fromName) {
			return fail(400, { error: 'From name is required' });
		}
		const fromEmail = `${ctx.org.slug}@commons.email`;
		const campaignId = formData.get('campaignId')?.toString() || null;

		if (!subject) {
			return fail(400, { error: 'Subject is required' });
		}
		if (!rawBodyHtml) {
			return fail(400, { error: 'Email body is required' });
		}
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		// Validate campaignId via Convex
		if (campaignId) {
			const campaign = await serverQuery(api.campaigns.get, {
				campaignId: campaignId as any
			});
			if (!campaign) {
				return fail(400, { error: 'Invalid campaign selection' });
			}
		}

		const filter = parseFilter(formData);

		// Count recipients via Convex
		const recipientCount = await serverQuery(api.supporters.countByFilter, {
			orgSlug: params.slug,
			filter
		});
		if (recipientCount === 0) {
			return fail(400, { error: 'No recipients match your filters. Adjust filters and try again.' });
		}

		// Create and send blast via Convex
		await serverMutation(api.email.createBlast, {
			orgSlug: params.slug,
			subject,
			bodyHtml,
			fromName,
			fromEmail,
			recipientFilter: filter,
			campaignId: campaignId ?? undefined
		});

		throw redirect(302, `/org/${params.slug}/emails`);
	},

	sendAbTest: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		// Check plan via Convex
		const sub = await serverQuery(api.subscriptions.getByOrg, { slug: params.slug });
		if (!FEATURES.AB_TESTING || sub?.plan === 'free') {
			return fail(403, { error: 'A/B testing requires a Starter plan or above.' });
		}

		const sendLimit = await getRateLimiter().check(`ratelimit:compose:send:org:${ctx.org._id}`, {
			maxRequests: 5,
			windowMs: 60 * 60_000
		});
		if (!sendLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		// Billing usage check via Convex
		const abLimits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug });
		if (abLimits?.current && (abLimits.current as any).emailsSent >= (abLimits.limits as any).maxEmails) {
			return fail(403, { error: 'Email send limit reached for the current billing period. Upgrade your plan to send more.' });
		}

		const formData = await request.formData();
		const subjectA = formData.get('subjectA')?.toString().trim()?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const subjectB = formData.get('subjectB')?.toString().trim()?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const rawBodyHtmlA = formData.get('bodyHtmlA')?.toString();
		const rawBodyHtmlB = formData.get('bodyHtmlB')?.toString();
		const rawFromName = formData.get('fromName')?.toString().trim() || ctx.org.name;
		const fromName = rawFromName.replace(/[\x00-\x1f\x7f<>"]/g, '').slice(0, 64);
		if (!fromName) return fail(400, { error: 'From name is required' });
		const fromEmail = `${ctx.org.slug}@commons.email`;
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

		// Validate campaignId via Convex
		if (campaignId) {
			const campaign = await serverQuery(api.campaigns.get, {
				campaignId: campaignId as any
			});
			if (!campaign) return fail(400, { error: 'Invalid campaign selection' });
		}

		const filter = parseFilter(formData);
		const abParentId = crypto.randomUUID();
		const abTestConfig = { splitPct, winnerMetric, testDurationMs, testGroupPct };

		// Create A/B test blasts via Convex (recipient splitting handled server-side)
		await serverMutation(api.email.createAbTestBlasts, {
			orgSlug: params.slug,
			subjectA,
			subjectB,
			bodyHtmlA,
			bodyHtmlB,
			fromName,
			fromEmail,
			recipientFilter: filter,
			campaignId: campaignId ?? undefined,
			abParentId,
			abTestConfig
		});

		throw redirect(302, `/org/${params.slug}/emails`);
	},

	createClientDraft: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const sendLimit = await getRateLimiter().check(`ratelimit:compose:send:org:${ctx.org._id}`, {
			maxRequests: 5,
			windowMs: 60 * 60_000
		});
		if (!sendLimit.allowed) {
			return fail(429, { error: 'Too many requests. Try again later.' });
		}

		const limits = await serverQuery(api.subscriptions.checkPlanLimits, { orgSlug: params.slug });
		if (limits?.current && (limits.current as any).emailsSent >= (limits.limits as any).maxEmails) {
			return fail(403, { error: 'Email send limit reached for the current billing period. Upgrade your plan to send more.' });
		}

		const formData = await request.formData();
		const rawSubject = formData.get('subject')?.toString().trim();
		const subject = rawSubject?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const rawBodyHtml = formData.get('bodyHtml')?.toString();
		const rawFromName = formData.get('fromName')?.toString().trim() || ctx.org.name;
		const fromName = rawFromName.replace(/[\x00-\x1f\x7f<>"]/g, '').slice(0, 64);
		if (!fromName) return fail(400, { error: 'From name is required' });
		const fromEmail = `${ctx.org.slug}@commons.email`;
		const campaignId = formData.get('campaignId')?.toString() || null;

		if (!subject) return fail(400, { error: 'Subject is required' });
		if (!rawBodyHtml) return fail(400, { error: 'Email body is required' });
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		if (campaignId) {
			const campaign = await serverQuery(api.campaigns.get, { campaignId: campaignId as any });
			if (!campaign) return fail(400, { error: 'Invalid campaign selection' });
		}

		// Create blast record as draft with client-direct send mode
		const result = await serverMutation(api.email.createBlast, {
			orgSlug: params.slug,
			subject,
			bodyHtml,
			fromName,
			fromEmail,
			sendMode: 'client-direct',
			recipientFilter: parseFilter(formData),
			campaignId: campaignId ?? undefined
		});

		return {
			blastId: result.id,
			orgId: ctx.org._id,
			fromEmail,
			fromName,
			subject,
			bodyHtml
		};
	}
};
