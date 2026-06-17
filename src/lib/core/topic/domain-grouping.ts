/**
 * Topical Template Grouping
 *
 * Groups templates by civic domain and orders the resulting bands along the
 * domain-hue spectrum, so semantically adjacent issues neighbour each other and
 * the spine of the collection reads as one continuous gradient.
 *
 * This is the topical sibling of `groupByPrecision` (geographic grouping). The
 * two are interchangeable lenses over the same templates — a toggle chooses
 * between them. Hue ordering rides `domainHue` (a real projection of the topic
 * embedding) via the injected `hueOf` resolver, so the spectrum is stable even
 * before that field is backfilled.
 *
 * Deterministic given `now`: the within-band order is fully specified down to
 * explicit tie-breaks, so two runs over the same input and the same clock return
 * the identical shape regardless of input ordering. `now` defaults to the current
 * time so recency weighting matches the geographic list (a stale fixed default
 * would let recency swamp coordination); pass a fixed `now` for a fully
 * reproducible result.
 */

import type { Template } from '$lib/types/template';
import { scoreTemplate } from '$lib/utils/template-scoring';

/**
 * A hue-ordered band of templates that share a civic domain.
 *
 * Each channel cites a real field:
 * - `hue`      ← resolved domain hue (the spectrum axis / band spine colour)
 * - `templates`← the domain's templates, highest civic-relevance first
 * - `count`    ← how many templates the band holds
 */
export interface DomainGroup {
	/** Civic domain label, e.g. "Healthcare". Untagged templates land in "Other". */
	domain: string;
	/** Resolved domain hue in [0, 360) — the band's spine colour and order key. */
	hue: number;
	/** Zero-based spectrum position after ordering by ascending hue. */
	order: number;
	/** Templates in this band, sorted by civic-relevance score (descending). */
	templates: Template[];
	/** Number of templates in this band. */
	count: number;
}

/** Stable label for templates with no civic domain — placed at the spectrum end. */
const UNCATEGORIZED_DOMAIN = 'Other';

/**
 * Stable DOM id for a band, derived purely from its domain label.
 *
 * The overview map and the band agree on this id so a tapped segment can find
 * and scroll to its neighbourhood. Slugged (lowercased, non-alphanumerics
 * folded to single dashes) and prefixed so the id is a valid, collision-clear
 * anchor for any domain wording. Pure — no browser globals — so it is safe to
 * compute under SSR.
 */
export function bandDomId(domain: string): string {
	const slug = domain
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `band-${slug || 'other'}`;
}

/**
 * Resolve a per-template civic-relevance score for the within-band ordering.
 *
 * Mirrors the established enrichment used by the geographic list: newness +
 * coordination, with the template's own timestamps. SSR-safe — the caller may
 * pass a fixed `now` so the score is reproducible.
 */
function relevanceScore(template: Template, now: Date): number {
	const record = template as unknown as Record<string, unknown>;
	return scoreTemplate(
		{
			send_count: template.send_count || 0,
			created_at: new Date(template.createdAt),
			updated_at: new Date((record.updatedAt as string) || template.createdAt)
		},
		now
	).displayScore;
}

/** Normalise a template's domain, folding null/empty/whitespace into "Other". */
function domainOf(template: Template): string {
	const raw = typeof template.domain === 'string' ? template.domain.trim() : '';
	return raw.length > 0 ? raw : UNCATEGORIZED_DOMAIN;
}

interface GroupByDomainOptions {
	/** Resolves a template's domain hue in [0, 360). Injected so the grouper stays
	 *  decoupled from the hue-backfill: the resolver supplies a stable fallback. */
	hueOf: (template: Template) => number;
	/** Clock for the within-band recency weighting. Defaults to the current time
	 *  (matching the geographic list); pass a fixed `now` for a reproducible result. */
	now?: Date;
}

/**
 * Group templates by civic domain and order the bands along the hue spectrum.
 *
 * - Buckets templates by `domain` (untagged → "Other").
 * - Within each band, sorts by civic-relevance score, descending.
 * - The band's hue is its lead (highest-relevance) template's resolved hue.
 * - Orders bands by ascending hue so adjacent issues neighbour each other;
 *   the "Other" band is pinned to the spectrum end.
 * - Emergent: only domains that actually have templates appear.
 *
 * Deterministic — same input always yields the same order. Tie-breaks are
 * explicit (domain label for bands, send_count then slug within a band) so the
 * result never depends on input ordering or engine sort stability.
 */
export function groupByDomain(
	templates: Template[],
	{ hueOf, now = new Date() }: GroupByDomainOptions
): DomainGroup[] {
	// Bucket by normalised domain.
	const buckets = new Map<string, Template[]>();
	for (const template of templates) {
		const domain = domainOf(template);
		const bucket = buckets.get(domain);
		if (bucket) {
			bucket.push(template);
		} else {
			buckets.set(domain, [template]);
		}
	}

	// Precompute scores once so the within-band sort is cheap and stable.
	const scoreFor = new Map<Template, number>();
	for (const template of templates) {
		scoreFor.set(template, relevanceScore(template, now));
	}

	const groups = Array.from(buckets.entries()).map(([domain, bucket]) => {
		const sorted = [...bucket].sort((a, b) => {
			const byScore = (scoreFor.get(b) ?? 0) - (scoreFor.get(a) ?? 0);
			if (byScore !== 0) return byScore;
			const bySend = (b.send_count || 0) - (a.send_count || 0);
			if (bySend !== 0) return bySend;
			// Final, fully-deterministic tie-break on a stable identifier.
			return (a.slug || a.id || '').localeCompare(b.slug || b.id || '');
		});

		// The band's spine hue echoes its lead tile.
		const hue = hueOf(sorted[0]);

		return {
			domain,
			hue,
			order: 0, // assigned after spectrum ordering below
			templates: sorted,
			count: sorted.length
		} satisfies DomainGroup;
	});

	// Order bands along the hue spectrum; pin "Other" to the end.
	groups.sort((a, b) => {
		const aOther = a.domain === UNCATEGORIZED_DOMAIN;
		const bOther = b.domain === UNCATEGORIZED_DOMAIN;
		if (aOther !== bOther) return aOther ? 1 : -1;
		if (a.hue !== b.hue) return a.hue - b.hue;
		// Same hue: stable, name-ordered so the spectrum never reshuffles.
		return a.domain.localeCompare(b.domain);
	});

	// Stamp the emergent spectrum position.
	groups.forEach((group, index) => {
		group.order = index;
	});

	return groups;
}
