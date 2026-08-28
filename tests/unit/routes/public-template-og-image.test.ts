import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCachedPublicTemplateOgImageArtifact } = vi.hoisted(() => ({
	mockGetCachedPublicTemplateOgImageArtifact: vi.fn()
}));

vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplateOgImageArtifact: mockGetCachedPublicTemplateOgImageArtifact
}));

import { GET, HEAD } from '../../../src/routes/s/[slug]/og-image/+server';
import routeSource from '../../../src/routes/s/[slug]/og-image/+server.ts?raw';

function event(slug = 'clean-water') {
	const url = new URL(`https://commons.example/s/${slug}/og-image`);
	return {
		params: { slug },
		platform: { env: { marker: 'platform' } },
		url
	} as never;
}

describe('GET /s/[slug]/og-image', () => {
	beforeEach(() => {
		mockGetCachedPublicTemplateOgImageArtifact.mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => vi.restoreAllMocks());

	it('serves only the exact published PNG with short revalidation', async () => {
		const bytes = new Uint8Array([137, 80, 78, 71]);
		mockGetCachedPublicTemplateOgImageArtifact.mockResolvedValue({ bytes, revision: '71' });
		const response = await GET(event());
		expect(response.status).toBe(200);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(response.headers.get('content-length')).toBe('4');
		expect(response.headers.get('etag')).toBe('"og-71"');
		expect(response.headers.get('cache-control')).toBe('public, max-age=60, must-revalidate');
		expect(response.headers.get('cloudflare-cdn-cache-control')).toBe(
			'public, max-age=60, must-revalidate'
		);
		expect(mockGetCachedPublicTemplateOgImageArtifact).toHaveBeenCalledWith(
			expect.objectContaining({ url: expect.any(URL), platform: expect.any(Object) }),
			'clean-water'
		);
	});

	it('returns a private 404 for invalid or unpublished slugs without fallback work', async () => {
		let response = await GET(event('../invalid'));
		expect(response.status).toBe(404);
		expect(mockGetCachedPublicTemplateOgImageArtifact).not.toHaveBeenCalled();

		mockGetCachedPublicTemplateOgImageArtifact.mockResolvedValue(null);
		response = await GET(event('not-published'));
		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
	});

	it('fails closed with a private retryable 503 when exact storage is unavailable', async () => {
		mockGetCachedPublicTemplateOgImageArtifact.mockRejectedValue(new Error('R2 unavailable'));
		const response = await GET(event());
		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
		expect(response.headers.get('retry-after')).toBe('60');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('rejects HEAD before manifest, R2, rendering, or origin work', async () => {
		const response = await HEAD(event());
		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET');
		expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
		expect(mockGetCachedPublicTemplateOgImageArtifact).not.toHaveBeenCalled();
	});

	it('contains no renderer, Convex, JSON-artifact, or origin fallback dependency', () => {
		expect(routeSource).not.toMatch(/satori|sharp|renderPublicTemplateOgImage/i);
		expect(routeSource).not.toMatch(/serverQuery|convex/i);
		expect(routeSource).not.toMatch(/getCachedPublicTemplatePageArtifact|\.json\s*\(/);
		expect(routeSource).not.toMatch(/\bfetch\s*\(/);
	});
});
