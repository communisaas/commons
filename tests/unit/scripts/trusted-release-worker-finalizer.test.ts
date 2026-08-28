import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	TRUSTED_RELEASE_WORKER_PROFILES,
	createTrustedReleaseWorkerFinalizationRecord,
	finalizeTrustedReleaseWorker,
	parseTrustedReleaseWorkerArgs,
	parseTrustedReleaseWorkerValidationArgs,
	validateTrustedReleaseWorkerArtifact,
	verifyTrustedReleaseWorkerInputClosure,
	verifyTrustedReleaseWorkerMetafileOutput
} from '../../../scripts/finalize-trusted-release-worker.mjs';

const roots: string[] = [];
const wranglerPackageRoot = '.github/release-gate/node_modules/wrangler';
const wranglerLockfile = '.github/release-gate/package-lock.json';

function artifact(branch = 'production') {
	const root = mkdtempSync(join(tmpdir(), 'commons-standalone-worker-finalizer-'));
	roots.push(root);
	writeFileSync(
		join(root, 'release-metadata.json'),
		JSON.stringify({ schemaVersion: 1, mode: 'normal', branch, sourceSha: 'a'.repeat(40) })
	);
	return root;
}

function finalize(root: string, profile: keyof typeof TRUSTED_RELEASE_WORKER_PROFILES) {
	return finalizeTrustedReleaseWorker({
		artifactRoot: root,
		trustedSourceRoot: '.',
		profile,
		wranglerPackageRoot,
		wranglerLockfile
	});
}

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('trusted fixed-profile standalone Worker finalizer', () => {
	it(
		'produces deterministic standalone JS for both gate realms, work budget, and cron',
		() => {
			for (const profile of Object.keys(TRUSTED_RELEASE_WORKER_PROFILES) as Array<
				keyof typeof TRUSTED_RELEASE_WORKER_PROFILES
			>) {
				const branch = TRUSTED_RELEASE_WORKER_PROFILES[profile].nonProductionOnly
					? 'main'
					: 'production';
				const primary = artifact(branch);
				const replica = artifact(branch);
				const first = finalize(primary, profile);
				const second = finalize(replica, profile);
				const directory = TRUSTED_RELEASE_WORKER_PROFILES[profile].artifactDirectory;
				const firstBytes = readFileSync(join(primary, directory, 'index.js'));
				const secondBytes = readFileSync(join(replica, directory, 'index.js'));
				expect(first.sha256).toBe(second.sha256);
				expect(firstBytes.equals(secondBytes)).toBe(true);
				expect(first.rawBytes).toBe(firstBytes.byteLength);
				expect(first.gzipBytes).toBeLessThanOrEqual(128 * 1024);
				expect(first.inputs.some((input) => input.path.endsWith('.ts'))).toBe(true);
				expect(firstBytes.subarray(0, 2).toString()).not.toBe('--');
				expect(firstBytes.toString('utf8')).not.toContain('formdata-undici');
				expect(firstBytes.toString('utf8')).not.toContain('sourceMappingURL=');
			}
		},
		120_000
	);

	it('fails closed on caller-selected profiles, preview cron, and pre-existing output', () => {
		expect(() =>
			finalizeTrustedReleaseWorker({
				artifactRoot: artifact(),
				trustedSourceRoot: '.',
				profile: 'candidate-worker',
				wranglerPackageRoot,
				wranglerLockfile
			})
		).toThrow(/Unknown/);
		expect(() => finalize(artifact('main'), 'manifest-cron')).toThrow(/incompatible/);
		expect(() => finalize(artifact('main'), 'manifest-gate')).toThrow(/incompatible/);
		expect(() => finalize(artifact('main'), 'convex-work-budget')).toThrow(/incompatible/);
		expect(() => finalize(artifact(), 'manifest-gate-nonprod')).not.toThrow();
		const existing = artifact();
		mkdirSync(join(existing, 'manifest-gate'));
		expect(() => finalize(existing, 'manifest-gate')).toThrow(/already exists/);
	});

	it(
		'rejects the old random-boundary --outfile body and every extra map/output',
		() => {
			expect(() =>
			createTrustedReleaseWorkerFinalizationRecord({
				profile: 'manifest-gate',
				configSha256: 'a'.repeat(64),
				inputs: [
					{
						path: 'workers/public-discovery-manifest-refresh-gate.ts',
						bytes: 1,
						sha256: 'b'.repeat(64)
					}
				],
				bundle: Buffer.from(
					'------formdata-undici-012345678901\nContent-Disposition: form-data; name="metadata"\n'
				)
			})
			).toThrow(/multipart upload body/);

			const root = artifact();
			finalize(root, 'manifest-gate');
			writeFileSync(join(root, 'manifest-gate/index.js.map'), '{}');
			expect(() =>
				validateTrustedReleaseWorkerArtifact(root, '.', 'manifest-gate')
			).toThrow(/entries are not exact/);

			const sourceMapDirective = artifact();
			finalize(sourceMapDirective, 'manifest-gate');
			const workerPath = join(sourceMapDirective, 'manifest-gate/index.js');
			writeFileSync(
				workerPath,
				Buffer.concat([
					readFileSync(workerPath),
					Buffer.from('\n//# sourceMappingURL=public-discovery-manifest-refresh-gate.js.map\n')
				])
			);
			expect(() =>
				validateTrustedReleaseWorkerArtifact(sourceMapDirective, '.', 'manifest-gate')
			).toThrow(/not canonical standalone JavaScript/);
		},
		30_000
	);

	it('rejects metafile traversal before resolving any input', () => {
		expect(() =>
			verifyTrustedReleaseWorkerInputClosure(
				{ inputs: { '../outside.ts': { bytes: 1 } } },
				{ trustedSourceRoot: '.', entrypoint: 'workers/public-discovery-manifest-cron.ts' }
			)
		).toThrow(/unsafe input/);
	});

	it('binds the executable metafile output and entrypoint to the selected profile', () => {
		const root = artifact();
		const outputRoot = join(root, 'output');
		const selected = TRUSTED_RELEASE_WORKER_PROFILES['manifest-gate'];
		const outputName = relative(process.cwd(), join(outputRoot, selected.emittedFile)).replaceAll(
			'\\',
			'/'
		);
		const output = {
			bytes: 1,
			imports: [],
			entryPoint: selected.entrypoint
		};

		expect(
			verifyTrustedReleaseWorkerMetafileOutput(
				{ outputs: { [outputName]: output } },
				{ trustedSourceRoot: '.', outputRoot, profile: 'manifest-gate' }
			)
		).toMatchObject({ entrypoint: selected.entrypoint });
		expect(() =>
			verifyTrustedReleaseWorkerMetafileOutput(
				{
					outputs: {
						[outputName]: { ...output, entryPoint: 'workers/convex-work-budget.ts' }
					}
				},
				{ trustedSourceRoot: '.', outputRoot, profile: 'manifest-gate' }
			)
		).toThrow(/entrypoint does not match/);
		expect(() =>
			verifyTrustedReleaseWorkerMetafileOutput(
				{
					outputs: {
						[relative(process.cwd(), join(outputRoot, 'forged.js'))]: output
					}
				},
				{ trustedSourceRoot: '.', outputRoot, profile: 'manifest-gate' }
			)
		).toThrow(/output does not match/);
	});

	it(
		'revalidates every config and immutable-T input digest in the artifact record',
		() => {
			const configDrift = artifact();
			finalize(configDrift, 'manifest-gate');
			const configRecordPath = join(configDrift, 'manifest-gate/finalization.json');
			const configRecord = JSON.parse(readFileSync(configRecordPath, 'utf8'));
			configRecord.config.sha256 = '0'.repeat(64);
			writeFileSync(configRecordPath, `${JSON.stringify(configRecord)}\n`);
			expect(() =>
				validateTrustedReleaseWorkerArtifact(configDrift, '.', 'manifest-gate')
			).toThrow(/config proof does not match T/);

			const inputDrift = artifact();
			finalize(inputDrift, 'manifest-gate');
			const inputRecordPath = join(inputDrift, 'manifest-gate/finalization.json');
			const inputRecord = JSON.parse(readFileSync(inputRecordPath, 'utf8'));
			inputRecord.inputs[0].sha256 = '0'.repeat(64);
			writeFileSync(inputRecordPath, `${JSON.stringify(inputRecord)}\n`);
			expect(() =>
				validateTrustedReleaseWorkerArtifact(inputDrift, '.', 'manifest-gate')
			).toThrow(/input proof drifted from T/);
		},
		45_000
	);

	it('accepts only fixed finalizer arguments', () => {
		expect(
			parseTrustedReleaseWorkerArgs([
				'--artifact-root',
				'artifact',
				'--trusted-source-root',
				'gate',
				'--profile',
				'manifest-gate',
				'--wrangler-package-root',
				'gate/node_modules/wrangler',
				'--wrangler-lockfile',
				'gate/package-lock.json'
			])
		).toMatchObject({ profile: 'manifest-gate', trustedSourceRoot: 'gate' });
		expect(() =>
			parseTrustedReleaseWorkerArgs([
				'--artifact-root',
				'artifact',
				'--trusted-source-root',
				'gate',
				'--profile',
				'manifest-gate',
				'--wrangler-package-root',
				'gate/node_modules/wrangler',
				'--wrangler-lockfile',
				'gate/package-lock.json',
				'--entrypoint',
				'candidate.ts'
			])
		).toThrow();
		expect(
			parseTrustedReleaseWorkerValidationArgs([
				'--artifact-root',
				'artifact',
				'--trusted-source-root',
				'gate',
				'--profile',
				'manifest-gate'
			])
		).toEqual({
			artifactRoot: 'artifact',
			trustedSourceRoot: 'gate',
			profile: 'manifest-gate'
		});
		expect(() =>
			parseTrustedReleaseWorkerValidationArgs([
				'--artifact-root',
				'artifact',
				'--trusted-source-root',
				'gate',
				'--profile',
				'manifest-gate',
				'--wrangler-lockfile',
				'candidate-lock.json'
			])
		).toThrow();
	});
});
