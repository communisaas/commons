/**
 * People reach derivations — pure functions behind the People space.
 *
 * The People surface answers four org questions: who do we have, can we
 * reach them, what permission is on file, and how do we slice them. These
 * helpers turn the layout-loaded `BaseSpaceData` slice — the supporter
 * summary plus the saved-segment shape — into plain sentences so the
 * component renders answers, not raw counters.
 *
 * Copy register follows the staffer-legible evidence doctrine
 * (docs/design/VERIFICATION-LEGIBILITY.md): plain nouns an organizer already
 * uses, absence stated as a sentence rather than a zero, and honesty about
 * what a number does and does not prove.
 */

import type { BaseSpaceData, PeopleSegmentationGroundData } from './spaces';

function fmt(n: number): string {
	return n.toLocaleString('en-US');
}

/**
 * The list headline: "2,140 people · 1,890 with usable addresses ·
 * 412 identity-verified". Zero stages are omitted rather than rendered as
 * bare zeros — the pipeline below carries the full funnel.
 */
export function describePeopleOnFile(
	data: Pick<BaseSpaceData, 'total' | 'postalResolved' | 'identityVerified'>
): string {
	const parts = [`${fmt(data.total)} ${data.total === 1 ? 'person' : 'people'}`];
	if (data.postalResolved > 0) {
		parts.push(`${fmt(data.postalResolved)} with usable addresses`);
	}
	if (data.identityVerified > 0) {
		parts.push(`${fmt(data.identityVerified)} identity-verified`);
	}
	return parts.join(' · ');
}

/**
 * Email reach as a sentence: "1,204 reachable by email · 18 unsubscribed ·
 * 3 bounced or complained". Reachable means currently subscribed; bounced
 * and complained addresses are grouped because both are undeliverable.
 */
export function describeEmailReach(emailHealth: BaseSpaceData['emailHealth']): string {
	const undeliverable = emailHealth.bounced + emailHealth.complained;
	const recorded = emailHealth.subscribed + emailHealth.unsubscribed + undeliverable;
	if (recorded === 0) {
		return 'No email reach recorded yet — subscribed addresses appear here as you import them.';
	}
	const parts = [
		emailHealth.subscribed > 0
			? `${fmt(emailHealth.subscribed)} reachable by email`
			: 'No one is reachable by email right now'
	];
	if (emailHealth.unsubscribed > 0) {
		parts.push(`${fmt(emailHealth.unsubscribed)} unsubscribed`);
	}
	if (undeliverable > 0) {
		parts.push(`${fmt(undeliverable)} bounced or complained`);
	}
	return parts.join(' · ');
}

/**
 * Text reach as a sentence. A list with no phone numbers gets a sentence
 * about the missing column, not a row of zeros. Opted out groups people who
 * unsubscribed and people who replied STOP — both mean do not text.
 */
export function describeTextReach(smsHealth: BaseSpaceData['smsHealth']): string {
	if (smsHealth.phonePresent === 0) {
		return 'No phone numbers on file — map a phone column on import to reach people by text.';
	}
	const optedOut = smsHealth.unsubscribed + smsHealth.stopped;
	const parts = [
		smsHealth.subscribed > 0
			? `${fmt(smsHealth.subscribed)} opted in to texts`
			: 'No text opt-ins recorded yet'
	];
	if (optedOut > 0) {
		parts.push(`${fmt(optedOut)} opted out`);
	}
	parts.push(`${fmt(smsHealth.phonePresent)} with a phone number on file`);
	return parts.join(' · ');
}

/**
 * Email consent records as a sentence: "Consent records on file for 940
 * people · 812 currently subscribed". Consent records say where permission
 * came from — that scope honesty is a separate sentence on the surface.
 */
export function describeEmailConsent(
	consentEvidence: BaseSpaceData['consentEvidence']
): string {
	if (consentEvidence.email === 0) return NO_CONSENT_RECORDS_SENTENCE;
	const noun = consentEvidence.email === 1 ? 'person' : 'people';
	return `Consent records on file for ${fmt(consentEvidence.email)} ${noun} · ${fmt(consentEvidence.emailSubscribed)} currently subscribed`;
}

/**
 * Text consent records as a sentence, or null when none exist — the email
 * consent sentence already covers the all-absent state.
 */
export function describeTextConsent(
	consentEvidence: BaseSpaceData['consentEvidence']
): string | null {
	if (consentEvidence.sms === 0) return null;
	const noun = consentEvidence.sms === 1 ? 'person' : 'people';
	return `Text consent records for ${fmt(consentEvidence.sms)} ${noun} · ${fmt(consentEvidence.smsSubscribed)} currently opted in`;
}

/**
 * The condition families saved segments actually slice by, ranked by how
 * often they appear, in plain words. District groups the concrete district
 * filters (imported labels, action-time labels, and action-district
 * evidence); the human-readable-geography rollup is a superset count and is
 * deliberately not ranked, so nothing is counted twice.
 */
export function dominantSegmentFamilies(
	segmentation: PeopleSegmentationGroundData,
	limit = 3
): string[] {
	const families = [
		{
			label: 'by district',
			count:
				segmentation.congressionalDistrictConditionCount +
				segmentation.actionDistrictLabelConditionCount +
				segmentation.actionDistrictHashConditionCount
		},
		{ label: 'by state', count: segmentation.stateCodeConditionCount },
		{ label: 'by country', count: segmentation.postalCountryConditionCount },
		{ label: 'by tag', count: segmentation.tagConditionCount },
		{ label: 'by verification', count: segmentation.verificationConditionCount },
		{ label: 'by source', count: segmentation.sourceConditionCount },
		{ label: 'by email status', count: segmentation.emailStatusConditionCount },
		{ label: 'by date added', count: segmentation.dateConditionCount },
		{
			label: 'by campaign participation',
			count: segmentation.campaignParticipationConditionCount
		},
		{ label: 'by engagement level', count: segmentation.engagementTierConditionCount }
	];
	return families
		.filter((family) => family.count > 0)
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
		.map((family) => family.label);
}

/** "4 saved segments — by district, by tag", or the quiet absence sentence. */
export function describeSavedSegments(segmentation: PeopleSegmentationGroundData): string {
	if (segmentation.segmentCount === 0) return NO_SAVED_SEGMENTS_SENTENCE;
	const noun = segmentation.segmentCount === 1 ? 'saved segment' : 'saved segments';
	const families = dominantSegmentFamilies(segmentation);
	return families.length > 0
		? `${fmt(segmentation.segmentCount)} ${noun} — ${families.join(', ')}`
		: `${fmt(segmentation.segmentCount)} ${noun}`;
}

/** Plain absence: the org has not imported anyone yet. */
export const NO_PEOPLE_SENTENCE = 'No people yet — import your first list.';

/** Unavailable is not zero: the summary read failed for this page view. */
export const PEOPLE_UNAVAILABLE_SENTENCE =
	"People didn't load with this page view — your counts are unavailable right now, not zero. Reload the page to fetch them.";

/** Plain absence: rows exist but carry no import-origin record. */
export const NO_SOURCE_RECORDS_SENTENCE =
	'No source records yet — people you import from now on carry where they came from.';

/** Plain absence: no consent records have been imported. */
export const NO_CONSENT_RECORDS_SENTENCE =
	'No consent records on file yet — map consent columns on import and they stay with each person.';

/**
 * Scope honesty: consent records are where permission came from, kept with
 * each person — they are not, on their own, permission to send.
 */
export const CONSENT_SCOPE_SENTENCE =
	'Consent records show where permission came from — they are not permission to send on their own.';

/** Plain absence: no saved segments exist yet. */
export const NO_SAVED_SEGMENTS_SENTENCE =
	'No saved segments yet — save a filter on your people list and it appears here.';

/** Unavailable is not zero: the saved-segment read failed for this page view. */
export const SEGMENTS_UNAVAILABLE_SENTENCE =
	"Saved segments didn't load with this page view — they're unavailable right now, not gone.";
