/**
 * Band Aggregate Signals
 *
 * Roll up the per-template dimensional substrate into the two band-level signals
 * the spectrum reads from: the shared arrival rhythm (a Pulse) and a scalar
 * coordination weight (optional overview emphasis).
 *
 * Every value cites a real field. Nothing is synthesised:
 * - `aggregateArrivals` ← element-wise sum of each template's `daily_arrivals`
 *   (the 30-day rolling rhythm denormalised at send time).
 * - `bandMomentum`      ← `send_count` and `coordinationScale` (verified reach).
 *
 * Honesty is structural, not cosmetic. A band with no real arrivals returns
 * `null` from `aggregateArrivals` so the surface renders NO Pulse — never a flat
 * dead zero line. The server already K-floors `daily_arrivals` (sub-floor days
 * arrive as zeros) and may K-floor `send_count` to `null`; both are treated as
 * absence here, so no sub-floor cohort is ever reconstructed by summing.
 *
 * Pure, deterministic and SSR-safe: no wall-clock reads, no randomness, no
 * browser globals.
 */

import type { Template } from '$lib/types/template';

/** Coerce a possibly-null/undefined send count (K-floored server-side) to 0. */
function sendCountOf(template: Template): number {
	const raw = template.send_count;
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/**
 * Element-wise sum the `daily_arrivals` rhythm across a band's templates.
 *
 * Missing arrays count as zeros. The result has the length of the longest
 * present array; templates with shorter (or absent) arrays simply contribute
 * nothing to the trailing buckets.
 *
 * Returns `null` when NO template carries any positive arrival — i.e. every
 * bucket would be zero. The caller renders no Pulse in that case rather than a
 * flat dead line (P4 honesty: momentum primitives are absent at zero data, not
 * displayed as zero). A non-null result always contains at least one positive
 * bucket.
 *
 * K-floor safe: the server zeroes sub-floor days before this runs, so summing
 * only ever combines values that already cleared the privacy floor or are zero.
 */
export function aggregateArrivals(templates: Template[]): number[] | null {
	let length = 0;
	for (const template of templates) {
		const arrivals = template.daily_arrivals;
		if (Array.isArray(arrivals) && arrivals.length > length) {
			length = arrivals.length;
		}
	}

	if (length === 0) return null;

	const summed = new Array<number>(length).fill(0);
	let hasSignal = false;

	for (const template of templates) {
		const arrivals = template.daily_arrivals;
		if (!Array.isArray(arrivals)) continue;
		for (let i = 0; i < arrivals.length; i++) {
			const value = arrivals[i];
			// Guard against non-finite / negative noise; only real counts add.
			if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
				summed[i] += value;
				hasSignal = true;
			}
		}
	}

	// All-zero (or all-absent) sum → no Pulse, not a flat dead line.
	return hasSignal ? summed : null;
}

/**
 * Scalar coordination weight for a band, for optional overview emphasis.
 *
 * Reads the band's verified reach: total `send_count` across its templates, with
 * `coordinationScale` (the per-template logarithmic reach already computed by the
 * loader) as the magnitude tie-break so two bands with equal raw sends order by
 * how concentrated that reach is.
 *
 * Monotonic in `send_count`: adding sends to any template never lowers the
 * band's momentum. Returns `0` for an empty band or a band with zero verified
 * reach — the overview treats that as uniform weight (P4: no invented emphasis
 * before coordination data exists).
 */
export function bandMomentum(templates: Template[]): number {
	let totalSends = 0;
	let totalScale = 0;

	for (const template of templates) {
		totalSends += sendCountOf(template);
		const scale = template.coordinationScale;
		if (typeof scale === 'number' && Number.isFinite(scale) && scale > 0) {
			totalScale += scale;
		}
	}

	if (totalSends <= 0) return 0;

	// Sends are the dominant term (monotonic in send_count); the summed
	// coordination scale is a sub-unit refinement that never overtakes a whole
	// additional send, so ordering by raw reach is preserved.
	return totalSends + totalScale / (totalScale + 1);
}
