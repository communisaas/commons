import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY,
	PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD,
	finalizePublicTemplateOgReleaseArtifact,
	validateFinalizedPublicTemplateOgArtifact,
	validatePublicTemplateOgMetafile
} from '../../../scripts/finalize-public-template-og-release-artifact.mjs';
import { validatePublicTemplateOgSourceConfig } from '../../../scripts/verify-public-template-og-deployment.mjs';

const roots: string[] = [];

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'commons-og-release-test-'));
	roots.push(root);
	const artifactRoot = join(root, 'artifact');
	mkdirSync(artifactRoot);
	writeFileSync(
		join(artifactRoot, 'release-metadata.json'),
		`${JSON.stringify({ schemaVersion: 1, mode: 'normal' })}\n`
	);
	return { root, artifactRoot };
}

function finalize(artifactRoot: string) {
	return finalizePublicTemplateOgReleaseArtifact({
		artifactRoot,
		candidateRoot: '.',
		candidateConfig: 'wrangler.public-template-og.toml',
		trustedConfig: 'wrangler.public-template-og.toml',
		wranglerPackageRoot: '.github/release-gate/node_modules/wrangler',
		wranglerLockfile: '.github/release-gate/package-lock.json'
	});
}

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('trusted public-template OG release artifact', () => {
	it('pins both isolated realms, private routes, one-message batches, and two retries', () => {
		const source = readFileSync('wrangler.public-template-og.toml', 'utf8');
		expect(validatePublicTemplateOgSourceConfig(source).production).toMatchObject({
			worker: 'commons-public-template-og',
			queue: 'commons-public-template-og',
			deadLetterQueue: 'commons-public-template-og-dlq'
		});
		expect(source.match(/max_batch_size = 1/g)).toHaveLength(2);
		expect(source.match(/max_retries = 2/g)).toHaveLength(2);
		expect(source.match(/cpu_ms = 100/g)).toHaveLength(2);
		expect(source).toContain('workers_dev = false');
		expect(source).toContain('preview_urls = false');
		expect(() =>
			validatePublicTemplateOgSourceConfig(source.replace('max_retries = 2', 'max_retries = 5'))
		).toThrow(/does not match/i);
		expect(() =>
			validatePublicTemplateOgSourceConfig(source.replace('cpu_ms = 100', 'cpu_ms = 101'))
		).toThrow(/does not match/i);
	});

	it(
		'uses pinned Wrangler to emit one deterministic self-contained inert module',
		() => {
			const primary = fixture();
			const replica = fixture();
			const first = finalize(primary.artifactRoot);
			const second = finalize(replica.artifactRoot);
			expect(first.bundle.gzipBytes).toBeLessThan(128 * 1024);
			expect(first.bundle.sha256).toBe(second.bundle.sha256);
			expect(
				readFileSync(
					join(primary.artifactRoot, PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY, 'index.js')
				)
			).toEqual(
				readFileSync(
					join(replica.artifactRoot, PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY, 'index.js')
				)
			);
			expect(
				readFileSync(join(primary.artifactRoot, PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD))
			).toEqual(
				readFileSync(join(replica.artifactRoot, PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD))
			);
			expect(
				validateFinalizedPublicTemplateOgArtifact(
					primary.artifactRoot,
					'wrangler.public-template-og.toml'
				)
			).toEqual(first);
		},
		30_000
	);

	it('rejects record/config drift and candidate paths outside the inert checkout', () => {
		const input = fixture();
		finalize(input.artifactRoot);
		const driftedConfig = join(input.root, 'wrangler.toml');
		writeFileSync(
			driftedConfig,
			readFileSync('wrangler.public-template-og.toml', 'utf8').replace(
				'commons-public-template-og-dlq',
				'untrusted-dlq'
			)
		);
		expect(() =>
			validateFinalizedPublicTemplateOgArtifact(input.artifactRoot, driftedConfig)
		).toThrow();
		expect(() =>
			validatePublicTemplateOgMetafile(
				{
					inputs: { '../outside.ts': {} },
					outputs: {
						'.wrangler/tmp/public-template-og-consumer.js': {
							entryPoint: 'workers/public-template-og-consumer.ts',
							imports: []
						}
					}
				},
				'.'
			)
		).toThrow(/unsafe input path/i);
	});
});
