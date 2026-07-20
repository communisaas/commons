#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_PACKAGE_JSON_BYTES = 2 * 1024 * 1024;
const MAX_LOCKFILE_BYTES = 32 * 1024 * 1024;
const MAX_NPMRC_BYTES = 1024;
const EXPECTED_NPMRC = 'engine-strict=false\nlegacy-peer-deps=true\n';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} filePath @param {number} maximumBytes @param {string} label */
function readBoundedOrdinaryFile(filePath, maximumBytes, label) {
	const requested = path.resolve(filePath);
	const stat = lstatSync(requested);
	invariant(!stat.isSymbolicLink() && stat.isFile(), `${label} must be an ordinary file.`);
	invariant(stat.size > 0 && stat.size <= maximumBytes, `${label} has an invalid byte length.`);
	return readFileSync(requested);
}

/** @param {unknown} value @param {string} label @returns {Record<string,unknown>} */
function dependencyMap(value, label) {
	if (value === undefined) return {};
	invariant(
		value !== null && typeof value === 'object' && !Array.isArray(value),
		`${label} must be an object.`
	);
	for (const [name, specifier] of Object.entries(value)) {
		invariant(typeof name === 'string' && name.length > 0, `${label} contains an invalid name.`);
		invariant(
			typeof specifier === 'string' && specifier.length > 0,
			`${label}.${name} has an invalid specifier.`
		);
		invariant(
			!/(?:^|:)(?:file|git|github|gitlab|bitbucket|http|https):/iu.test(specifier) &&
				!specifier.startsWith('.') &&
				!specifier.startsWith('/') &&
				!specifier.startsWith('workspace:'),
			`${label}.${name} uses a non-registry dependency source.`
		);
	}
	return /** @type {Record<string,unknown>} */ (value);
}

/** @param {Record<string, unknown>} left @param {Record<string, unknown>} right @param {string} label */
function assertSameDependencyMap(left, right, label) {
	const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
	const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
	invariant(
		JSON.stringify(leftEntries) === JSON.stringify(rightEntries),
		`${label} differs between package.json and package-lock.json.`
	);
}

/** @param {string} segment */
function isSafeRegistryNameSegment(segment) {
	return (
		segment.length > 0 &&
		segment.length <= 214 &&
		segment !== '.' &&
		segment !== '..' &&
		!/[\\/%:@\s\p{Cc}]/u.test(segment)
	);
}

/** @param {string} packagePath */
function assertSafeLockPackagePath(packagePath) {
	const segments = packagePath.split('/');
	let index = 0;
	while (index < segments.length) {
		invariant(
			segments[index] === 'node_modules',
			`Candidate lock entry has an unsafe package path: ${packagePath}.`
		);
		index += 1;
		invariant(
			index < segments.length,
			`Candidate lock package path is incomplete: ${packagePath}.`
		);
		if (segments[index].startsWith('@')) {
			invariant(
				isSafeRegistryNameSegment(segments[index].slice(1)),
				`Candidate lock entry has an unsafe package scope: ${packagePath}.`
			);
			index += 1;
			invariant(
				index < segments.length,
				`Candidate lock scoped package path is incomplete: ${packagePath}.`
			);
		}
		invariant(
			isSafeRegistryNameSegment(segments[index]),
			`Candidate lock entry has an unsafe package name: ${packagePath}.`
		);
		index += 1;
	}
}

/** @param {unknown} integrity @param {string} packagePath */
function assertExactSha512Integrity(integrity, packagePath) {
	invariant(
		typeof integrity === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/u.test(integrity),
		`Candidate lock entry ${packagePath} must have one SHA-512 integrity.`
	);
	const encoded = integrity.slice('sha512-'.length);
	const digest = Buffer.from(encoded, 'base64');
	invariant(
		digest.byteLength === 64 && digest.toString('base64') === encoded,
		`Candidate lock entry ${packagePath} must have one canonical SHA-512 integrity.`
	);
}

/**
 * Prove that a fresh `npm ci --ignore-scripts` can only materialize
 * integrity-pinned registry tarballs. Candidate lifecycle code never runs in
 * the trusted finalization job.
 *
 * @param {{packageJsonPath:string;lockfilePath:string;npmrcPath:string}} options
 */
export function verifyReleaseCandidateDependencyAuthority({
	packageJsonPath,
	lockfilePath,
	npmrcPath
}) {
	const packageBytes = readBoundedOrdinaryFile(
		packageJsonPath,
		MAX_PACKAGE_JSON_BYTES,
		'Candidate package.json'
	);
	const lockfileBytes = readBoundedOrdinaryFile(
		lockfilePath,
		MAX_LOCKFILE_BYTES,
		'Candidate package-lock.json'
	);
	const npmrcBytes = readBoundedOrdinaryFile(npmrcPath, MAX_NPMRC_BYTES, 'Candidate .npmrc');
	invariant(
		npmrcBytes.toString('utf8') === EXPECTED_NPMRC,
		'Candidate .npmrc is not the exact trusted inert-install policy.'
	);

	const packageJson = JSON.parse(packageBytes.toString('utf8'));
	const lockfile = JSON.parse(lockfileBytes.toString('utf8'));
	invariant(
		packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson),
		'Candidate package.json must be an object.'
	);
	invariant(
		!Object.prototype.hasOwnProperty.call(packageJson, 'workspaces'),
		'Candidate package.json must not declare workspaces.'
	);
	invariant(lockfile?.lockfileVersion === 3, 'Candidate lockfileVersion must be exactly 3.');
	invariant(
		lockfile.requires === true,
		'Candidate package lock must require its complete dependency graph.'
	);
	invariant(
		lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages),
		'Candidate package lock must contain one packages authority.'
	);

	const root = /** @type {Record<string, unknown>} */ (lockfile.packages['']);
	invariant(
		root && typeof root === 'object' && !Array.isArray(root),
		'Candidate package lock is missing its root package.'
	);
	for (const field of [
		'dependencies',
		'devDependencies',
		'optionalDependencies',
		'peerDependencies'
	]) {
		const manifestMap = dependencyMap(packageJson[field], `package.json ${field}`);
		const lockMap = dependencyMap(root[field], `package-lock.json root ${field}`);
		assertSameDependencyMap(manifestMap, lockMap, field);
	}

	let packageCount = 0;
	for (const [packagePath, entry] of Object.entries(lockfile.packages)) {
		invariant(
			entry && typeof entry === 'object' && !Array.isArray(entry),
			`Candidate lock entry ${packagePath || '<root>'} must be an object.`
		);
		invariant(
			entry.link !== true,
			`Candidate lock entry ${packagePath || '<root>'} must not be a link.`
		);
		if (packagePath === '') continue;
		assertSafeLockPackagePath(packagePath);
		invariant(
			typeof entry.version === 'string' && entry.version.length > 0,
			`Candidate lock entry ${packagePath} has no exact version.`
		);
		invariant(
			typeof entry.resolved === 'string',
			`Candidate lock entry ${packagePath} has no registry tarball.`
		);
		let resolved;
		try {
			resolved = new URL(entry.resolved);
		} catch {
			throw new Error(`Candidate lock entry ${packagePath} has an invalid resolved URL.`);
		}
		invariant(
			resolved.protocol === 'https:' &&
				resolved.hostname === 'registry.npmjs.org' &&
				resolved.port === '' &&
				resolved.username === '' &&
				resolved.password === '' &&
				resolved.search === '' &&
				resolved.hash === '' &&
				resolved.pathname.startsWith('/') &&
				resolved.pathname.endsWith('.tgz'),
			`Candidate lock entry ${packagePath} is not an exact npm registry tarball.`
		);
		assertExactSha512Integrity(entry.integrity, packagePath);
		packageCount += 1;
	}
	invariant(
		packageCount > 0 && packageCount <= 20_000,
		'Candidate dependency package count is outside the release bound.'
	);
	return {
		schemaVersion: 1,
		policy: 'npm-ci-ignore-scripts-registry-sha512-v1',
		packages: packageCount,
		packageJsonSha256: createHash('sha256').update(packageBytes).digest('hex'),
		lockfileSha256: createHash('sha256').update(lockfileBytes).digest('hex')
	};
}

/** @param {string[]} argv */
export function parseReleaseCandidateLockfileArgs(argv) {
	const accepted = new Set(['--package-json', '--lockfile', '--npmrc']);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			accepted.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Unknown, duplicate, or valueless argument: ${String(flag)}.`
		);
		values.set(flag, value);
	}
	invariant(
		values.size === accepted.size,
		'All candidate dependency authority arguments are required.'
	);
	return {
		packageJsonPath: /** @type {string} */ (values.get('--package-json')),
		lockfilePath: /** @type {string} */ (values.get('--lockfile')),
		npmrcPath: /** @type {string} */ (values.get('--npmrc'))
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		console.log(
			JSON.stringify(
				verifyReleaseCandidateDependencyAuthority(
					parseReleaseCandidateLockfileArgs(process.argv.slice(2))
				)
			)
		);
	} catch (error) {
		console.error(
			`Candidate dependency authority rejected: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exitCode = 1;
	}
}
