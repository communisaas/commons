import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
	createPublicDiscoveryBootstrapCustodyStage,
	loadPublicDiscoveryBootstrapCustody,
	parsePublicDiscoveryBootstrapCustodyArgs,
	publicDiscoveryBootstrapCustodyRoot,
	putPublicDiscoveryBootstrapCustodyStage,
	validatePublicDiscoveryBootstrapCustodyIdentity
} from '../../../scripts/public-discovery-bootstrap-recovery-custody.mjs';
import {
	classifyPublicDiscoveryBootstrapRecovery,
	classifyPublicDiscoveryBootstrapRouteInventory,
	recoverPublicDiscoveryBootstrap
} from '../../../scripts/recover-public-discovery-bootstrap.mjs';
import {
	PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
	PUBLIC_DISCOVERY_BOOTSTRAP_WORKER
} from '../../../scripts/verify-public-discovery-bootstrap-deployment.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const TRUSTED_GATE_SHA = 'b'.repeat(40);
const VERSION_ID = 'c'.repeat(32);
const ROUTE_ID = 'd'.repeat(32);
const identity = validatePublicDiscoveryBootstrapCustodyIdentity({
	repository: 'communisaas/commons',
	repositoryId: '599295397',
	runId: '123456789',
	runAttempt: '2',
	transactionId: '123456789-2'
});

class FakeS3Client {
	objects = new Map<string, { bytes: Buffer; metadata: Record<string, string> }>();

	async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
		const key = String(command.input.Key);
		if (command.constructor.name === 'PutObjectCommand') {
			if (this.objects.has(key)) {
				throw Object.assign(new Error('precondition'), {
					name: 'PreconditionFailed',
					$metadata: { httpStatusCode: 412 }
				});
			}
			const body = command.input.Body;
			const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array);
			this.objects.set(key, {
				bytes,
				metadata: command.input.Metadata as Record<string, string>
			});
			return { $metadata: { httpStatusCode: 200 } };
		}
		const object = this.objects.get(key);
		if (!object) {
			throw Object.assign(new Error('missing'), {
				name: 'NoSuchKey',
				$metadata: { httpStatusCode: 404 }
			});
		}
		if (command.constructor.name === 'HeadObjectCommand') {
			return { ContentLength: object.bytes.byteLength, Metadata: object.metadata };
		}
		if (command.constructor.name === 'GetObjectCommand') {
			return {
				ContentLength: object.bytes.byteLength,
				Metadata: object.metadata,
				Body: (async function* () {
					yield object.bytes;
				})()
			};
		}
		throw new Error(`unexpected command ${command.constructor.name}`);
	}
}

function intentStage() {
	return createPublicDiscoveryBootstrapCustodyStage({
		identity,
		sourceSha: SOURCE_SHA,
		trustedGateSha: TRUSTED_GATE_SHA,
		stage: 'intent',
		previousStage: null,
		previousDigest: null,
		versionId: null
	});
}

describe('independent public-discovery bootstrap recovery custody', () => {
	it('uses one fixed private path keyed only by repository id, run, and attempt', () => {
		expect(publicDiscoveryBootstrapCustodyRoot(identity)).toBe(
			'transactions/v1/repositories/599295397/runs/123456789/attempts/2/bootstrap-production'
		);
		expect(publicDiscoveryBootstrapCustodyRoot(identity)).not.toContain(SOURCE_SHA);
	});

	it('parses exact pre-mutation, deployed, cleaned, and hydration orchestration contracts', () => {
		const common = [
			'--repository',
			identity.repository,
			'--repository-id',
			identity.repositoryId,
			'--run-id',
			identity.runId,
			'--run-attempt',
			identity.runAttempt,
			'--transaction-id',
			identity.transactionId,
			'--trusted-gate-sha',
			TRUSTED_GATE_SHA
		];
		expect(
			parsePublicDiscoveryBootstrapCustodyArgs([
				'seal',
				...common,
				'--source-sha',
				SOURCE_SHA,
				'--config',
				'bootstrap.toml'
			])
		).toMatchObject({
			command: 'seal',
			configPath: 'bootstrap.toml',
			sourceSha: SOURCE_SHA,
			transactionId: identity.transactionId
		});
		expect(
			parsePublicDiscoveryBootstrapCustodyArgs([
				'record-deployed',
				...common,
				'--source-sha',
				SOURCE_SHA,
				'--config',
				'bootstrap.toml',
				'--wrangler',
				'wrangler'
			])
		).toMatchObject({ command: 'record-deployed', wranglerPath: 'wrangler' });
		expect(
			parsePublicDiscoveryBootstrapCustodyArgs([
				'record-cleaned',
				...common,
				'--source-sha',
				SOURCE_SHA
			])
		).toMatchObject({ command: 'record-cleaned', sourceSha: SOURCE_SHA });
		expect(
			parsePublicDiscoveryBootstrapCustodyArgs([
				'hydrate',
				...common,
				'--journal',
				'journal.json'
			])
		).toMatchObject({ command: 'hydrate', journalPath: 'journal.json' });
		expect(() =>
			parsePublicDiscoveryBootstrapCustodyArgs([
				'seal',
				...common,
				'--source-sha',
				SOURCE_SHA
			])
		).toThrow(/required exactly once/i);
	});

	it('loads an immutable intent → deployed → cleaned chain without LIST authority', async () => {
		const client = new FakeS3Client();
		const intent = await putPublicDiscoveryBootstrapCustodyStage({
			client: client as never,
			identity,
			stage: intentStage()
		});
		const deployedStage = createPublicDiscoveryBootstrapCustodyStage({
			identity,
			sourceSha: SOURCE_SHA,
			trustedGateSha: TRUSTED_GATE_SHA,
			stage: 'deployed',
			previousStage: 'intent',
			previousDigest: intent.digest,
			versionId: VERSION_ID
		});
		const deployed = await putPublicDiscoveryBootstrapCustodyStage({
			client: client as never,
			identity,
			stage: deployedStage
		});
		await putPublicDiscoveryBootstrapCustodyStage({
			client: client as never,
			identity,
			stage: createPublicDiscoveryBootstrapCustodyStage({
				identity,
				sourceSha: SOURCE_SHA,
				trustedGateSha: TRUSTED_GATE_SHA,
				stage: 'cleaned',
				previousStage: 'deployed',
				previousDigest: deployed.digest,
				versionId: VERSION_ID
			})
		});

		await expect(
			loadPublicDiscoveryBootstrapCustody({
				client: client as never,
				identity,
				expectedTrustedGateSha: TRUSTED_GATE_SHA
			})
		).resolves.toMatchObject({
			state: 'present',
			latest: { envelope: { stage: 'cleaned', versionId: VERSION_ID } }
		});
	});

	it('rejects a cleaned/deployed sibling fork and a crossed trusted gate', async () => {
		const client = new FakeS3Client();
		const intent = await putPublicDiscoveryBootstrapCustodyStage({
			client: client as never,
			identity,
			stage: intentStage()
		});
		await putPublicDiscoveryBootstrapCustodyStage({
			client: client as never,
			identity,
			stage: createPublicDiscoveryBootstrapCustodyStage({
				identity,
				sourceSha: SOURCE_SHA,
				trustedGateSha: TRUSTED_GATE_SHA,
				stage: 'deployed',
				previousStage: 'intent',
				previousDigest: intent.digest,
				versionId: VERSION_ID
			})
		});
		await putPublicDiscoveryBootstrapCustodyStage({
			client: client as never,
			identity,
			stage: createPublicDiscoveryBootstrapCustodyStage({
				identity,
				sourceSha: SOURCE_SHA,
				trustedGateSha: TRUSTED_GATE_SHA,
				stage: 'cleaned',
				previousStage: 'intent',
				previousDigest: intent.digest,
				versionId: null
			})
		});

		await expect(
			loadPublicDiscoveryBootstrapCustody({
				client: client as never,
				identity,
				expectedTrustedGateSha: TRUSTED_GATE_SHA
			})
		).rejects.toThrow(/forked|hash-linked/i);
		await expect(
			loadPublicDiscoveryBootstrapCustody({
				client: client as never,
				identity,
				expectedTrustedGateSha: 'e'.repeat(40)
			})
		).rejects.toThrow(/trusted gate/i);
	});

	it('mutates only an absent or exact transaction and treats drift as superseded', () => {
		expect(
			classifyPublicDiscoveryBootstrapRecovery({
				journalStage: 'intent',
				expectedVersionId: null,
				workerState: 'exact',
				workerVersionId: VERSION_ID,
				routeState: 'exact'
			})
		).toBe('contain-owned');
		expect(
			classifyPublicDiscoveryBootstrapRecovery({
				journalStage: 'deployed',
				expectedVersionId: VERSION_ID,
				workerState: 'exact',
				workerVersionId: 'f'.repeat(32),
				routeState: 'exact'
			})
		).toBe('superseded-noop');
		expect(
			classifyPublicDiscoveryBootstrapRecovery({
				journalStage: 'intent',
				expectedVersionId: null,
				workerState: 'absent',
				routeState: 'exact'
			})
		).toBe('contain-owned');
		expect(
			classifyPublicDiscoveryBootstrapRecovery({
				journalStage: 'cleaned',
				expectedVersionId: VERSION_ID,
				workerState: 'absent',
				routeState: 'absent'
			})
		).toBe('already-cleaned');
	});

	it('requires one exact route id and rejects overlapping or malformed inventories', () => {
		expect(
			classifyPublicDiscoveryBootstrapRouteInventory({
				success: true,
				result: [
					{
						id: ROUTE_ID,
						pattern: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
						script: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER
					}
				],
				result_info: { total_count: 1, total_pages: 1 }
			})
		).toEqual({ state: 'exact', routeId: ROUTE_ID });
		expect(
			classifyPublicDiscoveryBootstrapRouteInventory({
				success: true,
				result: [],
				result_info: { total_count: 0, total_pages: 1 }
			})
		).toEqual({ state: 'absent' });
		expect(
			classifyPublicDiscoveryBootstrapRouteInventory({
				success: true,
				result: [{ pattern: 'pages-origin.commons.email/*', script: 'ambient' }]
			})
		).toEqual({ state: 'superseded' });
	});

	it('contains an intent-only partial deployment route first and records terminal absence', async () => {
		const temporary = mkdtempSync(path.join(os.tmpdir(), 'commons-bootstrap-recovery-test-'));
		const journalPath = path.join(temporary, 'journal.json');
		writeFileSync(journalPath, `${JSON.stringify(intentStage())}\n`, { mode: 0o600 });
		let workerPresent = true;
		let routePresent = true;
		const events: string[] = [];
		const settings = {
			success: true,
			result: {
				bindings: [
					{
						name: 'PUBLIC_CONVEX_URL',
						text: 'https://quirky-chinchilla-352.convex.cloud',
						type: 'plain_text'
					},
					{
						name: 'PUBLIC_DISCOVERY_BOOTSTRAP_MODE',
						text: 'v1',
						type: 'plain_text'
					},
					{
						name: 'PUBLIC_RELEASE_TRANSACTION_ID',
						text: identity.transactionId,
						type: 'plain_text'
					},
					{
						name: 'PUBLIC_DISCOVERY_R2',
						bucket_name: 'commons-public-discovery-cache',
						type: 'r2_bucket'
					},
					{
						name: 'PUBLIC_TEMPLATE_OG_QUEUE',
						queue_name: 'commons-public-template-og',
						type: 'queue'
					},
					{
						name: 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE',
						class_name: 'PublicDiscoveryManifestRefreshGate',
						script_name: 'commons-public-discovery-manifest-gate',
						namespace_id: 'gate-id',
						type: 'durable_object_namespace'
					},
					{
						name: 'CONVEX_WORK_BUDGET',
						class_name: 'ConvexWorkBudget',
						script_name: 'commons-convex-work-budget',
						namespace_id: 'budget-id',
						type: 'durable_object_namespace'
					},
					{ name: 'DISCOVERY_MANIFEST_REFRESH_SECRET', type: 'secret_text' },
					{ name: 'INTERNAL_API_SECRET', type: 'secret_text' }
				],
				compatibility_date: '2025-04-01',
				compatibility_flags: [
					'nodejs_compat',
					'nodejs_als',
					'global_fetch_strictly_public'
				],
				limits: { cpu_ms: 10 }
			}
		};
		const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.endsWith(`/workers/routes/${ROUTE_ID}`) && init?.method === 'DELETE') {
				events.push('route-delete');
				routePresent = false;
				return Response.json({ success: true, result: { id: ROUTE_ID } });
			}
			if (url.endsWith('/workers/routes')) {
				return Response.json({
					success: true,
					result: routePresent
						? [
								{
									id: ROUTE_ID,
									pattern: PUBLIC_DISCOVERY_BOOTSTRAP_ROUTE,
									script: PUBLIC_DISCOVERY_BOOTSTRAP_WORKER
								}
							]
						: [],
					result_info: { total_count: routePresent ? 1 : 0, total_pages: 1 }
				});
			}
			if (url.endsWith('/settings')) {
				return workerPresent
					? Response.json(settings)
					: Response.json({ success: false, errors: [{ code: 10090 }] }, { status: 404 });
			}
			if (url.endsWith('/subdomain')) {
				return Response.json({
					success: true,
					result: { enabled: false, previews_enabled: false }
				});
			}
			throw new Error(`unexpected request ${url}`);
		});
		const spawnFn = vi.fn((_command: string, args: string[]) => {
			if (args[0] === 'deployments') {
				return {
					status: 0,
					stdout: JSON.stringify({
						versions: [{ percentage: 100, version_id: VERSION_ID }]
					})
				};
			}
			if (args[0] === 'versions') {
				return {
					status: 0,
					stdout: JSON.stringify({
						id: VERSION_ID,
						annotations: {
							'workers/tag': SOURCE_SHA,
							'workers/message': `Commons release transaction=${identity.transactionId} component=bootstrap`
						}
					})
				};
			}
			if (args[0] === 'delete') {
				events.push('worker-delete');
				workerPresent = false;
				return { status: 0, stdout: '' };
			}
			throw new Error(`unexpected wrangler arguments ${args.join(' ')}`);
		});
		const recordCleanedFn = vi.fn(async () => {
			events.push('record-cleaned');
			return { state: 'cleanup-recorded' };
		});

		try {
			await expect(
				recoverPublicDiscoveryBootstrap({
					journalPath,
					configPath: 'wrangler.public-discovery-bootstrap.toml',
					wranglerPath: '/tmp/wrangler',
					expectedTrustedGateSha: TRUSTED_GATE_SHA,
					accountId: '019d1184e655db74b7589794a2a2a533',
					zoneId: 'e'.repeat(32),
					apiToken: 'cloudflare-token',
					fetchFn,
					spawnFn: spawnFn as never,
					recordCleanedFn: recordCleanedFn as never
				})
			).resolves.toMatchObject({
				state: 'bootstrap-contained',
				sourceSha: SOURCE_SHA,
				transactionId: identity.transactionId
			});
			expect(events).toEqual(['route-delete', 'worker-delete', 'record-cleaned']);
			expect(recordCleanedFn).toHaveBeenCalledOnce();
		} finally {
			rmSync(temporary, { force: true, recursive: true });
		}
	});

	it('hydrates independently and orders outer recovery before route-first bootstrap cleanup', () => {
		const workflow = readFileSync(
			'.github/workflows/public-template-og-release-recovery.yml',
			'utf8'
		);
		const recovery = readFileSync('scripts/recover-public-discovery-bootstrap.mjs', 'utf8');
		const custody = readFileSync(
			'scripts/public-discovery-bootstrap-recovery-custody.mjs',
			'utf8'
		);
		const bootstrapHydrate = workflow.indexOf(
			'Hydrate independent production bootstrap custody'
		);
		const core = workflow.indexOf('Recover only the exact live transaction');
		const coordination = workflow.indexOf(
			'Recover production scheduler edge and exposure from immutable custody'
		);
		const bootstrapCleanup = workflow.indexOf(
			'Contain exact temporary production bootstrap after recovery settles'
		);
		expect(bootstrapHydrate).toBeGreaterThan(-1);
		expect(core).toBeGreaterThan(bootstrapHydrate);
		expect(coordination).toBeGreaterThan(core);
		expect(bootstrapCleanup).toBeGreaterThan(coordination);
		expect(workflow.slice(bootstrapCleanup)).toContain('always() &&');
		expect(workflow.slice(bootstrapHydrate, core)).toContain(
			'public-discovery-bootstrap-recovery-custody.mjs hydrate'
		);
		expect(workflow.slice(bootstrapHydrate, core)).toContain(
			'test "$source_sha" = "${{ steps.hydrate.outputs.source_sha }}"'
		);
		expect(workflow.slice(bootstrapCleanup)).toContain(
			'recover-public-discovery-bootstrap.mjs'
		);
		const routeDelete = recovery.indexOf('/workers/routes/${route.routeId}');
		const scriptDelete = recovery.indexOf(
			"['delete', PUBLIC_DISCOVERY_BOOTSTRAP_WORKER, '--force']"
		);
		expect(routeDelete).toBeGreaterThan(-1);
		expect(scriptDelete).toBeGreaterThan(routeDelete);
		expect(recovery).toContain('expectedPresent: false');
		expect(custody).not.toContain('ListObjects');
	});
});
