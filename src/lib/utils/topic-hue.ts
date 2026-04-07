/**
 * Topic Hue — maps template content domain to an oklch hue angle.
 *
 * Known civic domains are pinned to hues anchored in the design system
 * (--doc-legislative, --coord-route, --doc-academic, etc.).
 * Unknown domains get a deterministic hash-derived hue so every template
 * gets a stable, unique color — even "AI regulation" or "water fluoridation."
 *
 * The hue is consumed as a CSS custom property (--card-hue) and drives
 * three surfaces at different chroma levels: card tint, header rule, icon.
 */

/**
 * Pinned hues for known civic domains.
 *
 * Keys are lowercase. Matching is prefix/substring — "Public Health" matches
 * "health", "Labor Rights" matches "labor", etc.
 *
 * Hue sources:
 *   85  = --doc-legislative (amber)
 *   150 = --coord-verified adjacent (green)
 *   240 = --doc-media (blue)
 *   290 = --doc-academic (purple)
 *   180 = --coord-route (teal)
 *   270 = --coord-share (indigo)
 *   160 = --doc-corporate (emerald)
 *   55  = foundation hue (warm copper)
 *   35  = warm orange
 *   320 = rose
 */
const DOMAIN_HUES: Array<{ keywords: string[]; hue: number }> = [
	{ keywords: ['health', 'medical', 'telehealth', 'wellness'], hue: 240 },
	{ keywords: ['environment', 'climate', 'energy', 'clean', 'park', 'conservation'], hue: 150 },
	{ keywords: ['housing', 'urban', 'homelessness', 'vacancy', 'affordab', 'zoning'], hue: 55 },
	{ keywords: ['education', 'school', 'childcare', 'preschool', 'librar', 'tuition'], hue: 290 },
	{ keywords: ['labor', 'worker', 'wage', 'employ', 'union', 'retail', 'pay dispar'], hue: 180 },
	{ keywords: ['immigra', 'human rights', 'refugee', 'asylum', 'green card', 'visa'], hue: 270 },
	{ keywords: ['justice', 'criminal', 'police', 'incarcerat', 'sentenc', 'prison'], hue: 320 },
	{ keywords: ['govern', 'legislat', 'congress', 'policy', 'veteran'], hue: 85 },
	{ keywords: ['digital', 'privacy', 'technolog', 'ai ', 'artificial', 'data', 'cyber'], hue: 160 },
	{ keywords: ['transport', 'transit', 'infrastruc', 'road', 'rail', 'parking', 'bike', 'bicycle', 'freeway', 'highway'], hue: 35 },
	{ keywords: ['indigenous', 'reconcili', 'tribal', 'first nation', 'revenue sharing'], hue: 25 },
];

/**
 * djb2 string hash → hue angle.
 * Deterministic, fast, good distribution across 0-360.
 */
function hashToHue(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
	}
	// Map to 0-360, ensure positive
	return ((hash % 360) + 360) % 360;
}

/**
 * Match a string against the known-domain table.
 * Returns the pinned hue if any keyword matches, or null.
 */
function matchDomain(text: string): number | null {
	const lower = text.toLowerCase();
	for (const domain of DOMAIN_HUES) {
		for (const keyword of domain.keywords) {
			if (lower.includes(keyword)) {
				return domain.hue;
			}
		}
	}
	return null;
}

/**
 * Derive an oklch hue angle for a template's content domain.
 *
 * @param domain - The template's civic domain (e.g., "Parking & Municipal Revenue", "School Facilities")
 * @param topics - Optional topic tags (e.g., ["parking-enforcement", "municipal-revenue"])
 * @returns Hue angle 0-360
 */
export function topicHue(domain: string, topics?: string[], domainHue?: number): number {
	// Prefer stored embedding-projected hue (semantically continuous)
	if (domainHue !== undefined && domainHue >= 0 && domainHue <= 360) return domainHue;

	// Try domain first (strongest signal — model-synthesized civic space name)
	if (domain) {
		const hit = matchDomain(domain);
		if (hit !== null) return hit;
	}

	// Try topics in order
	if (topics) {
		for (const topic of topics) {
			const hit = matchDomain(topic);
			if (hit !== null) return hit;
		}
	}

	// Fallback: hash the domain (or first topic, or 'unknown')
	const seed = domain || topics?.[0] || 'unknown';
	return hashToHue(seed);
}

/** Exported for testing. */
export { DOMAIN_HUES, hashToHue, matchDomain };
