import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import {
	compileEmail,
	compileEmailShell,
	buildTierContext,
	type MergeContext,
	type VerificationBlock
} from '$lib/server/email/compiler';
import { sanitizeEmailBody } from '$lib/server/email/sanitize';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad, Actions } from './$types';

const baseUrl = env.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://commons.email';

interface RecipientFilter {
	tagIds?: string[];
	verified?: 'any' | 'verified' | 'unverified';
}

type SupporterCountPage = {
	supporters: Array<{ emailStatus?: string }>;
	hasMore: boolean;
	nextCursor: string | null;
};

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

async function countRecipientsByFilter(orgSlug: string, filter: RecipientFilter): Promise<number | null> {
	if (filter.tagIds && filter.tagIds.length > 1) {
		return null;
	}

	const listFilter: Record<string, unknown> = {};
	if (filter.verified === 'verified') listFilter.verified = true;
	if (filter.verified === 'unverified') listFilter.verified = false;
	if (filter.tagIds?.[0]) listFilter.tagId = filter.tagIds[0];

	let cursor: string | null = null;
	let count = 0;
	let scanned = 0;

	do {
		const result = await serverQuery(api.supporters.list, {
			orgSlug,
			paginationOpts: { cursor, numItems: 100 },
			filters: Object.keys(listFilter).length > 0 ? listFilter : undefined
		}) as SupporterCountPage;

		for (const supporter of result.supporters) {
			if ((supporter.emailStatus ?? 'subscribed') === 'subscribed') count++;
		}
		scanned += result.supporters.length;
		cursor = result.hasMore ? result.nextCursor : null;
	} while (cursor && scanned < 10_000);

	return count;
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
		serverQuery(api.subscriptions.getByOrg, { orgSlug: params.slug }),
		serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug })
	]);

	// A/B testing allowed if org has starter+ plan
	const abTestingAllowed = FEATURES.AB_TESTING && (sub?.plan !== 'free');

	return {
		campaigns: convexCampaigns.page.map((c: Record<string, unknown>) => ({
			id: asString(c._id),
			title: asString(c.title, 'Untitled campaign'),
			status: asString(c.status, 'DRAFT')
		})),
		tags: (convexTags ?? []).map((t: Record<string, unknown>) => ({
			id: asString(t._id ?? t.id),
			name: asString(t.name)
		})),
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
		const count = await countRecipientsByFilter(params.slug, filter);
		if (count == null) {
			return fail(501, { error: 'Recipient counting for multiple tags is not available yet.', count: 0 });
		}

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
		if (rawBodyHtml.length > 524_288) {
			return fail(400, { error: 'Email body must not exceed 512 KB for preview.' });
		}
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
			districtCount: 8
		};

		const compiledHtml = compileEmail(
			bodyHtml,
			sampleMerge,
			sampleVerification,
			`${baseUrl}/unsubscribe/sample/token`,
			baseUrl
		);

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
		if (limits?.current && limits.current.emailsSent >= limits.limits.maxEmails) {
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
		// Cap raw body before sanitize — emailBlasts.bodyHtml writes have to fit
		// Convex's 1MiB doc cap; 512KiB is well above any real marketing email
		// (typical 50-200KB) and leaves headroom for sanitize overhead.
		if (rawBodyHtml.length > 524_288) {
			return fail(400, { error: 'Email body must not exceed 512 KB. Trim images or split into multiple sends.' });
		}
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		// Validate campaignId via Convex
		if (campaignId) {
			const campaign = await serverQuery(api.campaigns.get, {
				campaignId: campaignId as Id<'campaigns'>
			});
			if (!campaign) {
				return fail(400, { error: 'Invalid campaign selection' });
			}
		}

		const filter = parseFilter(formData);

		// Count recipients via Convex
		const recipientCount = await countRecipientsByFilter(params.slug, filter);
		if (recipientCount == null) {
			return fail(501, { error: 'Sending to multiple tags is not available yet.' });
		}
		if (recipientCount === 0) {
			return fail(400, { error: 'No recipients match your filters. Adjust filters and try again.' });
		}

		// Wrap in canonical email shell — same path as `createClientDraft`,
		// for parity if the server-side `sendBlast` action is ever revived.
		// Verification block is filter-scoped or omitted (see createClientDraft).
		let verificationBlock: VerificationBlock | null = null;
		if (filter.verified === 'verified') {
			verificationBlock = {
				totalRecipients: recipientCount,
				verifiedCount: recipientCount,
				verifiedPct: 100,
				districtCount: 0
			};
		} else if (filter.verified === 'unverified') {
			verificationBlock = {
				totalRecipients: recipientCount,
				verifiedCount: 0,
				verifiedPct: 0,
				districtCount: 0
			};
		}
		const BLAST_ID_PLACEHOLDER = '__BLAST_ID__';
		const wrappedBodyTemplate = compileEmailShell(bodyHtml, verificationBlock, {
			platformUrl: baseUrl,
			unsubscribeUrl: `${baseUrl}/unsubscribe?blast=${BLAST_ID_PLACEHOLDER}`
		});

		// Create blast then patch the per-blast unsubscribe URL with the real
		// row id. See `createClientDraft` for the rationale.
		const sendResult = await serverMutation(api.email.createBlast, {
			orgSlug: params.slug,
			subject,
			bodyHtml: wrappedBodyTemplate,
			fromName,
			fromEmail,
			recipientFilter: filter,
			campaignId: campaignId ?? undefined
		});
		await serverMutation(api.email.updateBlast, {
			orgSlug: params.slug,
			blastId: sendResult.id as Id<'emailBlasts'>,
			bodyHtml: wrappedBodyTemplate.replaceAll(
				BLAST_ID_PLACEHOLDER,
				String(sendResult.id)
			)
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
		const sub = await serverQuery(api.subscriptions.getByOrg, { orgSlug: params.slug });
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
		if (abLimits?.current && abLimits.current.emailsSent >= abLimits.limits.maxEmails) {
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
		if (rawBodyHtmlA.length > 524_288 || rawBodyHtmlB.length > 524_288) {
			return fail(400, { error: 'Each variant body must not exceed 512 KB.' });
		}

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
				campaignId: campaignId as Id<'campaigns'>
			});
			if (!campaign) return fail(400, { error: 'Invalid campaign selection' });
		}

		const filter = parseFilter(formData);
		const abParentId = crypto.randomUUID();
		const abTestConfig = { splitPct, winnerMetric, testDurationMs, testGroupPct };

		// Wrap both variants in the canonical email shell (parity with `send` /
		// `createClientDraft`). Verification block omitted for A/B variants —
		// the test cohort is a sub-fraction of the full filter cohort and
		// per-variant verification truth is not knowable without per-variant
		// recipient resolution; honest absence beats approximation.
		const wrappedA = compileEmailShell(bodyHtmlA, null, { platformUrl: baseUrl });
		const wrappedB = compileEmailShell(bodyHtmlB, null, { platformUrl: baseUrl });

		// A/B winner automation is not exposed as a public Convex mutation yet; create linked draft variants.
		await Promise.all([
			serverMutation(api.email.createBlast, {
				orgSlug: params.slug,
				subject: subjectA,
				bodyHtml: wrappedA,
				fromName,
				fromEmail,
				recipientFilter: filter,
				campaignId: campaignId ?? undefined,
				isAbTest: true,
				abVariant: 'A',
				abParentId,
				abTestConfig
			}),
			serverMutation(api.email.createBlast, {
				orgSlug: params.slug,
				subject: subjectB,
				bodyHtml: wrappedB,
				fromName,
				fromEmail,
				recipientFilter: filter,
				campaignId: campaignId ?? undefined,
				isAbTest: true,
				abVariant: 'B',
				abParentId,
				abTestConfig
			})
		]);

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
		if (limits?.current && limits.current.emailsSent >= limits.limits.maxEmails) {
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
		if (rawBodyHtml.length > 524_288) {
			return fail(400, { error: 'Email body must not exceed 512 KB. Trim images or split into multiple sends.' });
		}
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		if (campaignId) {
			const campaign = await serverQuery(api.campaigns.get, { campaignId: campaignId as Id<'campaigns'> });
			if (!campaign) return fail(400, { error: 'Invalid campaign selection' });
		}

		const filter = parseFilter(formData);
		const totalRecipients = (await countRecipientsByFilter(params.slug, filter)) ?? 0;

		// Verification block is filter-scoped: only emit it when the filter
		// constrains the cohort to a known verification state. A 'any' filter
		// would force an org-wide approximation that can diverge from the
		// actual cohort — false verification context is worse than no
		// verification context.
		let verificationBlock: VerificationBlock | null = null;
		if (filter.verified === 'verified') {
			verificationBlock = {
				totalRecipients,
				verifiedCount: totalRecipients,
				verifiedPct: 100,
				districtCount: 0
			};
		} else if (filter.verified === 'unverified') {
			verificationBlock = {
				totalRecipients,
				verifiedCount: 0,
				verifiedPct: 0,
				districtCount: 0
			};
		}

		// Wrap the author body in the canonical email shell + (optional)
		// verification block + platform footer + per-blast unsubscribe URL.
		// Bulk-mode shell does not personalize merge fields — the Lambda proxy
		// sends one bodyHtml to N recipients per batch — so the unsubscribe URL
		// is per-blast (form-based: recipient enters their email to apply).
		// Per-recipient one-click unsubscribe (RFC 8058 List-Unsubscribe-Post +
		// HMAC token) is tracked separately and requires Lambda templating.
		// `__BLAST_ID__` is a single-use placeholder substituted after
		// createBlast returns the row id.
		const BLAST_ID_PLACEHOLDER = '__BLAST_ID__';
		const wrappedBodyTemplate = compileEmailShell(bodyHtml, verificationBlock, {
			platformUrl: baseUrl,
			unsubscribeUrl: `${baseUrl}/unsubscribe?blast=${BLAST_ID_PLACEHOLDER}`
		});

		// Create blast record as draft with client-direct send mode. Body is
		// substituted with the real blast id immediately after creation.
		const result = await serverMutation(api.email.createBlast, {
			orgSlug: params.slug,
			subject,
			bodyHtml: wrappedBodyTemplate,
			fromName,
			fromEmail,
			sendMode: 'client-direct',
			recipientFilter: filter,
			campaignId: campaignId ?? undefined
		});
		const wrappedBodyHtml = wrappedBodyTemplate.replaceAll(
			BLAST_ID_PLACEHOLDER,
			String(result.id)
		);
		await serverMutation(api.email.updateBlast, {
			orgSlug: params.slug,
			blastId: result.id as Id<'emailBlasts'>,
			bodyHtml: wrappedBodyHtml
		});

		return {
			blastId: result.id,
			orgId: ctx.org._id,
			fromEmail,
			fromName,
			subject,
			bodyHtml: wrappedBodyHtml
		};
	}
};
