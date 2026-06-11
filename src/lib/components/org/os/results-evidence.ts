/**
 * Results evidence derivations — pure functions behind the Results space.
 *
 * The Results surface answers three org questions: did it deliver, did anyone
 * respond, and what can we show our board. These helpers derive the four
 * headline numbers, the district-reach list, and the response-activity
 * sentence from the layout-loaded `ReturnSpaceData` slice so the component
 * renders evidence, not raw counters.
 *
 * Copy register follows the staffer-legible evidence doctrine
 * (docs/design/VERIFICATION-LEGIBILITY.md): plain nouns a board or a
 * legislative office already uses, honest about sampling bounds, and absence
 * stated as a sentence rather than a zero.
 */

import type { DistrictWeight } from '$lib/types/verification-packet';
import type { ReturnSpaceData, ReturnSpaceReceiptSummary } from './spaces';

export type ResultsHeadline = {
	/** Verified constituents behind the org's actions. */
	verifiedConstituents: number;
	/** Unique districts those actions landed in. */
	districtsReached: number;
	/** Proof reports delivered to decision-makers (bounded recent sample). */
	proofReportsDelivered: number;
	/** Delivered reports with a decision-maker response on record. */
	responsesLogged: number;
};

/**
 * The four headline numbers. `packet.verified` is the canonical verified
 * count; when the packet has not been computed, the per-campaign verified
 * totals stand in so the org never sees a fabricated zero with real
 * campaigns underneath it.
 */
export function deriveResultsHeadline(data: ReturnSpaceData): ResultsHeadline {
	const verifiedConstituents =
		data.packet?.verified ??
		data.campaigns.reduce((sum, campaign) => sum + campaign.verifiedActions, 0);
	return {
		verifiedConstituents,
		districtsReached: data.packet?.districtCount ?? 0,
		proofReportsDelivered: data.receipts.loadedCount,
		responsesLogged: data.receipts.responseLoggedCount
	};
}

export type DistrictReach = {
	/** Plain rank label — district identities are privacy-protected hashes. */
	label: string;
	/** Action count that landed in this district. */
	count: number;
	/** Share of all district-resolved actions, 1–100 (for bar widths). */
	sharePct: number;
};

/** Rank label for an anonymized district row. */
export function districtRankLabel(index: number): string {
	if (index === 0) return 'Top district';
	const n = index + 1;
	const suffix = n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
	return `${n}${suffix} district`;
}

/**
 * Top districts by action count from the packet's geographic field.
 * Districts are privacy-preserving hashes, so rows carry rank labels and
 * counts — the verifiable spread itself lives on the proof packet.
 */
export function deriveDistrictReach(
	geography: DistrictWeight[] | null,
	limit = 5
): DistrictReach[] {
	if (!geography || geography.length === 0) return [];
	const sorted = [...geography].sort((a, b) => b.count - a.count);
	const total = sorted.reduce((sum, district) => sum + district.count, 0);
	return sorted.slice(0, limit).map((district, index) => ({
		label: districtRankLabel(index),
		count: district.count,
		sharePct: total > 0 ? Math.max(Math.round((district.count / total) * 100), 1) : 0
	}));
}

/** "Mar 4" — adds the year only when it isn't the current one. */
export function formatReportDay(iso: string): string {
	const date = new Date(iso);
	const sameYear = date.getFullYear() === new Date().getFullYear();
	return date.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		...(sameYear ? {} : { year: 'numeric' as const })
	});
}

/**
 * Response activity as a sentence: "3 responses logged · 2 awaiting response
 * · last report delivered Mar 4." Returns null when no proof reports have
 * been delivered — that absence is rendered as its own sentence upstream.
 *
 * The receipt summary is a bounded sample of the most recent reports; when
 * the loaded count hits that bound, the sentence says so instead of implying
 * an all-time total.
 */
export function describeResponseActivity(receipts: ReturnSpaceReceiptSummary): string | null {
	if (receipts.loadedCount === 0) return null;
	const atCap = receipts.sampleLimit > 0 && receipts.loadedCount >= receipts.sampleLimit;
	const responses = receipts.responseLoggedCount;
	const parts: string[] = [];
	if (responses === 0) {
		parts.push(
			atCap
				? `No responses logged in the most recent ${receipts.sampleLimit} reports`
				: 'No responses logged yet'
		);
	} else {
		const noun = responses === 1 ? 'response' : 'responses';
		parts.push(
			`${responses} ${noun} logged${atCap ? ` of the most recent ${receipts.sampleLimit} reports` : ''}`
		);
	}
	if (receipts.pendingCount > 0) {
		parts.push(`${receipts.pendingCount} awaiting response`);
	}
	if (receipts.latestProofDeliveredAt) {
		parts.push(`last report delivered ${formatReportDay(receipts.latestProofDeliveredAt)}`);
	}
	return `${parts.join(' · ')}.`;
}

/** Proof-language absence: no verified actions on record yet. */
export const NO_VERIFIED_ACTIONS_SENTENCE =
	"No verified actions yet — your first campaign's proof packet assembles here.";

/** Proof-language absence: no decision-maker responses on record yet. */
export const NO_RESPONSES_LOGGED_SENTENCE =
	'No responses logged yet — responses you record on a campaign appear here.';

/** Proof-language absence: no proof reports have gone out yet. */
export const NO_REPORTS_DELIVERED_SENTENCE =
	'No proof reports delivered yet — deliver a campaign report and responses are logged here.';
