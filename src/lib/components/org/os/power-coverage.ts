/**
 * Power coverage derivations — pure functions behind the Power space.
 *
 * The Power surface answers three org questions: who decides, what are they
 * doing, and is our pressure registering. These helpers turn the
 * layout-loaded `LandscapeSpaceData` slice — followed decision-makers,
 * watched bills, and accountability scorecards — into plain sentences so the
 * component renders answers, not raw counters.
 *
 * Copy register follows the staffer-legible evidence doctrine
 * (docs/design/VERIFICATION-LEGIBILITY.md): plain nouns an organizer already
 * uses, absence stated as a sentence rather than a zero, and honesty about
 * what a number does and does not prove.
 */

function fmt(n: number): string {
	return n.toLocaleString('en-US');
}

/**
 * The Power headline: "3 decision-makers followed · 2 bills watched ·
 * 4 scorecards averaging 71". Zero parts are omitted rather than rendered
 * as bare zeros; null when nothing is tracked yet.
 */
export function describePowerPosition(input: {
	followedCount: number;
	watchedBillCount: number;
	scorecardSnapshotCount: number;
	scorecardAvg: number | null;
	legislationEnabled: boolean;
}): string | null {
	const parts: string[] = [];
	if (input.followedCount > 0) {
		parts.push(
			`${fmt(input.followedCount)} decision-maker${input.followedCount === 1 ? '' : 's'} followed`
		);
	}
	if (input.legislationEnabled && input.watchedBillCount > 0) {
		parts.push(`${fmt(input.watchedBillCount)} bill${input.watchedBillCount === 1 ? '' : 's'} watched`);
	}
	if (input.legislationEnabled && input.scorecardSnapshotCount > 0) {
		const noun = input.scorecardSnapshotCount === 1 ? 'scorecard' : 'scorecards';
		parts.push(
			input.scorecardAvg !== null
				? `${fmt(input.scorecardSnapshotCount)} ${noun} averaging ${fmt(input.scorecardAvg)}`
				: `${fmt(input.scorecardSnapshotCount)} ${noun}`
		);
	}
	return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * "4 bills match your issue areas", or null when the relevant-bill read
 * returned nothing — absence of the read is not an empty result.
 */
export function describeRelevantBills(relevantBillCount: number | null): string | null {
	if (relevantBillCount === null || relevantBillCount === 0) return null;
	return relevantBillCount === 1
		? '1 bill matches your issue areas'
		: `${fmt(relevantBillCount)} bills match your issue areas`;
}

/**
 * Report engagement in one sentence: "212 reports received · 96 opened ·
 * 4 replies logged". Null signals are omitted — unknown is not zero — while
 * real zeros render, because no replies despite delivered reports is honest
 * information.
 */
export function describeReportSignals(input: {
	reportsReceived: number;
	reportsOpened: number | null;
	repliesLogged: number | null;
}): string {
	const parts = [
		`${fmt(input.reportsReceived)} report${input.reportsReceived === 1 ? '' : 's'} received`
	];
	if (input.reportsOpened !== null) {
		parts.push(`${fmt(input.reportsOpened)} opened`);
	}
	if (input.repliesLogged !== null) {
		parts.push(
			`${fmt(input.repliesLogged)} ${input.repliesLogged === 1 ? 'reply' : 'replies'} logged`
		);
	}
	return parts.join(' · ');
}

/**
 * Where decision-maker coverage honestly stands: there is no standing
 * directory to browse — congressional targets resolve when an action is
 * written, and state and local officials are looked up per action.
 */
export const DECISION_MAKER_COVERAGE_SENTENCE =
	'Congressional targets resolve automatically when you write an action; state and local officials are looked up per action.';

/**
 * Plain absence: the org is not following anyone yet. The lead is exported
 * separately so the surface can render the closing "find yours" as the link
 * into the decision-maker directory.
 */
export const NO_FOLLOWED_DECISION_MAKERS_LEAD =
	"You're not following any decision-makers yet";
export const NO_FOLLOWED_DECISION_MAKERS_SENTENCE = `${NO_FOLLOWED_DECISION_MAKERS_LEAD} — find yours.`;

/** Plain absence: no bills are being watched yet. */
export const NO_WATCHED_BILLS_SENTENCE =
	'No bills watched yet — watch the ones your actions reference and they appear here.';

/** Plain absence that says how the number gets built, not just that it is zero. */
export const SCORECARDS_BUILD_SENTENCE =
	'Scorecards build as your reports are delivered and answered.';

/** Unavailable is not zero: the decision-maker read failed for this page view. */
export const POWER_UNAVAILABLE_SENTENCE =
	"Power didn't load with this page view — what you track is unavailable right now, not gone. Reload the page to fetch it.";
