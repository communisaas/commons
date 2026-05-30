<script lang="ts">
	import { cellToBoundary, cellToLatLng, isValidCell } from 'h3-js';
	import { FEATURES } from '$lib/config/features';
	import {
		getDistrictBasemapUrl,
		getDistrictBoundary
	} from '$lib/core/shadow-atlas/district-bundle';
	import {
		bboxCenter,
		fitZoom,
		projectToImage,
		unwrapBBoxAntimeridian,
		unwrapLon,
		type BBox
	} from '$lib/core/shadow-atlas/projection';

	type LngLat = [number, number];
	type PolygonGeometry = {
		type: 'Polygon';
		coordinates: LngLat[][];
	};
	type MultiPolygonGeometry = {
		type: 'MultiPolygon';
		coordinates: LngLat[][][];
	};
	type DistrictGeometry = PolygonGeometry | MultiPolygonGeometry;
	type MapStatus = 'idle' | 'loading' | 'ready' | 'cell-only' | 'missing';

	let {
		districtCode = null,
		h3Cell = null
	}: {
		districtCode?: string | null;
		h3Cell?: string | null;
	} = $props();

	let status = $state<MapStatus>('idle');
	let boundaryName = $state<string | null>(null);
	let districtGeometry = $state<DistrictGeometry | null>(null);
	let basemapUrl = $state<string | null>(null);
	let basemapLoaded = $state(false);
	let loadToken = 0;

	const WIDTH = 360;
	const HEIGHT = 220;
	// Padding (per side, fraction of image dimension) — MUST match the
	// publish-side renderer in voter-protocol/packages/shadow-atlas/scripts/
	// render-district-basemaps.ts. Drift here = the SVG polygon will not
	// trace the basemap district boundary.
	const PADDING_PCT = 0.06;

	function asH3Cell(value: string | null | undefined): string | null {
		const cell = value?.trim();
		return cell && isValidCell(cell) ? cell : null;
	}

	function closeRing(ring: LngLat[]): LngLat[] {
		const first = ring[0];
		const last = ring[ring.length - 1];
		if (!first || !last) return ring;
		if (first[0] === last[0] && first[1] === last[1]) return ring;
		return [...ring, first];
	}

	function h3Rings(cell: string | null): LngLat[][] {
		if (!cell) return [];
		return [closeRing(cellToBoundary(cell, true) as LngLat[])];
	}

	function geometryRings(geometry: DistrictGeometry | null): LngLat[][] {
		if (!geometry) return [];
		if (geometry.type === 'Polygon') return geometry.coordinates.map(closeRing);
		return geometry.coordinates.flatMap((polygon) => polygon.map(closeRing));
	}

	function boundsFor(rings: LngLat[][]): BBox | null {
		const points = rings.flat();
		if (points.length === 0) return null;
		let minLon = Infinity;
		let maxLon = -Infinity;
		let minLat = Infinity;
		let maxLat = -Infinity;
		for (const [lng, lat] of points) {
			minLon = Math.min(minLon, lng);
			maxLon = Math.max(maxLon, lng);
			minLat = Math.min(minLat, lat);
			maxLat = Math.max(maxLat, lat);
		}
		if (![minLon, maxLon, minLat, maxLat].every(Number.isFinite)) return null;
		return { minLon, maxLon, minLat, maxLat };
	}

	interface Frame {
		bbox: BBox;
		center: { lon: number; lat: number };
		zoom: number;
		unwrapped: boolean;
	}

	function frameFor(rings: LngLat[][]): Frame | null {
		const raw = boundsFor(rings);
		if (!raw) return null;
		const { bbox, unwrapped } = unwrapBBoxAntimeridian(raw);
		return {
			bbox,
			center: bboxCenter(bbox),
			zoom: fitZoom(bbox, WIDTH, HEIGHT, PADDING_PCT),
			unwrapped,
		};
	}

	function makePaths(rings: LngLat[][], frame: Frame) {
		return rings.map((ring) =>
			ring
				.map(([lng, lat], index) => {
					const { x, y } = projectToImage(
						unwrapLon(lng, frame.unwrapped),
						lat,
						frame.center.lon,
						frame.center.lat,
						frame.zoom,
						WIDTH,
						HEIGHT,
					);
					return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
				})
				.join(' ')
				.concat(' Z'),
		);
	}

	const safeH3Cell = $derived(asH3Cell(h3Cell));
	const districtRings = $derived(geometryRings(districtGeometry));
	const cellRings = $derived(h3Rings(safeH3Cell));
	// Project against the DISTRICT frame only when the district has loaded; this
	// keeps the H3 cell rendered at its true small footprint inside the district
	// rather than zoomed to fill the frame.
	const mapFrame = $derived(districtRings.length > 0 ? frameFor(districtRings) : null);
	const districtPaths = $derived(mapFrame ? makePaths(districtRings, mapFrame) : []);
	const cellPaths = $derived(mapFrame ? makePaths(cellRings, mapFrame) : []);
	const cellAnchor = $derived.by(() => {
		if (!safeH3Cell || !mapFrame) return null;
		const [lat, lng] = cellToLatLng(safeH3Cell);
		return projectToImage(
			unwrapLon(lng, mapFrame.unwrapped),
			lat,
			mapFrame.center.lon,
			mapFrame.center.lat,
			mapFrame.zoom,
			WIDTH,
			HEIGHT,
		);
	});

	const showBasemap = $derived(FEATURES.PROFILE_BASEMAP && basemapUrl !== null && basemapLoaded);

	$effect(() => {
		const district = districtCode?.trim().toUpperCase() ?? null;
		const cell = asH3Cell(h3Cell);
		const token = ++loadToken;
		const controller = new AbortController();

		districtGeometry = null;
		boundaryName = null;
		basemapUrl = null;
		basemapLoaded = false;

		if (!cell) {
			status = 'missing';
			return;
		}
		if (!district) {
			status = 'cell-only';
			return;
		}

		status = 'loading';

		// Fetch directly from atlas.commons.email — no proxy, no lat/lng sent
		// up, no auth gate on a public dataset.
		getDistrictBoundary(district, controller.signal)
			.then((result) => {
				if (token !== loadToken) return;
				districtGeometry = (result?.geometry as DistrictGeometry | undefined) ?? null;
				boundaryName = result?.name ?? district;
				status = districtGeometry ? 'ready' : 'cell-only';
			})
			.catch(() => {
				if (token !== loadToken) return;
				status = 'cell-only';
			});

		// Basemap URL resolves only when the flag is on. The preload uses an
		// HTML Image() rather than the SVG `<image>` load event, because SVG
		// `<image>`'s load event has spotty cross-browser support — relying
		// on it produced opacity-0 rasters on Safari in past spikes. The
		// preloader fires the well-supported HTMLImageElement events, and the
		// SVG mount conditions on `basemapLoaded` (set true only after a
		// successful preload).
		if (FEATURES.PROFILE_BASEMAP) {
			getDistrictBasemapUrl(district, controller.signal)
				.then((url) => {
					if (token !== loadToken || !url) return;
					basemapUrl = url;
					if (typeof Image !== 'function') return;
					const img = new Image();
					img.decoding = 'async';
					img.onload = () => {
						if (token === loadToken) basemapLoaded = true;
					};
					img.onerror = () => {
						if (token === loadToken) basemapLoaded = false;
					};
					img.src = url;
				})
				.catch(() => {
					if (token !== loadToken) return;
					basemapUrl = null;
				});
		}

		return () => {
			controller.abort();
		};
	});
</script>

{#if !safeH3Cell}
	<!-- No cell saved → no spatial figure. The GroundCard already says "verify your address." -->
{:else if status === 'ready'}
	<figure
		class="ground-figure"
		title={showBasemap
			? 'District boundary and pre-rendered basemap from the atlas; no per-user tile requests.'
			: 'District boundary from disclosed metadata. No third-party map tiles are loaded.'}
	>
		<svg
			viewBox="0 0 {WIDTH} {HEIGHT}"
			role="img"
			aria-label={boundaryName
				? `Disclosed privacy hex inside ${boundaryName}`
				: 'Disclosed privacy hex inside district'}
			preserveAspectRatio="xMidYMid meet"
		>
			{#if showBasemap && basemapUrl}
				<!-- Mounted only after the HTMLImageElement preloader confirmed
				     the asset is fetchable. The SVG `<image>` element's own load
				     event has spotty cross-browser support, so the preload is
				     the actual gate; this element just renders. -->
				<image
					href={basemapUrl}
					x="0"
					y="0"
					width={WIDTH}
					height={HEIGHT}
					preserveAspectRatio="xMidYMid meet"
					class="ground-figure__basemap"
				/>
			{/if}
			{#if districtPaths.length > 0}
				<!-- Single combined path with even-odd fill: outer rings fill,
				     hole rings cut out. Without this, GeoJSON Polygon holes
				     (interior carve-outs) render as if they were territory. -->
				<path
					d={districtPaths.join(' ')}
					class="ground-figure__district"
					class:ground-figure__district--with-basemap={showBasemap}
					fill-rule="evenodd"
				/>
			{/if}
			{#each cellPaths as path}
				<path d={path} class="ground-figure__cell" />
			{/each}
			{#if cellAnchor}
				<circle cx={cellAnchor.x} cy={cellAnchor.y} r="2.5" class="ground-figure__cell-dot" />
			{/if}
		</svg>
		<figcaption class="ground-figure__legend">
			<span><i class="ground-figure__swatch ground-figure__swatch--district"></i>District</span>
			<span><i class="ground-figure__swatch ground-figure__swatch--cell"></i>Privacy hex</span>
		</figcaption>
	</figure>
{:else if status === 'loading'}
	<div class="ground-figure ground-figure--placeholder" aria-busy="true">
		<svg viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
			<path
				d="M 60 110 C 130 60 220 60 290 100 S 330 160 320 175"
				class="ground-figure__loading-path"
			/>
		</svg>
	</div>
{:else}
	<!-- cell-only or missing-district path: do NOT render a full-bleed hex pretending
	     to be territory. Render a tight citation-scale line that admits the
	     boundary fetch did not succeed. -->
	<p class="ground-figure ground-figure--inline">
		<svg class="ground-figure__glyph" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M 12 2 L 22 7.5 L 22 16.5 L 12 22 L 2 16.5 L 2 7.5 Z"
				class="ground-figure__glyph-path"
			/>
		</svg>
		{#if districtCode}
			<span class="ground-figure__district-code">{districtCode}</span>
		{/if}
		<span class="ground-figure__inline-note">
			Privacy hex disclosed · boundary unavailable
		</span>
	</p>
{/if}

<style>
	.ground-figure {
		min-width: 0;
	}

	/* Scope to direct children so the small inline glyph (a nested svg) keeps its
	   own 1.25rem footprint instead of inheriting the figure-fill rule. */
	.ground-figure > svg {
		display: block;
		width: 100%;
		height: auto;
		max-height: 14rem;
	}

	/* District: emerald stroke at low chroma — verified containment. */
	.ground-figure__district {
		fill: oklch(0.94 0.04 155 / 0.32);
		stroke: oklch(0.62 0.12 155 / 0.85);
		stroke-width: 1.5;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}

	/* With a basemap underneath, the emerald fill would muddy the cartography
	 * — drop the fill, raise the stroke chroma so the boundary still reads.
	 */
	.ground-figure__district--with-basemap {
		fill: none;
		stroke: oklch(0.5 0.16 155 / 0.95);
		stroke-width: 1.75;
	}

	/* Basemap raster sits underneath the polygons. Mount is preload-gated,
	 * so the element only appears once the asset is known fetchable. */
	.ground-figure__basemap {
		opacity: 1;
	}

	/* H3 cell inside district: teal — your route within the verified shape. */
	.ground-figure__cell {
		fill: oklch(0.78 0.09 200 / 0.32);
		stroke: oklch(0.6 0.11 200 / 0.95);
		stroke-width: 1.25;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}

	.ground-figure__cell-dot {
		fill: oklch(0.6 0.11 200 / 0.95);
		stroke: oklch(0.985 0.006 55);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}

	.ground-figure__loading-path {
		fill: none;
		stroke: oklch(0.82 0.012 60);
		stroke-width: 1.5;
		stroke-dasharray: 5 7;
		vector-effect: non-scaling-stroke;
	}

	.ground-figure__legend {
		margin-top: 0.5rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1rem;
		font-family:
			'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
			'Liberation Mono', 'Courier New', monospace;
		font-size: 0.625rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: oklch(0.55 0.02 250);
	}

	.ground-figure__legend span {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		white-space: nowrap;
	}

	.ground-figure__swatch {
		width: 0.5rem;
		height: 0.5rem;
		display: inline-block;
	}

	.ground-figure__swatch--district {
		background: oklch(0.94 0.04 155 / 0.32);
		border: 1px solid oklch(0.62 0.12 155 / 0.85);
	}

	.ground-figure__swatch--cell {
		background: oklch(0.78 0.09 200 / 0.32);
		border: 1px solid oklch(0.6 0.11 200 / 0.95);
	}

	/* Cell-only fallback: tight inline citation. No fake territory, no sprawl. */
	.ground-figure--inline {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		max-width: 100%;
		flex-wrap: wrap;
	}

	.ground-figure__glyph {
		width: 0.875rem;
		height: 0.875rem;
		flex-shrink: 0;
	}

	.ground-figure__glyph-path {
		fill: oklch(0.78 0.09 200 / 0.32);
		stroke: oklch(0.6 0.11 200 / 0.95);
		stroke-width: 1.5;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}

	.ground-figure__district-code {
		font-family:
			'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
			'Liberation Mono', 'Courier New', monospace;
		font-size: 0.8125rem;
		font-weight: 600;
		color: oklch(0.34 0.04 155);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.ground-figure__inline-note {
		font-size: 0.6875rem;
		line-height: 1.3;
		color: oklch(0.55 0.02 250);
	}
</style>
