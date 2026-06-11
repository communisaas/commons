import { error, fail, redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { env as privateEnv } from '$env/dynamic/private';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import { FEATURES } from '$lib/config/features';
import { getEmailServerDispatchReadiness } from '$lib/server/email/server-dispatch-readiness';
import { orgLimitSentence } from '$lib/data/org-limit-sentences';
import type { Id } from '$convex/_generated/dataModel';
import type { Actions, PageServerLoad } from './$types';

function emailServerDispatchEnv() {
	return {
		AWS_ACCESS_KEY_ID: privateEnv.AWS_ACCESS_KEY_ID,
		AWS_SECRET_ACCESS_KEY: privateEnv.AWS_SECRET_ACCESS_KEY,
		UNSUBSCRIBE_SECRET: privateEnv.UNSUBSCRIBE_SECRET,
		PUBLIC_BASE_URL: publicEnv.PUBLIC_BASE_URL
	};
}

async function serverDispatchBoundary(orgSlug: string) {
	const orgKeyResult = await serverQuery(api.organizations.getOrgKeyVerifier, { slug: orgSlug });
	const readiness = getEmailServerDispatchReadiness(emailServerDispatchEnv(), {
		orgKeyConfigured: Boolean(orgKeyResult?.orgKeyVerifier)
	});
	if (readiness.ready) return null;
	return {
		error: orgLimitSentence('email_server_dispatch_dependency_missing'),
		errorCode: 'email_server_dispatch_dependency_missing',
		blockedVerb: 'server_email_dispatch',
		preservedArtifact: 'email_draft',
		dependency: readiness.dependency,
		missing: readiness.missing,
		runtimeMessage: readiness.message
	};
}

function mapBlast(convexBlast: Record<string, unknown>) {
	return {
		id: String(convexBlast._id),
		subject: typeof convexBlast.subject === 'string' ? convexBlast.subject : '(no subject)',
		status: typeof convexBlast.status === 'string' ? convexBlast.status : 'draft',
		abVariant: typeof convexBlast.abVariant === 'string' ? convexBlast.abVariant : null,
		totalRecipients:
			typeof convexBlast.totalRecipients === 'number' ? convexBlast.totalRecipients : 0,
		totalSent: typeof convexBlast.totalSent === 'number' ? convexBlast.totalSent : 0,
		totalBounced: typeof convexBlast.totalBounced === 'number' ? convexBlast.totalBounced : 0,
		totalOpened: typeof convexBlast.totalOpened === 'number' ? convexBlast.totalOpened : 0,
		totalClicked: typeof convexBlast.totalClicked === 'number' ? convexBlast.totalClicked : 0,
		totalComplained:
			typeof convexBlast.totalComplained === 'number' ? convexBlast.totalComplained : 0,
		sentAt:
			typeof convexBlast.sentAt === 'number' ? new Date(convexBlast.sentAt).toISOString() : null,
		createdAt:
			typeof convexBlast._creationTime === 'number'
				? new Date(convexBlast._creationTime).toISOString()
				: String(convexBlast._creationTime),
		abWinnerPickedAt:
			typeof convexBlast.abWinnerPickedAt === 'number'
				? new Date(convexBlast.abWinnerPickedAt).toISOString()
				: null
	};
}

function mapAbConfig(value: unknown) {
	if (!value || typeof value !== 'object') return null;
	const config = value as Record<string, unknown>;
	const rawSnapshot = config.cohortSnapshot;
	const snapshot =
		rawSnapshot && typeof rawSnapshot === 'object'
			? (rawSnapshot as Record<string, unknown>)
			: null;
	return {
		winnerMetric: typeof config.winnerMetric === 'string' ? config.winnerMetric : null,
		winnerMetricSupported:
			config.winnerMetric === undefined ||
			config.winnerMetric === 'open' ||
			config.winnerMetric === 'click',
		winnerBlastId: typeof config.winnerBlastId === 'string' ? config.winnerBlastId : null,
		testGroupPct: typeof config.testGroupPct === 'number' ? config.testGroupPct : null,
		splitPct: typeof config.splitPct === 'number' ? config.splitPct : null,
		cohortSnapshot: snapshot
			? {
					totalCount: typeof snapshot.totalCount === 'number' ? snapshot.totalCount : null,
					testCount: typeof snapshot.testCount === 'number' ? snapshot.testCount : null,
					variantACount: typeof snapshot.variantACount === 'number' ? snapshot.variantACount : null,
					variantBCount: typeof snapshot.variantBCount === 'number' ? snapshot.variantBCount : null,
					remainderCount:
						typeof snapshot.remainderCount === 'number' ? snapshot.remainderCount : null
				}
			: null
	};
}

function mapAbCohort(value: unknown) {
	if (!value || typeof value !== 'object') return null;
	const cohort = value as Record<string, unknown>;
	return {
		totalCount: typeof cohort.totalCount === 'number' ? cohort.totalCount : 0,
		testCount: typeof cohort.testCount === 'number' ? cohort.testCount : 0,
		variantACount: typeof cohort.variantACount === 'number' ? cohort.variantACount : 0,
		variantBCount: typeof cohort.variantBCount === 'number' ? cohort.variantBCount : 0,
		remainderCount: typeof cohort.remainderCount === 'number' ? cohort.remainderCount : 0,
		remainderBlastId: typeof cohort.remainderBlastId === 'string' ? cohort.remainderBlastId : null
	};
}

async function loadReceiptSummary(orgSlug: string, blastId: Id<'emailBlasts'>) {
	const page = await serverQuery(api.email.listReceiptsForBlast, {
		orgSlug,
		blastId,
		paginationOpts: {
			numItems: 50,
			cursor: null
		}
	});
	const receipts = Array.isArray(page.page) ? page.page : [];
	return {
		pageCount: receipts.length,
		sentCount: receipts.filter((receipt) => receipt.status === 'sent').length,
		failedCount: receipts.filter((receipt) => receipt.status === 'failed').length,
		hasMore: !page.isDone
	};
}

export const load: PageServerLoad = async ({ params, parent }) => {
	const { org, spaces } = await parent();
	const serverDispatchRuntimeReady = Boolean(
		spaces.operating?.emailDelivery.serverDispatchRuntimeReady
	);

	const convexBlast = await serverQuery(api.email.getBlast, {
		orgSlug: org.slug,
		blastId: params.blastId as Id<'emailBlasts'>
	});

	if (!convexBlast) throw error(404, 'Email not found');

	const blast = mapBlast(convexBlast as Record<string, unknown>);
	const receiptSummary = await loadReceiptSummary(org.slug, params.blastId as Id<'emailBlasts'>);

	if (convexBlast.isAbTest === true) {
		const group = await serverQuery(api.email.getAbTestGroup, {
			orgSlug: org.slug,
			blastId: params.blastId as Id<'emailBlasts'>
		});
		const rawVariants = Array.isArray(group?.variants) ? group.variants : [convexBlast];
		const variants = rawVariants.map((variant) => mapBlast(variant as Record<string, unknown>));
		const configSource =
			rawVariants.find(
				(variant) =>
					typeof (variant as Record<string, unknown>).abTestConfig === 'object' &&
					(variant as Record<string, unknown>).abTestConfig !== null
			) ?? convexBlast;

		return {
			isAbTest: variants.length > 1,
			abConfig: mapAbConfig((configSource as Record<string, unknown>).abTestConfig),
			abCohort: mapAbCohort((group as Record<string, unknown> | null)?.cohort),
			blast,
			variants,
			remainderDraft: group?.remainderDraft
				? mapBlast(group.remainderDraft as Record<string, unknown>)
				: null,
			winnerBlast: null,
			receiptSummary,
			bounceEvents: [],
			serverDispatchRuntimeReady
		};
	}

	return {
		isAbTest: false,
		abCohort: null,
		blast,
		variants: [],
		remainderDraft: null,
		winnerBlast: null,
		receiptSummary,
		bounceEvents: [],
		serverDispatchRuntimeReady
	};
};

export const actions: Actions = {
	sendTestCohorts: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/${params.blastId}`);
		}
		if (!FEATURES.EMAIL_SERVER_DISPATCH) {
			return fail(403, {
				error:
					'Server dispatch is dependency-first for this delivery; A/B test cohorts remain preserved drafts until runtime evidence clears.'
			});
		}
		const boundary = await serverDispatchBoundary(params.slug);
		if (boundary) return fail(424, boundary);
		try {
			await serverMutation(api.email.enqueueAbTestDispatch, {
				orgSlug: params.slug,
				blastId: params.blastId as Id<'emailBlasts'>
			});
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'Could not queue A/B test cohorts.'
			});
		}
		throw redirect(303, `/org/${params.slug}/emails/${params.blastId}`);
	},

	createRemainderDraft: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/${params.blastId}`);
		}
		const formData = await request.formData();
		const winnerBlastId = formData.get('winnerBlastId')?.toString() || params.blastId;
		let result: { blastId: string };
		try {
			result = (await serverMutation(api.email.createAbRemainderDraft, {
				orgSlug: params.slug,
				winnerBlastId: winnerBlastId as Id<'emailBlasts'>
			})) as { blastId: string };
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'Could not create remainder draft.'
			});
		}
		throw redirect(303, `/org/${params.slug}/emails/${result.blastId}`);
	},

	sendRemainder: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/auth/google?returnTo=/org/${params.slug}/emails/${params.blastId}`);
		}
		if (!FEATURES.EMAIL_SERVER_DISPATCH) {
			return fail(403, {
				error:
					'Server dispatch is dependency-first for this delivery; the A/B remainder remains a preserved draft until runtime evidence clears.'
			});
		}
		const boundary = await serverDispatchBoundary(params.slug);
		if (boundary) return fail(424, boundary);
		const formData = await request.formData();
		const winnerBlastId = formData.get('winnerBlastId')?.toString() || params.blastId;
		let result: { blastId: string };
		try {
			result = (await serverMutation(api.email.enqueueAbRemainderDispatch, {
				orgSlug: params.slug,
				winnerBlastId: winnerBlastId as Id<'emailBlasts'>
			})) as { blastId: string };
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : 'Could not queue the A/B remainder.'
			});
		}
		throw redirect(303, `/org/${params.slug}/emails/${result.blastId}`);
	}
};
