import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_PRODUCTION,
	validatePublicDiscoveryBootstrapCompletionEnvironment,
	verifyPublicDiscoveryBootstrapCompletion
} from '../../../scripts/verify-public-discovery-bootstrap-completion';
import { publicDiscoveryGraphGeneration } from '../../../src/lib/server/public-discovery-manifest-shield';
import { publicTemplatePageCoordinateDigest } from '../../../src/lib/server/public-template-page-coordinate';
import { publicTemplatePageArtifactObjectKeys } from '../../../src/lib/server/public-template-og-queue';
import { publicTemplatePageBackfillProgressKey } from '../../../scripts/rearm-public-template-og-backfill.mjs';

const NOW = Date.UTC(2026, 6, 20, 12, 0, 0);
const LAST_MODIFIED = new Date(NOW - 1_000);
const COORDINATES = [
	{ artifactRevision: 7, slug: 'alpha', templateId: 'template-a' },
	{ artifactRevision: 8, slug: 'beta', templateId: 'template-b' }
];

type FixtureOptions = {
	checkpoint?: Record<string, unknown>;
	checkpointObject?: Record<string, unknown>;
	manifest?: Record<string, unknown>;
	manifestObject?: Record<string, unknown>;
	inventory?: Record<string, unknown>;
	inventoryObject?: Record<string, unknown>;
	payloadHead?: Record<string, unknown>;
	pngHead?: Record<string, unknown>;
	mutateSecondCheckpointRead?: boolean;
};

function jsonObject(
	value: unknown,
	metadata: Record<string, string>,
	etagCharacter: string,
	patch: Record<string, unknown> = {}
) {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	return {
		Body: { transformToByteArray: vi.fn(async () => bytes) },
		ContentLength: bytes.byteLength,
		ContentType: 'application/json',
		ETag: `"${etagCharacter.repeat(32)}"`,
		LastModified: LAST_MODIFIED,
		Metadata: metadata,
		...patch
	};
}

async function fixture(options: FixtureOptions = {}) {
	const coordinateDigest = await publicTemplatePageCoordinateDigest(COORDINATES);
	const list = {
		ready: true,
		retiredRevision: 6,
		revision: 7,
		updatedAt: 700,
		withdrawalEpoch: 2
	};
	const relations = {
		ready: true,
		retiredRevision: 8,
		revision: 9,
		updatedAt: 900,
		withdrawalEpoch: 3
	};
	const checkpoint = {
		version: 1,
		generation: 'ready:7:700:epoch=2:artifact-set=3',
		coordinateDigest,
		coordinates: COORDINATES,
		total: 2,
		nextOffset: 2,
		enqueuedOffset: 2,
		enqueuedAt: null,
		enqueueAttempts: 0,
		...options.checkpoint
	};
	const manifest = {
		certifiedAt: NOW - 3_000,
		manifest: { list, relations },
		payloadGenerations: {
			list: ['7:700'],
			graph: [publicDiscoveryGraphGeneration({ list, relations })]
		},
		pendingRetireGenerations: { list: [], graph: [] },
		phase: 'ready',
		publicationLag: null,
		realm: `backend=${PUBLIC_DISCOVERY_PRODUCTION.backend}`,
		schema: 2,
		withdrawalFloors: { list: 6, relations: 8 },
		writtenAt: NOW - 2_000,
		...options.manifest
	};
	const inventory = {
		cachedAt: NOW - 2_000,
		revision: '7:700',
		value: {
			version: 1,
			revision: 7,
			updatedAt: 700,
			entries: COORDINATES.map(({ slug, artifactRevision }) => ({
				slug,
				artifactRevision: String(artifactRevision)
			}))
		},
		...options.inventory
	};
	const checkpointKey = publicTemplatePageBackfillProgressKey(
		PUBLIC_DISCOVERY_PRODUCTION.backend
	);
	let checkpointReads = 0;
	const commands: unknown[] = [];
	const send = vi.fn(async (command: unknown) => {
		commands.push(command);
		if (command instanceof GetObjectCommand) {
			const key = command.input.Key;
			if (key === checkpointKey) {
				checkpointReads += 1;
				const body =
					options.mutateSecondCheckpointRead && checkpointReads === 2
						? { ...checkpoint, coordinateDigest: 'f'.repeat(64) }
						: checkpoint;
				return jsonObject(
					body,
					{ kind: 'template-page-backfill-progress', schema: '1' },
					options.mutateSecondCheckpointRead && checkpointReads === 2 ? '9' : 'a',
					options.checkpointObject
				);
			}
			if (key?.endsWith('/control/manifest/state.json')) {
				return jsonObject(
					manifest,
					{ kind: 'manifest-ready', schema: '2' },
					'b',
					options.manifestObject
				);
			}
			if (key?.includes('template-pages%3Ainventory')) {
				return jsonObject(
					inventory,
					{ kind: 'payload', revision: '7:700' },
					'c',
					options.inventoryObject
				);
			}
			throw new Error(`unexpected GET ${key}`);
		}
		if (command instanceof HeadObjectCommand) {
			const key = command.input.Key ?? '';
			const match = /template-page%3Aslug%3D([^/]+)\/revision=(\d+)\/(payload\.json|og-image\.png)$/.exec(
				key
			);
			if (!match) throw new Error(`unexpected HEAD ${key}`);
			const [, slug, revision, filename] = match;
			if (filename === 'payload.json') {
				return {
					ContentLength: 1_024,
					ContentType: 'application/json',
					ETag: `"${'d'.repeat(32)}"`,
					LastModified: LAST_MODIFIED,
					Metadata: { kind: 'payload', revision },
					...options.payloadHead
				};
			}
			return {
				ContentLength: 2_048,
				ContentType: 'image/png',
				ETag: `"${'e'.repeat(32)}"`,
				LastModified: LAST_MODIFIED,
				Metadata: { kind: 'template-og-image', revision, schema: '1', slug },
				...options.pngHead
			};
		}
		throw new Error('write or LIST command was attempted');
	});
	return { checkpoint, commands, inventory, manifest, s3: { send } };
}

describe('offline production public-discovery bootstrap completion proof', () => {
	it('keeps CLI configuration failures outside the cold-state sentinel', () => {
		const valid = {
			accessKeyId: 'read-only-access-key',
			accountId: PUBLIC_DISCOVERY_PRODUCTION.accountId,
			argumentCount: 0,
			secretAccessKey: 'read-only-secret-key'
		};
		expect(validatePublicDiscoveryBootstrapCompletionEnvironment(valid)).toEqual({
			accessKeyId: valid.accessKeyId,
			accountId: valid.accountId,
			secretAccessKey: valid.secretAccessKey
		});
		for (const candidate of [
			{ ...valid, argumentCount: 1 },
			{ ...valid, accountId: 'wrong-account' },
			{ ...valid, accessKeyId: '' },
			{ ...valid, secretAccessKey: '' }
		]) {
			expect(() => validatePublicDiscoveryBootstrapCompletionEnvironment(candidate)).toThrow(
				/^PUBLIC_DISCOVERY_BOOTSTRAP_CONFIGURATION_ERROR:/u
			);
			try {
				validatePublicDiscoveryBootstrapCompletionEnvironment(candidate);
			} catch (error) {
				expect(String(error)).not.toContain('PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:');
			}
		}
	});

	it('proves one stable exact-key production snapshot without LIST or writes', async () => {
		const context = await fixture();
		const result = await verifyPublicDiscoveryBootstrapCompletion({
			s3: context.s3,
			now: NOW,
			headConcurrency: 2
		});

		expect(result).toMatchObject({
			action: 'verify-public-discovery-bootstrap-completion',
			artifacts: {
				coordinates: 2,
				exactHeadReads: 4,
				jsonBytes: 2_048,
				pngBytes: 4_096
			},
			backend: 'https://quirky-chinchilla-352.convex.cloud',
			bucket: 'commons-public-discovery-cache',
			environment: 'production',
			proof: 'production-bootstrap-complete',
			verifiedAt: NOW
		});
		expect(context.commands.filter((command) => command instanceof GetObjectCommand)).toHaveLength(
			6
		);
		expect(context.commands.filter((command) => command instanceof HeadObjectCommand)).toHaveLength(
			4
		);
		expect(
			context.commands.every(
				(command) => command instanceof GetObjectCommand || command instanceof HeadObjectCommand
			)
		).toBe(true);
		expect(
			context.commands.every(
				(command) =>
					(command as GetObjectCommand | HeadObjectCommand).input.Bucket ===
					PUBLIC_DISCOVERY_PRODUCTION.bucket
			)
		).toBe(true);
		expect(JSON.stringify(result).length).toBeLessThan(4_096);
	});

	it('derives every pair key through the shared Queue contract', () => {
		const expected = publicTemplatePageArtifactObjectKeys({
			version: 2,
			backend: PUBLIC_DISCOVERY_PRODUCTION.backend,
			revision: '7',
			sourceSha: '0'.repeat(40),
			slug: 'alpha',
			transactionId: '1-1'
		});
		expect(expected.payload).toContain(
			'public-template-pages/v1/backend%3Dhttps%3A%2F%2Fquirky-chinchilla-352.convex.cloud/'
		);
		expect(expected.ogImage).toBe(expected.payload.replace('payload.json', 'og-image.png'));
	});

	it.each([
		['NoSuchKey', 'Checkpoint'],
		['NotFound', 'Checkpoint'],
		['NoSuchObject', 'Checkpoint']
	])('classifies an exact missing required object (%s) as cold bootstrap state', async (name, label) => {
		const context = await fixture();
		const missing = Object.assign(new Error('not found'), {
			$metadata: { httpStatusCode: 404 },
			name
		});
		const checkpointKey = publicTemplatePageBackfillProgressKey(
			PUBLIC_DISCOVERY_PRODUCTION.backend
		);
		const send = vi.fn(async (command: unknown) => {
			if (command instanceof GetObjectCommand && command.input.Key === checkpointKey) throw missing;
			return context.s3.send(command);
		});

		await expect(
			verifyPublicDiscoveryBootstrapCompletion({ s3: { send }, now: NOW })
		).rejects.toThrow(`PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:${label} is absent.`);
	});

	it.each([
		['AccessDenied', 403],
		['NoSuchBucket', 404],
		['TimeoutError', undefined]
	])('does not misclassify the operational S3 error %s', async (name, httpStatusCode) => {
		const context = await fixture();
		const operational = Object.assign(new Error('operational failure'), {
			...(httpStatusCode === undefined ? {} : { $metadata: { httpStatusCode } }),
			name
		});
		const send = vi.fn(async (command: unknown) => {
			if (command instanceof GetObjectCommand) throw operational;
			return context.s3.send(command);
		});

		await expect(
			verifyPublicDiscoveryBootstrapCompletion({ s3: { send }, now: NOW })
		).rejects.toBe(operational);
	});

	it('classifies an exact missing page artifact as incomplete bootstrap state', async () => {
		const context = await fixture();
		const missing = Object.assign(new Error('not found'), {
			$metadata: { httpStatusCode: 404 },
			name: 'NotFound'
		});
		const send = vi.fn(async (command: unknown) => {
			if (
				command instanceof HeadObjectCommand &&
				command.input.Key?.endsWith('/og-image.png')
			) {
				throw missing;
			}
			return context.s3.send(command);
		});

		await expect(
			verifyPublicDiscoveryBootstrapCompletion({ s3: { send }, now: NOW })
		).rejects.toThrow('PUBLIC_DISCOVERY_BOOTSTRAP_INCOMPLETE:PNG alpha is absent.');
	});

	it.each([
		[
			'pending Queue handoff',
			{ checkpoint: { nextOffset: 0, enqueuedOffset: 2, enqueuedAt: NOW - 5_000, enqueueAttempts: 1 } },
			'unfinished or pending'
		],
		[
			'coordinate digest drift',
			{ checkpoint: { coordinateDigest: 'f'.repeat(64) } },
			'coordinate digest'
		],
		[
			'checkpoint metadata drift',
			{
				checkpointObject: {
					Metadata: {
						kind: 'template-page-backfill-progress',
						schema: '1',
						extra: 'drift'
					}
				}
			},
			'Checkpoint metadata'
		],
		[
			'checkpoint oversize',
			{ checkpointObject: { ContentLength: 128 * 1024 + 1 } },
			'Checkpoint size'
		],
		[
			'checkpoint/manifest generation drift',
			{ checkpoint: { generation: 'ready:8:800:epoch=2:artifact-set=3' } },
			'does not match the ready list authority'
		],
		[
			'non-ready manifest',
			{ manifest: { phase: 'refreshing' } },
			'Manifest ready state is invalid'
		],
		[
			'payload generation drift',
			{ manifest: { payloadGenerations: { list: ['6:600'], graph: [] } } },
			'Manifest ready state is invalid'
		],
		[
			'inventory drift',
			{
				inventory: {
					value: {
						version: 1,
						revision: 7,
						updatedAt: 700,
						entries: [{ slug: 'alpha', artifactRevision: '99' }]
					}
				}
			},
			'Inventory coordinates'
		],
		[
			'inventory content type drift',
			{ inventoryObject: { ContentType: 'text/plain' } },
			'Inventory content type'
		],
		[
			'corrupt JSON metadata',
			{ payloadHead: { Metadata: { kind: 'payload', revision: '7', extra: 'drift' } } },
			'JSON alpha metadata'
		],
		[
			'corrupt PNG type',
			{ pngHead: { ContentType: 'application/octet-stream' } },
			'PNG alpha type'
		]
	])('fails closed for %s', async (_label, options, message) => {
		const context = await fixture(options as FixtureOptions);
		await expect(
			verifyPublicDiscoveryBootstrapCompletion({ s3: context.s3, now: NOW })
		).rejects.toThrow(message as string);
	});

	it('rejects control-state drift observed during the pair proof', async () => {
		const context = await fixture({ mutateSecondCheckpointRead: true });
		await expect(
			verifyPublicDiscoveryBootstrapCompletion({ s3: context.s3, now: NOW })
		).rejects.toThrow('Checkpoint changed during verification');
	});
});
