import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { LayoutServerLoad } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: LayoutServerLoad = async ({ params, locals: _locals, request }) => {
	const { slug } = params;

	// Detect country and resolve channel (needed regardless of data source)
	const detectedCountry = detectCountryFromHeaders(request.headers) || 'US';
	const channelInfo = await resolveChannel(detectedCountry);

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
		channel: channelInfo
	};
};
