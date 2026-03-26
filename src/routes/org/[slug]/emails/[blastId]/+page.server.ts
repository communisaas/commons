import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { org } = await parent();

	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexBlast = await serverQuery(api.email.getBlast, {
				orgSlug: org.slug,
				blastId: params.blastId as any
			});

			if (!convexBlast) throw error(404, 'Email not found');

			console.log(`[Email Detail] Convex: loaded blast ${params.blastId} for ${org.slug}`);

			// A/B test logic not yet in Convex — show basic blast info
			return {
				isAbTest: false,
				blast: {
					id: convexBlast._id,
					subject: convexBlast.subject,
					status: convexBlast.status,
					abVariant: convexBlast.abVariant ?? null,
					totalRecipients: convexBlast.totalRecipients ?? 0,
					totalSent: convexBlast.totalSent ?? 0,
					totalBounced: convexBlast.totalBounced ?? 0,
					totalOpened: convexBlast.totalOpened ?? 0,
					totalClicked: convexBlast.totalClicked ?? 0,
					totalComplained: convexBlast.totalComplained ?? 0,
					sentAt: typeof convexBlast.sentAt === 'number'
						? new Date(convexBlast.sentAt).toISOString()
						: null,
					createdAt: typeof convexBlast._creationTime === 'number'
						? new Date(convexBlast._creationTime).toISOString()
						: String(convexBlast._creationTime),
					abWinnerPickedAt: typeof convexBlast.abWinnerPickedAt === 'number'
						? new Date(convexBlast.abWinnerPickedAt).toISOString()
						: null
				},
				variants: [],
				winnerBlast: null,
				bounceEvents: []
			};
		} catch (err) {
			if (err && typeof err === 'object' && 'status' in err) throw err;
			console.error('[Email Detail] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───

	const blast = await db.emailBlast.findFirst({
		where: { id: params.blastId, orgId: org.id }
	});

	if (!blast) throw error(404, 'Email not found');

	// If not an A/B test, just show basic info
	if (!blast.isAbTest || !blast.abParentId) {
		const bounceEvents = await db.emailEvent.findMany({
			where: { blastId: blast.id, eventType: 'bounce' },
			select: { recipientEmail: true, timestamp: true },
			orderBy: { timestamp: 'desc' },
			take: 100
		});

		return {
			isAbTest: false,
			blast: serializeBlast(blast),
			variants: [],
			winnerBlast: null,
			bounceEvents: bounceEvents.map((e) => ({
				email: maskEmail(e.recipientEmail),
				timestamp: e.timestamp.toISOString()
			}))
		};
	}

	// Load all blasts in this A/B test group
	const allBlasts = await db.emailBlast.findMany({
		where: { abParentId: blast.abParentId },
		orderBy: { createdAt: 'asc' }
	});

	const variantA = allBlasts.find((b) => b.abVariant === 'A');
	const variantB = allBlasts.find((b) => b.abVariant === 'B');
	const winnerBlast = allBlasts.find((b) => b.abVariant === null);

	const config = (variantA?.abTestConfig ?? {}) as Record<string, unknown>;

	const abBlastIds = allBlasts.map((b) => b.id);
	const bounceEvents = await db.emailEvent.findMany({
		where: { blastId: { in: abBlastIds }, eventType: 'bounce' },
		select: { recipientEmail: true, timestamp: true },
		orderBy: { timestamp: 'desc' },
		take: 100
	});

	return {
		isAbTest: true,
		blast: serializeBlast(blast),
		variants: [
			variantA ? serializeBlast(variantA) : null,
			variantB ? serializeBlast(variantB) : null
		].filter(Boolean),
		winnerBlast: winnerBlast ? serializeBlast(winnerBlast) : null,
		abConfig: {
			splitPct: (config.splitPct as number) ?? 50,
			winnerMetric: (config.winnerMetric as string) ?? 'open',
			testDurationMs: (config.testDurationMs as number) ?? 0,
			testGroupPct: (config.testGroupPct as number) ?? 20
		},
		bounceEvents: bounceEvents.map((e) => ({
			email: maskEmail(e.recipientEmail),
			timestamp: e.timestamp.toISOString()
		}))
	};
};

function serializeBlast(b: {
	id: string;
	subject: string;
	status: string;
	abVariant: string | null;
	totalRecipients: number;
	totalSent: number;
	totalBounced: number;
	totalOpened: number;
	totalClicked: number;
	totalComplained: number;
	sentAt: Date | null;
	createdAt: Date;
	abWinnerPickedAt: Date | null;
}) {
	return {
		id: b.id,
		subject: b.subject,
		status: b.status,
		abVariant: b.abVariant,
		totalRecipients: b.totalRecipients,
		totalSent: b.totalSent,
		totalBounced: b.totalBounced,
		totalOpened: b.totalOpened,
		totalClicked: b.totalClicked,
		totalComplained: b.totalComplained,
		sentAt: b.sentAt?.toISOString() ?? null,
		createdAt: b.createdAt.toISOString(),
		abWinnerPickedAt: b.abWinnerPickedAt?.toISOString() ?? null
	};
}

function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	if (!local || !domain) return '***@***';
	return local[0] + '***@' + domain;
}
