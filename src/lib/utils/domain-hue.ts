/**
 * Domain Hue Resolver — a stable hue angle for every template.
 *
 * Resolves a template's place on the domain-hue spectrum in [0, 360), so the
 * topical landscape can order bands by hue even before the embedding projection
 * has run for every template. Three sources, in priority order:
 *
 *   1. `template.domainHue` — the real embedding projection (projectToHue over
 *      the topic embedding), when present. The continuous, semantically exact
 *      signal; honoured first.
 *   2. The 11 canonical anchor domains — a fixed hue per anchor, drawn straight
 *      from `domain-anchors.json` (the same anchors `projectToHue` interpolates
 *      against). Matched by domain wording so "Public Health" lands on the
 *      Healthcare anchor, "Affordable Housing" on Housing, and so on. This is
 *      what makes the spectrum stable WITHOUT an embedding backfill — the
 *      micro-ordering inside a band sharpens once `domainHue` is populated, but
 *      the band's place on the spine never depends on it.
 *   3. A deterministic hash of the domain string — for domains outside the 11
 *      anchors. Every template still gets a stable, unique hue.
 *
 * Pure, deterministic and SSR-safe: no wall-clock reads, no randomness, no
 * browser globals. The same domain string always resolves to the same hue.
 *
 * Emits a bare hue angle only — never an oklch string. The consuming component
 * applies the system's chroma-per-role via `--card-hue`, so this stays in step
 * with `app.css`'s tint/rule/icon levels and never drifts from them.
 */

import type { Template } from '$lib/types/template';
import anchorsData from './domain-anchors.json';
import { hashToHue } from './topic-hue';

interface Anchor {
	label: string;
	hue: number;
	embedding: number[];
}

/** The 11 canonical anchor domains, ordered along the hue spectrum in the file. */
const ANCHORS = anchorsData as Anchor[];

/**
 * Wording that resolves a template's free-text domain to a canonical anchor.
 *
 * Keys are the anchor labels exactly as they appear in `domain-anchors.json`;
 * the hue is read from that same file, so this table never re-asserts a hue —
 * it only says which words point at which anchor. Matching is lowercase
 * substring, so "Public Health" hits "health", "Labor Rights" hits "labor".
 */
const ANCHOR_KEYWORDS: Record<string, string[]> = {
	Healthcare: ['health', 'medical', 'telehealth', 'wellness'],
	Environment: ['environment', 'climate', 'energy', 'clean', 'park', 'conservation'],
	Housing: ['housing', 'urban', 'homelessness', 'vacancy', 'affordab', 'zoning'],
	Education: ['education', 'school', 'childcare', 'preschool', 'librar', 'tuition'],
	Labor: ['labor', 'worker', 'wage', 'employ', 'union', 'retail', 'pay dispar'],
	Immigration: ['immigra', 'refugee', 'asylum', 'green card', 'visa'],
	Justice: ['justice', 'criminal', 'police', 'incarcerat', 'sentenc', 'prison'],
	Governance: ['govern', 'legislat', 'congress', 'policy', 'veteran'],
	Technology: ['technolog', 'digital', 'privacy', 'artificial', 'data', 'cyber'],
	Transportation: [
		'transport',
		'transit',
		'infrastruc',
		'road',
		'rail',
		'parking',
		'bike',
		'bicycle',
		'freeway',
		'highway'
	],
	'Indigenous Rights': ['indigenous', 'reconcili', 'tribal', 'first nation', 'revenue sharing']
};

/** Anchor label → its hue, read once from `domain-anchors.json`. */
const HUE_BY_ANCHOR = new Map<string, number>(ANCHORS.map((a) => [a.label, a.hue]));

/**
 * Ordered match table: each anchor's keywords paired with its hue. Built once
 * from the anchors file so the hue is always the file's, never re-typed here.
 */
const ANCHOR_TABLE: Array<{ keywords: string[]; hue: number }> = ANCHORS.flatMap((anchor) => {
	const keywords = ANCHOR_KEYWORDS[anchor.label];
	return keywords ? [{ keywords, hue: anchor.hue }] : [];
});

/**
 * Match a free-text domain string against the canonical anchors.
 * @returns the anchor hue if any keyword matches, or null.
 */
function matchAnchor(text: string): number | null {
	const lower = text.toLowerCase();
	for (const { keywords, hue } of ANCHOR_TABLE) {
		for (const keyword of keywords) {
			if (lower.includes(keyword)) return hue;
		}
	}
	return null;
}

/**
 * Resolve a template's domain hue in [0, 360).
 *
 * @param template - the template to place on the spectrum
 * @returns hue angle, always in [0, 360)
 */
export function resolveDomainHue(template: Pick<Template, 'domain' | 'domainHue'>): number {
	// 1. The real embedding projection, when present.
	const projected = template.domainHue;
	if (typeof projected === 'number' && projected >= 0 && projected <= 360) {
		// Fold 360 down to 0 so the range is a clean half-open [0, 360).
		return projected % 360;
	}

	// 2. A fixed hue from the 11 canonical anchors.
	const domain = typeof template.domain === 'string' ? template.domain.trim() : '';
	if (domain) {
		const anchorHue = matchAnchor(domain);
		if (anchorHue !== null) return anchorHue;
	}

	// 3. Deterministic hash of the domain string (or a stable seed when blank).
	return hashToHue(domain || 'uncategorized');
}

/** Exported for testing and for components that need the anchor hues directly. */
export { ANCHOR_TABLE, HUE_BY_ANCHOR, matchAnchor };
