// Note: form actions (send/preview/A/B test) stay Prisma — SES engine, billing, rate limiting
import { fail, redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { loadOrgContext, requireRole } from '$lib/server/org';
import { countRecipients, resolveRecipients, sendBlast, type RecipientFilter } from '$lib/server/email/engine';
import {
	compileEmail,
	buildTierContext,
	type MergeContext,
	type VerificationBlock
} from '$lib/server/email/compiler';
import { sanitizeEmailBody } from '$lib/server/email/sanitize';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { orgMeetsPlan } from '$lib/server/billing/plan-check';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';
import { FEATURES } from '$lib/config/features';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import type { PageServerLoad, Actions } from './$types';

// Convex dual-stack imports
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org } = await parent();

	// ─── DUAL-STACK: Try Convex first ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const [convexCampaigns, convexSupporterStats] = await Promise.all([
				serverQuery(api.campaigns.list, {
					slug: params.slug,
					paginationOpts: { numItems: 50, cursor: null }
				}),
				serverQuery(api.supporters.getSummaryStats, { orgSlug: params.slug })
			]);

			// A/B testing still needs Prisma billing check
			const abTestingAllowed = FEATURES.AB_TESTING && await orgMeetsPlan(org.id, 'starter');

			// Tags still from Prisma (no Convex tags query yet)
			const tags = await db.tag.findMany({
				where: { orgId: org.id },
				select: { id: true, name: true },
				orderBy: { name: 'asc' }
			});

			return {
				campaigns: convexCampaigns.page.map((c: Record<string, unknown>) => ({
					id: c._id,
					title: c.title,
					status: c.status
				})),
				tags,
				subscribedCount: convexSupporterStats.emailHealth?.subscribed ?? 0,
				abTestingAllowed
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[EmailCompose] Convex load failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	const [campaigns, tags, subscribedCount] = await Promise.all([
		db.campaign.findMany({
			where: { orgId: org.id },
			select: { id: true, title: true, status: true },
			orderBy: { updatedAt: 'desc' }
		}),
		db.tag.findMany({
			where: { orgId: org.id },
			select: { id: true, name: true },
			orderBy: { name: 'asc' }
		}),
		db.supporter.count({
			where: { orgId: org.id, emailStatus: 'subscribed' }
		})
	]);

	// A/B testing requires Starter+ plan
	const abTestingAllowed = FEATURES.AB_TESTING && await orgMeetsPlan(org.id, 'starter');

	return {
		campaigns: campaigns.map((c) => ({
			id: c.id,
			title: c.title,
			status: c.status
		})),
		tags,
		subscribedCount,
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

		// NOTE: Rate limit is per-isolate on CF Workers without Redis. Configure REDIS_URL for global enforcement.
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
		// Strip control characters (CRLF injection) and cap length (RFC 2822)
		const subject = rawSubject?.replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 998);
		const rawBodyHtml = formData.get('bodyHtml')?.toString();
		const rawFromName = formData.get('fromName')?.toString().trim() || org.name;
		// Strip control characters (CRLF injection) and angle brackets (display name spoofing)
		const fromName = rawFromName.replace(/[\x00-\x1f\x7f<>"]/g, '').slice(0, 64);
		if (!fromName) {
			return fail(400, { error: 'From name is required' });
		}
		// Force from email to org slug — prevent local-part spoofing
		const fromEmail = `${org.slug}@commons.email`;
		const campaignId = formData.get('campaignId')?.toString() || null;

		if (!subject) {
			return fail(400, { error: 'Subject is required' });
		}
		if (!rawBodyHtml) {
			return fail(400, { error: 'Email body is required' });
		}
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		// Validate campaignId belongs to org if provided
		if (campaignId) {
			const campaign = await db.campaign.findFirst({
				where: { id: campaignId, orgId: org.id }
			});
			if (!campaign) {
				return fail(400, { error: 'Invalid campaign selection' });
			}
		}

		const filter = parseFilter(formData);

		// Count recipients before creating blast
		const recipientCount = await countRecipients(org.id, filter);
		if (recipientCount === 0) {
			return fail(400, { error: 'No recipients match your filters. Adjust filters and try again.' });
		}

		// Create blast
		const blast = await db.emailBlast.create({
			data: {
				orgId: org.id,
				campaignId,
				subject,
				bodyHtml,
				fromName,
				fromEmail,
				status: 'draft',
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
			recipientFilter: filter as any,
				totalRecipients: recipientCount
			}
		});

		// Send pipeline runs async -- use waitUntil on CF Workers to keep alive
		const blastPromise = sendBlast(blast.id).catch((err) => {
			console.error(`[email-engine] Blast ${blast.id} async error:`, err);
		});
		if (platform?.context?.waitUntil) {
			platform.context.waitUntil(blastPromise);
		} else {
			// Non-CF: await inline so the blast actually runs (blocks redirect but doesn't silently drop)
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

		if (campaignId) {
			const campaign = await db.campaign.findFirst({
				where: { id: campaignId, orgId: org.id }
			});
			if (!campaign) return fail(400, { error: 'Invalid campaign selection' });
		}

		const filter = parseFilter(formData);

		// Resolve all recipients and split into test/remainder pools
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

		// Create variant A blast
		const blastA = await db.emailBlast.create({
			data: {
				orgId: org.id,
				campaignId,
				subject: subjectA,
				bodyHtml: bodyHtmlA,
				fromName,
				fromEmail,
				status: 'draft',
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				recipientFilter: { ...filter, testRecipientIds: groupA.map((r) => r.id) } as any,
				totalRecipients: groupA.length,
				isAbTest: true,
				abVariant: 'A',
				abParentId,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				abTestConfig: abTestConfig as any
			}
		});

		// Create variant B blast
		const blastB = await db.emailBlast.create({
			data: {
				orgId: org.id,
				campaignId,
				subject: subjectB,
				bodyHtml: bodyHtmlB,
				fromName,
				fromEmail,
				status: 'draft',
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				recipientFilter: { ...filter, testRecipientIds: groupB.map((r) => r.id) } as any,
				totalRecipients: groupB.length,
				isAbTest: true,
				abVariant: 'B',
				abParentId,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				abTestConfig: abTestConfig as any
			}
		});

		// Send both variants async
		const sendPromise = Promise.all([
			sendBlast(blastA.id),
			sendBlast(blastB.id)
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
