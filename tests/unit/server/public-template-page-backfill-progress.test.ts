import { describe, expect, it, vi } from 'vitest';

import {
	readPublicTemplatePageBackfillProgress,
	writePublicTemplatePageBackfillProgress,
	type PublicTemplatePageBackfillProgress
} from '$lib/server/public-discovery-cache';

const CONVEX_URL = 'https://production.example.convex.cloud';

type Stored = {
	body: string;
	customMetadata?: Record<string, string>;
	etag: string;
	uploaded: Date;
};

function fixture() {
	const entries = new Map<string, Stored>();
	let nextEtag = 1;
	const object = (key: string, stored: Stored) => ({
		customMetadata: stored.customMetadata,
		etag: stored.etag,
		httpEtag: `"${stored.etag}"`,
		json: async <T>() => JSON.parse(stored.body) as T,
		key,
		size: new TextEncoder().encode(stored.body).byteLength,
		text: async () => stored.body,
		uploaded: stored.uploaded
	});
	const r2 = {
		get: vi.fn(async (key: string) => {
			const stored = entries.get(key);
			return stored ? object(key, stored) : null;
		}),
		put: vi.fn(
			async (
				key: string,
				value: string,
				options?: {
					customMetadata?: Record<string, string>;
					onlyIf?: Headers | { etagMatches?: string };
				}
			) => {
				const existing = entries.get(key);
				const ifNoneMatch =
					options?.onlyIf instanceof Headers ? options.onlyIf.get('If-None-Match') : null;
				const etagMatches =
					options?.onlyIf && !(options.onlyIf instanceof Headers)
						? options.onlyIf.etagMatches
						: undefined;
				if (ifNoneMatch === '*' && existing) return null;
				if (etagMatches !== undefined && existing?.etag !== etagMatches) return null;
				const stored: Stored = {
					body: String(value),
					customMetadata: options?.customMetadata,
					etag: `etag-${nextEtag++}`,
					uploaded: new Date()
				};
				entries.set(key, stored);
				return object(key, stored);
			}
		)
	} as unknown as R2Bucket;
	const platform = {
		env: { PUBLIC_CONVEX_URL: CONVEX_URL, PUBLIC_DISCOVERY_R2: r2 }
	} as App.Platform;
	return { entries, platform };
}

function progress(
	patch: Partial<PublicTemplatePageBackfillProgress> = {}
): PublicTemplatePageBackfillProgress {
	const nextOffset = patch.nextOffset ?? 0;
	return {
		version: 1,
		generation: '1:100',
		coordinateDigest: 'a'.repeat(64),
		coordinates: [
			{ templateId: 'template-a', slug: 'alpha', artifactRevision: 1 },
			{ templateId: 'template-b', slug: 'beta', artifactRevision: 2 }
		],
		total: 2,
		nextOffset,
		enqueuedOffset: patch.enqueuedOffset ?? nextOffset,
		enqueuedAt: null,
		enqueueAttempts: 0,
		...patch
	};
}

describe('public-template page backfill checkpoint CAS', () => {
	it('treats a missing singleton as no progress and fails closed on corruption', async () => {
		const { entries, platform } = fixture();
		await expect(readPublicTemplatePageBackfillProgress({ platform })).resolves.toBeNull();

		const created = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: null,
			progress: progress()
		});
		expect(created).not.toBeNull();
		const [key, stored] = [...entries.entries()][0]!;
		entries.set(key, {
			...stored,
			body: JSON.stringify({ ...progress(), coordinates: [{ slug: 'missing-fields' }] })
		});
		await expect(readPublicTemplatePageBackfillProgress({ platform })).rejects.toThrow(
			'PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT'
		);

		entries.set(key, { ...stored, customMetadata: { kind: 'wrong', schema: '1' } });
		await expect(readPublicTemplatePageBackfillProgress({ platform })).rejects.toThrow(
			'PUBLIC_TEMPLATE_PAGE_BACKFILL_PROGRESS_CORRUPT'
		);
	});

	it('lets exactly one concurrent publisher advance an observed checkpoint', async () => {
		const { platform } = fixture();
		const created = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: null,
			progress: progress()
		});
		expect(created).not.toBeNull();

		const contenders = await Promise.all([
			writePublicTemplatePageBackfillProgress({
				platform,
				expectedEtag: created!.etag,
				progress: progress({ nextOffset: 1 })
			}),
			writePublicTemplatePageBackfillProgress({
				platform,
				expectedEtag: created!.etag,
				progress: progress({ nextOffset: 2 })
			})
		]);
		expect(contenders.filter(Boolean)).toHaveLength(1);
		const observed = await readPublicTemplatePageBackfillProgress({ platform });
		expect(observed?.progress.nextOffset).toBe(contenders.find(Boolean)!.progress.nextOffset);
	});

	it('fences stale generation and digest writers after a plan reset', async () => {
		const { platform } = fixture();
		const first = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: null,
			progress: progress({ nextOffset: 2 })
		});
		const nextPlan = progress({
			generation: '2:200',
			coordinateDigest: 'b'.repeat(64),
			nextOffset: 0
		});
		const reset = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: first!.etag,
			progress: nextPlan
		});
		expect(reset).not.toBeNull();

		await expect(
			writePublicTemplatePageBackfillProgress({
				platform,
				expectedEtag: first!.etag,
				progress: progress({ nextOffset: 1 })
			})
		).resolves.toBeNull();
		await expect(readPublicTemplatePageBackfillProgress({ platform })).resolves.toMatchObject({
			progress: nextPlan
		});

		const digestReset = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: reset!.etag,
			progress: { ...nextPlan, coordinateDigest: 'c'.repeat(64) }
		});
		expect(digestReset?.progress.coordinateDigest).toBe('c'.repeat(64));
		await expect(
			writePublicTemplatePageBackfillProgress({
				platform,
				expectedEtag: reset!.etag,
				progress: { ...nextPlan, nextOffset: 1, enqueuedOffset: 1 }
			})
		).resolves.toBeNull();
	});
});
