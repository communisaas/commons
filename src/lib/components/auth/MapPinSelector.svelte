<!--
  MapPinSelector.svelte

  Privacy-first location selection via interactive map.
  User drops a pin on their location — no address string ever leaves the browser.

  Uses MapLibre GL JS with OpenStreetMap raster tiles (no API key, no tracking).
  Lazy-loads MapLibre (~150 KB) only when this component mounts.

  Emits: onSelect({ lat, lng }) when user confirms pin placement.
  Emits: onCancel() when user goes back.
-->

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { MapPin, Check, RotateCcw, Loader2 } from '@lucide/svelte';

	let {
		onSelect,
		onCancel,
	}: {
		onSelect: (coords: { lat: number; lng: number }) => void;
		onCancel?: () => void;
	} = $props();

	let mapContainer: HTMLDivElement;
	let map: unknown;
	let marker: unknown;
	let loading = $state(true);
	let pinLat: number | null = $state(null);
	let pinLng: number | null = $state(null);
	let hasPinPlaced = $derived(pinLat !== null && pinLng !== null);

	// Default center: Continental US
	const DEFAULT_CENTER: [number, number] = [-98.5795, 39.8283];
	const DEFAULT_ZOOM = 4;
	const PIN_ZOOM = 12;

	// OSM raster tiles — no API key, no tracking
	const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

	onMount(async () => {
		try {
			// Lazy-load MapLibre GL JS
			const maplibregl = await import('maplibre-gl');

			// Try to get a rough initial center from browser timezone
			const initialCenter = guessCountryCenter() || DEFAULT_CENTER;

			map = new maplibregl.Map({
				container: mapContainer,
				style: {
					version: 8,
					sources: {
						osm: {
							type: 'raster',
							tiles: [TILE_URL],
							tileSize: 256,
							attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
						},
					},
					layers: [
						{
							id: 'osm',
							type: 'raster',
							source: 'osm',
						},
					],
				},
				center: initialCenter,
				zoom: DEFAULT_ZOOM,
				maxZoom: 18,
			});

			const mapInstance = map as InstanceType<typeof maplibregl.Map>;

			mapInstance.on('load', () => {
				loading = false;
			});

			// Place pin on click
			mapInstance.on('click', (e: { lngLat: { lat: number; lng: number } }) => {
				const { lat, lng } = e.lngLat;
				pinLat = lat;
				pinLng = lng;

				// Remove existing marker
				if (marker) {
					(marker as InstanceType<typeof maplibregl.Marker>).remove();
				}

				// Add new marker
				marker = new maplibregl.Marker({ color: '#2563eb' })
					.setLngLat([lng, lat])
					.addTo(mapInstance);

				// Fly to pin location if zoomed out
				if (mapInstance.getZoom() < PIN_ZOOM) {
					mapInstance.flyTo({ center: [lng, lat], zoom: PIN_ZOOM });
				}
			});
		} catch (err) {
			console.error('[MapPinSelector] Failed to load MapLibre:', err);
			loading = false;
		}
	});

	onDestroy(() => {
		if (map) {
			(map as { remove: () => void }).remove();
		}
	});

	function handleConfirm() {
		if (pinLat !== null && pinLng !== null) {
			onSelect({ lat: pinLat, lng: pinLng });
		}
	}

	function handleReset() {
		if (marker) {
			(marker as { remove: () => void }).remove();
			marker = null;
		}
		pinLat = null;
		pinLng = null;
	}

	/**
	 * Guess a rough country center from the browser's timezone.
	 * Returns [lng, lat] or null if indeterminate.
	 */
	function guessCountryCenter(): [number, number] | null {
		try {
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			if (!tz) return null;

			// Map timezone prefixes to rough country centers
			if (tz.startsWith('America/')) return DEFAULT_CENTER; // US
			if (tz.startsWith('Europe/London') || tz.startsWith('Europe/Belfast')) return [-1.5, 52.5]; // UK
			if (tz.startsWith('Europe/')) return [10.0, 50.0]; // Central Europe
			if (tz.startsWith('Asia/Kolkata') || tz.startsWith('Asia/Calcutta')) return [78.9, 20.6]; // India
			if (tz.startsWith('Australia/')) return [134.0, -25.3]; // Australia
			if (tz.startsWith('Pacific/Auckland')) return [174.8, -41.3]; // NZ
			if (tz === 'America/Toronto' || tz === 'America/Vancouver') return [-96.0, 56.1]; // Canada

			return null;
		} catch {
			return null;
		}
	}
</script>

<svelte:head>
	<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
</svelte:head>

<div class="map-pin-selector">
	<div class="map-header">
		<MapPin size={18} />
		<span>Tap your location on the map</span>
	</div>

	<div class="map-wrapper" bind:this={mapContainer}>
		{#if loading}
			<div class="map-loading">
				<Loader2 size={24} class="animate-spin" />
				<span>Loading map...</span>
			</div>
		{/if}
	</div>

	{#if hasPinPlaced}
		<div class="pin-info">
			<span class="coords">
				{pinLat?.toFixed(4)}, {pinLng?.toFixed(4)}
			</span>
		</div>
	{/if}

	<div class="map-actions">
		{#if onCancel}
			<button type="button" class="btn-secondary" onclick={onCancel}>
				Back
			</button>
		{/if}

		{#if hasPinPlaced}
			<button type="button" class="btn-secondary" onclick={handleReset}>
				<RotateCcw size={14} />
				Reset
			</button>
		{/if}

		<button
			type="button"
			class="btn-primary"
			disabled={!hasPinPlaced}
			onclick={handleConfirm}
		>
			<Check size={14} />
			Confirm location
		</button>
	</div>
</div>

<style>
	.map-pin-selector {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.map-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--text-secondary, #6b7280);
	}

	.map-wrapper {
		position: relative;
		width: 100%;
		height: 350px;
		border-radius: 0.5rem;
		overflow: hidden;
		border: 1px solid var(--border-color, #e5e7eb);
	}

	.map-loading {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: var(--bg-secondary, #f9fafb);
		color: var(--text-secondary, #6b7280);
		font-size: 0.875rem;
		z-index: 10;
	}

	.pin-info {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--bg-secondary, #f3f4f6);
		font-size: 0.75rem;
		color: var(--text-secondary, #6b7280);
		font-variant-numeric: tabular-nums;
	}

	.map-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		border: none;
		background: var(--primary, #2563eb);
		color: white;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		border: 1px solid var(--border-color, #d1d5db);
		background: transparent;
		color: var(--text-primary, #374151);
		font-size: 0.875rem;
		cursor: pointer;
	}
</style>
