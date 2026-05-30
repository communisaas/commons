/**
 * Web Mercator projection helpers shared between the runtime SVG renderer
 * (`GroundSpatialProof.svelte`) and the publish-time basemap renderer in
 * `voter-protocol/packages/shadow-atlas/scripts/render-district-basemaps.ts`.
 *
 * The two sides MUST stay aligned: the SVG district polygon and the Stadia
 * raster underneath are framed by the same center + zoom + size. Any drift
 * in this math becomes a visible offset between the basemap district outline
 * and the stroked SVG polygon.
 *
 * The publish-side script duplicates the same constants and math inline. Both
 * are short pure functions; promote to a shared package if a third caller
 * ever appears.
 */

export const TILE_SIZE_PX = 256;

/** Web Mercator latitude limit (Slippy-map convention). */
const LAT_LIMIT = 85.0511;

export interface BBox {
	minLon: number;
	minLat: number;
	maxLon: number;
	maxLat: number;
}

/**
 * Detect whether a bbox spans the antimeridian and, if so, re-bound it in
 * the "shifted" convention where `minLon > 0` and `maxLon > 180`. The
 * input bbox is assumed to come from naive min/max over ring points: a
 * district that crosses ±180° produces a bbox like `[-179.2, 179.9]` whose
 * span (~359°) is the symptom — no real district spans more than 180° of
 * longitude. The returned `unwrapped` flag tells callers to also shift
 * individual point longitudes (negative → +360) before projecting.
 *
 * Affects Alaska's `cd-0200` in the current US atlas (Aleutians span ±180°).
 */
export function unwrapBBoxAntimeridian(b: BBox): { bbox: BBox; unwrapped: boolean } {
	if (b.maxLon - b.minLon <= 180) {
		return { bbox: b, unwrapped: false };
	}
	// Reframe as the SHORT arc that crosses ±180°: minLon = old maxLon,
	// maxLon = old minLon + 360. For AK: 179.86 .. 180.77.
	return {
		bbox: { ...b, minLon: b.maxLon, maxLon: b.minLon + 360 },
		unwrapped: true,
	};
}

/**
 * Shift a single longitude into the unwrapped frame produced by
 * `unwrapBBoxAntimeridian`. No-op when the frame is not unwrapped.
 */
export function unwrapLon(lon: number, frameUnwrapped: boolean): number {
	return frameUnwrapped && lon < 0 ? lon + 360 : lon;
}

/**
 * Bring a longitude into the standard [-180, 180] range. Used when emitting
 * a center coordinate to a third-party API that doesn't accept the unwrapped
 * `> 180` form.
 */
export function wrapToStandard(lon: number): number {
	return (((lon + 180) % 360) + 360) % 360 - 180;
}

export function bboxCenter(b: BBox): { lon: number; lat: number } {
	return {
		lon: (b.minLon + b.maxLon) / 2,
		lat: (b.minLat + b.maxLat) / 2,
	};
}

export function lonToPx(lon: number, zoom: number): number {
	return ((lon + 180) / 360) * TILE_SIZE_PX * 2 ** zoom;
}

export function latToPx(lat: number, zoom: number): number {
	const clamped = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat));
	const s = Math.sin((clamped * Math.PI) / 180);
	return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE_SIZE_PX * 2 ** zoom;
}

/**
 * Largest integer zoom level at which `b` fits inside (widthPx, heightPx),
 * leaving `padding` (fraction of the image dimension) clear on each side.
 * padding=0.06 means 6% clear margin per side; the bbox is sized to fit
 * within the remaining 88% of the image.
 */
export function fitZoom(
	b: BBox,
	widthPx: number,
	heightPx: number,
	padding: number,
	maxZoom = 18,
): number {
	const availW = widthPx * (1 - padding * 2);
	const availH = heightPx * (1 - padding * 2);
	for (let z = maxZoom; z >= 0; z--) {
		const w = lonToPx(b.maxLon, z) - lonToPx(b.minLon, z);
		const h = latToPx(b.minLat, z) - latToPx(b.maxLat, z);
		if (w <= availW && h <= availH) return z;
	}
	return 0;
}

/**
 * Project a lon/lat to image-pixel space, with (centerLon, centerLat) at the
 * image center and the given zoom. Matches how a Web Mercator static-map
 * provider (Stadia, Mapbox) frames a `center+zoom+size` request — using this
 * projection alongside the basemap fetched with the same parameters yields
 * pixel-exact alignment.
 */
export function projectToImage(
	lon: number,
	lat: number,
	centerLon: number,
	centerLat: number,
	zoom: number,
	widthPx: number,
	heightPx: number,
): { x: number; y: number } {
	const cx = lonToPx(centerLon, zoom);
	const cy = latToPx(centerLat, zoom);
	const px = lonToPx(lon, zoom);
	const py = latToPx(lat, zoom);
	return {
		x: px - cx + widthPx / 2,
		y: py - cy + heightPx / 2,
	};
}
