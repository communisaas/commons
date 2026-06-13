import { fail, redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import {
	compileEmail,
	compileEmailShell,
	compileSubjectMergeFields,
	buildTierContext,
	type MergeContext,
	type VerificationBlock
} from '$lib/server/email/compiler';
import { sanitizeEmailBody } from '$lib/server/email/sanitize';
import { getEmailServerDispatchReadiness } from '$lib/server/email/server-dispatch-readiness';
import { orgLimitSentence } from '$lib/data/org-limit-sentences';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { FEATURES } from '$lib/config/features';
import type { PageServerLoad, Actions } from './$types';

const baseUrl = publicEnv.PUBLIC_BASE_URL?.replace(/\/$/, '') ?? 'https://commons.email';

function emailServerDispatchEnv() {
	return {
		AWS_ACCESS_KEY_ID: privateEnv.AWS_ACCESS_KEY_ID,
		AWS_SECRET_ACCESS_KEY: privateEnv.AWS_SECRET_ACCESS_KEY,
		UNSUBSCRIBE_SECRET: privateEnv.UNSUBSCRIBE_SECRET,
		PUBLIC_BASE_URL: publicEnv.PUBLIC_BASE_URL
	};
}

interface RecipientFilter {
	// tagIds are sourced from form data (raw strings); the Convex
	// recipientFilterValidator expects Id<'tags'>. parseFilter casts
	// at the API boundary so this local shape stays string-typed.
	tagIds?: Id<'tags'>[];
	segmentIds?: Id<'segments'>[];
	verified?: 'any' | 'verified' | 'unverified';
	includeEmailHashes?: string[];
	excludeEmailHashes?: string[];
}

type AbCohortAllocation = {
	variantAEmailHashes: string[];
	variantBEmailHashes: string[];
	remainderEmailHashes: string[];
	totalCount: number;
	testCount: number;
	remainderCount: number;
};

type RecipientCountResult = {
	totalCount: number;
	sourceCounts: Record<string, number>;
};

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asSourceCounts(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const counts: Record<string, number> = {};
	for (const [source, count] of Object.entries(value)) {
		if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
			counts[source] = count;
		}
	}
	return counts;
}

function requireRole(role: string, required: string): void {
	const hierarchy = ['viewer', 'member', 'editor', 'owner'];
	if (hierarchy.indexOf(role) < hierarchy.indexOf(required)) {
		throw new Error(`Role '${required}' required, got '${role}'`);
	}
}

function canEdit(role: string): boolean {
	return role === 'owner' || role === 'editor';
}

async function countRecipientsByFilter(
	orgSlug: string,
	filter: RecipientFilter
): Promise<RecipientCountResult> {
	const result = (await serverQuery(api.email.countRecipientsForFilter, {
		orgSlug,
		recipientFilter: filter
	})) as { totalCount: number; sourceCounts?: Record<string, number> };
	return {
		totalCount: result.totalCount,
		sourceCounts: asSourceCounts(result.sourceCounts)
	};
}

function allocateAbCohort(
	emailHashes: string[],
	testGroupPct: number,
	splitPct: number
): AbCohortAllocation {
	const ordered = Array.from(new Set(emailHashes)).sort();
	if (ordered.length < 2) {
		throw new Error('A/B tests need at least two subscribed recipients in the selected cohort.');
	}
	const testCount = Math.min(
		ordered.length,
		Math.max(2, Math.ceil((ordered.length * testGroupPct) / 100))
	);
	const variantACount = Math.min(
		testCount - 1,
		Math.max(1, Math.round((testCount * splitPct) / 100))
	);
	const variantAEmailHashes = ordered.slice(0, variantACount);
	const variantBEmailHashes = ordered.slice(variantACount, testCount);
	const remainderEmailHashes = ordered.slice(testCount);
	return {
		variantAEmailHashes,
		variantBEmailHashes,
		remainderEmailHashes,
		totalCount: ordered.length,
		testCount,
		remainderCount: remainderEmailHashes.length
	};
}

export const load: PageServerLoad = async ({ parent, params }) => {
	const { org, membership } = await parent();

	const [
		convexCampaigns,
		convexSupporterStats,
		convexTags,
		convexSegments,
		sub,
		orgKeyResult,
		initialRecipientCount
	] = await Promise.all([
		serverQuery(api.campaigns.list, {
			slug: params.slug,
			paginationOpts: { numItems: 50, cursor: null }
		}),
		serverQuery(api.supporters.getSummaryStats, { orgSlug: params.slug }),
		serverQuery(api.supporters.getTags, { orgSlug: params.slug }),
		serverQuery(api.segments.list, { slug: params.slug }),
		serverQuery(api.subscriptions.getByOrg, { orgSlug: params.slug }),
		serverQuery(api.organizations.getOrgKeyVerifier, { slug: params.slug }),
		canEdit(membership.role)
			? countRecipientsByFilter(params.slug, { verified: 'any' }).catch(() => null)
			: Promise.resolve(null)
	]);

	// A/B testing allowed if org has starter+ plan
	const abTestingAllowed = FEATURES.AB_TESTING && sub?.plan !== 'free';
	const serverDispatchReadiness = getEmailServerDispatchReadiness(emailServerDispatchEnv(), {
		orgKeyConfigured: Boolean(orgKeyResult?.orgKeyVerifier)
	});

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
		segments: (
			(convexSegments as { segments?: Array<Record<string, unknown>> } | null)?.segments ?? []
		).map((segment: Record<string, unknown>) => ({
			id: asString(segment._id ?? segment.id),
			name: asString(segment.name)
		})),
		subscribedCount:
			initialRecipientCount?.totalCount ?? convexSupporterStats.emailHealth?.subscribed ?? 0,
		recipientSourceCounts: initialRecipientCount?.sourceCounts ?? {},
		abTestingAllowed,
		orgKeyVerifier: orgKeyResult?.orgKeyVerifier ?? null,
		serverDispatchRuntimeReady: serverDispatchReadiness.ready,
		serverDispatchRuntimeMissing: serverDispatchReadiness.missing,
		serverDispatchRuntimeDependency: serverDispatchReadiness.dependency,
		serverDispatchRuntimeMessage: serverDispatchReadiness.message
	};
};

// Convex doc Id format: lowercase base32, ~32 chars in practice. Reject
// obviously-malformed input at the boundary so a bad client posts a
// controllable 400 instead of riding through to the Convex args validator
// (which throws as 500). Charset/length tightened after a brutalist round
// caught the earlier /^[a-z0-9_]{20,64}$/i admitting underscores and
// uppercase that no real Convex Id contains.
const CONVEX_ID_RE = /^[a-z0-9]{30,40}$/;
const VERIFIED_VALUES = new Set(['any', 'verified', 'unverified']);

function parseFilter(formData: FormData): RecipientFilter {
	const rawTagIds = formData.getAll('tagIds').map(String).filter(Boolean);
	const rawSegmentIds = formData.getAll('segmentIds').map(String).filter(Boolean);
	// Drop any tagId that doesn't match the Convex Id shape — the cast at
	// the bottom would otherwise lie about a runtime invariant the args
	// validator checks downstream. Keeps shape-defense local to the
	// boundary instead of relying on Convex throwing an unhandled error.
	const tagIds = Array.from(new Set(rawTagIds.filter((t) => CONVEX_ID_RE.test(t))));
	const segmentIds = Array.from(new Set(rawSegmentIds.filter((t) => CONVEX_ID_RE.test(t))));
	const rawVerified = formData.get('verified')?.toString() ?? 'any';
	// Normalize unknown verified-axis values to 'any' rather than letting
	// the cast lie to the type system. The Convex validator's union
	// literals would reject anything outside the set with a 500; this
	// degrades unrecognized values to no-op locally.
	const verified = VERIFIED_VALUES.has(rawVerified)
		? (rawVerified as 'any' | 'verified' | 'unverified')
		: 'any';
	return {
		tagIds: tagIds.length > 0 ? (tagIds as Id<'tags'>[]) : undefined,
		segmentIds: segmentIds.length > 0 ? (segmentIds as Id<'segments'>[]) : undefined,
		verified
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
		const recipientCount = await countRecipientsByFilter(params.slug, filter);

		return { count: recipientCount.totalCount, sourceCounts: recipientCount.sourceCounts };
	},

	preview: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/compose`);
		}
		const ctx = await serverQuery(api.organizations.getOrgContext, { slug: params.slug });
		requireRole(ctx.membership.role, 'editor');

		const previewLimit = await getRateLimiter().check(
			`ratelimit:compose:preview:org:${ctx.org._id}`,
			{
				maxRequests: 20,
				windowMs: 60_000
			}
		);
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

		// Resolve the subject through the same sample values as the body, in
		// header mode (CR/LF stripped, no HTML-escape) so the preview reflects
		// what each recipient actually receives — the UI claims the preview
		// "fills the fields with sample values."
		const previewSubject = compileSubjectMergeFields(subject, sampleMerge);

		return { previewHtml: compiledHtml, previewSubject };
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
			return fail(403, {
				error:
					'Email send limit reached for the current billing period. Upgrade your plan to send more.'
			});
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
			return fail(400, {
				error: 'Email body must not exceed 512 KB. Trim images or split into multiple sends.'
			});
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
		const recipientCountResult = await countRecipientsByFilter(params.slug, filter);
		const recipientCount = recipientCountResult.totalCount;
		if (recipientCount === 0) {
			return fail(400, {
				error: 'No recipients match your filters. Adjust filters and try again.'
			});
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
			// campaignId is form-data string validated against campaigns.get above;
			// narrow to the schema's Id<'campaigns'> at the call boundary.
			campaignId: campaignId ? (campaignId as Id<'campaigns'>) : undefined
		});
		await serverMutation(api.email.updateBlast, {
			orgSlug: params.slug,
			blastId: sendResult.id as Id<'emailBlasts'>,
			bodyHtml: wrappedBodyTemplate.replaceAll(BLAST_ID_PLACEHOLDER, String(sendResult.id))
		});
		if (FEATURES.EMAIL_SERVER_DISPATCH) {
			const orgKeyVerifier = await serverQuery(api.organizations.getOrgKeyVerifier, {
				slug: params.slug
			});
			const serverDispatchReadiness = getEmailServerDispatchReadiness(emailServerDispatchEnv(), {
				orgKeyConfigured: Boolean(orgKeyVerifier?.orgKeyVerifier)
			});
			if (!serverDispatchReadiness.ready) {
				return fail(424, {
					error: orgLimitSentence('email_server_dispatch_dependency_missing'),
					errorCode: 'email_server_dispatch_dependency_missing',
					blockedVerb: 'server_email_dispatch',
					preservedArtifact: 'email_draft',
					blastId: String(sendResult.id),
					draftHref: `/org/${params.slug}/emails/${sendResult.id}`,
					dependency: serverDispatchReadiness.dependency,
					missing: serverDispatchReadiness.missing,
					runtimeMessage: serverDispatchReadiness.message
				});
			}
			await serverMutation(api.email.enqueueServerDispatch, {
				orgSlug: params.slug,
				blastId: sendResult.id as Id<'emailBlasts'>
			});
		}

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
			return fail(403, {
				error:
					'Email send limit reached for the current billing period. Upgrade your plan to send more.'
			});
		}

		const formData = await request.formData();
		const subjectA = formData
			.get('subjectA')
			?.toString()
			.trim()
			?.replace(/[\r\n\x00-\x1f\x7f]/g, '')
			.slice(0, 998);
		const subjectB = formData
			.get('subjectB')
			?.toString()
			.trim()
			?.replace(/[\r\n\x00-\x1f\x7f]/g, '')
			.slice(0, 998);
		const rawBodyHtmlA = formData.get('bodyHtmlA')?.toString();
		const rawBodyHtmlB = formData.get('bodyHtmlB')?.toString();
		const rawFromName = formData.get('fromName')?.toString().trim() || ctx.org.name;
		const fromName = rawFromName.replace(/[\x00-\x1f\x7f<>"]/g, '').slice(0, 64);
		if (!fromName) return fail(400, { error: 'From name is required' });
		const fromEmail = `${ctx.org.slug}@commons.email`;
		const campaignId = formData.get('campaignId')?.toString() || null;

		if (!subjectA || !subjectB) return fail(400, { error: 'Both variant subjects are required' });
		if (!rawBodyHtmlA || !rawBodyHtmlB)
			return fail(400, { error: 'Both variant bodies are required' });
		if (rawBodyHtmlA.length > 524_288 || rawBodyHtmlB.length > 524_288) {
			return fail(400, { error: 'Each variant body must not exceed 512 KB.' });
		}

		const bodyHtmlA = sanitizeEmailBody(rawBodyHtmlA);
		const bodyHtmlB = sanitizeEmailBody(rawBodyHtmlB);

		const splitPct = Math.max(
			10,
			Math.min(90, parseInt(formData.get('splitPct')?.toString() || '50'))
		);
		const testGroupPct = Math.max(
			10,
			Math.min(50, parseInt(formData.get('testGroupPct')?.toString() || '20'))
		);
		const rawWinnerMetric = formData.get('winnerMetric')?.toString() || '';
		const winnerMetric = (
			['open', 'click'].includes(rawWinnerMetric) ? rawWinnerMetric : 'open'
		) as 'open' | 'click';

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
		const resolvedCohort = (await serverQuery(api.email.resolveRecipientHashesForFilter, {
			orgSlug: params.slug,
			recipientFilter: filter
		})) as {
			emailHashes: string[];
			totalCount: number;
			limited: boolean;
			maxSupported: number;
		};
		if (resolvedCohort.limited) {
			return fail(400, {
				error: `A/B cohort snapshots are currently capped at ${resolvedCohort.maxSupported.toLocaleString()} recipients. Narrow the audience before creating the test.`
			});
		}
		let allocation: AbCohortAllocation;
		try {
			allocation = allocateAbCohort(resolvedCohort.emailHashes, testGroupPct, splitPct);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'A/B cohort could not be allocated.'
			});
		}
		const abParentId = crypto.randomUUID();
		const abTestConfig = {
			splitPct,
			winnerMetric,
			testDurationMs,
			testGroupPct,
			cohortSnapshot: {
				totalCount: allocation.totalCount,
				testCount: allocation.testCount,
				variantACount: allocation.variantAEmailHashes.length,
				variantBCount: allocation.variantBEmailHashes.length,
				remainderCount: allocation.remainderCount,
				createdAt: Date.now()
			}
		};

		// Wrap both variants in the canonical email shell (parity with `send` /
		// `createClientDraft`). Verification block omitted for A/B variants —
		// the test cohort is a sub-fraction of the full filter cohort and
		// per-variant verification truth is not knowable without per-variant
		// recipient resolution; honest absence beats approximation.
		const wrappedA = compileEmailShell(bodyHtmlA, null, { platformUrl: baseUrl });
		const wrappedB = compileEmailShell(bodyHtmlB, null, { platformUrl: baseUrl });

		await serverMutation(api.email.createAbTestDrafts, {
			orgSlug: params.slug,
			subjectA,
			subjectB,
			bodyHtmlA: wrappedA,
			bodyHtmlB: wrappedB,
			fromName,
			fromEmail,
			recipientFilter: filter,
			campaignId: campaignId ? (campaignId as Id<'campaigns'>) : undefined,
			abParentId,
			abTestConfig,
			variantAEmailHashes: allocation.variantAEmailHashes,
			variantBEmailHashes: allocation.variantBEmailHashes,
			remainderEmailHashes: allocation.remainderEmailHashes
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
		if (limits?.current && limits.current.emailsSent >= limits.limits.maxEmails) {
			return fail(403, {
				error:
					'Email send limit reached for the current billing period. Upgrade your plan to send more.'
			});
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
			return fail(400, {
				error: 'Email body must not exceed 512 KB. Trim images or split into multiple sends.'
			});
		}
		const bodyHtml = sanitizeEmailBody(rawBodyHtml);

		if (campaignId) {
			const campaign = await serverQuery(api.campaigns.get, {
				campaignId: campaignId as Id<'campaigns'>
			});
			if (!campaign) return fail(400, { error: 'Invalid campaign selection' });
		}

		const filter = parseFilter(formData);
		const totalRecipients = (await countRecipientsByFilter(params.slug, filter)).totalCount;

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
		// compileEmailShell leaves merge tokens intact. The client-direct
		// browser sender resolves them after org-key decryption and switches to
		// singleton Lambda calls when personalization is present. The
		// unsubscribe URL here is per-blast (form-based: recipient enters their
		// email to apply).
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
			campaignId: campaignId ? (campaignId as Id<'campaigns'>) : undefined
		});
		const wrappedBodyHtml = wrappedBodyTemplate.replaceAll(BLAST_ID_PLACEHOLDER, String(result.id));
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
