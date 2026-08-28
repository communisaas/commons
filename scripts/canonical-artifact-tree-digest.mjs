#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
	chmodSync,
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const CANONICAL_ARTIFACT_DIRECTORY_MODE = 0o755;
export const CANONICAL_ARTIFACT_FILE_MODE = 0o644;
export const CANONICAL_ARTIFACT_MODE_POLICY = 'directories-0755-files-0644';

const DIGEST_DOMAIN = Buffer.from('commons-canonical-release-artifact-tree-v1\0', 'utf8');
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_FILES = 20_000;
const MAX_DIRECTORIES = 4_000;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 32;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} value */
function assertSafePathSegment(value) {
	invariant(
		value.length > 0 &&
			value !== '.' &&
			value !== '..' &&
			!value.includes('/') &&
			!value.includes('\\') &&
			!/\p{Cc}/u.test(value),
		`Canonical artifact contains an unsafe path segment: ${JSON.stringify(value)}.`
	);
}

/** @param {number} mode */
function permissionMode(mode) {
	return mode & 0o7777;
}

/** @param {string} root */
function inventoryArtifactTree(root) {
	invariant(typeof root === 'string' && root.length > 0, 'Artifact root is required.');
	const requestedRoot = path.resolve(root);
	const requestedStat = lstatSync(requestedRoot);
	invariant(!requestedStat.isSymbolicLink(), 'Artifact root cannot be a symbolic link.');
	invariant(requestedStat.isDirectory(), 'Artifact root must be a directory.');
	const absoluteRoot = realpathSync(requestedRoot);
	const rootStat = lstatSync(absoluteRoot);
	invariant(rootStat.isDirectory(), 'Canonical artifact root must resolve to a directory.');

	/** @type {Array<{type: 'directory'|'file', absolute: string, relative: string, mode: number, size: number}>} */
	const entries = [
		{
			type: 'directory',
			absolute: absoluteRoot,
			relative: '.',
			mode: permissionMode(rootStat.mode),
			size: 0
		}
	];
	/** @type {Array<{absolute: string, relative: string, depth: number}>} */
	const pending = [{ absolute: absoluteRoot, relative: '', depth: 0 }];
	let files = 0;
	let directories = 1;
	let bytes = 0;

	while (pending.length > 0) {
		const directory = pending.pop();
		invariant(directory, 'Canonical artifact traversal failed.');
		invariant(directory.depth <= MAX_DEPTH, 'Canonical artifact exceeds the depth limit.');
		const children = readdirSync(directory.absolute, { withFileTypes: true }).sort((left, right) =>
			Buffer.from(left.name).compare(Buffer.from(right.name))
		);
		for (const child of children) {
			assertSafePathSegment(child.name);
			const relative = directory.relative ? `${directory.relative}/${child.name}` : child.name;
			const absolute = path.join(directory.absolute, child.name);
			const stat = lstatSync(absolute);
			invariant(!stat.isSymbolicLink(), `Canonical artifact forbids symbolic links: ${relative}.`);
			if (stat.isDirectory()) {
				directories += 1;
				invariant(
					directories <= MAX_DIRECTORIES,
					'Canonical artifact exceeds the directory-count limit.'
				);
				entries.push({
					type: 'directory',
					absolute,
					relative,
					mode: permissionMode(stat.mode),
					size: 0
				});
				pending.push({ absolute, relative, depth: directory.depth + 1 });
				continue;
			}
			invariant(stat.isFile(), `Canonical artifact forbids special files: ${relative}.`);
			invariant(stat.size <= MAX_FILE_BYTES, `Canonical artifact file exceeds limit: ${relative}.`);
			files += 1;
			bytes += stat.size;
			invariant(files <= MAX_FILES, 'Canonical artifact exceeds the file-count limit.');
			invariant(bytes <= MAX_TOTAL_BYTES, 'Canonical artifact exceeds the total-byte limit.');
			entries.push({
				type: 'file',
				absolute,
				relative,
				mode: permissionMode(stat.mode),
				size: stat.size
			});
		}
	}

	entries.sort((left, right) => Buffer.from(left.relative).compare(Buffer.from(right.relative)));
	return { root: absoluteRoot, entries, files, directories, bytes };
}

/** @param {number} value */
function uint32(value) {
	const bytes = Buffer.alloc(4);
	bytes.writeUInt32BE(value);
	return bytes;
}

/** @param {number} value */
function uint64(value) {
	invariant(Number.isSafeInteger(value) && value >= 0, 'Canonical artifact length is invalid.');
	const bytes = Buffer.alloc(8);
	bytes.writeBigUInt64BE(BigInt(value));
	return bytes;
}

/** @param {import('node:crypto').Hash} hash @param {'directory'|'file'} type @param {string} relative @param {number} mode @param {number} size */
function hashEntryHeader(hash, type, relative, mode, size) {
	const pathBytes = Buffer.from(relative, 'utf8');
	hash.update(type === 'directory' ? Buffer.from([0x44]) : Buffer.from([0x46]));
	hash.update(uint32(pathBytes.byteLength));
	hash.update(pathBytes);
	hash.update(uint32(mode));
	hash.update(uint64(size));
}

/** @param {{absolute: string, relative: string, mode: number, size: number}} entry */
function readStableFile(entry) {
	const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
	const descriptor = openSync(entry.absolute, constants.O_RDONLY | noFollow);
	try {
		const before = fstatSync(descriptor, { bigint: true });
		invariant(before.isFile(), `Canonical artifact entry changed type: ${entry.relative}.`);
		invariant(
			Number(before.size) === entry.size && Number(before.mode & 0o7777n) === entry.mode,
			`Canonical artifact entry changed before hashing: ${entry.relative}.`
		);
		const contents = readFileSync(descriptor);
		const after = fstatSync(descriptor, { bigint: true });
		invariant(
			before.dev === after.dev &&
				before.ino === after.ino &&
				before.size === after.size &&
				before.mode === after.mode &&
				before.mtimeNs === after.mtimeNs &&
				before.ctimeNs === after.ctimeNs &&
				contents.byteLength === entry.size,
			`Canonical artifact entry changed while hashing: ${entry.relative}.`
		);
		return contents;
	} finally {
		closeSync(descriptor);
	}
}

/**
 * Normalize the only permission modes preserved by GitHub artifact transport.
 * Builders run this before hashing/upload; deploy recomputes without mutating.
 * @param {string} root
 */
export function normalizeCanonicalArtifactModes(root) {
	const inventory = inventoryArtifactTree(root);
	for (const entry of inventory.entries.filter((candidate) => candidate.type === 'file')) {
		chmodSync(entry.absolute, CANONICAL_ARTIFACT_FILE_MODE);
	}
	for (const entry of inventory.entries
		.filter((candidate) => candidate.type === 'directory')
		.sort((left, right) => right.relative.length - left.relative.length)) {
		chmodSync(entry.absolute, CANONICAL_ARTIFACT_DIRECTORY_MODE);
	}
	return {
		root: inventory.root,
		files: inventory.files,
		directories: inventory.directories,
		modePolicy: CANONICAL_ARTIFACT_MODE_POLICY
	};
}

/**
 * @param {string} root
 * @param {{requireTransportSafeModes?: boolean}} [options]
 */
export function canonicalArtifactTreeDigest(root, { requireTransportSafeModes = true } = {}) {
	const inventory = inventoryArtifactTree(root);
	const hash = createHash('sha256');
	hash.update(DIGEST_DOMAIN);
	for (const entry of inventory.entries) {
		const expectedMode =
			entry.type === 'directory' ? CANONICAL_ARTIFACT_DIRECTORY_MODE : CANONICAL_ARTIFACT_FILE_MODE;
		if (requireTransportSafeModes) {
			invariant(
				entry.mode === expectedMode,
				`Canonical artifact ${entry.relative} mode must be ${expectedMode.toString(8)} before hashing.`
			);
		}
		hashEntryHeader(hash, entry.type, entry.relative, entry.mode, entry.size);
		if (entry.type === 'file') hash.update(readStableFile(entry));
	}
	return {
		schemaVersion: 1,
		algorithm: 'sha256',
		digest: hash.digest('hex'),
		files: inventory.files,
		directories: inventory.directories,
		bytes: inventory.bytes,
		modePolicy: CANONICAL_ARTIFACT_MODE_POLICY
	};
}

/** @param {{artifactRoot: string, expectedDigest: string, requireTransportSafeModes?: boolean}} input */
export function verifyCanonicalArtifactTreeDigest({
	artifactRoot,
	expectedDigest,
	requireTransportSafeModes = true
}) {
	invariant(
		typeof expectedDigest === 'string' && SHA256_RE.test(expectedDigest),
		'Expected artifact digest must be one lowercase SHA-256.'
	);
	const result = canonicalArtifactTreeDigest(artifactRoot, { requireTransportSafeModes });
	invariant(result.digest === expectedDigest, 'Canonical artifact tree digest does not match.');
	return result;
}

/** @param {string[]} argv */
export function parseCanonicalArtifactDigestArgs(argv) {
	let artifactRoot;
	let expectedDigest;
	let normalizeModes = false;
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		if (flag === '--normalize-modes') {
			invariant(!normalizeModes, '--normalize-modes may be supplied only once.');
			normalizeModes = true;
			continue;
		}
		invariant(
			flag === '--artifact-root' || flag === '--expected-digest',
			`Unknown argument: ${flag}`
		);
		const value = argv[index + 1];
		invariant(value !== undefined && !value.startsWith('--'), `${flag} requires a value.`);
		if (flag === '--artifact-root') {
			invariant(artifactRoot === undefined, '--artifact-root may be supplied only once.');
			artifactRoot = value;
		} else {
			invariant(expectedDigest === undefined, '--expected-digest may be supplied only once.');
			expectedDigest = value;
		}
		index += 1;
	}
	invariant(artifactRoot !== undefined, '--artifact-root is required.');
	return { artifactRoot, expectedDigest, normalizeModes };
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const options = parseCanonicalArtifactDigestArgs(process.argv.slice(2));
		if (options.normalizeModes) normalizeCanonicalArtifactModes(options.artifactRoot);
		const result = options.expectedDigest
			? verifyCanonicalArtifactTreeDigest({
					artifactRoot: options.artifactRoot,
					expectedDigest: options.expectedDigest
				})
			: canonicalArtifactTreeDigest(options.artifactRoot);
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
