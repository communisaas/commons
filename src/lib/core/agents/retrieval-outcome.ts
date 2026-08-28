/**
 * `blocked` is a lower bound, never a census. Firecrawl may transparently pass a wall
 * (we then see a real page) or fail before any body reaches us. Downstream copy may say
 * 'we could not read this page'; it may never report a total count of sites that blocked us.
 */

import { absent, blocked, present, type Fact } from '$lib/core/fact';
import { isUsableContactEmail } from './contact-email';

const RETRIEVAL_SCAN_MAX_CHARACTERS = 200_000;
const GENERIC_INTERSTITIAL_MAX_CHARACTERS = 2_000;
const BLOCKED_STATUS_CODES = new Set([401, 403, 406, 409, 429, 503]);

export type BlockVendor =
	| 'cloudflare'
	| 'akamai'
	| 'imperva'
	| 'perimeterx'
	| 'datadome'
	| 'awswaf'
	| 'vercel'
	| 'radware'
	| 'unknown';

export interface BlockSignal {
	vendor: BlockVendor;
	/**
	 * The literal marker we matched, from the closed lists below. This is never
	 * provider-controlled text and is safe to log.
	 */
	evidence: string;
	statusCode?: number;
}

export type AbsentReason = 'not_found' | 'empty';
export type BlockedReason = 'waf' | 'transport' | 'not_attempted';

type PresentFact<T> = Extract<Fact<T>, { state: 'present' }>;
type BlockedFact = Extract<Fact<never>, { state: 'blocked' }>;
type AbsentFact = Extract<Fact<never>, { state: 'absent' }>;

/**
 * Fetch-specific projection of the shared Fact vocabulary. `present` is exposed
 * as the established `ok` fetch outcome; `blocked` and `absent` retain the shared
 * state names. WITHHELD is deliberately unavailable at page-fetch time.
 */
export type PageRetrievalOutcome<TPage> =
	| { outcome: 'ok'; page: PresentFact<TPage>['value'] }
	| { outcome: BlockedFact['state']; url: string; reason: 'waf'; signal: BlockSignal }
	| {
			outcome: BlockedFact['state'];
			url: string;
			reason: Exclude<BlockedReason, 'waf'>;
			detail?: string;
	  }
	| {
			outcome: AbsentFact['state'];
			url: string;
			reason: AbsentReason;
			statusCode?: number;
	  };

export function pageRetrievalOk<TPage>(page: TPage): PageRetrievalOutcome<TPage> {
	const fact = present(page);
	return { outcome: 'ok', page: fact.value };
}

export function pageRetrievalBlocked<TPage = never>(
	url: string,
	signal: BlockSignal
): PageRetrievalOutcome<TPage>;
export function pageRetrievalBlocked<TPage = never>(
	url: string,
	reason: Exclude<BlockedReason, 'waf'>,
	detail?: string
): PageRetrievalOutcome<TPage>;
export function pageRetrievalBlocked<TPage = never>(
	url: string,
	signalOrReason: BlockSignal | Exclude<BlockedReason, 'waf'>,
	detail?: string
): PageRetrievalOutcome<TPage> {
	if (typeof signalOrReason === 'string') {
		const fact = blocked(detail ?? signalOrReason);
		return {
			outcome: fact.state,
			url,
			reason: signalOrReason,
			...(detail === undefined ? {} : { detail })
		};
	}

	const fact = blocked(signalOrReason.evidence);
	return { outcome: fact.state, url, reason: 'waf', signal: signalOrReason };
}

export function pageRetrievalAbsent<TPage = never>(
	url: string,
	reason: AbsentReason,
	statusCode?: number
): PageRetrievalOutcome<TPage> {
	const fact = absent();
	return {
		outcome: fact.state,
		url,
		reason,
		...(statusCode === undefined ? {} : { statusCode })
	};
}

interface StrongMarkerRule {
	vendor: BlockVendor;
	evidence: string;
	markers: readonly string[];
	policy: 'always' | 'cloudflare-challenge' | 'radware-captcha-title';
}

interface BodyProseRule {
	vendor: BlockVendor;
	evidence: string;
	markers: readonly string[];
}

/**
 * Capture ledger for every surviving strong rule. Each positive is pinned by a
 * named test, and every rule has an HTTP-200 near-miss or a capture-specific
 * conjunction/guard negative control in retrieval-outcome.test.ts.
 *
 * - Cloudflare: verified from the chla.org challenge and the captured HTTP-200
 *   challenge shape.
 * - Akamai: verified from the duke-energy.com, cisco.com, and mayoclinic.org
 *   403 bodies. Cisco and Mayo entity-encode the vendor host as
 *   `errors&#46;edgesuite&#46;net`; matching therefore decodes HTML entities first.
 * - PerimeterX: verified from the zillow.com 403 and wayfair.com 429 bodies.
 * - Vercel: verified from the sutterhealth.org 429 checkpoint.
 * - Radware: verified from the mn.gov HTTP-200 interstitial title. The former
 *   `unusual activity` + `radware` pair was invented and is not a live signal.
 *
 * These are vendor-specific interstitial tokens. None requires an HTTP status
 * because Exa contents never supplies one. Cloudflare and Radware retain their
 * capture-specific title/contact guards; those guards define the live marker
 * shape but never use status as a prerequisite.
 */
const STRONG_MARKER_RULES: readonly StrongMarkerRule[] = [
	{
		vendor: 'cloudflare',
		evidence: '/cdn-cgi/challenge-platform/h/',
		markers: ['/cdn-cgi/challenge-platform/h/'],
		policy: 'cloudflare-challenge'
	},
	{
		vendor: 'akamai',
		evidence: 'errors.edgesuite.net',
		markers: ['errors.edgesuite.net', 'access denied'],
		policy: 'always'
	},
	{
		vendor: 'perimeterx',
		evidence: 'px-captcha',
		markers: ['px-captcha'],
		policy: 'always'
	},
	{
		vendor: 'vercel',
		evidence: 'vercel security checkpoint',
		markers: ['vercel security checkpoint'],
		policy: 'always'
	},
	{
		vendor: 'radware',
		evidence: 'radware bot manager captcha',
		markers: ['radware bot manager captcha'],
		policy: 'radware-captcha-title'
	}
];

/**
 * Interstitial prose that can survive Exa's text extraction even when vendor
 * markers in script/style regions do not. These rules inspect body text only,
 * never the title or raw HTML. They share the generic policy's compact-body and
 * contact-free corroboration and require a known blocked status. Exa supplies no
 * status, so prose alone cannot attribute a block on that path: a missed wall is
 * safer than falsely deleting readable institutional content that quotes it.
 */
const BODY_PROSE_RULES: readonly BodyProseRule[] = [
	{
		vendor: 'cloudflare',
		evidence: 'enable javascript and cookies to continue',
		markers: ['enable javascript and cookies to continue']
	},
	{
		vendor: 'cloudflare',
		evidence: 'cloudflare ray id:',
		markers: ['sorry, you have been blocked', 'cloudflare ray id:']
	}
];

const GENERIC_MARKERS = [
	'just a moment...',
	'checking your browser before accessing',
	'access denied',
	'attention required',
	'pardon our interruption',
	'verify you are human',
	'verifying you are a human',
	'are you a robot',
	'bot detection',
	'request unsuccessful',
	'security checkpoint',
	'403 forbidden',
	'datadome',
	'incident id:',
	// AWS WAF strong marker: unverified — no capture of a block-only token. AWS
	// documents loading this integration host before a user is challenged, so it
	// remains generic and requires status/body/contact corroboration.
	'token.awswaf.com'
] as const;

const VENDOR_WORDS: readonly { vendor: BlockVendor; markers: readonly string[] }[] = [
	{ vendor: 'cloudflare', markers: ['cloudflare'] },
	{ vendor: 'akamai', markers: ['akamai'] },
	{ vendor: 'imperva', markers: ['imperva', 'incapsula'] },
	{ vendor: 'perimeterx', markers: ['perimeterx'] },
	{ vendor: 'datadome', markers: ['datadome'] },
	{ vendor: 'awswaf', markers: ['awswaf', 'aws waf'] },
	{ vendor: 'vercel', markers: ['vercel'] },
	{ vendor: 'radware', markers: ['radware'] }
];

const EMAIL_IN_BODY_RE =
	/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,187}\.[A-Za-z]{2,63}(?![A-Za-z0-9-])/g;
const PHONE_IN_BODY_RE =
	/(?<!\d)(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}(?!\d)/g;
const PHONE_CONTEXT_PREFIX_RE = /(?:tel:|phone\b|call\b)[^0-9]{0,48}$/iu;

const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	apos: "'",
	colon: ':',
	gt: '>',
	lt: '<',
	num: '#',
	period: '.',
	quot: '"',
	sol: '/'
};

function htmlCodePoint(value: number): string | null {
	if (!Number.isSafeInteger(value) || value <= 0 || value > 0x10ffff) return null;
	if (value >= 0xd800 && value <= 0xdfff) return null;
	return String.fromCodePoint(value);
}

/** Decode the entity forms that can hide closed-list markers without a DOM. */
function decodeHtmlEntities(value: string): string {
	return value.replace(
		/&(?:#([0-9]{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]+));/giu,
		(
			entity,
			decimal: string | undefined,
			hexadecimal: string | undefined,
			named: string | undefined
		) => {
			if (decimal !== undefined) return htmlCodePoint(Number.parseInt(decimal, 10)) ?? entity;
			if (hexadecimal !== undefined) {
				return htmlCodePoint(Number.parseInt(hexadecimal, 16)) ?? entity;
			}
			return (named && HTML_NAMED_ENTITIES[named.toLowerCase()]) || entity;
		}
	);
}

function boundedHaystack(parts: readonly string[]): string {
	let haystack = '';
	for (const part of parts) {
		if (haystack.length >= RETRIEVAL_SCAN_MAX_CHARACTERS) break;
		if (haystack.length > 0) haystack += '\n';
		const remaining = RETRIEVAL_SCAN_MAX_CHARACTERS - haystack.length;
		haystack += decodeHtmlEntities(part).slice(0, remaining);
	}
	return haystack.toLowerCase();
}

/**
 * A phone is conservative veto evidence only: it can prevent a generic marker
 * from becoming BLOCKED, but never establishes or returns a contact. Bare digit
 * runs need a nearby phone anchor; separated forms are recognizable as phone
 * notation on their own. Callers pass visible title/text only, never raw HTML,
 * so CDN reference epochs in scripts cannot masquerade as contact evidence.
 */
export function hasUsableRetrievalContact(text: string): boolean {
	if (text.includes('@')) {
		const matches = text.match(EMAIL_IN_BODY_RE);
		if (matches?.some(isUsableContactEmail)) return true;
	}
	if (!/\d{3}/u.test(text)) return false;

	for (const match of text.matchAll(PHONE_IN_BODY_RE)) {
		const candidate = match[0];
		const hasPhonePunctuation = /[().\s-]/u.test(candidate);
		const prefix = text.slice(Math.max(0, (match.index ?? 0) - 48), match.index ?? 0);
		if (hasPhonePunctuation || PHONE_CONTEXT_PREFIX_RE.test(prefix)) return true;
	}
	return false;
}

function strongRuleMatches(
	rule: StrongMarkerRule,
	input: { statusCode?: number; title: string },
	haystack: string,
	visibleContent: string
): boolean {
	if (!rule.markers.every((marker) => haystack.includes(marker))) return false;
	if (rule.policy === 'always') return true;

	const title = input.title.toLowerCase();
	if (rule.policy === 'cloudflare-challenge') {
		const blockedStatus =
			input.statusCode !== undefined && BLOCKED_STATUS_CODES.has(input.statusCode);
		if (blockedStatus) return true;
		const hasChallengeTitle =
			title.includes('just a moment') || title.includes('checking your browser');
		return hasChallengeTitle && !hasUsableRetrievalContact(visibleContent);
	}

	return (
		title.includes('radware bot manager captcha') && !hasUsableRetrievalContact(visibleContent)
	);
}

function signal(vendor: BlockVendor, evidence: string, statusCode?: number): BlockSignal {
	return {
		vendor,
		evidence,
		...(statusCode === undefined ? {} : { statusCode })
	};
}

function vendorFromWords(haystack: string): BlockVendor {
	for (const entry of VENDOR_WORDS) {
		if (entry.markers.some((marker) => haystack.includes(marker))) return entry.vendor;
	}
	return 'unknown';
}

function hasCompactContactFreeBody(text: string, visibleContent: string): boolean {
	return (
		text.length < GENERIC_INTERSTITIAL_MAX_CHARACTERS && !hasUsableRetrievalContact(visibleContent)
	);
}

export function classifyRetrievalBlock(input: {
	statusCode?: number;
	title: string;
	text: string;
	rawHtml?: string;
}): BlockSignal | null {
	const haystack = boundedHaystack([input.title, input.rawHtml ?? '', input.text]);
	const visibleContent = boundedHaystack([input.title, input.text]);
	const bodyText = boundedHaystack([input.text]);

	for (const rule of STRONG_MARKER_RULES) {
		if (strongRuleMatches(rule, input, haystack, visibleContent)) {
			return signal(rule.vendor, rule.evidence, input.statusCode);
		}
	}

	for (const rule of BODY_PROSE_RULES) {
		if (
			rule.markers.every((marker) => bodyText.includes(marker)) &&
			input.statusCode !== undefined &&
			BLOCKED_STATUS_CODES.has(input.statusCode) &&
			hasCompactContactFreeBody(input.text, visibleContent)
		) {
			return signal(rule.vendor, rule.evidence, input.statusCode);
		}
	}

	const genericMarker = GENERIC_MARKERS.find((marker) => haystack.includes(marker));
	if (!genericMarker) return null;

	// A generic phrase cannot turn an unknown status into evidence of a block.
	// On status-less retrievals, only the challenge-specific strong rules above
	// are sufficient. A known status must itself be a blocked response class.
	if (input.statusCode === undefined || !BLOCKED_STATUS_CODES.has(input.statusCode)) return null;
	if (!hasCompactContactFreeBody(input.text, visibleContent)) return null;

	return signal(vendorFromWords(haystack), genericMarker, input.statusCode);
}
