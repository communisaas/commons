import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { LayoutServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ params, request }) => {
	const { slug } = params;

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

	// Gate CWC templates behind CONGRESSIONAL feature flag
	if (!FEATURES.CONGRESSIONAL && convexTemplate.deliveryMethod === 'cwc') {
		throw error(404, 'Template not found');
	}

	return {
		template: convexTemplate,
		channel: { country: detectedCountry, locale: 'en-US' }
	};
};
