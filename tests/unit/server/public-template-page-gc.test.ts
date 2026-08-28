import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX,
	PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS,
	PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_LIST_MAX,
	PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES,
	collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh,
	readPublicTemplatePageBackfillProgress,
	writePublicTemplatePageBackfillProgress
} from '$lib/server/public-discovery-cache';

const CONVEX_URL = 'https://production.example.convex.cloud';
const REALM = encodeURIComponent(`backend=${CONVEX_URL}`);

type Stored = {
	body: string;
	customMetadata?: Record<string, string>;
	etag: string;
	uploaded: Date;
};

function artifactKey(slug: string, revision: number): string {
	return `public-template-pages/v1/${REALM}/${encodeURIComponent(
		`template-page:slug=${slug}`
	)}/revision=${revision}/payload.json`;
}

function ogImageKey(slug: string, revision: number): string {
	return artifactKey(slug, revision).replace(/payload\.json$/, 'og-image.png');
}

function collectPublicTemplatePageArtifactGarbage(
	context: Omit<
		Parameters<typeof collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh>[0],
		'ownership'
	>
) {
	return collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh({
		...context,
		ownership: 'manifest-before-publish'
	});
}

function productionTypeScriptFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(directory, entry.name);
		return entry.isDirectory()
			? productionTypeScriptFiles(path)
			: entry.isFile() && entry.name.endsWith('.ts')
				? [path]
				: [];
	});
}

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
	const get = vi.fn(async (key: string) => {
		const stored = entries.get(key);
		return stored ? object(key, stored) : null;
	});
	const put = vi.fn(
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
	);
	const list = vi.fn(
		async ({
			prefix = '',
			limit = 1000,
			cursor
		}: {
			prefix?: string;
			limit?: number;
			cursor?: string;
		} = {}) => {
			const matching = [...entries.entries()]
				.filter(([key]) => key.startsWith(prefix) && (cursor === undefined || key > cursor))
				.sort(([left], [right]) => left.localeCompare(right));
			const selected = matching.slice(0, limit);
			const truncated = matching.length > selected.length;
			return {
				objects: selected.map(([key, stored]) => object(key, stored)),
				truncated,
				...(truncated && selected.length > 0 ? { cursor: selected.at(-1)![0] } : {})
			};
		}
	);
	const deleteObjects = vi.fn(async (keys: string | string[]) => {
		for (const key of Array.isArray(keys) ? keys : [keys]) entries.delete(key);
	});
	const r2 = { delete: deleteObjects, get, list, put } as unknown as R2Bucket;
	const platform = {
		env: { PUBLIC_CONVEX_URL: CONVEX_URL, PUBLIC_DISCOVERY_R2: r2 }
	} as App.Platform;
	const seed = (key: string, uploadedAt: number) => {
		entries.set(key, {
			body: '{}',
			etag: `seed-${nextEtag++}`,
			uploaded: new Date(uploadedAt)
		});
	};
	return { deleteObjects, entries, list, platform, put, seed };
}

describe('public-template page artifact garbage collection', () => {
	it('has exactly one production caller, inside manifest before-publication ownership', () => {
		const root = resolve(process.cwd(), 'src');
		const symbol = 'collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh';
		const callers = productionTypeScriptFiles(root)
			.filter((path) => !path.endsWith('/public-discovery-cache.ts'))
			.filter((path) => readFileSync(path, 'utf8').includes(symbol))
			.map((path) => relative(process.cwd(), path));
		expect(callers).toEqual(['src/lib/server/public-template-queries.ts']);
		const querySource = readFileSync(
			resolve(root, 'lib/server/public-template-queries.ts'),
			'utf8'
		);
		expect(querySource).toMatch(
			/collectPublicTemplatePageArtifactGarbageForOwnedManifestRefresh\(\{\s*ownership:\s*'manifest-before-publish'/
		);
		expect(querySource).not.toContain('afterPublish:');
	});

	it('uses first-seen-unreferenced grace, resumes cursors, and never deletes protected coordinates', async () => {
		const { deleteObjects, entries, list, platform, seed } = fixture();
		const now = 1_900_000_000_000;
		const monthsOld = now - 90 * 24 * 60 * 60 * 1000;
		const protectedCoordinates = Array.from({ length: 10 }, (_, index) => ({
			slug: `current-${index.toString().padStart(3, '0')}`,
			artifactRevision: 2
		}));
		const protectedKeys = protectedCoordinates.map(({ slug, artifactRevision }) =>
			artifactKey(slug, artifactRevision)
		);
		for (const key of protectedKeys) seed(key, monthsOld);
		const orphanKeys = Array.from({ length: 140 }, (_, index) =>
			artifactKey(`orphan-${index.toString().padStart(3, '0')}`, 1)
		);
		for (const key of orphanKeys) seed(key, monthsOld);

		const firstMark = await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates,
			now
		});
		expect(firstMark.deleted).toBe(0);
		expect(firstMark.marked).toBeGreaterThan(0);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates,
			now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS - 1
		});
		// Upload age is irrelevant: even months-old prior authority survives the
		// entire grace measured from its first unreferenced observation.
		expect(orphanKeys.every((key) => entries.has(key))).toBe(true);

		let sweepNow = now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1;
		for (let epoch = 0; epoch < 8 && orphanKeys.some((key) => entries.has(key)); epoch += 1) {
			for (let cycle = 0; cycle < 8; cycle += 1) {
				const result = await collectPublicTemplatePageArtifactGarbage({
					platform,
					protectedCoordinates,
					now: sweepNow
				});
				expect(result.scanned).toBeLessThanOrEqual(PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_LIST_MAX);
				expect(result.deleted).toBeLessThanOrEqual(PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX);
			}
			sweepNow += PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1;
		}
		expect(orphanKeys.some((key) => entries.has(key))).toBe(false);
		expect(protectedKeys.every((key) => entries.has(key))).toBe(true);
		expect(
			list.mock.calls.every(
				([options]) =>
					options?.limit === PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_LIST_MAX &&
					options?.prefix === `public-template-pages/v1/${REALM}/`
			)
		).toBe(true);
		expect(
			deleteObjects.mock.calls.every(
				([keys]) =>
					Array.isArray(keys) &&
					keys.length <= PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX * 2
			)
		).toBe(true);
	});

	it('requires a continuous unreferenced grace and clears a mark when a coordinate is reused', async () => {
		const { entries, platform, seed } = fixture();
		const now = 1_900_000_000_000;
		const coordinate = { slug: 'reused-coordinate', artifactRevision: 7 };
		const key = artifactKey(coordinate.slug, coordinate.artifactRevision);
		seed(key, now - 90 * 24 * 60 * 60 * 1000);

		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now
			})
		).resolves.toMatchObject({ marked: 1, deleted: 0 });
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [coordinate],
			now: now + Math.floor(PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS / 2)
		});
		expect(entries.has(key)).toBe(true);

		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
			})
		).resolves.toMatchObject({ marked: 1, deleted: 0 });
		expect(entries.has(key)).toBe(true);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: now + 2 * PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 2
		});
		expect(entries.has(key)).toBe(false);
	});

	it('canonicalizes either sibling and deletes or protects the JSON+PNG pair as one coordinate', async () => {
		const { deleteObjects, entries, platform, seed } = fixture();
		const now = 1_900_000_000_000;
		const protectedCoordinate = { slug: 'protected-pair', artifactRevision: 8 };
		const protectedPair = [
			artifactKey(protectedCoordinate.slug, protectedCoordinate.artifactRevision),
			ogImageKey(protectedCoordinate.slug, protectedCoordinate.artifactRevision)
		];
		const orphanPair = [artifactKey('orphan-pair', 7), ogImageKey('orphan-pair', 7)];
		for (const key of [...protectedPair, ...orphanPair]) {
			seed(key, now - 90 * 24 * 60 * 60 * 1000);
		}

		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [protectedCoordinate],
			now
		});
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [protectedCoordinate],
			now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
		});

		expect(orphanPair.every((key) => !entries.has(key))).toBe(true);
		expect(protectedPair.every((key) => entries.has(key))).toBe(true);
		expect(
			deleteObjects.mock.calls.some(
				([keys]) =>
					Array.isArray(keys) &&
					orphanPair.every((key) => (keys as string[]).includes(key))
			)
		).toBe(true);
	});

	it('protects an orphan reused by the active durable producer plan before HEAD', async () => {
		const { entries, platform, seed } = fixture();
		const now = 1_900_000_000_000;
		const coordinate = {
			templateId: 'staged-template',
			slug: 'staged-reuse',
			artifactRevision: 9
		};
		const key = artifactKey(coordinate.slug, coordinate.artifactRevision);
		seed(key, now - 90 * 24 * 60 * 60 * 1000);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now
		});
		const active = await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: null,
			progress: {
				version: 1,
				generation: 'ready:2:200:epoch=0',
				coordinateDigest: 'a'.repeat(64),
				coordinates: [coordinate],
				total: 1,
				nextOffset: 0,
				enqueuedOffset: 0,
				enqueuedAt: null,
				enqueueAttempts: 0
			}
		});
		expect(active).not.toBeNull();
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
		});
		expect(entries.has(key)).toBe(true);

		const observed = await readPublicTemplatePageBackfillProgress({ platform });
		await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: observed!.etag,
			progress: {
				version: 1,
				generation: 'withdrawn:2:200:epoch=1',
				coordinateDigest: 'b'.repeat(64),
				coordinates: [],
				total: 0,
				nextOffset: 0,
				enqueuedOffset: 0,
				enqueuedAt: null,
				enqueueAttempts: 0
			}
		});
		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 2
			})
		).resolves.toMatchObject({ marked: 1, deleted: 0 });
		expect(entries.has(key)).toBe(true);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: now + 2 * PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 3
		});
		expect(entries.has(key)).toBe(false);
	});

	it('keeps the ledger clock monotonic when an isolate clock steps backward', async () => {
		const { entries, platform, seed } = fixture();
		const now = 1_900_000_000_000;
		const key = artifactKey('backward-clock', 1);
		seed(key, now - 90 * 24 * 60 * 60 * 1000);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now
		});
		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now - 60_000
			})
		).resolves.toMatchObject({ deleted: 0, fenced: false });
		expect(entries.has(key)).toBe(true);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS - 1
		});
		expect(entries.has(key)).toBe(true);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
		});
		expect(entries.has(key)).toBe(false);
	});

	it('fences deletion when a successor plan reuses a coordinate after ledger CAS', async () => {
		const { entries, platform, put, seed } = fixture();
		const now = 1_900_000_000_000;
		const coordinate = {
			templateId: 'successor-template',
			slug: 'successor-reuse-race',
			artifactRevision: 11
		};
		const key = artifactKey(coordinate.slug, coordinate.artifactRevision);
		seed(key, now - 90 * 24 * 60 * 60 * 1000);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now
		});

		const originalPut = put.getMockImplementation();
		expect(originalPut).toBeDefined();
		put.mockImplementationOnce(async (...args) => {
			const receipt = await originalPut!(...args);
			// The successor becomes durable after this collector wins the GC-ledger
			// CAS but before its final active-plan reread and exact DELETE.
			entries.set(
				`public-template-pages/v1/${REALM}/control/backfill-progress.json`,
				{
					body: JSON.stringify({
						version: 1,
						generation: 'ready:2:200:epoch=0',
						coordinateDigest: 'c'.repeat(64),
						coordinates: [coordinate],
						total: 1,
						nextOffset: 0,
						enqueuedOffset: 0,
						enqueuedAt: null,
						enqueueAttempts: 0
					}),
					customMetadata: {
						kind: 'template-page-backfill-progress',
						schema: '1'
					},
					etag: 'successor-plan-etag',
					uploaded: new Date(now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1)
				}
			);
			return receipt;
		});

		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
			})
		).resolves.toMatchObject({ deleted: 0, fenced: false });
		expect(entries.has(key)).toBe(true);

		const active = await readPublicTemplatePageBackfillProgress({ platform });
		await writePublicTemplatePageBackfillProgress({
			platform,
			expectedEtag: active!.etag,
			progress: {
				version: 1,
				generation: 'withdrawn:2:200:epoch=1',
				coordinateDigest: 'd'.repeat(64),
				coordinates: [],
				total: 0,
				nextOffset: 0,
				enqueuedOffset: 0,
				enqueuedAt: null,
				enqueueAttempts: 0
			}
		});
		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 2
			})
		).resolves.toMatchObject({ marked: 1, deleted: 0 });
		expect(entries.has(key)).toBe(true);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: now + 2 * PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 3
		});
		expect(entries.has(key)).toBe(false);
	});

	it('allows only one concurrent collector to delete after the progress CAS', async () => {
		const { entries, platform, seed } = fixture();
		const now = 1_900_000_000_000;
		for (let index = 0; index < 40; index += 1) {
			seed(
				artifactKey(`concurrent-${index.toString().padStart(3, '0')}`, 1),
				now - PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS - 1
			);
		}
		await expect(
			collectPublicTemplatePageArtifactGarbage({ platform, protectedCoordinates: [], now })
		).resolves.toMatchObject({ marked: PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX, deleted: 0 });
		const results = await Promise.all([
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
			}),
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
			})
		]);
		expect(results.filter(({ fenced }) => fenced)).toHaveLength(1);
		expect(results.reduce((sum, result) => sum + result.deleted, 0)).toBe(
			PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX
		);
		expect(
			[...entries.keys()].filter((key) => key.includes('/template-page%3Aslug%3D'))
		).toHaveLength(40 - PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_DELETE_MAX);
	});

	it('recovers safely when the process crashes after ledger CAS but before delete', async () => {
		const { deleteObjects, entries, platform, seed } = fixture();
		const now = 1_900_000_000_000;
		const key = artifactKey('crash-after-ledger-cas', 1);
		seed(key, now - 90 * 24 * 60 * 60 * 1000);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now
		});
		deleteObjects.mockRejectedValueOnce(new Error('simulated delete transport crash'));
		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 1
			})
		).rejects.toThrow('simulated delete transport crash');
		expect(entries.has(key)).toBe(true);

		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: now + PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 2
			})
		).resolves.toMatchObject({ marked: 1, deleted: 0 });
		expect(entries.has(key)).toBe(true);
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: now + 2 * PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_GRACE_MS + 3
		});
		expect(entries.has(key)).toBe(false);
	});

	it('fails closed on a corrupt progress singleton before another LIST or delete', async () => {
		const { deleteObjects, entries, list, platform } = fixture();
		await collectPublicTemplatePageArtifactGarbage({
			platform,
			protectedCoordinates: [],
			now: 1_900_000_000_000
		});
		const progress = [...entries.entries()].find(([key]) => key.endsWith('/control/gc-progress.json'));
		expect(progress).toBeDefined();
		progress![1].body = JSON.stringify({
			version: 2,
			cursor: 'x'.repeat(2_049),
			candidates: [],
			updatedAt: 1
		});
		const listsBefore = list.mock.calls.length;
		const deletesBefore = deleteObjects.mock.calls.length;
		await expect(
			collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now: 1_900_000_000_001
			})
		).rejects.toThrow('PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT');
		expect(list).toHaveBeenCalledTimes(listsBefore);
		expect(deleteObjects).toHaveBeenCalledTimes(deletesBefore);
	});

	it('accepts an exact 32-KiB ledger and rejects one byte more before PUT', async () => {
		const now = 1_900_000_000_000;
		const prefix = `public-template-pages/v1/${REALM}/`;
		let selected:
			| {
					candidates: Array<{ key: string; firstSeenUnreferencedAt: number }>;
					cursorLength: number;
			  }
			| undefined;
		for (let padding = 1; padding < 900 && !selected; padding += 1) {
			const candidates = Array.from({ length: 32 }, (_, index) => ({
				key: `${prefix}template-page%3Aslug%3D${index
					.toString()
					.padStart(2, '0')}${'a'.repeat(padding)}/revision=1/payload.json`,
				firstSeenUnreferencedAt: now
			}));
			if (candidates.some(({ key }) => key.length > 1_024)) continue;
			const baseBytes = new TextEncoder().encode(
				JSON.stringify({ version: 2, cursor: '', candidates, updatedAt: now })
			).byteLength;
			const cursorLength = PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES - baseBytes;
			if (cursorLength >= 3 && cursorLength < 2_048) selected = { candidates, cursorLength };
		}
		expect(selected).toBeDefined();

		for (const extraByte of [0, 1]) {
			const { entries, list, platform, put } = fixture();
			const progressKey = `${prefix}control/gc-progress.json`;
			const priorBody = JSON.stringify({
				version: 2,
				cursor: null,
				candidates: selected!.candidates,
				updatedAt: now
			});
			expect(new TextEncoder().encode(priorBody).byteLength).toBeLessThan(
				PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES
			);
			entries.set(progressKey, {
				body: priorBody,
				customMetadata: { kind: 'template-page-artifact-gc-progress', schema: '2' },
				etag: 'near-limit-ledger',
				uploaded: new Date(now)
			});
			list.mockResolvedValueOnce({
				cursor: 'z'.repeat(selected!.cursorLength + extraByte),
				objects: [],
				truncated: true
			});

			const collection = collectPublicTemplatePageArtifactGarbage({
				platform,
				protectedCoordinates: [],
				now
			});
			if (extraByte === 0) {
				await expect(collection).resolves.toMatchObject({ deleted: 0, fenced: false });
				expect(new TextEncoder().encode(entries.get(progressKey)!.body).byteLength).toBe(
					PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_MAX_BYTES
				);
				expect(put).toHaveBeenCalledOnce();
			} else {
				await expect(collection).rejects.toThrow(
					'PUBLIC_TEMPLATE_PAGE_ARTIFACT_GC_PROGRESS_CORRUPT'
				);
				expect(put).not.toHaveBeenCalled();
			}
		}
	});
});
