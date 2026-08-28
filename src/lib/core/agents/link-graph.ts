/**
 * Same-institution link graph — registrable-domain filtering over already-fetched bytes.
 *
 * This module adds no network call. It reads the link list a page scrape already
 * returned and keeps only the links that belong to the *same institution* as the
 * page they came from. "Same institution" means "same registrable domain", which
 * is why `registrableDomain()` exists here at all: without it `sfusd.k12.ca.us`
 * and `lausd.k12.ca.us` collapse into one entity and a downstream consumer would
 * hop out of one school district and into another.
 *
 * Four limits are deliberate and must be understood before this output is trusted:
 *
 * 1. THE SUFFIX TABLE IS PSL-LITE, NOT THE PUBLIC SUFFIX LIST.
 *    `MULTI_LABEL_PUBLIC_SUFFIXES` covers the handful of multi-label suffixes that
 *    actually show up in civic-institution hostnames (UK/AU/NZ/CA/JP/BR government
 *    and education space) plus the structured `.us` locality scheme. Any multi-label
 *    suffix that is NOT listed degrades to "last label only" and therefore
 *    OVER-FUSES: two unrelated organisations under, say, `*.com.pl` will be reported
 *    as the same institution. That is a known, accepted false-merge, not a bug to be
 *    silently patched by widening the table one entry at a time.
 *
 * 2. NO NPM DEPENDENCY MAY REPLACE THE TABLE.
 *    Not `tldts`, not `psl`, not any bundled-PSL package. Production runs on
 *    Cloudflare Workers: no Node built-ins, a hard bundle budget, and no appetite
 *    for shipping a ~200KB suffix list to the edge. If the table is wrong, fix the
 *    table.
 *
 * 3. RETENTION IS FIRST-N-IN-DOCUMENT-ORDER, NOT BEST-N.
 *    `sameInstitutionLinks()` walks the raw link array in document order and stops
 *    the moment it has kept `LINK_GRAPH_RETAIN_LIMIT` links. It does not rank,
 *    score, or sort. A nav-heavy page can therefore spend the entire budget on
 *    header/menu links and crowd out a footer `/contact` that a caller would have
 *    considered the single most valuable link on the page. Any consumer that treats
 *    this list as a complete or prioritised view of the site is reading it wrong:
 *    it is a cheap, order-preserving sample, and absence from it proves nothing.
 *
 * 4. `undefined` AND `[]` ARE DIFFERENT FACTS. NEVER COLLAPSE THEM.
 *    `sameInstitutionLinks()` returns `undefined` when NO LINK GRAPH COULD BE
 *    EVALUATED on this path — the scrape carried no link array at all, or the page
 *    URL could not be anchored. It returns `[]` only when a link array WAS carried,
 *    WAS scanned, and zero entries survived same-registrable-domain filtering. The
 *    "page URL unanchorable" sub-case is folded into `undefined` on purpose: like the
 *    missing-array case it means "no link graph was produced", never "one was produced
 *    and came back empty". (That sub-case is unreachable from `readPage`, which
 *    normalizes `url` through `normalizeExternalHttpUrl` before the call site — see
 *    exa-search.ts; it exists for direct callers.) Defensively initialising the result
 *    to `[]` anywhere on this path destroys the distinction and is an outright bug:
 *    "we never looked" would start reporting itself as "we looked and found nothing".
 *
 * Import note: `normalizeExternalHttpUrl` is imported from `./exa-search`, which
 * imports this module back. The cycle is benign ONLY because neither module
 * touches the imported binding at module-evaluation time — every reference lives
 * inside a function body. Keep it that way.
 *
 * @module agents/link-graph
 */

import { normalizeExternalHttpUrl } from './exa-search';

/** Maximum raw link entries inspected per page, regardless of how many were scraped. */
export const LINK_GRAPH_SCAN_LIMIT = 1024;

/** Maximum same-institution links retained per page (first-N in document order). */
export const LINK_GRAPH_RETAIN_LIMIT = 32;

/**
 * Multi-label public suffixes seen in civic-institution hostnames. Deliberately
 * small — see limit (1) in the module header. Entries are `<label>.<tld>` pairs
 * compared against the final two labels of a hostname.
 */
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
	'co.uk',
	'org.uk',
	'ac.uk',
	'gov.uk',
	'sch.uk',
	'nhs.uk',
	'com.au',
	'net.au',
	'org.au',
	'edu.au',
	'gov.au',
	'co.nz',
	'govt.nz',
	'ac.nz',
	'gc.ca',
	'on.ca',
	'qc.ca',
	'bc.ca',
	'ab.ca',
	'co.jp',
	'ne.jp',
	'or.jp',
	'go.jp',
	'com.br',
	'gov.br',
	'edu.br'
]);

/**
 * `.us` locality-scheme second-level types. Under `<state>.us` these behave as
 * public suffixes, so `sfusd.k12.ca.us` and `lausd.k12.ca.us` are distinct
 * registrable domains rather than one fused `k12.ca.us` entity.
 */
const US_LOCALITY_TYPES = new Set([
	'k12',
	'cc',
	'lib',
	'city',
	'town',
	'vil',
	'co',
	'ci',
	'state',
	'gen',
	'mus',
	'dst',
	'pvt',
	'tec'
]);

const IPV4_LITERAL = /^\d+\.\d+\.\d+\.\d+$/u;
const US_STATE_LABEL = /^[a-z]{2}$/u;

/**
 * Registrable domain (one label plus its public suffix) for a hostname, or `null`
 * when the hostname has no registrable domain of its own — a bare public suffix
 * (`gov.uk`, `city.ca.us`), a single label (`localhost`), or an IP literal.
 *
 * Callers use equality of this value as the "same institution" test. `null` is
 * never equal to anything, including another `null`.
 */
export function registrableDomain(hostname: string): string | null {
	if (typeof hostname !== 'string') return null;
	const raw = hostname.trim().toLowerCase().replace(/\.$/u, '');
	if (raw.length === 0) return null;
	// IPv6 literals arrive bracketed or colon-bearing; neither has a registrable domain.
	if (raw.includes(':') || raw.startsWith('[') || raw.endsWith(']')) return null;
	if (IPV4_LITERAL.test(raw)) return null;

	const labels = raw.split('.');
	if (labels.length < 2 || labels.some((label) => label.length === 0)) return null;

	// Number of trailing labels that form the public suffix.
	let suffixLabels = 1;
	const lastTwo = `${labels[labels.length - 2]}.${labels[labels.length - 1]}`;
	if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
		suffixLabels = 2;
	} else if (labels[labels.length - 1] === 'us' && US_STATE_LABEL.test(labels[labels.length - 2])) {
		// `<state>.us` is a public suffix, and `<type>.<state>.us` extends it.
		suffixLabels = 2;
		const localityType = labels.length >= 3 ? labels[labels.length - 3] : undefined;
		if (localityType !== undefined && US_LOCALITY_TYPES.has(localityType)) {
			suffixLabels = 3;
		}
	}

	// Underflow guard: a hostname that IS the public suffix has no registrable
	// domain. `city.ca.us`, `k12.ca.us` and `co.us` land here and must return null
	// rather than joining zero labels onto the suffix.
	if (labels.length <= suffixLabels) return null;

	return labels.slice(labels.length - suffixLabels - 1).join('.');
}

function positiveIntegerOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function hostnameOf(normalizedUrl: string): string | null {
	try {
		return new URL(normalizedUrl).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Filter an untrusted, already-fetched link array down to same-institution links.
 *
 * Order-preserving and non-ranking: entries are inspected in document order and
 * retention stops at the first `limit` keepers. Relative hrefs are resolved
 * against the page URL; anything `normalizeExternalHttpUrl` rejects (non-http(s)
 * schemes such as `mailto:`/`tel:`/`javascript:`, private or loopback hosts,
 * oversized URLs) is dropped, as is the page's own URL.
 *
 * Return contract — three states, and they are three different facts (see limit (4)
 * in the module header):
 *
 * - `undefined` — NO LINK GRAPH WAS EVALUABLE on this path. Either `rawLinks` was not
 *   an array (the scrape carried no link list), or `pageUrl` could not be anchored to
 *   a usable external URL. The "unanchorable page URL" sub-case is folded in here on
 *   purpose: both mean "no link graph was produced", never "produced and empty". It is
 *   unreachable from `readPage`, which normalizes `url` through
 *   `normalizeExternalHttpUrl` before calling; it exists for direct callers.
 * - `[]` — a link array WAS carried, WAS scanned, and zero entries survived filtering.
 * - non-empty — survivors, in document order, at most `limit` of them.
 *
 * Consumers must test for absence BEFORE testing for emptiness. Collapsing the two
 * turns "we never looked" into "we looked and found nothing".
 *
 * @param pageUrl - URL the links were scraped from
 * @param rawLinks - untrusted link array straight off the scrape payload
 * @returns normalized, deduped, same-registrable-domain URLs; `[]` when a link graph
 *   was evaluated with zero survivors; `undefined` when none could be evaluated
 */
export function sameInstitutionLinks(
	pageUrl: string,
	rawLinks: unknown,
	opts?: { scanLimit?: number; limit?: number }
): string[] | undefined {
	if (!Array.isArray(rawLinks)) return undefined;
	const normalizedPage = normalizeExternalHttpUrl(pageUrl);
	if (!normalizedPage) return undefined;

	const pageHostname = hostnameOf(normalizedPage);
	if (!pageHostname) return undefined;
	const pageDomain = registrableDomain(pageHostname);

	const scanLimit = positiveIntegerOr(opts?.scanLimit, LINK_GRAPH_SCAN_LIMIT);
	const limit = positiveIntegerOr(opts?.limit, LINK_GRAPH_RETAIN_LIMIT);

	const kept: string[] = [];
	const seen = new Set<string>();
	const scanned = Math.min(rawLinks.length, scanLimit);

	for (let index = 0; index < scanned; index++) {
		if (kept.length >= limit) break;
		const link = rawLinks[index];
		if (typeof link !== 'string') continue;

		let absolute: string;
		try {
			absolute = new URL(link, normalizedPage).toString();
		} catch {
			continue;
		}

		const normalizedLink = normalizeExternalHttpUrl(absolute);
		if (!normalizedLink || normalizedLink === normalizedPage) continue;

		const linkHostname = hostnameOf(normalizedLink);
		if (!linkHostname) continue;

		const linkDomain = registrableDomain(linkHostname);
		const sameInstitution =
			pageDomain !== null && linkDomain !== null
				? pageDomain === linkDomain
				: // IP-literal / single-label hosts have no registrable domain; fall back
					// to exact hostname identity rather than fusing them with anything.
					linkHostname === pageHostname;
		if (!sameInstitution) continue;

		const dedupeKey = normalizedLink.toLowerCase();
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		kept.push(normalizedLink);
	}

	return kept;
}
