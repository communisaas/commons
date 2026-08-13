import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearPublicTemplateCachesForTest,
	getCachedPublicTemplateDetail,
	getCachedPublicTemplateOgImage,
	invalidatePublicTemplateCaches
} from '$lib/server/public-template-detail-cache';
import {
	classifyPublicTemplateCostPath,
	isValidPublicTemplateSlug,
	PUBLIC_TEMPLATE_DETAIL_RATE_LIMIT
} from '$lib/server/public-template-detail-path';
import hooksSource from '../../../src/hooks.server.ts?raw';

const mockGetArtifact = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplatePageArtifact: mockGetArtifact
}));

import { load as loadTemplateDetailLayout } from '../../../src/routes/s/[slug]/+layout.server';
import templateModalComponentSource from '../../../src/lib/components/template/TemplateModal.svelte?raw';

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

class MemoryCache {
	readonly entries = new Map<string, Response>();

	async match(request: Request): Promise<Response | undefined> {
		return this.entries.get(request.url)?.clone();
	}

	async put(request: Request, response: Response): Promise<void> {
		this.entries.set(request.url, response.clone());
	}

	async delete(request: Request): Promise<boolean> {
		return this.entries.delete(request.url);
	}
}

class DelayedPutCache extends MemoryCache {
	readonly gate = deferred<void>();

	override async put(request: Request, response: Response): Promise<void> {
		await this.gate.promise;
		await super.put(request, response);
	}
}

const url = new URL('https://commons.example/s/clean-water');

function detailFixture() {
	return {
		id: 'templates:clean-water',
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
		verified_sends: 0,
		unique_districts: 0,
		send_count: 0,
		delivery_config: {},
		cwc_config: null,
		recipient_config: {
			emails: ['press@agency.example'],
			decisionMakers: [
				{
					name: 'Press Office',
					title: 'Press Desk',
					organization: 'Public Agency',
					email: 'press@agency.example',
					emailGrounded: true,
					emailSource: 'https://agency.example/contact'
				}
			]
		},
		recipient_count: 1,
		recipientEmails: ['press@agency.example'],
		topics: ['water'],
		createdAt: '2026-07-18T00:00:00.000Z',
		author: { name: 'Template Author', avatar: null }
	};
}

describe('public template detail cost shield', () => {
	let cache: MemoryCache;

	beforeEach(() => {
		cache = new MemoryCache();
		vi.stubGlobal('caches', { default: cache });
		clearPublicTemplateCachesForTest();
	});

	afterEach(() => {
		clearPublicTemplateCachesForTest();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('has no production Convex fallback after the immutable R2 cutover', async () => {
		await expect(
			getCachedPublicTemplateDetail({ slug: 'clean-water', url })
		).rejects.toThrow('PUBLIC_TEMPLATE_DETAIL_ORIGIN_FALLBACK_RETIRED');
	});

	it('matches only the two exact cost-bearing route shapes', () => {
		expect(classifyPublicTemplateCostPath('/s/clean-water')).toEqual({
			kind: 'detail',
			slug: 'clean-water',
			validSlug: true
		});
		expect(classifyPublicTemplateCostPath('/s/clean-water/og-image')).toEqual({
			kind: 'og-image',
			slug: 'clean-water',
			validSlug: true
		});
		expect(classifyPublicTemplateCostPath('/template-modal/clean-water/')).toBeNull();
		expect(classifyPublicTemplateCostPath('/s/clean-water/debate/debate-1')).toBeNull();
		expect(classifyPublicTemplateCostPath('/s/clean-water/extra')).toBeNull();
		expect(classifyPublicTemplateCostPath('/directory')).toBeNull();
	});

	it('classifies malformed exact-path slugs so the early hook can reject them', () => {
		for (const pathname of [
			'/s/Clean-Water',
			'/s/clean--water',
			'/s/%63lean-water',
			`/s/${'a'.repeat(101)}/og-image`
		]) {
			const match = classifyPublicTemplateCostPath(pathname);
			expect(match).not.toBeNull();
			expect(match?.validSlug).toBe(false);
		}
		expect(isValidPublicTemplateSlug('clean-water')).toBe(true);
	});

	it('keeps the 6 per 10-second shield before authentication and Convex I/O', () => {
		expect(PUBLIC_TEMPLATE_DETAIL_RATE_LIMIT).toMatchObject({
			maxRequests: 6,
			windowMs: 10_000,
			keyStrategy: 'ip',
			includeGet: true
		});
		const sequence = hooksSource.slice(hooksSource.indexOf('const applicationHandle = sequence('));
		expect(sequence.indexOf('handlePublicTemplateDetailCostShield')).toBeGreaterThanOrEqual(0);
		expect(sequence.indexOf('handlePublicTemplateDetailCostShield')).toBeLessThan(
			sequence.indexOf('handleAuth')
		);
	});

	it('single-flights a positive miss and then reuses the Cache API envelope', async () => {
		const load = vi.fn(async () => detailFixture());
		const firstWave = await Promise.all(
			Array.from({ length: 20 }, () =>
				getCachedPublicTemplateDetail({ slug: 'clean-water', url, load })
			)
		);
		expect(load).toHaveBeenCalledTimes(1);
		expect(firstWave.every((value) => value?.slug === 'clean-water')).toBe(true);

		clearPublicTemplateCachesForTest();
		const edgeHit = await getCachedPublicTemplateDetail({ slug: 'clean-water', url, load });
		expect(edgeHit?.title).toBe('Protect clean water');
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('single-flights and persists negative misses', async () => {
		const load = vi.fn(async () => null);
		const firstWave = await Promise.all(
			Array.from({ length: 20 }, () =>
				getCachedPublicTemplateDetail({ slug: 'missing-template', url, load })
			)
		);
		expect(firstWave).toEqual(Array.from({ length: 20 }, () => null));
		expect(load).toHaveBeenCalledTimes(1);

		clearPublicTemplateCachesForTest();
		await expect(
			getCachedPublicTemplateDetail({ slug: 'missing-template', url, load })
		).resolves.toBeNull();
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('returns an invalidated positive in-flight detail only to its original caller', async () => {
		const started = deferred<void>();
		const oldFill = deferred<ReturnType<typeof detailFixture>>();
		const load = vi.fn(async () => {
			started.resolve();
			return oldFill.promise;
		});
		const oldRequest = getCachedPublicTemplateDetail({ slug: 'clean-water', url, load });
		await started.promise;

		let invalidated = false;
		const invalidation = invalidatePublicTemplateCaches({ slug: 'clean-water', url }).then(() => {
			invalidated = true;
		});
		await Promise.resolve();
		expect(invalidated).toBe(false);

		const initial = detailFixture();
		oldFill.resolve(initial);
		await expect(oldRequest).resolves.toMatchObject({ title: initial.title });
		await invalidation;
		expect(cache.entries.size).toBe(0);

		const updated = {
			...detailFixture(),
			title: 'Protect every watershed',
			subject: 'Protect every watershed'
		};
		await expect(
			getCachedPublicTemplateDetail({
				slug: 'clean-water',
				url,
				load: async () => updated
			})
		).resolves.toMatchObject({ title: updated.title });
		expect(load).toHaveBeenCalledOnce();
	});

	it('cannot resurrect an invalidated in-flight negative detail', async () => {
		const started = deferred<void>();
		const oldFill = deferred<null>();
		const oldRequest = getCachedPublicTemplateDetail({
			slug: 'clean-water',
			url,
			load: async () => {
				started.resolve();
				return oldFill.promise;
			}
		});
		await started.promise;
		const invalidation = invalidatePublicTemplateCaches({ slug: 'clean-water', url });
		oldFill.resolve(null);

		await expect(oldRequest).resolves.toBeNull();
		await invalidation;
		expect(cache.entries.size).toBe(0);
		await expect(
			getCachedPublicTemplateDetail({
				slug: 'clean-water',
				url,
				load: async () => detailFixture()
			})
		).resolves.toMatchObject({ slug: 'clean-water' });
	});

	it('serves a mutation for at most the explicit 60-second TTL without per-hit I/O', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
		const initial = detailFixture();
		const updated = {
			...detailFixture(),
			title: 'Protect every watershed',
			subject: 'Protect every watershed'
		};
		const load = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(updated);

		await expect(
			getCachedPublicTemplateDetail({ slug: 'clean-water', url, load })
		).resolves.toMatchObject({ title: initial.title });
		vi.advanceTimersByTime(59_999);
		await expect(
			getCachedPublicTemplateDetail({ slug: 'clean-water', url, load })
		).resolves.toMatchObject({ title: initial.title });
		expect(load).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(2);
		await expect(
			getCachedPublicTemplateDetail({ slug: 'clean-water', url, load })
		).resolves.toMatchObject({ title: updated.title });
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('rejects malformed slugs before invoking the origin loader', async () => {
		const load = vi.fn(async () => detailFixture());
		await expect(
			getCachedPublicTemplateDetail({ slug: '../clean-water', url, load })
		).rejects.toThrow('PUBLIC_TEMPLATE_SLUG_INVALID');
		expect(load).not.toHaveBeenCalled();
		expect(cache.entries.size).toBe(0);
	});

	it('stores only the exhaustive public projection and rejects recipient poison', async () => {
		const valid = detailFixture();
		await getCachedPublicTemplateDetail({ slug: 'clean-water', url, load: async () => valid });
		const bodies = await Promise.all(
			[...cache.entries.values()].map((response) => response.clone().text())
		);
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toContain('press@agency.example');
		expect(bodies[0]).not.toContain('personalPrompt');
		expect(bodies[0]).not.toContain('publicRecipientProvenance');

		await invalidatePublicTemplateCaches({ slug: 'clean-water', url });
		const poisoned = detailFixture();
		(poisoned.recipient_config.decisionMakers[0] as Record<string, unknown>).personalPrompt =
			'private authoring prompt';
		await expect(
			getCachedPublicTemplateDetail({ slug: 'clean-water', url, load: async () => poisoned })
		).rejects.toThrow('PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID');
		expect(cache.entries.size).toBe(0);
	});

	it('single-flights and explicitly caches the Satori/Sharp result', async () => {
		const render = vi.fn(async () => new Uint8Array([137, 80, 78, 71]));
		const responses = await Promise.all(
			Array.from({ length: 10 }, () =>
				getCachedPublicTemplateOgImage({ slug: 'clean-water', url, render })
			)
		);
		expect(render).toHaveBeenCalledTimes(1);
		expect(await responses[0].arrayBuffer()).toEqual(
			new Uint8Array([137, 80, 78, 71]).buffer
		);

		clearPublicTemplateCachesForTest();
		const edgeHit = await getCachedPublicTemplateOgImage({ slug: 'clean-water', url, render });
		expect(new Uint8Array(await edgeHit.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
		expect(render).toHaveBeenCalledTimes(1);
	});

	it('does not coalesce or publish an OG render bound to a pre-invalidation detail', async () => {
		const staleDetail = await getCachedPublicTemplateDetail({
			slug: 'clean-water',
			url,
			load: async () => detailFixture()
		});
		expect(staleDetail).not.toBeNull();
		await invalidatePublicTemplateCaches({ slug: 'clean-water', url });

		const freshDetail = await getCachedPublicTemplateDetail({
			slug: 'clean-water',
			url,
			load: async () => ({
				...detailFixture(),
				title: 'Fresh watershed detail',
				subject: 'Fresh watershed detail'
			})
		});
		expect(freshDetail).not.toBeNull();

		const staleRenderStarted = deferred<void>();
		const staleRender = deferred<Uint8Array>();
		const staleRequest = getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			sourceDetail: staleDetail!,
			render: async () => {
				staleRenderStarted.resolve();
				return staleRender.promise;
			}
		});
		await staleRenderStarted.promise;

		const freshBytes = new Uint8Array([4, 5, 6]);
		const freshRender = vi.fn(async () => freshBytes);
		const freshResponse = await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			sourceDetail: freshDetail!,
			render: freshRender
		});
		expect(new Uint8Array(await freshResponse.arrayBuffer())).toEqual(freshBytes);
		expect(freshRender).toHaveBeenCalledOnce();

		const staleBytes = new Uint8Array([1, 2, 3]);
		staleRender.resolve(staleBytes);
		const staleResponse = await staleRequest;
		expect(new Uint8Array(await staleResponse.arrayBuffer())).toEqual(staleBytes);

		clearPublicTemplateCachesForTest();
		const edgeHit = await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			render: freshRender
		});
		expect(new Uint8Array(await edgeHit.arrayBuffer())).toEqual(freshBytes);
		expect(freshRender).toHaveBeenCalledOnce();
	});

	it('does not share an OG render when its detail provenance is absent', async () => {
		const response = await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			sourceDetail: detailFixture() as unknown as NonNullable<
				Awaited<ReturnType<typeof getCachedPublicTemplateDetail>>
			>,
			render: async () => new Uint8Array([1, 2, 3])
		});
		expect(response.headers.get('cache-control')).toContain('max-age=0');
		expect(cache.entries.size).toBe(0);
	});

	it('compensates delayed Cache API puts that land after invalidation', async () => {
		const delayedCache = new DelayedPutCache();
		vi.stubGlobal('caches', { default: delayedCache });
		const waitUntilWork: Promise<unknown>[] = [];
		const platform = {
			context: {
				waitUntil: (promise: Promise<unknown>) => waitUntilWork.push(promise)
			}
		} as unknown as App.Platform;

		const detail = await getCachedPublicTemplateDetail({
			slug: 'clean-water',
			url,
			platform,
			load: async () => detailFixture()
		});
		expect(detail).not.toBeNull();
		await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			platform,
			sourceDetail: detail!,
			render: async () => new Uint8Array([1, 2, 3])
		});
		expect(waitUntilWork).toHaveLength(2);

		await invalidatePublicTemplateCaches({ slug: 'clean-water', url, platform });
		expect(delayedCache.entries.size).toBe(0);
		delayedCache.gate.resolve();
		await Promise.all(waitUntilWork);
		expect(delayedCache.entries.size).toBe(0);
	});

	it('does not renew the hard OG TTL when an edge hit is promoted to memory', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
		const initial = new Uint8Array([1, 2, 3]);
		const updated = new Uint8Array([4, 5, 6]);
		const render = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(updated);

		await getCachedPublicTemplateOgImage({ slug: 'clean-water', url, render });
		vi.advanceTimersByTime(59_999);
		clearPublicTemplateCachesForTest();
		const edgeHit = await getCachedPublicTemplateOgImage({ slug: 'clean-water', url, render });
		expect(new Uint8Array(await edgeHit.arrayBuffer())).toEqual(initial);
		expect(render).toHaveBeenCalledTimes(1);

		// The promoted memory entry retains the edge object's original timestamp;
		// one more millisecond cannot grant it a fresh 60-second lease.
		vi.advanceTimersByTime(2);
		const refreshed = await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			render
		});
		expect(new Uint8Array(await refreshed.arrayBuffer())).toEqual(updated);
		expect(render).toHaveBeenCalledTimes(2);
	});

	it('cannot extend stale detail into a second OG lease at the detail TTL boundary', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
		const initial = detailFixture();
		const updated = {
			...detailFixture(),
			title: 'Fresh watershed detail',
			subject: 'Fresh watershed detail'
		};
		const detailLoad = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(updated);
		const initialDetail = await getCachedPublicTemplateDetail({
			slug: 'clean-water',
			url,
			load: detailLoad
		});
		expect(initialDetail).not.toBeNull();

		// A late OG miss must inherit the detail object's remaining lease instead
		// of granting stale detail an independent new 60-second browser/CDN lease.
		vi.advanceTimersByTime(59_000);
		const render = vi
			.fn()
			.mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
			.mockResolvedValue(new Uint8Array([4, 5, 6]));
		const lateOg = await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			sourceDetail: initialDetail!,
			render
		});
		expect(lateOg.headers.get('cache-control')).toContain('max-age=1');

		vi.advanceTimersByTime(1_001);
		const freshDetail = await getCachedPublicTemplateDetail({
			slug: 'clean-water',
			url,
			load: detailLoad
		});
		expect(freshDetail).toMatchObject({ title: updated.title });
		const freshOg = await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			sourceDetail: freshDetail!,
			render
		});
		expect(new Uint8Array(await freshOg.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
		expect(render).toHaveBeenCalledTimes(2);
	});

	it('rejects future detail and OG timestamps instead of extending either lease', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
		const detailLoad = vi
			.fn()
			.mockResolvedValueOnce(detailFixture())
			.mockResolvedValue({
				...detailFixture(),
				title: 'Fresh detail',
				subject: 'Fresh detail'
			});
		const render = vi
			.fn()
			.mockResolvedValueOnce(new Uint8Array([1, 2, 3]))
			.mockResolvedValue(new Uint8Array([4, 5, 6]));

		await getCachedPublicTemplateDetail({ slug: 'clean-water', url, load: detailLoad });
		await getCachedPublicTemplateOgImage({ slug: 'clean-water', url, render });
		const detailEntry = [...cache.entries.entries()].find(([key]) => key.includes('/detail/'))!;
		const detailEnvelope = JSON.parse(await detailEntry[1].clone().text()) as {
			cachedAt: number;
		};
		detailEnvelope.cachedAt = Date.now() + 1;
		cache.entries.set(
			detailEntry[0],
			new Response(JSON.stringify(detailEnvelope), {
				headers: { 'Content-Type': 'application/json' }
			})
		);

		const ogEntry = [...cache.entries.entries()].find(([key]) => key.includes('/og-image/'))!;
		const ogHeaders = new Headers(ogEntry[1].headers);
		ogHeaders.set('X-Commons-Cached-At', String(Date.now() + 1));
		cache.entries.set(
			ogEntry[0],
			new Response(await ogEntry[1].clone().arrayBuffer(), { headers: ogHeaders })
		);
		clearPublicTemplateCachesForTest();

		await expect(
			getCachedPublicTemplateDetail({ slug: 'clean-water', url, load: detailLoad })
		).resolves.toMatchObject({ title: 'Fresh detail' });
		const freshOg = await getCachedPublicTemplateOgImage({ slug: 'clean-water', url, render });
		expect(new Uint8Array(await freshOg.arrayBuffer())).toEqual(new Uint8Array([4, 5, 6]));
		expect(detailLoad).toHaveBeenCalledTimes(2);
		expect(render).toHaveBeenCalledTimes(2);
	});

	it('rejects an HTTP downgrade in a stored public recipient source', async () => {
		const downgraded = detailFixture();
		downgraded.recipient_config.decisionMakers[0].emailSource =
			'http://agency.example/contact';

		await expect(
			getCachedPublicTemplateDetail({
				slug: 'clean-water',
				url,
				load: async () => downgraded
			})
		).rejects.toThrow('PUBLIC_TEMPLATE_DETAIL_PROJECTION_INVALID');
		expect(cache.entries.size).toBe(0);
	});

	it('evicts both detail and rendered-image cache families', async () => {
		await getCachedPublicTemplateDetail({
			slug: 'clean-water',
			url,
			load: async () => detailFixture()
		});
		await getCachedPublicTemplateOgImage({
			slug: 'clean-water',
			url,
			render: async () => new Uint8Array([1, 2, 3])
		});
		expect(cache.entries.size).toBe(2);
		await invalidatePublicTemplateCaches({ slug: 'clean-water', url });
		expect(cache.entries.size).toBe(0);
	});
});

describe('public template detail route payload', () => {
	type DetailLoadEvent = Parameters<typeof loadTemplateDetailLayout>[0];

	function detailLoadEvent(): DetailLoadEvent {
		return {
			params: { slug: 'clean-water' },
			request: new Request('https://commons.example/s/clean-water'),
			setHeaders: vi.fn(),
			url,
			platform: undefined
		} as unknown as DetailLoadEvent;
	}

	async function loadDetailPayload(): Promise<{ template: Record<string, unknown> }> {
		const payload = await loadTemplateDetailLayout(detailLoadEvent());
		return payload as unknown as { template: Record<string, unknown> };
	}

	function templateFieldsReadBy(source: string): Set<string> {
		return new Set(
			[...source.matchAll(/\btemplate\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1])
		);
	}

	it('carries a published send count through to the payload', async () => {
		const detail = { ...detailFixture(), send_count: 12 };
		mockGetArtifact.mockResolvedValue({ slug: 'clean-water', detail, aggregate: {} });

		const result = await loadDetailPayload();
		expect(result.template.send_count).toBe(12);
	});

	it('preserves a suppressed send count as null rather than a false zero', async () => {
		const detail = { ...detailFixture(), send_count: null };
		mockGetArtifact.mockResolvedValue({ slug: 'clean-water', detail, aggregate: {} });

		const result = await loadDetailPayload();
		expect('send_count' in result.template).toBe(true);
		expect(result.template.send_count).toBeNull();
		expect(result.template.send_count).not.toBe(0);
	});

	it('supplies every template field the modal component reads', async () => {
		const detail = { ...detailFixture(), send_count: 12 };
		mockGetArtifact.mockResolvedValue({ slug: 'clean-water', detail, aggregate: {} });

		const result = await loadDetailPayload();
		const fields = templateFieldsReadBy(templateModalComponentSource);
		const missing = [...fields].filter((field) => !(field in result.template));
		expect(missing).toEqual([]);
	});

	it('leaves the retired modal path outside the cost-bearing grammar', () => {
		expect(classifyPublicTemplateCostPath('/template-modal/clean-water')).toBeNull();
	});
});
