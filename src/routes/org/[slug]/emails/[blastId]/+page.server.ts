import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
	const { org } = await parent();

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
