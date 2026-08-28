import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	CANONICAL_ARTIFACT_DIRECTORY_MODE,
	CANONICAL_ARTIFACT_FILE_MODE,
	canonicalArtifactTreeDigest,
	normalizeCanonicalArtifactModes,
	parseCanonicalArtifactDigestArgs,
	verifyCanonicalArtifactTreeDigest
} from '../../../scripts/canonical-artifact-tree-digest.mjs';

const roots: string[] = [];

function tempRoot(prefix = 'commons-artifact-digest-') {
	const root = mkdtempSync(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function writeTree(root: string, reverse = false) {
	const writes = [
		() => {
			mkdirSync(join(root, 'pages'));
			writeFileSync(join(root, 'pages/_worker.js'), 'export default { fetch() {} };\n');
		},
		() => writeFileSync(join(root, 'release-metadata.json'), '{"schemaVersion":1}\n')
	];
	for (const write of reverse ? writes.reverse() : writes) write();
}

function mode(pathname: string) {
	return lstatSync(pathname).mode & 0o7777;
}

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('canonical artifact tree digest', () => {
	it('is deterministic across creation order and ignores timestamps after transport-mode normalization', () => {
		const first = tempRoot();
		const second = tempRoot();
		writeTree(first);
		writeTree(second, true);
		chmodSync(first, 0o700);
		chmodSync(join(first, 'pages'), 0o711);
		chmodSync(join(first, 'pages/_worker.js'), 0o600);
		chmodSync(join(first, 'release-metadata.json'), 0o640);
		chmodSync(second, 0o777);
		chmodSync(join(second, 'pages'), 0o700);
		chmodSync(join(second, 'pages/_worker.js'), 0o755);

		expect(() => canonicalArtifactTreeDigest(first)).toThrow(/mode must be/i);
		normalizeCanonicalArtifactModes(first);
		normalizeCanonicalArtifactModes(second);
		const firstDigest = canonicalArtifactTreeDigest(first);
		const secondDigest = canonicalArtifactTreeDigest(second);
		expect(firstDigest.digest).toBe(secondDigest.digest);
		expect(firstDigest).toMatchObject({
			algorithm: 'sha256',
			files: 2,
			directories: 2,
			modePolicy: 'directories-0755-files-0644'
		});
		expect(mode(first)).toBe(CANONICAL_ARTIFACT_DIRECTORY_MODE);
		expect(mode(join(first, 'pages'))).toBe(CANONICAL_ARTIFACT_DIRECTORY_MODE);
		expect(mode(join(first, 'pages/_worker.js'))).toBe(CANONICAL_ARTIFACT_FILE_MODE);
		expect(mode(join(first, 'release-metadata.json'))).toBe(CANONICAL_ARTIFACT_FILE_MODE);
	});

	it('covers relative path, permission mode, byte length, and raw file bytes', () => {
		const root = tempRoot();
		writeTree(root);
		normalizeCanonicalArtifactModes(root);
		const baseline = canonicalArtifactTreeDigest(root).digest;

		chmodSync(join(root, 'pages/_worker.js'), 0o755);
		const modeChanged = canonicalArtifactTreeDigest(root, {
			requireTransportSafeModes: false
		}).digest;
		expect(modeChanged).not.toBe(baseline);
		chmodSync(join(root, 'pages/_worker.js'), CANONICAL_ARTIFACT_FILE_MODE);

		writeFileSync(join(root, 'pages/_worker.js'), 'export default { fetch() { return 1; } };\n');
		const bytesAndLengthChanged = canonicalArtifactTreeDigest(root).digest;
		expect(bytesAndLengthChanged).not.toBe(baseline);

		writeFileSync(join(root, 'pages/_worker.js'), 'export default { fetch() { return 2; } };\n');
		const sameLengthDifferentBytes = canonicalArtifactTreeDigest(root).digest;
		expect(sameLengthDifferentBytes).not.toBe(bytesAndLengthChanged);

		const renamed = tempRoot();
		mkdirSync(join(renamed, 'other'));
		writeFileSync(join(renamed, 'other/_worker.js'), 'export default { fetch() {} };\n');
		writeFileSync(join(renamed, 'release-metadata.json'), '{"schemaVersion":1}\n');
		normalizeCanonicalArtifactModes(renamed);
		expect(canonicalArtifactTreeDigest(renamed).digest).not.toBe(baseline);
	});

	it('verifies one expected lowercase digest and rejects substitution', () => {
		const root = tempRoot();
		writeTree(root);
		normalizeCanonicalArtifactModes(root);
		const expectedDigest = canonicalArtifactTreeDigest(root).digest;
		expect(
			verifyCanonicalArtifactTreeDigest({ artifactRoot: root, expectedDigest }).digest
		).toBe(expectedDigest);
		expect(() =>
			verifyCanonicalArtifactTreeDigest({ artifactRoot: root, expectedDigest: '0'.repeat(64) })
		).toThrow(/does not match/i);
		expect(() =>
			verifyCanonicalArtifactTreeDigest({ artifactRoot: root, expectedDigest: 'A'.repeat(64) })
		).toThrow(/lowercase SHA-256/i);
	});

	it('rejects root and nested symbolic links before reading bytes', () => {
		const realRoot = tempRoot();
		writeTree(realRoot);
		const linkParent = tempRoot();
		const rootLink = join(linkParent, 'artifact');
		symlinkSync(realRoot, rootLink, 'dir');
		expect(() => canonicalArtifactTreeDigest(rootLink)).toThrow(/root cannot be a symbolic link/i);

		const nestedRoot = tempRoot();
		writeTree(nestedRoot);
		symlinkSync('/etc/passwd', join(nestedRoot, 'pages/leak'));
		expect(() => normalizeCanonicalArtifactModes(nestedRoot)).toThrow(/forbids symbolic links/i);
	});

	it('rejects special files rather than hashing device or stream state', () => {
		const root = tempRoot();
		writeTree(root);
		const fifo = join(root, 'pages/candidate-pipe');
		const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
		expect(created.status, created.stderr).toBe(0);
		expect(() => canonicalArtifactTreeDigest(root)).toThrow(/forbids special files/i);
	});

	it('parses normalization as an explicit builder-only operation', () => {
		expect(
			parseCanonicalArtifactDigestArgs([
				'--artifact-root',
				'artifact',
				'--normalize-modes',
				'--expected-digest',
				'a'.repeat(64)
			])
		).toEqual({
			artifactRoot: 'artifact',
			expectedDigest: 'a'.repeat(64),
			normalizeModes: true
		});
		expect(() =>
			parseCanonicalArtifactDigestArgs(['--artifact-root', 'a', '--artifact-root', 'b'])
		).toThrow(/only once/i);
	});
});
