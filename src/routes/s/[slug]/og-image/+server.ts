import type { RequestHandler } from './$types';
import { isValidPublicTemplateSlug } from '$lib/server/public-template-detail-path';
import { getCachedPublicTemplateOgImageArtifact } from '$lib/server/public-template-queries';

const PRIVATE_NO_STORE = 'private, no-store, max-age=0';
const PUBLIC_REVALIDATE = 'public, max-age=60, must-revalidate';

function textFailure(body: string, status: 404 | 503, retryAfter?: string): Response {
	return new Response(body, {
		status,
		headers: {
			'Cache-Control': PRIVATE_NO_STORE,
			'Content-Type': 'text/plain; charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
			...(retryAfter ? { 'Retry-After': retryAfter } : {})
		}
	});
}

/** Anonymous requests can select and GET only a producer-published exact PNG. */
export const GET: RequestHandler = async ({ params, url, platform }) => {
	if (!isValidPublicTemplateSlug(params.slug)) {
		return textFailure('Template not found', 404);
	}
	try {
		const artifact = await getCachedPublicTemplateOgImageArtifact({ url, platform }, params.slug);
		if (!artifact) return textFailure('Template not found', 404);
		const body = new ArrayBuffer(artifact.bytes.byteLength);
		new Uint8Array(body).set(artifact.bytes);
		return new Response(body, {
			headers: {
				'Cache-Control': PUBLIC_REVALIDATE,
				'Cloudflare-CDN-Cache-Control': PUBLIC_REVALIDATE,
				'Content-Length': String(artifact.bytes.byteLength),
				'Content-Type': 'image/png',
				ETag: `"og-${artifact.revision}"`,
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (error) {
		console.error(
			'[public-template-og] exact published image unavailable:',
			error instanceof Error ? error.name : 'unknown'
		);
		return textFailure('Image temporarily unavailable', 503, '60');
	}
};

/** Disable SvelteKit's implicit GET-backed HEAD path: anonymous storage is GET-only. */
export const HEAD: RequestHandler = () =>
	new Response('Method not allowed', {
		status: 405,
		headers: {
			Allow: 'GET',
			'Cache-Control': PRIVATE_NO_STORE,
			'Content-Type': 'text/plain; charset=utf-8',
			'X-Content-Type-Options': 'nosniff'
		}
	});
