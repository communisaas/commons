import { absent, present, type Fact } from '$lib/core/fact';

/**
 * A governmental registry class answers only whether the address's domain is
 * inside a closed, registration-restricted government namespace. It does not
 * establish that the mailbox belongs to an officeholder or even to a person:
 * `info@city.gov` is governmental by registry and may still be a general office
 * route. Callers must keep that question separate.
 *
 * The matcher is deliberately network-free and grant-only. A namespace not
 * listed here returns a negative finding even when its owner may in fact be a
 * government. False negatives preserve stricter moderation; false positives
 * could relax moderation for a private recipient.
 */

export type GovernmentalBasis =
	| 'us-federal-registry'
	| 'us-state-registry'
	| 'foreign-government-registry';

export type GovernmentalClass =
	| { governmental: true; basis: GovernmentalBasis; registryDomain: string }
	| { governmental: false; reason: 'not-a-government-registry' }
	| { governmental: false; reason: 'no-address' };

type AddressObservation = Extract<Fact<string>, { state: 'present' | 'absent' }>;

// CISA restricts .gov to verified U.S. government organizations, and .mil is
// delegated to the Department of Defense's registry:
// https://get.gov/domains/eligibility/
// https://www.iana.org/domains/root/db/mil.html
const US_RESTRICTED_TOP_LEVEL_DOMAINS = ['gov', 'mil'] as const;

// RFC 1480 defines STATE, CI and CO as government branches inside the legacy
// .us locality hierarchy, and FED as the federal-government branch:
// https://www.rfc-editor.org/rfc/rfc1480.html
const US_STATE_AND_TERRITORY_CODES = new Set([
	'al',
	'ak',
	'az',
	'ar',
	'ca',
	'co',
	'ct',
	'de',
	'fl',
	'ga',
	'hi',
	'id',
	'il',
	'in',
	'ia',
	'ks',
	'ky',
	'la',
	'me',
	'md',
	'ma',
	'mi',
	'mn',
	'ms',
	'mo',
	'mt',
	'ne',
	'nv',
	'nh',
	'nj',
	'nm',
	'ny',
	'nc',
	'nd',
	'oh',
	'ok',
	'or',
	'pa',
	'ri',
	'sc',
	'sd',
	'tn',
	'tx',
	'ut',
	'vt',
	'va',
	'wa',
	'wv',
	'wi',
	'wy',
	'dc',
	'as',
	'gu',
	'mp',
	'pr',
	'vi'
]);

// Each namespace is registration-restricted by its government operator. Keep
// this list closed: a plausible-looking suffix is not enough to add a grant.
// Sources:
// https://www.gov.uk/government/publications/list-of-gov-uk-domain-names
// https://www.canada.ca/en/government/system/digital-government/policies-standards/enterprise-it-service-common-configurations/email.html
// https://www.digital.govt.nz/standards-and-guidance/technology-and-architecture/domain-names
// https://www.auda.org.au/au-domain-names/the-different-au-domain-names/gov-au-domain-names/
const FOREIGN_GOVERNMENT_REGISTRY_DOMAINS = ['gov.uk', 'gc.ca', 'govt.nz', 'gov.au'] as const;

function observeAddress(email: string | undefined): AddressObservation {
	const normalized = email?.trim();
	return normalized ? present(normalized) : absent();
}

export function emailDomain(email: string): string | undefined {
	if (email.length > 320 || /\s/.test(email)) return undefined;

	const firstAt = email.indexOf('@');
	if (firstAt <= 0 || firstAt !== email.lastIndexOf('@') || firstAt === email.length - 1) {
		return undefined;
	}

	const localPart = email.slice(0, firstAt);
	if (
		localPart.length > 64 ||
		localPart.startsWith('.') ||
		localPart.endsWith('.') ||
		localPart.includes('..') ||
		!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart)
	) {
		return undefined;
	}

	const domain = email.slice(firstAt + 1).toLowerCase();
	if (domain.length > 253) return undefined;

	const labels = domain.split('.');
	if (
		labels.length < 2 ||
		labels.some(
			(label) =>
				label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
		)
	) {
		return undefined;
	}

	return domain;
}

function matchesRegistryDomain(domain: string, registryDomain: string): boolean {
	return domain === registryDomain || domain.endsWith(`.${registryDomain}`);
}

function classifyUsRegistry(domain: string): GovernmentalClass | undefined {
	const topLevelDomain = domain.slice(domain.lastIndexOf('.') + 1);
	if (US_RESTRICTED_TOP_LEVEL_DOMAINS.some((registry) => registry === topLevelDomain)) {
		return {
			governmental: true,
			basis: 'us-federal-registry',
			registryDomain: topLevelDomain
		};
	}

	if (matchesRegistryDomain(domain, 'fed.us')) {
		return { governmental: true, basis: 'us-federal-registry', registryDomain: 'fed.us' };
	}

	const labels = domain.split('.');
	if (labels.at(-1) !== 'us') return undefined;

	const stateCode = labels.at(-2);
	if (!stateCode || !US_STATE_AND_TERRITORY_CODES.has(stateCode)) return undefined;

	if (labels.at(-3) === 'state') {
		return {
			governmental: true,
			basis: 'us-state-registry',
			registryDomain: `state.${stateCode}.us`
		};
	}

	const locality = labels.at(-3);
	const branch = labels.at(-4);
	if (locality && (branch === 'ci' || branch === 'co')) {
		return {
			governmental: true,
			basis: 'us-state-registry',
			registryDomain: `${branch}.${locality}.${stateCode}.us`
		};
	}

	return undefined;
}

/** Classify one final, post-resolution candidate address. */
export function classifyGovernmentalAddress(email: string | undefined): GovernmentalClass {
	const address = observeAddress(email);
	if (address.state === 'absent') {
		return { governmental: false, reason: 'no-address' };
	}

	const domain = emailDomain(address.value);
	if (!domain) return { governmental: false, reason: 'not-a-government-registry' };

	const usRegistry = classifyUsRegistry(domain);
	if (usRegistry) return usRegistry;

	const foreignRegistry = FOREIGN_GOVERNMENT_REGISTRY_DOMAINS.find((registry) =>
		matchesRegistryDomain(domain, registry)
	);
	if (foreignRegistry) {
		return {
			governmental: true,
			basis: 'foreign-government-registry',
			registryDomain: foreignRegistry
		};
	}

	return { governmental: false, reason: 'not-a-government-registry' };
}
