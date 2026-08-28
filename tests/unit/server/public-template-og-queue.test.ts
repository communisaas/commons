import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_BATCH_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS,
	PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX,
	PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS,
	buildPublicTemplateOgQueueJob,
	enqueuePublicTemplateOgQueueJobs,
	publicTemplatePageArtifactObjectKeys,
	readPublicTemplateOgQueueJob
} from '$lib/server/public-template-og-queue';
import { PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES } from '$lib/server/public-template-page-artifact';
import { PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_ATTEMPTS_MAX } from '$lib/server/public-template-queries';

const BACKEND = 'https://production.example.convex.cloud';
const SOURCE_SHA = 'a'.repeat(40);
const TRANSACTION_ID = '123456789-2';
const REPOSITORY_ROOT = process.cwd();

function repositoryCodeSources(): Array<{ path: string; source: string }> {
	const files: Array<{ path: string; source: string }> = [];
	const visit = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				visit(absolute);
			} else if (/\.(?:mjs|svelte|ts)$/.test(entry.name)) {
				files.push({
					path: relative(REPOSITORY_ROOT, absolute).replaceAll('\\', '/'),
					source: readFileSync(absolute, 'utf8')
				});
			}
		}
	};
	for (const directory of ['scripts', 'src', 'workers']) visit(resolve(REPOSITORY_ROOT, directory));
	return files;
}

function filesMatching(pattern: RegExp): string[] {
	return repositoryCodeSources()
		.filter(({ source }) => pattern.test(source))
		.map(({ path }) => path)
		.sort();
}

function job(slug = 'clean-water', revision: number | string = 7) {
	return buildPublicTemplateOgQueueJob({
		backend: BACKEND,
		revision,
		sourceSha: SOURCE_SHA,
		slug,
		transactionId: TRANSACTION_ID
	});
}

describe('public template OG Queue protocol', () => {
	it('admits only canonical positive safe-integer revision strings', () => {
		expect(readPublicTemplateOgQueueJob(job())).toEqual({
			version: 2,
			backend: BACKEND,
			revision: '7',
			sourceSha: SOURCE_SHA,
			slug: 'clean-water',
			transactionId: TRANSACTION_ID
		});
		for (const revision of [
			'0001',
			'01',
			'0',
			'-1',
			'1.0',
			'1e0',
			String(Number.MAX_SAFE_INTEGER + 1)
		]) {
			expect(() =>
				readPublicTemplateOgQueueJob({
					version: 2,
					backend: BACKEND,
					revision,
					sourceSha: SOURCE_SHA,
					slug: 'clean-water',
					transactionId: TRANSACTION_ID
				})
			).toThrow('PUBLIC_TEMPLATE_OG_QUEUE_JOB_INVALID');
		}
	});

	it('derives the one exact JSON/PNG coordinate and rejects realm/protocol drift', () => {
		const value = job();
		expect(publicTemplatePageArtifactObjectKeys(value)).toEqual({
			payload:
				'public-template-pages/v1/backend%3Dhttps%3A%2F%2Fproduction.example.convex.cloud/template-page%3Aslug%3Dclean-water/revision=7/payload.json',
			ogImage:
				'public-template-pages/v1/backend%3Dhttps%3A%2F%2Fproduction.example.convex.cloud/template-page%3Aslug%3Dclean-water/revision=7/og-image.png'
		});
		expect(() => readPublicTemplateOgQueueJob(value, 'https://other.example.convex.cloud')).toThrow(
			'PUBLIC_TEMPLATE_OG_QUEUE_REALM_MISMATCH'
		);
		expect(() => readPublicTemplateOgQueueJob({ ...value, extra: true })).toThrow(
			'PUBLIC_TEMPLATE_OG_QUEUE_JOB_INVALID'
		);
	});

	it('sends one bounded JSON batch and rejects duplicates or cardinality drift', async () => {
		const queue = { sendBatch: vi.fn().mockResolvedValue(undefined) };
		const jobs = Array.from({ length: PUBLIC_TEMPLATE_OG_QUEUE_BATCH_MAX }, (_, index) =>
			job(`bounded-${index + 1}`, index + 1)
		);
		await enqueuePublicTemplateOgQueueJobs(queue, jobs);
		expect(queue.sendBatch).toHaveBeenCalledOnce();
		expect(queue.sendBatch).toHaveBeenCalledWith(
			jobs.map((body) => ({ body, contentType: 'json' }))
		);
		await expect(enqueuePublicTemplateOgQueueJobs(queue, [])).rejects.toThrow(
			'PUBLIC_TEMPLATE_OG_QUEUE_BATCH_INVALID'
		);
		await expect(enqueuePublicTemplateOgQueueJobs(queue, [...jobs, job('overflow', 99)])).rejects.toThrow(
			'PUBLIC_TEMPLATE_OG_QUEUE_BATCH_INVALID'
		);
		await expect(enqueuePublicTemplateOgQueueJobs(queue, [job(), job()])).rejects.toThrow(
			'PUBLIC_TEMPLATE_OG_QUEUE_BATCH_DUPLICATE'
		);
	});

	it('pins a deterministic admission projection with explicit unmodeled headroom', () => {
		const realms = 2;
		const healthyMessages = PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES * realms;
		const healthyNoDuplicateOperations = healthyMessages * 3;
		const projectedLifecycleWeight =
			PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS +
			PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS +
			PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS;
		const flatCalendarAdmissionProjection = healthyMessages * projectedLifecycleWeight;
		const commonsAdmissionProjectionPerDay =
			realms * PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX;
		expect(PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_ATTEMPTS_MAX).toBe(2);
		expect(PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS).toBe(9);
		expect(PUBLIC_TEMPLATE_OG_QUEUE_NEXT_DAY_PROJECTED_OPERATIONS).toBe(8);
		expect(PUBLIC_TEMPLATE_OG_QUEUE_SECOND_DAY_PROJECTED_OPERATIONS).toBe(2);
		expect(PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX).toBe(2_500);
		expect(PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX).toBe(277);
		expect(PUBLIC_TEMPLATE_OG_QUEUE_DAILY_MESSAGE_ATTEMPTS_PER_REALM_MAX).toBe(
			Math.floor(
				PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX /
					PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
			)
		);
		expect(healthyMessages).toBe(500);
		expect(healthyNoDuplicateOperations).toBe(1_500);
		// This is the admission-model P0 that a flat per-calendar-day message cap
		// misses: D, D+1, and D-2 lifecycle weights overlap on one projected day.
		expect(projectedLifecycleWeight).toBe(19);
		expect(flatCalendarAdmissionProjection).toBe(9_500);
		expect(commonsAdmissionProjectionPerDay).toBe(5_000);
		expect(10_000 - commonsAdmissionProjectionPerDay).toBe(5_000);
		// A clean realm cohort spends 2,250 of its deterministic send-day
		// projection, leaving exactly 27 same-day repair admissions.
		expect(
			Math.floor(
				(PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX -
					PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES *
						PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS) /
					PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
			)
		).toBe(27);
		// This is an admission-model allocation, not an upper bound on actual
		// Cloudflare account usage: at-least-once duplicate delivery and sibling
		// traffic consume the remaining headroom and are not bounded by this gate.
		expect(
			PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES *
				PUBLIC_TEMPLATE_OG_QUEUE_CURRENT_DAY_PROJECTED_OPERATIONS
		).toBeLessThanOrEqual(PUBLIC_TEMPLATE_OG_QUEUE_PROJECTED_OPERATIONS_PER_REALM_DAY_MAX);
	});

	it('pins the static Queue-send authority to the authenticated manifest producer', () => {
		expect(filesMatching(/\bPUBLIC_TEMPLATE_OG_QUEUE\b/)).toEqual([
			'scripts/verify-pages-durable-object-binding.mjs',
			'scripts/verify-public-template-og-deployment.mjs',
			'src/app.d.ts',
			'src/lib/server/public-template-queries.ts'
		]);
		expect(filesMatching(/\benqueuePublicTemplateOgQueueJobs\s*\(/)).toEqual([
			'src/lib/server/public-template-og-queue.ts',
			'src/lib/server/public-template-queries.ts'
		]);
		expect(filesMatching(/\brefreshPublicDiscoveryManifestControl\s*\(/)).toEqual([
			'src/lib/server/public-template-queries.ts',
			'src/routes/api/internal/public-discovery-manifest-refresh/+server.ts'
		]);
	});
});
