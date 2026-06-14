/**
 * Place-lens bands.
 *
 * The place lens organises the same templates by geographic precision instead
 * of by topic. The grouping itself is the EXISTING `groupByPrecision` (the
 * geographic grouper the homepage list already ships) — this module only
 * adapts its `TemplateGroup[]` output into the band shape the spectrum field
 * renders, so the topic and place lenses can share one band component.
 *
 * Hue stays domain-derived in BOTH lenses (the rule the spectrum holds): a
 * place band's spine hue is its lead template's resolved DOMAIN hue, never a
 * colour invented to encode place. Place is carried by the band's place label
 * (the precision tier — "Nationwide", "In Your State") and shown as a small
 * chip on each tile, not by hijacking the colour channel.
 *
 * Every value cites a real field:
 * - `place`     ← the precision tier title from `groupByPrecision`
 * - `hue`       ← the lead template's resolved domain hue (`hueOf`)
 * - `templates` ← the tier's templates, untouched (already score-ordered)
 * - `count`     ← how many templates the tier holds
 *
 * Pure and SSR-safe: no wall-clock reads, no randomness, no browser globals.
 */

import type { Template } from '$lib/types/template';
import type { TemplateGroup } from '$lib/types/template';

/**
 * A place-organised band of templates that share a geographic precision tier.
 *
 * Shaped to render through the same band component as a topic band: it carries
 * a `domain`-position label (here the place tier) and a domain-derived spine
 * `hue`, plus a `place` chip label the tiles surface.
 */
export interface PlaceBand {
	/** The geographic precision tier, e.g. "Nationwide" — the band's name. */
	domain: string;
	/** The place label tiles show as a chip (same as the tier here). */
	place: string;
	/** Spine hue: the lead template's resolved DOMAIN hue (hue stays domain). */
	hue: number;
	/** Zero-based position, preserving the precision tier order. */
	order: number;
	/** The tier's templates, in the order `groupByPrecision` produced. */
	templates: Template[];
	/** How many templates the band holds. */
	count: number;
}

interface ToPlaceBandsOptions {
	/** Resolves a template's domain hue in [0, 360) — the same resolver the topic
	 *  lens uses, so the spine stays domain-derived in both lenses. */
	hueOf: (template: Template) => number;
}

/**
 * Adapt geographic precision groups into place bands for the spectrum field.
 *
 * Preserves the precision tier order from `groupByPrecision` (district → city →
 * state → nationwide), drops empty tiers (they never reach here — the grouper
 * already omits them), and gives each band a domain-derived spine hue from its
 * lead template so colour still reads as topic.
 */
export function toPlaceBands(
	groups: TemplateGroup[],
	{ hueOf }: ToPlaceBandsOptions
): PlaceBand[] {
	return groups
		.filter((group) => group.templates.length > 0)
		.map((group, index) => ({
			domain: group.title,
			place: group.title,
			hue: hueOf(group.templates[0]),
			order: index,
			templates: group.templates,
			count: group.templates.length
		}));
}
