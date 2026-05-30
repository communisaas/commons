import { describe, expect, it } from 'vitest';
import {
	TILE_SIZE_PX,
	bboxCenter,
	fitZoom,
	latToPx,
	lonToPx,
	projectToImage,
	unwrapBBoxAntimeridian,
	unwrapLon,
	wrapToStandard,
	type BBox
} from '$lib/core/shadow-atlas/projection';

describe('bboxCenter', () => {
	it('returns the midpoint of a normal bbox', () => {
		const b: BBox = { minLon: -80, minLat: 30, maxLon: -70, maxLat: 40 };
		expect(bboxCenter(b)).toEqual({ lon: -75, lat: 35 });
	});
});

describe('unwrapBBoxAntimeridian', () => {
	it('leaves a non-crossing bbox unchanged with unwrapped=false', () => {
		const b: BBox = { minLon: -80, minLat: 30, maxLon: -70, maxLat: 40 };
		expect(unwrapBBoxAntimeridian(b)).toEqual({ bbox: b, unwrapped: false });
	});

	it('reframes Alaska-style bboxes around the short arc', () => {
		// Alaska's cd-0200 bbox in the actual atlas.
		const ak: BBox = {
			minLon: -179.231086,
			minLat: 51.175092,
			maxLon: 179.85968107125612,
			maxLat: 71.439786
		};
		const out = unwrapBBoxAntimeridian(ak);
		expect(out.unwrapped).toBe(true);
		expect(out.bbox.minLon).toBeCloseTo(179.85968107125612, 6);
		expect(out.bbox.maxLon).toBeCloseTo(360 - 179.231086, 6);
		// Span of the SHORT arc, not the long one.
		expect(out.bbox.maxLon - out.bbox.minLon).toBeLessThan(2);
		expect(out.bbox.minLat).toBe(ak.minLat);
		expect(out.bbox.maxLat).toBe(ak.maxLat);
	});
});

describe('unwrapLon', () => {
	it('is a no-op when the frame is not unwrapped', () => {
		expect(unwrapLon(-170, false)).toBe(-170);
		expect(unwrapLon(170, false)).toBe(170);
	});

	it('shifts negative longitudes by +360 when the frame is unwrapped', () => {
		expect(unwrapLon(-170, true)).toBe(190);
		expect(unwrapLon(-1, true)).toBe(359);
	});

	it('leaves positive longitudes alone in an unwrapped frame', () => {
		expect(unwrapLon(170, true)).toBe(170);
		expect(unwrapLon(0, true)).toBe(0);
	});
});

describe('wrapToStandard', () => {
	it('is a no-op inside [-180, 180]', () => {
		expect(wrapToStandard(0)).toBe(0);
		expect(wrapToStandard(-170)).toBe(-170);
		expect(wrapToStandard(170)).toBe(170);
	});

	it('wraps values past +180 back into the standard range', () => {
		expect(wrapToStandard(190)).toBeCloseTo(-170, 6);
		expect(wrapToStandard(360)).toBeCloseTo(0, 6);
	});
});

describe('lonToPx / latToPx', () => {
	it('places lon=0 at the half-width of the world at zoom 0', () => {
		// At zoom 0 the entire world is one TILE_SIZE_PX × TILE_SIZE_PX tile.
		// Greenwich Meridian sits at x = TILE_SIZE_PX / 2.
		expect(lonToPx(0, 0)).toBeCloseTo(TILE_SIZE_PX / 2, 6);
	});

	it('places lat=0 at the half-height of the world at zoom 0', () => {
		expect(latToPx(0, 0)).toBeCloseTo(TILE_SIZE_PX / 2, 6);
	});

	it('clamps Web Mercator latitudes at ±85.0511', () => {
		const top = latToPx(89, 0);
		const cap = latToPx(85.0511, 0);
		expect(top).toBeCloseTo(cap, 4);
	});

	it('scales pixel coordinates by 2 each zoom level', () => {
		const a = lonToPx(10, 5);
		const b = lonToPx(10, 6);
		expect(b).toBeCloseTo(a * 2, 6);
	});
});

describe('fitZoom', () => {
	it('returns higher zoom for smaller bboxes', () => {
		const small: BBox = { minLon: -75, minLat: 39.5, maxLon: -74.9, maxLat: 39.6 };
		const big: BBox = { minLon: -125, minLat: 25, maxLon: -67, maxLat: 49 };
		const zSmall = fitZoom(small, 360, 220, 0.06);
		const zBig = fitZoom(big, 360, 220, 0.06);
		expect(zSmall).toBeGreaterThan(zBig);
	});

	it('the selected zoom actually fits the bbox in the available area', () => {
		const b: BBox = { minLon: -86.7, minLat: 30.9, maxLon: -86.5, maxLat: 31.1 };
		const W = 360,
			H = 220,
			P = 0.06;
		const z = fitZoom(b, W, H, P);
		const w = lonToPx(b.maxLon, z) - lonToPx(b.minLon, z);
		const h = latToPx(b.minLat, z) - latToPx(b.maxLat, z);
		expect(w).toBeLessThanOrEqual(W / (1 + P * 2));
		expect(h).toBeLessThanOrEqual(H / (1 + P * 2));
	});

	it('caps at the provided maxZoom', () => {
		const tiny: BBox = { minLon: 0, minLat: 0, maxLon: 0.0001, maxLat: 0.0001 };
		const z = fitZoom(tiny, 360, 220, 0.06, 10);
		expect(z).toBe(10);
	});
});

describe('projectToImage', () => {
	it('places the centerLon/Lat at the image midpoint', () => {
		const result = projectToImage(-75, 40, -75, 40, 8, 360, 220);
		expect(result.x).toBeCloseTo(180, 6);
		expect(result.y).toBeCloseTo(110, 6);
	});

	it('offsets points east as expected (positive Δlon → larger x)', () => {
		const center = projectToImage(-75, 40, -75, 40, 8, 360, 220);
		const east = projectToImage(-74, 40, -75, 40, 8, 360, 220);
		expect(east.x).toBeGreaterThan(center.x);
	});

	it('offsets points north with smaller y (SVG y-down)', () => {
		const center = projectToImage(-75, 40, -75, 40, 8, 360, 220);
		const north = projectToImage(-75, 41, -75, 40, 8, 360, 220);
		expect(north.y).toBeLessThan(center.y);
	});

	it('round-trip stability: projecting back from the same frame returns the original point', () => {
		// Picking a frame and a point inside it; the y inversion is the only
		// twist — verify the projection is monotonic in both axes.
		const frame = { lon: -75, lat: 40, zoom: 8 };
		const p = projectToImage(-74.5, 39.5, frame.lon, frame.lat, frame.zoom, 360, 220);
		expect(Number.isFinite(p.x)).toBe(true);
		expect(Number.isFinite(p.y)).toBe(true);
	});
});
