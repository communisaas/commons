<script lang="ts">
	/**
	 * DistrictMap — Geographic dimension rendered as a real map.
	 *
	 * Non-interactive MapLibre instance using CartoDB Positron tiles
	 * (light basemap designed for data overlays — free, CORS-safe).
	 *
	 * Renders:
	 * - District boundary with outside-dim mask (area outside district fades)
	 * - H3 hexagonal cells as a choropleth (from verification packet `cells`)
	 * - Auto-fits viewport to boundary or cell bounds
	 * - Fallback: point clusters if no cell data available
	 *
	 * H3 cell indices → GeoJSON polygons via cellToBoundary() from h3-js.
	 * Each hexagon ~5.16 km² at res 7.
	 *
	 * Lazy-loads MapLibre (~262KB) + h3-js, off critical path.
	 */
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { onMount } from 'svelte';
	import type { LngLatBoundsLike } from 'maplibre-gl';
	import type { CellWeight } from '$lib/types/verification-packet';

	interface Cluster {
		lng: number;
		lat: number;
		count: number;
	}

	interface DistrictOverlay {
		boundary: GeoJSON.Polygon | GeoJSON.MultiPolygon;
		count: number;
		label?: string;
	}

	let {
		center = undefined,
		zoom = undefined,
		boundary = undefined,
		districtCode = undefined,
		districtCentroid = undefined,
		cells = [],
		clusters = [],
		districts = [],
		interactive = false,
		onCellHover = undefined,
		class: className = ''
	}: {
		/** Map center [lng, lat] — optional, auto-fits to data if omitted */
		center?: [number, number];
		/** Zoom level — optional, auto-fits to data if omitted */
		zoom?: number;
		/** Single district boundary polygon (for single-district view) */
		boundary?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
		/** District code (e.g., "CA-11") — fetches boundary from Shadow Atlas if boundary not provided */
		districtCode?: string;
		/** District centroid for boundary lookup — required when districtCode is set and boundary is not */
		districtCentroid?: { lat: number; lng: number };
		/** H3 res-7 cells with action counts — renders as hexagonal choropleth */
		cells?: CellWeight[];
		/** Fallback: point clusters (used when cell data unavailable) */
		clusters?: Cluster[];
		/** Multi-district overlays — each district filled by action count (cross-district view) */
		districts?: DistrictOverlay[];
		/** Enable pan/zoom and hover interactions. False = static specimen. */
		interactive?: boolean;
		/** Fires on cell hover (cell data) and leave (null). For cross-dimensional filtering. */
		onCellHover?: (cell: CellWeight | null) => void;
		class?: string;
	} = $props();

	let containerEl = $state<HTMLDivElement | null>(null);
	let mapInstance: { remove: () => void } | null = null;
	let resolvedBoundary = $state<GeoJSON.Polygon | GeoJSON.MultiPolygon | undefined>(boundary);

	// Self-resolve boundary from districtCode if not provided directly
	$effect(() => {
		if (boundary) {
			resolvedBoundary = boundary;
			return;
		}
		if (!districtCode || !districtCentroid) return;

		fetch(`/api/shadow-atlas/boundary?district=${districtCode}&lat=${districtCentroid.lat}&lng=${districtCentroid.lng}`)
			.then(r => r.ok ? r.json() : null)
			.then(data => {
				if (data?.geometry) resolvedBoundary = data.geometry;
			})
			.catch(() => { /* boundary fetch failed — map renders without boundary */ });
	});

	onMount(() => {
		if (!containerEl) return;
		initMap(containerEl);
		return () => { mapInstance?.remove(); };
	});

	/** Compute bounding box from an array of [lng, lat] coordinates */
	function computeBounds(coords: [number, number][]): LngLatBoundsLike {
		let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
		for (const [lng, lat] of coords) {
			if (lng < minLng) minLng = lng;
			if (lng > maxLng) maxLng = lng;
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
		}
		return [[minLng, minLat], [maxLng, maxLat]];
	}

	/** World polygon with a hole for the district — dims everything outside */
	function makeOutsideMask(districtGeom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Feature {
		const world = [[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]];
		const holes = districtGeom.type === 'Polygon'
			? districtGeom.coordinates
			: districtGeom.coordinates.flat();
		return {
			type: 'Feature',
			properties: {},
			geometry: { type: 'Polygon', coordinates: [world, ...holes] }
		};
	}

	async function initMap(container: HTMLDivElement) {
		const [maplibregl, h3, turfHelpers, turfIntersect] = await Promise.all([
			import('maplibre-gl'),
			import('h3-js'),
			import('@turf/helpers'),
			import('@turf/intersect')
		]);

		// Collect all coordinates for auto-fit
		const allCoords: [number, number][] = [];

		// Build district feature for clipping (if boundary provided)
		const districtFeature = resolvedBoundary
			? turfHelpers.feature(resolvedBoundary)
			: null;

		// Collect cell polygons for rendering + bounds
		// Clip to district boundary so edge cells don't extend beyond
		let cellFeatures: GeoJSON.Feature[] = [];
		if (cells.length > 0) {
			const maxCount = Math.max(...cells.map(c => c.count));
			for (let ci = 0; ci < cells.length; ci++) {
				const cell = cells[ci];
				const ring = h3.cellToBoundary(cell.h3).map(([lat, lng]): [number, number] => [lng, lat]);
				ring.push(ring[0]);
				const hexFeature = turfHelpers.polygon([ring]);
				const props = { count: cell.count, t: cell.count / maxCount, cellIndex: ci };

				if (districtFeature) {
					try {
						const clipped = turfIntersect.default(
							turfHelpers.featureCollection([hexFeature, districtFeature])
						);
						if (clipped) {
							clipped.properties = props;
							const coords = clipped.geometry.type === 'Polygon'
								? clipped.geometry.coordinates
								: clipped.geometry.coordinates.flat();
							for (const r of coords) for (const coord of r) allCoords.push(coord as [number, number]);
							cellFeatures.push(clipped);
						}
					} catch (e) {
						// Intersection failed (degenerate geometry) — use unclipped
						console.warn(`[DistrictMap] turf.intersect failed for cell ${cell.h3}, rendering unclipped:`, e);
						for (const coord of ring) allCoords.push(coord);
						cellFeatures.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
					}
				} else {
					for (const coord of ring) allCoords.push(coord);
					cellFeatures.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
				}
			}
		}

		// Collect boundary coords for bounds
		if (resolvedBoundary) {
			const rings = resolvedBoundary.type === 'Polygon' ? resolvedBoundary.coordinates : resolvedBoundary.coordinates.flat();
			for (const ring of rings) {
				for (const coord of ring) allCoords.push(coord as [number, number]);
			}
		}

		// Collect district overlay coords for bounds
		for (const d of districts) {
			const rings = d.boundary.type === 'Polygon' ? d.boundary.coordinates : d.boundary.coordinates.flat();
			for (const ring of rings) {
				for (const coord of ring) allCoords.push(coord as [number, number]);
			}
		}

		// Determine initial view
		const hasData = allCoords.length > 0;
		const initCenter: [number, number] = center ?? (hasData ? [
			(Math.min(...allCoords.map(c => c[0])) + Math.max(...allCoords.map(c => c[0]))) / 2,
			(Math.min(...allCoords.map(c => c[1])) + Math.max(...allCoords.map(c => c[1]))) / 2
		] : [-98.5, 39.8]);

		const m = new maplibregl.default.Map({
			container,
			style: {
				version: 8,
				sources: {
					carto: {
						type: 'raster',
						tiles: [
							'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
							'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
							'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'
						],
						tileSize: 256,
						attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
					}
				},
				layers: [{ id: 'carto', type: 'raster', source: 'carto' }]
			},
			center: initCenter,
			zoom: zoom ?? 10,
			interactive,
			renderWorldCopies: false,
			fadeDuration: 0,
			attributionControl: false
		});

		if (interactive) {
			m.addControl(new maplibregl.default.NavigationControl({ showCompass: false }), 'top-right');
		}

		m.on('load', () => {
			// Auto-fit to data bounds
			if (hasData && !center) {
				m.fitBounds(computeBounds(allCoords), { padding: 20, duration: 0 });
			}

			// District boundary + outside mask
			if (resolvedBoundary) {
				// Dim everything outside the district
				m.addSource('outside-mask', {
					type: 'geojson',
					data: makeOutsideMask(resolvedBoundary)
				});
				m.addLayer({
					id: 'outside-dim',
					type: 'fill',
					source: 'outside-mask',
					paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.55 }
				});

				// District boundary stroke
				m.addSource('district', {
					type: 'geojson',
					data: { type: 'Feature', properties: {}, geometry: resolvedBoundary }
				});
				m.addLayer({
					id: 'district-stroke',
					type: 'line',
					source: 'district',
					paint: { 'line-color': '#0f766e', 'line-width': 2.5, 'line-opacity': 0.7 }
				});
			}

			// Multi-district overlays (cross-district campaign view)
			if (districts.length > 0) {
				const maxDist = Math.max(...districts.map(d => d.count));
				const distFeatures = districts.map(d => ({
					type: 'Feature' as const,
					properties: { count: d.count, t: d.count / maxDist, label: d.label ?? '' },
					geometry: d.boundary
				}));
				m.addSource('districts', { type: 'geojson', data: { type: 'FeatureCollection', features: distFeatures } });
				m.addLayer({
					id: 'district-fills',
					type: 'fill',
					source: 'districts',
					paint: {
						'fill-color': ['interpolate', ['linear'], ['get', 't'], 0, '#ccfbf1', 0.5, '#14b8a6', 1, '#0f766e'],
						'fill-opacity': ['interpolate', ['linear'], ['get', 't'], 0, 0.2, 1, 0.5]
					}
				});
				m.addLayer({
					id: 'district-strokes',
					type: 'line',
					source: 'districts',
					paint: { 'line-color': '#0f766e', 'line-width': 1.5, 'line-opacity': 0.5 }
				});
			}

			// H3 hexagonal cells — the real geographic resolution
			if (cellFeatures.length > 0) {
				// Assign stable IDs for feature-state hover
				cellFeatures.forEach((f, i) => { f.id = i; });

				m.addSource('cells', {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: cellFeatures }
				});
				m.addLayer({
					id: 'cell-fill',
					type: 'fill',
					source: 'cells',
					paint: {
						'fill-color': ['interpolate', ['linear'], ['get', 't'],
							0, '#ccfbf1',
							0.3, '#5eead4',
							0.6, '#14b8a6',
							1, '#0f766e'
						],
						'fill-opacity': ['case',
							['boolean', ['feature-state', 'hover'], false],
							0.85,
							['interpolate', ['linear'], ['get', 't'], 0, 0.35, 1, 0.7]
						]
					}
				});
				m.addLayer({
					id: 'cell-stroke',
					type: 'line',
					source: 'cells',
					paint: {
						'line-color': '#0f766e',
						'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1],
						'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.8, 0.4]
					}
				});

				// Hover interaction (only when interactive)
				if (interactive) {
					let hoveredId: number | null = null;
					const popup = new maplibregl.default.Popup({
						closeButton: false,
						closeOnClick: false,
						className: 'district-map-popup',
						offset: 8
					});

					m.on('mousemove', 'cell-fill', (e) => {
						if (!e.features?.length) return;
						const feat = e.features[0];
						const id = feat.id as number;

						// Clear previous hover
						if (hoveredId !== null && hoveredId !== id) {
							m.setFeatureState({ source: 'cells', id: hoveredId }, { hover: false });
						}
						hoveredId = id;
						m.setFeatureState({ source: 'cells', id }, { hover: true });
						m.getCanvas().style.cursor = 'pointer';

						// Tooltip
						const count = feat.properties?.count ?? 0;
						popup.setLngLat(e.lngLat)
							.setHTML(`<span class="district-map-popup__count">${count}</span> verified`)
							.addTo(m);

						// Emit full CellWeight for cross-dimensional filtering
						const cellIndex = feat.properties?.cellIndex;
						if (onCellHover && typeof cellIndex === 'number' && cellIndex < cells.length) {
							onCellHover(cells[cellIndex]);
						}
					});

					m.on('mouseleave', 'cell-fill', () => {
						if (hoveredId !== null) {
							m.setFeatureState({ source: 'cells', id: hoveredId }, { hover: false });
							hoveredId = null;
						}
						m.getCanvas().style.cursor = '';
						popup.remove();
						onCellHover?.(null);
					});
				}
			} else if (clusters.length > 0) {
				const maxCount = Math.max(...clusters.map(c => c.count));
				m.addSource('clusters', {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: clusters.map(c => ({
							type: 'Feature' as const,
							properties: { count: c.count, t: c.count / maxCount },
							geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] }
						}))
					}
				});
				m.addLayer({
					id: 'cluster-dots',
					type: 'circle',
					source: 'clusters',
					paint: {
						'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 0, 4, maxCount, 10],
						'circle-color': ['interpolate', ['linear'], ['get', 't'], 0, '#5eead4', 0.5, '#14b8a6', 1, '#0f766e'],
						'circle-opacity': 0.85,
						'circle-stroke-color': '#ffffff',
						'circle-stroke-width': 1.5,
						'circle-stroke-opacity': 0.7
					}
				});
			}
		});

		mapInstance = m;
	}
</script>

<div bind:this={containerEl} class="district-map {className}" role="img" aria-label="District geographic distribution"></div>

<style>
	.district-map {
		width: 100%;
		height: 100%;
		border-radius: 3px;
		overflow: hidden;
	}

	.district-map :global(.maplibregl-canvas) {
		outline: none;
	}

	/* Tooltip: mono count + Satoshi label, civic styling */
	.district-map :global(.district-map-popup .maplibregl-popup-content) {
		padding: 4px 8px;
		border-radius: 3px;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.6875rem;
		color: #1e293b;
		background: #ffffff;
		border: 1px solid #e2e8f0;
		box-shadow: 0 2px 8px -2px rgba(0, 0, 0, 0.12);
	}

	.district-map :global(.district-map-popup .maplibregl-popup-tip) {
		display: none;
	}

	.district-map :global(.district-map-popup__count) {
		font-family: 'JetBrains Mono', monospace;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	/* Compact nav controls */
	.district-map :global(.maplibregl-ctrl-group) {
		border-radius: 3px;
		box-shadow: 0 1px 4px -1px rgba(0, 0, 0, 0.15);
	}
</style>
