import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	PublicTemplateOgImageNotPublishedError,
	clearPublicDiscoveryCache,
	getPublicTemplateOgImageArtifact
} from '$lib/server/public-discovery-cache';
import { renderPublicTemplateOgImage } from '$lib/server/public-template-og-image';
import {
	buildPublicTemplateOgQueueJob,
	publicTemplatePageArtifactObjectKeys
} from '$lib/server/public-template-og-queue';
import type { CachedPublicTemplateDetail } from '$lib/server/public-template-detail-cache';

const BACKEND = 'https://production.example.convex.cloud';
const URL = new globalThis.URL('https://commons.example/s/clean-water/og-image');

function detail(): CachedPublicTemplateDetail {
	return {
		id: 'template-clean-water',
		slug: 'clean-water',
		title: 'Protect clean water',
		description: 'Ask the agency to protect clean water.',
		domain: 'environment',
		type: 'email',
		deliveryMethod: 'email',
		subject: 'Protect clean water',
		message_body: 'Please protect clean water.',
		sources: [],
		research_log: [],
		preview: 'Please protect clean water.',
		is_public: true,
		verified_sends: 42,
		unique_districts: 3,
		send_count: 42,
		delivery_config: {},
		cwc_config: null,
		recipient_config: { emails: [] },
		recipient_count: 0,
		recipientEmails: [],
		topics: ['water'],
		createdAt: '2026-07-18T00:00:00.000Z',
		author: { name: 'Commons', avatar: null }
	} as unknown as CachedPublicTemplateDetail;
}

function fixture() {
	type Stored = {
		body: Uint8Array;
		customMetadata?: Record<string, string>;
		httpMetadata?: R2HTTPMetadata;
	};
	const entries = new Map<string, Stored>();
	const get = vi.fn(async (key: string) => {
		const stored = entries.get(key);
		if (!stored) return null;
		return {
			arrayBuffer: async () => stored.body.slice().buffer,
			customMetadata: stored.customMetadata,
			etag: 'etag',
			httpEtag: '"etag"',
			httpMetadata: stored.httpMetadata,
			key,
			size: stored.body.byteLength,
			uploaded: new Date(1_900_000_000_000)
		};
	});
	const list = vi.fn();
	const put = vi.fn();
	const remove = vi.fn();
	const r2 = { delete: remove, get, list, put } as unknown as R2Bucket;
	const edgeEntries = new Map<string, Response>();
	const edge = {
		delete: vi.fn(async (request: Request) => edgeEntries.delete(request.url)),
		match: vi.fn(async (request: Request) => edgeEntries.get(request.url)?.clone()),
		put: vi.fn(async (request: Request, response: Response) => {
			edgeEntries.set(request.url, response.clone());
		})
	};
	vi.stubGlobal('caches', { default: edge });
	const platform = {
		env: { PUBLIC_CONVEX_URL: BACKEND, PUBLIC_DISCOVERY_R2: r2 }
	} as App.Platform;
	const key = (revision: number) =>
		publicTemplatePageArtifactObjectKeys(
			buildPublicTemplateOgQueueJob({
				backend: BACKEND,
				revision,
				sourceSha: 'a'.repeat(40),
				slug: 'clean-water',
				transactionId: '123456789-2'
			})
		).ogImage;
	const seed = (revision: number, body: Uint8Array, metadata = true) => {
		entries.set(key(revision), {
			body,
			...(metadata
				? {
						customMetadata: {
							kind: 'template-og-image',
							revision: String(revision),
							schema: '1',
							slug: 'clean-water'
						},
						httpMetadata: { contentType: 'image/png' }
					}
				: {})
		});
	};
	return { edge, edgeEntries, entries, get, key, list, platform, put, remove, seed };
}

describe('anonymous public template OG binary cache', () => {
	beforeEach(() => clearPublicDiscoveryCache());
	afterEach(() => {
		clearPublicDiscoveryCache();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('uses Cache API then one exact R2 GET without LIST, R2 write, or stale-revision fallback', async () => {
		const f = fixture();
		const image = await renderPublicTemplateOgImage(detail());
		f.seed(7, image);
		await expect(
			getPublicTemplateOgImageArtifact({
				platform: f.platform,
				revision: 7,
				slug: 'clean-water',
				url: URL
			})
		).resolves.toEqual(image);
		expect(f.get).toHaveBeenCalledWith(f.key(7));
		expect(f.edge.put).toHaveBeenCalledOnce();

		clearPublicDiscoveryCache();
		await expect(
			getPublicTemplateOgImageArtifact({
				platform: f.platform,
				revision: 7,
				slug: 'clean-water',
				url: URL
			})
		).resolves.toEqual(image);
		expect(f.get).toHaveBeenCalledTimes(1);

		clearPublicDiscoveryCache();
		await expect(
			getPublicTemplateOgImageArtifact({
				platform: f.platform,
				revision: 8,
				slug: 'clean-water',
				url: URL
			})
		).rejects.toBeInstanceOf(PublicTemplateOgImageNotPublishedError);
		expect(f.get).toHaveBeenLastCalledWith(f.key(8));
		expect(f.list).not.toHaveBeenCalled();
		expect(f.put).not.toHaveBeenCalled();
		expect(f.remove).not.toHaveBeenCalled();
	});

	it('evicts corrupt edge data, retries the same exact R2 key, and fails closed on corrupt R2', async () => {
		const f = fixture();
		const image = await renderPublicTemplateOgImage(detail());
		f.seed(7, image);
		f.edgeEntries.set(
			'https://commons.example/.internal-cache/public-template-og/v1/commons.example/slug=clean-water/revision=7',
			new Response(new Uint8Array([1]), {
				headers: { 'Content-Length': '1', 'Content-Type': 'application/octet-stream' }
			})
		);
		await expect(
			getPublicTemplateOgImageArtifact({
				platform: f.platform,
				revision: 7,
				slug: 'clean-water',
				url: URL
			})
		).resolves.toEqual(image);
		// If the internal URL varies with realm encoding, the exact match still
		// proves only the requested revision reached R2.
		expect(f.get).toHaveBeenCalledWith(f.key(7));

		clearPublicDiscoveryCache();
		f.edgeEntries.clear();
		f.seed(8, image, false);
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		await expect(
			getPublicTemplateOgImageArtifact({
				platform: f.platform,
				revision: 8,
				slug: 'clean-water',
				url: URL
			})
		).rejects.toThrow('could not be read safely');
		expect(f.list).not.toHaveBeenCalled();
		expect(f.put).not.toHaveBeenCalled();
	});

	it('rejects noncanonical revision aliases before Cache API or R2 I/O', async () => {
		const f = fixture();
		await expect(
			getPublicTemplateOgImageArtifact({
				platform: f.platform,
				revision: '0007',
				slug: 'clean-water',
				url: URL
			})
		).rejects.toThrow('revision is invalid');
		expect(f.edge.match).not.toHaveBeenCalled();
		expect(f.get).not.toHaveBeenCalled();
	});
});
