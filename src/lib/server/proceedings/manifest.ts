/**
 * Closed Legistar client manifest.
 *
 * A client slug may only be added with its live measurement recorded here.
 * Slugs cannot be inferred from a city name: on 2026-08-04 only 5 of 9
 * plausible guesses resolved. chicago, philadelphia, sanfrancisco, mesaaz,
 * oaklandca, bostonma, and detroitmi returned HTTP 500 with
 * `LegistarConnectionString setting is not set up in InSite for client:`;
 * nyc and phila returned HTTP 403 with zero bytes; sfgov returned HTTP 400.
 */

export type ProceedingClient = Readonly<{
	slug: string;
	jurisdiction: string;
	jurisdictionLevel: 'municipal' | 'county';
	measuredAt: string;
	measuredBodies: number;
	measuredActiveBodies: number;
	measuredContactEmails: number;
}>;

export const PROCEEDING_CLIENTS: readonly ProceedingClient[] = Object.freeze([
	Object.freeze({
		slug: 'seattle',
		jurisdiction: 'Seattle, WA',
		jurisdictionLevel: 'municipal' as const,
		measuredAt: '2026-08-04',
		measuredBodies: 83,
		measuredActiveBodies: 19,
		measuredContactEmails: 0
	}),
	Object.freeze({
		slug: 'baltimore',
		jurisdiction: 'Baltimore, MD',
		jurisdictionLevel: 'municipal' as const,
		measuredAt: '2026-08-04',
		measuredBodies: 257,
		measuredActiveBodies: 194,
		measuredContactEmails: 7
	}),
	Object.freeze({
		slug: 'alexandria',
		jurisdiction: 'Alexandria, VA',
		jurisdictionLevel: 'municipal' as const,
		measuredAt: '2026-08-04',
		measuredBodies: 10,
		measuredActiveBodies: 10,
		measuredContactEmails: 4
	}),
	Object.freeze({
		slug: 'kingcounty',
		jurisdiction: 'King County, WA',
		jurisdictionLevel: 'county' as const,
		measuredAt: '2026-08-04',
		measuredBodies: 151,
		measuredActiveBodies: 83,
		measuredContactEmails: 0
	}),
	Object.freeze({
		slug: 'sanjose',
		jurisdiction: 'San José, CA',
		jurisdictionLevel: 'municipal' as const,
		measuredAt: '2026-08-04',
		measuredBodies: 42,
		measuredActiveBodies: 38,
		measuredContactEmails: 5
	})
]);

export const REFUSED_ENDPOINT_PATTERNS = Object.freeze([
	'/docket',
	'/ex-parte',
	'/staff-assigned',
	'/service-list'
] as const);

function normalizedPolicyPath(path: string): string {
	let decoded = path;
	try {
		decoded = decodeURIComponent(path);
	} catch {
		// An invalid escape cannot create an allowed endpoint from a refused one.
	}

	return decoded
		.replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
}

/**
 * GOAL invariant 9 refuses commission-staff contact mid-proceeding. R7 ships
 * the same capability guard for its registry lane; this lane must not reopen it.
 */
export function assertEndpointAllowed(path: string): void {
	const normalized = `-${normalizedPolicyPath(path)}-`;
	const refused = REFUSED_ENDPOINT_PATTERNS.find((pattern) => {
		const capability = normalizedPolicyPath(pattern);
		return normalized.includes(`-${capability}-`);
	});
	if (refused) {
		throw new Error(`Proceedings endpoint is refused by policy: ${refused}`);
	}
}
