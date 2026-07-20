import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	inspectArtifactTree,
	validatePagesReleaseArtifact
} from '../../../scripts/validate-pages-release-artifact.mjs';
import {
	PAGES_FINALIZATION_RECORD,
	TRUSTED_PAGES_ROUTES_FILE,
	TRUSTED_PAGES_ROUTES_SOURCE,
	createPagesFinalizationRecord
} from '../../../scripts/finalize-pages-release-artifact.mjs';
import {
	PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY,
	PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD,
	createPublicTemplateOgFinalizationRecord
} from '../../../scripts/finalize-public-template-og-release-artifact.mjs';
import {
	TRUSTED_RELEASE_WORKER_FINALIZATION_FILE,
	TRUSTED_RELEASE_WORKER_PROFILES,
	createTrustedReleaseWorkerFinalizationRecord
} from '../../../scripts/finalize-trusted-release-worker.mjs';

const roots: string[] = [];
const sourceSha = 'a'.repeat(40);
const trustedGateSha = 'd'.repeat(40);
const publicRuntime = {
	PUBLIC_CONVEX_URL: 'https://quirky-chinchilla-352.convex.cloud',
	ATLAS_BASE_URL: 'https://atlas.commons.email/v20260720',
	VITE_ATLAS_BASE_URL: 'https://atlas.commons.email/v20260720',
	EXPECTED_CELL_MAP_ROOT: `0x${'b'.repeat(64)}`,
	EXPECTED_CELL_MAP_DEPTH: '22'
};

function writeStandaloneProof(
	root: string,
	profile: keyof typeof TRUSTED_RELEASE_WORKER_PROFILES
) {
	const selected = TRUSTED_RELEASE_WORKER_PROFILES[profile];
	const bundle = readFileSync(join(root, selected.artifactDirectory, 'index.js'));
	const configSha256 = createHash('sha256').update(readFileSync(selected.config)).digest('hex');
	const input = readFileSync(selected.entrypoint);
	const record = createTrustedReleaseWorkerFinalizationRecord({
		profile,
		configSha256,
		inputs: [
			{
				path: selected.entrypoint,
				bytes: input.byteLength,
				sha256: createHash('sha256').update(input).digest('hex')
			}
		],
		bundle,
		releaseSourceSha: 'sourceShaBound' in selected && selected.sourceShaBound ? sourceSha : null
	});
	writeFileSync(
		join(root, selected.artifactDirectory, TRUSTED_RELEASE_WORKER_FINALIZATION_FILE),
		`${JSON.stringify(record)}\n`
	);
}

function artifact(mode: 'normal' | 'containment', branch = 'production') {
	const root = mkdtempSync(join(tmpdir(), 'commons-pages-artifact-'));
	roots.push(root);
	mkdirSync(join(root, 'pages'));
	writeFileSync(join(root, 'pages/_worker.js'), 'export default { fetch() {} };\n');
	const gate = mode === 'normal';
	if (gate) {
		const gateProfiles = [
			'manifest-gate-nonprod',
			...(branch === 'production' ? ['manifest-gate'] : [])
		] as Array<keyof typeof TRUSTED_RELEASE_WORKER_PROFILES>;
		for (const profile of gateProfiles) {
			const directory = TRUSTED_RELEASE_WORKER_PROFILES[profile].artifactDirectory;
			mkdirSync(join(root, directory));
			writeFileSync(
				join(root, directory, 'index.js'),
				'export class PublicDiscoveryManifestRefreshGate {}\n'
			);
			writeStandaloneProof(root, profile);
		}
	}
	const workBudget = mode === 'normal' && branch === 'production';
	if (workBudget) {
		mkdirSync(join(root, 'convex-work-budget'));
		writeFileSync(join(root, 'convex-work-budget/index.js'), 'export class ConvexWorkBudget {}\n');
		writeStandaloneProof(root, 'convex-work-budget');
	}
	if (mode === 'normal') {
		const profile =
			branch === 'production' ? 'trusted-pages-edge' : 'trusted-pages-edge-staging';
		const directory = TRUSTED_RELEASE_WORKER_PROFILES[profile].artifactDirectory;
		mkdirSync(join(root, directory));
		writeFileSync(
			join(root, directory, 'index.js'),
			`const releaseSourceSha=${JSON.stringify(sourceSha)};export default { fetch() { return releaseSourceSha } };\n`
		);
		writeStandaloneProof(root, profile);
	}
	const cron = mode === 'normal' && branch === 'production';
	if (cron) {
		mkdirSync(join(root, 'manifest-cron'));
		writeFileSync(join(root, 'manifest-cron/index.js'), 'export default { scheduled() {} };\n');
		writeStandaloneProof(root, 'manifest-cron');
	}
	if (mode === 'normal') {
		writeFileSync(join(root, 'pages', TRUSTED_PAGES_ROUTES_FILE), TRUSTED_PAGES_ROUTES_SOURCE);
		writeFileSync(
			join(root, PAGES_FINALIZATION_RECORD),
			`${JSON.stringify(createPagesFinalizationRecord(readFileSync(join(root, 'pages/_worker.js')), []))}\n`
		);
		const ogBundle = Buffer.from('export default { queue() {} };\n');
		mkdirSync(join(root, PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY));
		writeFileSync(join(root, PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY, 'index.js'), ogBundle);
		const configSha256 = createHash('sha256')
			.update(readFileSync('wrangler.public-template-og.toml'))
			.digest('hex');
		writeFileSync(
			join(root, PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD),
			`${JSON.stringify(
				createPublicTemplateOgFinalizationRecord(
					ogBundle,
					[{ path: 'workers/public-template-og-consumer.ts', bytes: 1, sha256: 'c'.repeat(64) }],
					configSha256
				)
			)}\n`
		);
	}
	writeFileSync(
		join(root, 'release-metadata.json'),
		JSON.stringify({
			schemaVersion: 1,
			sourceSha,
			trustedGateSha,
			finalizationBoundary:
				mode === 'normal'
					? 'fresh-runner-trusted-finalization-v1'
					: 'secret-job-trusted-containment-v1',
			mode,
			branch,
			manifestGateIncluded: gate,
			convexWorkBudgetIncluded: workBudget,
			trustedPagesEdgeIncluded: gate,
			publicTemplateOgConsumerIncluded: gate,
			manifestCronIncluded: cron,
			publicRuntime
		})
	);
	return root;
}

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('bounded Pages release artifact', () => {
	it('accepts exact containment and normal-production artifact shapes', () => {
		for (const mode of ['containment', 'normal'] as const) {
			const result = validatePagesReleaseArtifact({
				artifactRoot: artifact(mode),
				expectedSourceSha: sourceSha,
				expectedTrustedGateSha: trustedGateSha,
				expectedMode: mode,
				expectedBranch: 'production',
				expectedPublicRuntime: publicRuntime
			});
			expect(result.sourceSha).toBe(sourceSha);
			expect(result.manifestGateIncluded).toBe(mode === 'normal');
			expect(result.convexWorkBudgetIncluded).toBe(mode === 'normal');
			expect(result.trustedPagesEdgeIncluded).toBe(mode === 'normal');
			expect(result.manifestCronIncluded).toBe(mode === 'normal');
		}
	});

	it('includes a gate but no cron in a normal preview artifact', () => {
		const result = validatePagesReleaseArtifact({
			artifactRoot: artifact('normal', 'main'),
			expectedSourceSha: sourceSha,
			expectedTrustedGateSha: trustedGateSha,
			expectedMode: 'normal',
			expectedBranch: 'main',
			expectedPublicRuntime: publicRuntime
		});
		expect(result.manifestGateIncluded).toBe(true);
		expect(result.convexWorkBudgetIncluded).toBe(false);
		expect(result.trustedPagesEdgeIncluded).toBe(true);
		expect(result.manifestCronIncluded).toBe(false);
	});

	it('rejects metadata drift and unexpected top-level payloads', () => {
		const root = artifact('containment');
		writeFileSync(join(root, 'candidate-tool.js'), 'throw new Error("must not execute");\n');
		expect(() =>
			validatePagesReleaseArtifact({
				artifactRoot: root,
				expectedSourceSha: sourceSha,
				expectedTrustedGateSha: trustedGateSha,
				expectedMode: 'containment',
				expectedBranch: 'production',
				expectedPublicRuntime: publicRuntime
			})
		).toThrow(/top-level entries are not exact/);
	});

	it('rejects symbolic links before deployment tooling can follow them', () => {
		const root = artifact('containment');
		symlinkSync('/etc/passwd', join(root, 'pages/leak'));
		expect(() => inspectArtifactTree(root)).toThrow(/forbids symbolic links/);
	});

	it('rejects a missing finalization proof or Worker bytes changed after finalization', () => {
		const missing = artifact('normal');
		rmSync(join(missing, PAGES_FINALIZATION_RECORD));
		expect(() =>
			validatePagesReleaseArtifact({
				artifactRoot: missing,
				expectedSourceSha: sourceSha,
				expectedTrustedGateSha: trustedGateSha,
				expectedMode: 'normal',
				expectedBranch: 'production',
				expectedPublicRuntime: publicRuntime
			})
		).toThrow(/top-level entries are not exact/);

		const changed = artifact('normal');
		writeFileSync(join(changed, 'pages/_worker.js'), 'export default { fetch() { return 1 } };\n');
		expect(() =>
			validatePagesReleaseArtifact({
				artifactRoot: changed,
				expectedSourceSha: sourceSha,
				expectedTrustedGateSha: trustedGateSha,
				expectedMode: 'normal',
				expectedBranch: 'production',
				expectedPublicRuntime: publicRuntime
			})
		).toThrow(/does not match the canonical Worker bytes/);
	});

	it('rejects forged T provenance, same-runner finalization, and metadata smuggling', () => {
		for (const mutate of [
			(metadata: Record<string, unknown>) => (metadata.trustedGateSha = 'e'.repeat(40)),
			(metadata: Record<string, unknown>) =>
				(metadata.finalizationBoundary = 'candidate-same-runner-finalization'),
			(metadata: Record<string, unknown>) => (metadata.candidateApproved = true)
		]) {
			const root = artifact('normal');
			const metadataPath = join(root, 'release-metadata.json');
			const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
			mutate(metadata);
			writeFileSync(metadataPath, JSON.stringify(metadata));
			expect(() =>
				validatePagesReleaseArtifact({
					artifactRoot: root,
					expectedSourceSha: sourceSha,
					expectedTrustedGateSha: trustedGateSha,
					expectedMode: 'normal',
					expectedBranch: 'production',
					expectedPublicRuntime: publicRuntime
				})
			).toThrow();
		}
	});
});
