/**
 * Root layout JavaScript - handles global client-side initialization
 *
 * This runs on every page load and handles:
 * - Error tracking (categorized, no surveillance)
 * - Global client-side setup
 */

import { browser } from '$app/environment';
import { trackError } from '$lib/core/analytics/client';

// Initialize error tracking on client-side
// NOTE: No page view tracking - that's a surveillance pattern
if (browser) {
	// Track errors automatically (categorized by type)
	window.addEventListener('error', (event) => {
		trackError(event.error);
	});

	// Track unhandled promise rejections
	window.addEventListener('unhandledrejection', (event) => {
		trackError(new Error(String(event.reason)));
	});
}

import type { LayoutLoad } from './$types';

// Convex client is initialized via hooks.client.ts + layout.svelte.
// User data comes from Convex via hooks.server.ts session validation.

export const load: LayoutLoad = async ({ data }) => {
	return { ...data };
};
