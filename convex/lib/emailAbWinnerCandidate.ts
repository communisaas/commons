import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const AB_WINNER_DEFAULT_TIMEOUT_MS = 48 * 60 * 60 * 1000;
export const AB_WINNER_CANDIDATE_READ_MAX = 500;

type WinnerMetric = 'open' | 'click';

export type EmailAbWinnerCandidateInput = {
	blastId: Id<'emailBlasts'>;
	orgId: Id<'organizations'>;
	status: string;
	isAbTest: boolean;
	abParentId?: string;
	abVariant?: string;
	abWinnerPickedAt?: number;
	abTestConfig?: unknown;
	totalSent: number;
	totalOpened: number;
	totalClicked: number;
	sentAt?: number;
};

function readWinnerSettings(config: unknown): {
	winnerMetric?: WinnerMetric;
	testDurationMs: number;
} {
	const raw = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
	const rawMetric = raw.winnerMetric;
	const winnerMetric: WinnerMetric | undefined =
		rawMetric === undefined
			? 'open'
			: rawMetric === 'open' || rawMetric === 'click'
				? rawMetric
				: undefined;
	const testDurationMs =
		typeof raw.testDurationMs === 'number' &&
		Number.isFinite(raw.testDurationMs) &&
		raw.testDurationMs > 0
			? raw.testDurationMs
			: AB_WINNER_DEFAULT_TIMEOUT_MS;
	return { winnerMetric, testDurationMs };
}

function assertCandidateCounter(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`EMAIL_AB_CANDIDATE_${label}_INVALID`);
	}
}

/**
 * Maintain the compact, unresolved A/B winner read model in the same mutation
 * that changes its source blast. `emailBlasts.bodyHtml` is intentionally not
 * represented: the 15-minute picker needs only scalar counters and timing.
 *
 * Legacy sent A/B blasts have no row and are therefore safely tombstoned from
 * automated winner selection until an operator performs an explicit bounded
 * backfill. New source transitions are exact from the cutover onward.
 */
export async function syncEmailAbWinnerCandidate(
	ctx: Pick<MutationCtx, 'db'>,
	input: EmailAbWinnerCandidateInput
): Promise<void> {
	const existingRows = await ctx.db
		.query('emailAbWinnerCandidates')
		.withIndex('by_blastId', (q) => q.eq('blastId', input.blastId))
		.take(2);
	if (existingRows.length > 1) {
		throw new Error('EMAIL_AB_CANDIDATE_CARDINALITY_REPAIR_REQUIRED');
	}
	const existing = existingRows[0];
	const eligible =
		input.status === 'sent' &&
		input.isAbTest &&
		input.abWinnerPickedAt === undefined &&
		typeof input.abParentId === 'string' &&
		input.abParentId.length > 0 &&
		input.sentAt !== undefined;
	if (!eligible) {
		if (existing) await ctx.db.delete(existing._id);
		return;
	}

	assertCandidateCounter(input.totalSent, 'TOTAL_SENT');
	assertCandidateCounter(input.totalOpened, 'TOTAL_OPENED');
	assertCandidateCounter(input.totalClicked, 'TOTAL_CLICKED');
	if (!Number.isFinite(input.sentAt!) || input.sentAt! <= 0) {
		throw new Error('EMAIL_AB_CANDIDATE_SENT_AT_INVALID');
	}
	const settings = readWinnerSettings(input.abTestConfig);
	const projection = {
		blastId: input.blastId,
		orgId: input.orgId,
		abParentId: input.abParentId!,
		abVariant: input.abVariant,
		totalSent: input.totalSent,
		totalOpened: input.totalOpened,
		totalClicked: input.totalClicked,
		sentAt: input.sentAt!,
		winnerMetric: settings.winnerMetric,
		testDurationMs: settings.testDurationMs,
		updatedAt: Date.now()
	};
	if (existing) {
		await ctx.db.patch(existing._id, projection);
	} else {
		await ctx.db.insert('emailAbWinnerCandidates', projection);
	}
}
