/** This closed lexicon gates an ANONYMOUS CRAWLABLE surface and fails closed: keeping a role address private is acceptable, publishing a named person's address is not, and additions require the same standard. */
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
