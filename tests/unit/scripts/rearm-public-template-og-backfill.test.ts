import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS,
	PUBLIC_TEMPLATE_OG_REARM_REASON,
	canonicalJson,
	planPublicTemplateOgBackfillRearm,
	publicTemplatePageBackfillProgressKey,
	readPublicTemplatePageBackfillProgress,
	rearmPublicTemplateOgBackfill
} from '../../../scripts/rearm-public-template-og-backfill.mjs';

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const DIGEST = 'd'.repeat(64);
const ETAG = 'a'.repeat(32);
const RESULT_ETAG = 'b'.repeat(32);
const EVIDENCE = 'e'.repeat(64);
const REARM_ID = '12345678-1234-4234-9234-123456789abc';

function checkpoint(
	patch: Partial<ReturnType<typeof readPublicTemplatePageBackfillProgress>> = {}
) {
	return {
		version: 1 as const,
		generation: 'ready:7:700:epoch=2:artifact-set=3',
		coordinateDigest: DIGEST,
		coordinates: [
			{ artifactRevision: 7, slug: 'alpha', templateId: 'template-a' },
			{ artifactRevision: 8, slug: 'beta', templateId: 'template-b' }
		],
		total: 2,
		nextOffset: 0,
		enqueuedOffset: 2,
		enqueuedAt: NOW - PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS,
		enqueueAttempts: 2,
		...patch
	};
}

function object(body: string, etag = ETAG) {
	return {
		Body: { transformToString: vi.fn(async () => body) },
		ContentLength: Buffer.byteLength(body),
		ContentType: 'application/json',
		ETag: `"${etag}"`,
		Metadata: { kind: 'template-page-backfill-progress', schema: '1' }
	};
}

describe('operator-only public-template OG checkpoint rearm', () => {
	it('derives the exact backend-scoped singleton key', () => {
		expect(
			publicTemplatePageBackfillProgressKey('https://quirky-chinchilla-352.convex.cloud')
		).toBe(
			'public-template-pages/v1/backend%3Dhttps%3A%2F%2Fquirky-chinchilla-352.convex.cloud/control/backfill-progress.json'
		);
		expect(() =>
			publicTemplatePageBackfillProgressKey('https://quirky-chinchilla-352.convex.cloud/path')
		).toThrow('exact HTTPS origin');
	});

	it('changes only the three handoff fields after exact terminal proof', () => {
		const prior = checkpoint();
		const plan = planPublicTemplateOgBackfillRearm({
			checkpoint: prior,
			expectedCoordinateDigest: DIGEST,
			now: NOW
		});

		expect(plan.prior).toEqual(prior);
		expect(plan.next).toEqual({
			...prior,
			enqueuedOffset: prior.nextOffset,
			enqueuedAt: null,
			enqueueAttempts: 0
		});
		const changed = Object.keys(prior).filter(
			(key) =>
				canonicalJson(prior[key as keyof typeof prior]) !==
				canonicalJson(plan.next[key as keyof typeof plan.next])
		);
		expect(changed.sort()).toEqual(['enqueueAttempts', 'enqueuedAt', 'enqueuedOffset']);
	});

	it.each([
		['digest mismatch', checkpoint(), 'f'.repeat(64), 'does not match'],
		['handoff complete', checkpoint({ enqueuedOffset: 0, enqueuedAt: null, enqueueAttempts: 0 }), DIGEST, 'no active'],
		['attempt available', checkpoint({ enqueueAttempts: 1 }), DIGEST, 'has not exhausted'],
		[
			'repair delay active',
			checkpoint({ enqueuedAt: NOW - PUBLIC_TEMPLATE_OG_QUEUE_REPAIR_DELAY_MS + 1 }),
			DIGEST,
			'terminal repair delay'
		]
	])('fails closed for %s', (_label, value, digest, message) => {
		expect(() =>
			planPublicTemplateOgBackfillRearm({
				checkpoint: value,
				expectedCoordinateDigest: digest,
				now: NOW
			})
		).toThrow(message as string);
	});

	it('rejects malformed and backward-clock checkpoints before planning', () => {
		expect(() =>
			readPublicTemplatePageBackfillProgress(
				{ ...checkpoint(), unexpected: true },
				NOW
			)
		).toThrow('unexpected schema');
		expect(() =>
			readPublicTemplatePageBackfillProgress(
				{ ...checkpoint(), enqueuedAt: NOW + 1 },
				NOW
			)
		).toThrow('timestamp is invalid');
	});

	it('defaults to an exact-key dry run and emits a canonical audit receipt', async () => {
		const send = vi.fn(async (command: unknown) => {
			expect(command).toBeInstanceOf(GetObjectCommand);
			return object(JSON.stringify(checkpoint()));
		});
		const result = await rearmPublicTemplateOgBackfill({
			s3: { send },
			environment: 'production',
			expectedEtag: ETAG,
			expectedCoordinateDigest: DIGEST,
			evidenceSha256: EVIDENCE,
			apply: false,
			now: NOW,
			rearmId: REARM_ID
		});

		expect(send).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			action: 'public-template-og-backfill-rearm',
			applied: false,
			coordinateDigest: DIGEST,
			evidenceSha256: EVIDENCE,
			expectedEtag: ETAG,
			rearmId: REARM_ID,
			reason: PUBLIC_TEMPLATE_OG_REARM_REASON,
			resultEtag: null
		});
		expect(canonicalJson(result)).toBe(canonicalJson(JSON.parse(canonicalJson(result))));
	});

	it('uses If-Match and verifies the exact rearmed body after the write', async () => {
		let writtenBody = '';
		const send = vi.fn(async (command: unknown) => {
			if (command instanceof PutObjectCommand) {
				writtenBody = String(command.input.Body);
				expect(command.input).toMatchObject({
					Bucket: 'commons-public-discovery-cache',
					ContentType: 'application/json',
					IfMatch: `"${ETAG}"`,
					Metadata: { kind: 'template-page-backfill-progress', schema: '1' }
				});
				return { ETag: `"${RESULT_ETAG}"` };
			}
			if (send.mock.calls.length === 1) return object(JSON.stringify(checkpoint()));
			expect(command).toBeInstanceOf(GetObjectCommand);
			return object(writtenBody, RESULT_ETAG);
		});

		const result = await rearmPublicTemplateOgBackfill({
			s3: { send },
			environment: 'production',
			expectedEtag: ETAG,
			expectedCoordinateDigest: DIGEST,
			evidenceSha256: EVIDENCE,
			apply: true,
			now: NOW,
			rearmId: REARM_ID
		});

		expect(send).toHaveBeenCalledTimes(3);
		expect(JSON.parse(writtenBody)).toMatchObject({
			enqueueAttempts: 0,
			enqueuedAt: null,
			enqueuedOffset: 0
		});
		expect(result).toMatchObject({ applied: true, resultEtag: RESULT_ETAG });
	});

	it('refuses a stale operator ETag before any mutation', async () => {
		const send = vi.fn(async () => object(JSON.stringify(checkpoint()), 'f'.repeat(32)));
		await expect(
			rearmPublicTemplateOgBackfill({
				s3: { send },
				environment: 'production',
				expectedEtag: ETAG,
				expectedCoordinateDigest: DIGEST,
				evidenceSha256: EVIDENCE,
				apply: true,
				now: NOW,
				rearmId: REARM_ID
			})
		).rejects.toThrow('Observed ETag does not match');
		expect(send).toHaveBeenCalledOnce();
	});
});
