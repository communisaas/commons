import { error } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import type { LayoutServerLoad } from './$types';

import { isValidPublicTemplateSlug } from '$lib/server/public-template-detail-path';
import { getCachedPublicTemplatePageArtifact } from '$lib/server/public-template-queries';

export const load: LayoutServerLoad = async ({ params, request, setHeaders, url, platform }) => {
	const { slug } = params;
	if (!isValidPublicTemplateSlug(slug)) throw error(404, 'Template not found');

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

	const artifact = await getCachedPublicTemplatePageArtifact({ url, platform }, slug);

	if (!artifact) {
		throw error(404, 'Template not found');
	}
	const convexTemplate = artifact.detail;

	// Congressional delivery is implemented but not launched while the flag is false.
	if (!FEATURES.CONGRESSIONAL && convexTemplate.deliveryMethod === 'cwc') {
		throw error(404, 'Template not found');
	}

	return {
		template: convexTemplate,
		publicPageAggregate: artifact.aggregate,
		channel: { country: detectedCountry, locale: 'en-US' }
	};
};
