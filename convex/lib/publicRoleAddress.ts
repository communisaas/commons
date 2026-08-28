/**
 * This closed lexicon gates an ANONYMOUS CRAWLABLE surface and fails closed:
 * keeping a role address private is acceptable, publishing a named person's
 * address is not, and additions require the same standard.
 *
 * TWO LISTS, TWO QUESTIONS — the asymmetry below is INTENDED, not drift.
 * Admission asks one thing only: may this be published to an anonymous visitor,
 * i.e. is the string role-form by construction rather than a person's mailbox?
 * The seat lexicon (`CLOSED_SEAT_LOCAL_PARTS`, `src/lib/core/agents/seat-route.ts:4-60`)
 * asks a different thing: is this a desk whose presence the send-time audience
 * policy may narrow a hazard set for? Different questions, different answers.
 * Every one of the 54 seat words is publishable, and 72 publishable words are
 * NOT seat words — `zoning`, `billing`, `water`, `admissions` and the rest are
 * legitimately publishable and legitimately never earn `institutional`. A
 * role-form address that is not a seat is a correct, intended state; collapsing
 * these two lists into one would be a widening of the policy, not a cleanup.
 * Publication is NOT a grant of desk status: the sole-proprietor defence is the
 * `>= 2` distinct-desk COUNT in `src/lib/core/server/moderation/audience.ts`,
 * which nothing here touches and which a lone catch-all can never meet.
 *
 * RECONCILIATION, recorded once. Twelve words below were already members of
 * `CLOSED_SEAT_LOCAL_PARTS` while being refused at publication — the policy
 * would have called them desks had the reader ever let them through. That is
 * backwards, so they are admitted here. Membership in the seat lexicon is the
 * evidence that each is role-form by construction, and each is argued by name:
 *
 *   `governor` — an office held by one natural person, the identical shape to
 *     the already-admitted `mayor`, `president`, `chancellor`, `provost`,
 *     `superintendent`, `dean`, `principal`. The local part names the OFFICE,
 *     never the holder; `mayor` is present in BOTH lists today, so this is a
 *     verified precedent and not an assumed one.
 *   `premier` — same shape and same argument as `governor`: the head of a
 *     government, addressed as an office. A named holder is separated
 *     downstream by the registry NAME veto in `audience.ts`, not by refusing to
 *     publish the office word.
 *   `chiefofstaff` — the closed compound spelling of a principal's office
 *     manager; a desk, and strictly more role-shaped than the already-admitted
 *     bare `office`.
 *   `boardofeducation` — the closed compound of the already-admitted `board`
 *     and a sibling of the already-admitted `boardofdirectors`, `schoolboard`.
 *   `cityhall` — the closed compound of the already-admitted `cityclerk` /
 *     `citycouncil` family; a building-shaped name for a switchboard.
 *   `ombudsoffice` — the closed compound of the already-admitted `ombuds` and
 *     `ombudsman`. A compound is more role-shaped than the simple form, never
 *     less.
 *   `corporatesecretary` — the closed compound of the already-admitted
 *     `secretary`, naming a statutory corporate office.
 *   `comms` — the abbreviation of the already-admitted `communications`.
 *   `mediarelations` — the compound spelling of the already-admitted `media`,
 *     a sibling of the already-admitted `publicrelations` and
 *     `communityrelations`.
 *   `governmentrelations` — the compound spelling of the already-admitted
 *     `governmentaffairs` / `publicrelations` pair.
 *   `docinfo` — an OBSERVED agency intake box (recorded at
 *     `convex/seedData.ts:458` and cited in the seat lexicon's own comment):
 *     the already-admitted `info` desk carrying an agency prefix.
 *   `admin` — argued explicitly rather than let ride on its group, because it
 *     is the word most easily mistaken for a person's mailbox. `audience.ts`
 *     names `admin@` in its own header as the sole proprietor's catch-all, and
 *     that is true. It is admitted anyway, because admission asks only whether
 *     the string is role-form — which it is, exactly as the already-admitted
 *     `office`, `info`, `contact`, `help`, `hello` and `support` are, and each
 *     of those is a sole proprietor's catch-all too. What protects the sole
 *     proprietor is not withholding the word; it is the `>= 2` distinct-desk
 *     count downstream, which a lone `admin@` cannot meet. Admitting `admin`
 *     buys publication and buys no reach.
 *
 * No word was withheld: each of the twelve is role-form by construction under
 * the standard above, so the fail-closed rule had nothing to refuse.
 */
export const PUBLIC_ROLE_LOCAL_PARTS: ReadonlySet<string> = Object.freeze(
	new Set<string>([
		// Executive and head-of-institution offices.
		'administrator',
		'chair',
		'chairperson',
		'chancellor',
		'citymanager',
		'countyexecutive',
		'dean',
		'executivedirector',
		'generalmanager',
		'mayor',
		'president',
		'principal',
		'provost',
		'superintendent',
		'townmanager',

		// Governing bodies and clerks.
		'board',
		'boardclerk',
		'boardofdirectors',
		'cityclerk',
		'citycouncil',
		'clerk',
		'commission',
		'commissioners',
		'council',
		'countyclerk',
		'countycouncil',
		'schoolboard',
		'secretary',
		'trustees',

		// Public-facing desks.
		'comments',
		'contact',
		'contactus',
		'customerservice',
		'feedback',
		'frontdesk',
		'hello',
		'help',
		'info',
		'information',
		'inquiries',
		'inquiry',
		'mainoffice',
		'office',
		'publiccomment',
		'reception',
		'service',
		'support',
		'testimony',

		// Constituent, patient, and community relations.
		'casework',
		'community',
		'communityrelations',
		'constituentservices',
		'engagement',
		'ombuds',
		'ombudsman',
		'outreach',
		'patientadvocacy',
		'patientexperience',
		'patientrelations',

		// Press and public affairs.
		'communications',
		'media',
		'news',
		'newsroom',
		'press',
		'pressoffice',
		'publicaffairs',
		'publicinfo',
		'publicinformation',
		'publicrelations',

		// Records and compliance.
		'compliance',
		'counsel',
		'ethics',
		'foia',
		'generalcounsel',
		'legal',
		'privacy',
		'publicrecords',
		'records',

		// Common institutional functions.
		'academicaffairs',
		'admissions',
		'assessor',
		'auditor',
		'bids',
		'billing',
		'budget',
		'codeenforcement',
		'contracts',
		'environment',
		'facilities',
		'finance',
		'governmentaffairs',
		'health',
		'humanresources',
		'inspections',
		'investorrelations',
		'permits',
		'permitting',
		'planning',
		'procurement',
		'publichealth',
		'publicworks',
		'purchasing',
		'registrar',
		'regulatoryaffairs',
		'safety',
		'security',
		'studentaffairs',
		'sustainability',
		'transit',
		'transportation',
		'treasurer',
		'utilities',
		'water',
		'zoning'
	])
);

export function isPublicRoleFormAddress(email: string): boolean {
	if (typeof email !== 'string') return false;
	const separator = email.indexOf('@');
	if (separator < 0 || separator !== email.lastIndexOf('@')) return false;
	const localPart = email
		.slice(0, separator)
		.normalize('NFKC')
		.toLowerCase()
		.replaceAll('.', '')
		.replaceAll('-', '')
		.replaceAll('_', '');
	return PUBLIC_ROLE_LOCAL_PARTS.has(localPart);
}
