import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	parseReleaseCandidateLockfileArgs,
	verifyReleaseCandidateDependencyAuthority
} from '../../../scripts/verify-release-candidate-lockfile.mjs';

const roots: string[] = [];

function authority(overrides?: (lock: Record<string, any>, manifest: Record<string, any>) => void) {
	const root = mkdtempSync(join(tmpdir(), 'commons-release-lock-'));
	roots.push(root);
	const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
	const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
	overrides?.(lock, manifest);
	const packageJsonPath = join(root, 'package.json');
	const lockfilePath = join(root, 'package-lock.json');
	const npmrcPath = join(root, '.npmrc');
	writeFileSync(packageJsonPath, JSON.stringify(manifest));
	writeFileSync(lockfilePath, JSON.stringify(lock));
	writeFileSync(npmrcPath, 'engine-strict=false\nlegacy-peer-deps=true\n');
	return { packageJsonPath, lockfilePath, npmrcPath };
}

afterEach(() => {
	while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('trusted candidate dependency authority', () => {
	it('accepts the exact registry-only SHA-512 npm lock closure', () => {
		const result = verifyReleaseCandidateDependencyAuthority(authority());
		expect(result.policy).toBe('npm-ci-ignore-scripts-registry-sha512-v1');
		expect(result.packages).toBeGreaterThan(100);
		expect(result.lockfileSha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it.each([
		['link', (entry: Record<string, any>) => (entry.link = true)],
		['git source', (entry: Record<string, any>) => (entry.resolved = 'git+https://evil.invalid/pkg.git')],
		['file source', (entry: Record<string, any>) => (entry.resolved = 'file:../payload')],
		['weak integrity', (entry: Record<string, any>) => (entry.integrity = 'sha1-deadbeef')],
		['truncated SHA-512', (entry: Record<string, any>) => (entry.integrity = 'sha512-YQ==')]
	])('rejects a %s before npm can materialize candidate dependencies', (_label, mutate) => {
		const input = authority((lock) => {
			const key = Object.keys(lock.packages).find((candidate) => candidate !== '')!;
			mutate(lock.packages[key]);
		});
		expect(() => verifyReleaseCandidateDependencyAuthority(input)).toThrow();
	});

	it('rejects node_modules traversal disguised as a lock package path', () => {
		const input = authority((lock) => {
			const key = Object.keys(lock.packages).find((candidate) => candidate !== '')!;
			const entry = lock.packages[key];
			delete lock.packages[key];
			lock.packages['node_modules/../node_modules/escape'] = entry;
		});
		expect(() => verifyReleaseCandidateDependencyAuthority(input)).toThrow(/unsafe package name/);
	});

	it('rejects workspace traversal and candidate-controlled npm policy', () => {
		const workspace = authority((_lock, manifest) => {
			manifest.workspaces = ['../outside'];
		});
		expect(() => verifyReleaseCandidateDependencyAuthority(workspace)).toThrow(/workspaces/);

		const npmrc = authority();
		writeFileSync(npmrc.npmrcPath, 'registry=https://evil.invalid/\n');
		expect(() => verifyReleaseCandidateDependencyAuthority(npmrc)).toThrow(/exact trusted/);
	});

	it('accepts only the three fixed CLI authorities', () => {
		expect(
			parseReleaseCandidateLockfileArgs([
				'--package-json',
				'package.json',
				'--lockfile',
				'package-lock.json',
				'--npmrc',
				'.npmrc'
			])
		).toEqual({
			packageJsonPath: 'package.json',
			lockfilePath: 'package-lock.json',
			npmrcPath: '.npmrc'
		});
		expect(() =>
			parseReleaseCandidateLockfileArgs([
				'--package-json',
				'package.json',
				'--lockfile',
				'package-lock.json',
				'--npmrc',
				'.npmrc',
				'--allow-git',
				'1'
			])
		).toThrow();
	});
});
