import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { LayoutServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ params, request, setHeaders }) => {
	const { slug } = params;

	// This is an explicit detail/send response, not anonymous discovery data.
	// It contains the recipient roster needed by the power landscape and mailto
	// flow, so never allow a browser or Cloudflare cache to retain it.
	setHeaders({ 'Cache-Control': 'private, no-store, max-age=0' });

	// Country detection from CF / Vercel / generic headers — US default
	const headers = request.headers;
	const detectedCountry =
		headers.get('cf-ipcountry') ||
		headers.get('x-vercel-ip-country') ||
		headers.get('x-country') ||
		'US';

	const convexTemplate = await serverQuery(api.templates.getBySlugPublic, { slug });

	if (!convexTemplate) {
		throw error(404, 'Template not found');
	}

	// Congressional delivery is implemented but not launched while the flag is false.
	if (!FEATURES.CONGRESSIONAL && convexTemplate.deliveryMethod === 'cwc') {
		throw error(404, 'Template not found');
	}

	return {
		template: convexTemplate,
		channel: { country: detectedCountry, locale: 'en-US' }
	};
};
