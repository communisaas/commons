export type PlatformSource =
	| 'csv'
	| 'action_network'
	| 'everyaction'
	| 'nationbuilder'
	| 'mailchimp'
	| 'salsa'
	| 'mobilize'
	| 'actblue'
	| 'engaging_networks'
	| 'civicrm'
	| 'salesforce';

export type PlatformExportProfile = {
	source: Exclude<PlatformSource, 'csv'>;
	label: string;
	matchHeaders: string[];
	minMatches: number;
	requiredAnyHeaders?: string[];
};

export type PeopleImportField =
	| 'email'
	| 'name'
	| 'first_name'
	| 'last_name'
	| 'postalCode'
	| 'stateCode'
	| 'congressionalDistrict'
	| 'phone'
	| 'country'
	| 'tags'
	| 'can_message'
	| 'sms_consent'
	| 'email_consent_source'
	| 'email_consented_at'
	| 'email_consent_text'
	| 'sms_consent_source'
	| 'sms_consented_at'
	| 'sms_consent_text'
	| 'custom';

export type PeopleSource = PlatformSource | 'api' | 'organic' | 'widget' | 'unknown';

export type PeopleSourceLabelStyle = 'filter' | 'record';

export const PEOPLE_IMPORT_FIELD_ALIASES: Record<string, PeopleImportField> = {
	email: 'email',
	email_address: 'email',
	'email address': 'email',
	emailaddress: 'email',
	'primary email': 'email',
	'preferred email': 'email',
	'email 1': 'email',
	e_mail: 'email',
	name: 'name',
	full_name: 'name',
	'full name': 'name',
	first_name: 'first_name',
	'first name': 'first_name',
	firstname: 'first_name',
	first: 'first_name',
	given_name: 'first_name',
	'given name': 'first_name',
	last_name: 'last_name',
	'last name': 'last_name',
	lastname: 'last_name',
	last: 'last_name',
	family_name: 'last_name',
	'family name': 'last_name',
	postal_code: 'postalCode',
	postalcode: 'postalCode',
	postal: 'postalCode',
	postcode: 'postalCode',
	zip: 'postalCode',
	zip5: 'postalCode',
	zip_code: 'postalCode',
	'zip code': 'postalCode',
	'zip/postal': 'postalCode',
	zipcode: 'postalCode',
	state: 'stateCode',
	'state code': 'stateCode',
	state_code: 'stateCode',
	province: 'stateCode',
	'province code': 'stateCode',
	region: 'stateCode',
	'mailing state': 'stateCode',
	'mailing state/province': 'stateCode',
	'mailing province': 'stateCode',
	'congressional district': 'congressionalDistrict',
	congressional_district: 'congressionalDistrict',
	'congressional district code': 'congressionalDistrict',
	congressional_district_code: 'congressionalDistrict',
	'us congressional district': 'congressionalDistrict',
	'us congressional district code': 'congressionalDistrict',
	cd: 'congressionalDistrict',
	'cd code': 'congressionalDistrict',
	phone: 'phone',
	phone_number: 'phone',
	'phone number': 'phone',
	'mobile phone': 'phone',
	mobile: 'phone',
	cell: 'phone',
	'cell phone': 'phone',
	phone1: 'phone',
	country: 'country',
	'country code': 'country',
	tags: 'tags',
	tag: 'tags',
	'tag list': 'tags',
	'tag names': 'tags',
	tag_names: 'tags',
	'activist codes': 'tags',
	groups: 'tags',
	group: 'tags',
	lists: 'tags',
	interests: 'tags',
	can_message: 'can_message',
	'can message': 'can_message',
	'can receive email': 'can_message',
	'email opt in': 'can_message',
	'email opt-in': 'can_message',
	email_opt_in: 'can_message',
	email_status: 'can_message',
	'email status': 'can_message',
	'opt in status': 'can_message',
	'subscription status': 'can_message',
	'email marketing status': 'can_message',
	'marketing permissions': 'can_message',
	'email consent source': 'email_consent_source',
	email_consent_source: 'email_consent_source',
	'email consent date': 'email_consented_at',
	'email consent time': 'email_consented_at',
	'email opted in at': 'email_consented_at',
	email_consented_at: 'email_consented_at',
	'email consent text': 'email_consent_text',
	email_consent_text: 'email_consent_text',
	'email opt-in text': 'email_consent_text',
	sms_consent: 'sms_consent',
	can_text: 'sms_consent',
	'can text': 'sms_consent',
	sms_status: 'sms_consent',
	sms_opt_in: 'sms_consent',
	'sms opt in': 'sms_consent',
	'sms consent source': 'sms_consent_source',
	sms_consent_source: 'sms_consent_source',
	'sms consent date': 'sms_consented_at',
	'sms consent time': 'sms_consented_at',
	'sms opted in at': 'sms_consented_at',
	sms_consented_at: 'sms_consented_at',
	'sms consent text': 'sms_consent_text',
	sms_consent_text: 'sms_consent_text',
	'sms opt-in text': 'sms_consent_text',
	'donor email': 'email',
	'donor first name': 'first_name',
	'donor last name': 'last_name',
	'donor zip': 'postalCode',
	'donor postal code': 'postalCode',
	'mailing zip': 'postalCode',
	'mailing postal code': 'postalCode',
	'mailing country': 'country',
	'primary phone': 'phone',
	'mobile phone number': 'phone'
};

export const PLATFORM_EXPORT_PROFILES: PlatformExportProfile[] = [
	{
		source: 'action_network',
		label: 'Action Network',
		matchHeaders: [
			'email address',
			'first name',
			'last name',
			'zip code',
			'can_message',
			'can message'
		],
		minMatches: 4
	},
	{
		source: 'everyaction',
		label: 'EveryAction / NGP VAN',
		matchHeaders: ['vanid', 'contactid', 'activist codes', 'can receive email', 'preferred email'],
		minMatches: 2
	},
	{
		source: 'nationbuilder',
		label: 'NationBuilder',
		matchHeaders: ['nationbuilder_id', 'signup id', 'nbec guid', 'support level', 'tags'],
		minMatches: 2
	},
	{
		source: 'mailchimp',
		label: 'Mailchimp',
		matchHeaders: ['email address', 'email marketing status', 'opt-in time', 'member rating'],
		minMatches: 2
	},
	{
		source: 'salsa',
		label: 'Salsa Engage',
		matchHeaders: [
			'supporter id',
			'supporterid',
			'email',
			'email address',
			'first name',
			'last name',
			'groups'
		],
		minMatches: 3,
		requiredAnyHeaders: ['supporter id', 'supporterid', 'salsa supporter id']
	},
	{
		source: 'mobilize',
		label: 'Mobilize',
		matchHeaders: [
			'email',
			'email address',
			'first name',
			'last name',
			'phone number',
			'zipcode',
			'event name',
			'event id',
			'signup status'
		],
		minMatches: 4,
		requiredAnyHeaders: ['event name', 'event id', 'signup status', 'shift start']
	},
	{
		source: 'actblue',
		label: 'ActBlue',
		matchHeaders: [
			'donor email',
			'donor first name',
			'donor last name',
			'donor zip',
			'contribution amount',
			'amount'
		],
		minMatches: 3,
		requiredAnyHeaders: ['donor email', 'contribution amount', 'recipient committee']
	},
	{
		source: 'engaging_networks',
		label: 'Engaging Networks',
		matchHeaders: [
			'supporter id',
			'constituent id',
			'email address',
			'first name',
			'last name',
			'campaign opt in'
		],
		minMatches: 3,
		requiredAnyHeaders: ['constituent id', 'campaign opt in']
	},
	{
		source: 'civicrm',
		label: 'CiviCRM',
		matchHeaders: [
			'contact id',
			'external identifier',
			'contact type',
			'email',
			'first name',
			'last name',
			'postal code'
		],
		minMatches: 3,
		requiredAnyHeaders: ['external identifier', 'contact type']
	},
	{
		source: 'salesforce',
		label: 'Salesforce / Nonprofit Cloud',
		matchHeaders: [
			'salesforce id',
			'contact id',
			'account id',
			'email',
			'first name',
			'last name',
			'mailing zip'
		],
		minMatches: 3,
		requiredAnyHeaders: ['salesforce id', 'account id']
	}
];

const PLATFORM_EXPORT_PROFILE_BY_SOURCE = new Map(
	PLATFORM_EXPORT_PROFILES.map((profile) => [profile.source, profile])
);

export const PEOPLE_SOURCE_FILTER_OPTIONS: Array<{ value: PeopleSource; label: string }> = [
	{ value: 'csv', label: 'CSV' },
	...PLATFORM_EXPORT_PROFILES.map((profile) => ({
		value: profile.source,
		label: profile.label
	})),
	{ value: 'api', label: 'Public API' },
	{ value: 'organic', label: 'Organic' },
	{ value: 'widget', label: 'Widget' },
	{ value: 'unknown', label: 'Unknown source' }
];

export const PEOPLE_SOURCE_SEGMENT_OPTIONS: Array<{ value: PeopleSource; label: string }> =
	PEOPLE_SOURCE_FILTER_OPTIONS.map((option) =>
		option.value === 'csv' ? { ...option, label: 'CSV Import' } : option
	);

export function formatPeopleSourceLabel(
	source: string | null | undefined,
	options: { style?: PeopleSourceLabelStyle; fallback?: string } = {}
): string {
	const style = options.style ?? 'filter';
	const fallback = options.fallback ?? '\u2014';
	if (!source) return fallback;

	if (source === 'csv') return style === 'record' ? 'CSV export' : 'CSV';
	if (source === 'api') return 'Public API';
	if (source === 'organic') return style === 'record' ? 'Organic signup' : 'Organic';
	if (source === 'widget') return style === 'record' ? 'Reader action' : 'Widget';
	if (source === 'unknown') return 'Unknown source';

	const profile = PLATFORM_EXPORT_PROFILE_BY_SOURCE.get(source as Exclude<PlatformSource, 'csv'>);
	if (profile) return style === 'record' ? `${profile.label} export` : profile.label;

	const readable = source.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
	return readable ? readable : fallback;
}

export function normalizePlatformExportHeader(header: string): string {
	return header.toLowerCase().trim().replace(/\s+/g, ' ');
}

export function detectPlatformExportProfile(headers: string[]): PlatformExportProfile | null {
	const headerSet = new Set(headers.map(normalizePlatformExportHeader));
	return (
		PLATFORM_EXPORT_PROFILES.find((profile) => {
			if (
				profile.requiredAnyHeaders?.length &&
				!profile.requiredAnyHeaders.some((header) => headerSet.has(header))
			) {
				return false;
			}
			const matches = profile.matchHeaders.filter((header) => headerSet.has(header)).length;
			return matches >= profile.minMatches;
		}) ?? null
	);
}
