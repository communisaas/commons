export const PAGE_EMAIL_MAX_BYTES = 254;

export const CONTACT_EMAIL_BLOCK_HEADINGS = Object.freeze([
	'--- CONTACT EMAILS (from page links) ---',
	'--- CONTACT EMAILS (from page HTML) ---'
] as const);

export const ROLE_LOCAL_PART_LEXICON: ReadonlySet<string> = Object.freeze(
	new Set([
		'mayor',
		'governor',
		'president',
		'chancellor',
		'provost',
		'superintendent',
		'principal',
		'chief',
		'director',
		'administrator',
		'manager',
		'commissioner',
		'secretary',
		'clerk',
		'cityclerk',
		'boardclerk',
		'treasurer',
		'auditor',
		'sheriff',
		'council',
		'councilmember',
		'board',
		'trustees',
		'regents',
		'supervisor',
		'executive',
		'contact',
		'info',
		'inquiries',
		'inquiry',
		'records',
		'publicrecords',
		'foia',
		'press',
		'media',
		'communications',
		'news',
		'newsroom',
		'planning',
		'permits',
		'zoning',
		'publicworks',
		'health',
		'ombudsman',
		'patientrelations',
		'patientadvocate',
		'compliance',
		'legal',
		'generalcounsel',
		'government',
		'governmentaffairs',
		'publicaffairs',
		'communityrelations',
		'constituentservices',
		'citizenservices',
		'ask',
		'feedback',
		'comments',
		'testimony',
		'hearings'
	])
);

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function isUsableContactEmail(email: string): boolean {
	if (utf8ByteLength(email) > PAGE_EMAIL_MAX_BYTES) return false;
	const lower = email.toLowerCase();
	return !(
		lower.endsWith('.png') ||
		lower.endsWith('.jpg') ||
		lower.endsWith('.jpeg') ||
		lower.endsWith('.gif') ||
		lower.endsWith('.svg') ||
		lower.endsWith('.webp') ||
		lower.endsWith('.avif') ||
		lower.endsWith('.bmp') ||
		lower.endsWith('.ico') ||
		lower.endsWith('.tif') ||
		lower.endsWith('.tiff') ||
		lower.includes('noreply') ||
		lower.includes('no-reply') ||
		lower.includes('example.com') ||
		lower.includes('sentry.io') ||
		lower.includes('webpack') ||
		lower.includes('localhost')
	);
}

export function hasRoleFormLocalPart(email: string): boolean {
	const separator = email.indexOf('@');
	const localPart = (separator === -1 ? email : email.slice(0, separator)).toLowerCase();
	return (
		ROLE_LOCAL_PART_LEXICON.has(localPart) ||
		localPart.split(/[._+-]/u).some((segment) => ROLE_LOCAL_PART_LEXICON.has(segment))
	);
}

export function orderContactEmails(text: string, emails: readonly string[]): string[] {
	const structuralOffsets = CONTACT_EMAIL_BLOCK_HEADINGS.map((heading) =>
		text.indexOf(heading)
	).filter((offset) => offset !== -1);
	const structuralStart =
		structuralOffsets.length > 0 ? Math.min(...structuralOffsets) : Number.POSITIVE_INFINITY;
	const normalizedText = text.toLowerCase();

	return emails
		.map((email, index) => {
			const normalizedEmail = email.toLowerCase();
			const firstIndex = normalizedText.indexOf(normalizedEmail);
			const structuralIndex = normalizedText.indexOf(normalizedEmail, structuralStart);
			const tier = hasRoleFormLocalPart(email) ? 0 : structuralIndex !== -1 ? 1 : 2;
			return {
				email,
				index,
				sourceIndex: tier === 1 ? structuralIndex : firstIndex,
				tier
			};
		})
		.sort((left, right) =>
			left.tier !== right.tier
				? left.tier - right.tier
				: left.sourceIndex !== right.sourceIndex
					? left.sourceIndex - right.sourceIndex
					: left.index - right.index
		)
		.map(({ email }) => email);
}

export function stripNonContentMarkup(html: string): string {
	return html
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, ' ')
		.replace(/<!--[\s\S]*?-->/gu, ' ');
}
