#!/usr/bin/env node

/**
 * The tracked tree must be self-contained. A tracked source file may only
 * import modules that are themselves tracked; an import that resolves solely to
 * an untracked working-tree file builds on the author's machine and fails on a
 * clean checkout.
 *
 * Exactly one class is reported: the specifier resolves to a real file on disk
 * AND that file is absent from the tracked set. Specifiers that resolve to
 * nothing, and bare package specifiers, are silently skipped — widening the
 * report to "module not found" duplicates the type checker and fires on
 * build-time virtual modules.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCANNED_ROOTS = Object.freeze(['convex/', 'scripts/', 'src/', 'tests/', 'workers/']);
const SCANNED_FILE = /\.(?:js|mjs|svelte|ts)$/;
/** Path aliases are hard-wired to the resolver declared in svelte.config.js. */
const ALIASES = Object.freeze([
	Object.freeze(['$lib/', 'src/lib/']),
	Object.freeze(['$convex/', 'convex/'])
]);
/** Framework-virtual namespaces: resolved by the bundler, never a tracked file. */
const VIRTUAL_PREFIXES = Object.freeze(['$app/', '$env/']);
const VIRTUAL_SPECIFIERS = Object.freeze(new Set(['$service-worker']));
/** Codegen output; the generator is tracked, the emitted modules are not. */
const GENERATED_SEGMENT = '_generated';
/** Route type shims emitted by `svelte-kit sync`. */
const GENERATED_BASENAME = '$types';
const CANDIDATE_SUFFIXES = Object.freeze([
	'',
	'.ts',
	'.js',
	'.mjs',
	'.svelte',
	'.d.ts',
	'.json',
	'/index.ts',
	'/index.js'
]);
/**
 * One pass covers `import … from`, `export … from`, dynamic `import(…)` and
 * bare `import '…'`. Dynamic precedes bare so the parenthesised form wins at
 * the same start offset.
 */
const SPECIFIER_PATTERN =
	/\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)|\bimport\s*['"]([^'"\n]+)['"]/g;
const GIT_LIST_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * @typedef {object} UntrackedImportEdge
 * @property {string} importer Repo-relative path of the tracked file.
 * @property {string} specifier The specifier exactly as written in source.
 * @property {string} resolved Repo-relative path of the untracked target.
 */

/** @param {string} source @returns {Set<string>} */
function specifiersIn(source) {
	/** @type {Set<string>} */
	const specifiers = new Set();
	for (const match of source.matchAll(SPECIFIER_PATTERN)) {
		specifiers.add(match[1] ?? match[2] ?? match[3]);
	}
	return specifiers;
}

/** @param {string} specifier @returns {string} */
function withoutQuery(specifier) {
	const query = specifier.indexOf('?');
	return query < 0 ? specifier : specifier.slice(0, query);
}

/** @param {string} specifier @returns {boolean} */
function isVirtual(specifier) {
	const bare = withoutQuery(specifier);
	if (VIRTUAL_SPECIFIERS.has(bare)) return true;
	if (VIRTUAL_PREFIXES.some((prefix) => bare.startsWith(prefix))) return true;
	const segments = bare.split('/');
	return segments.includes(GENERATED_SEGMENT) || segments.at(-1) === GENERATED_BASENAME;
}

/**
 * Repo-relative resolution base, or null for bare package specifiers and any
 * path that would escape the repository root.
 * @param {string} importer @param {string} specifier @returns {string | null}
 */
function resolutionBase(importer, specifier) {
	const bare = withoutQuery(specifier);
	if (!bare) return null;
	/** @type {string | null} */
	let base = null;
	for (const [prefix, replacement] of ALIASES) {
		if (bare.startsWith(prefix)) base = replacement + bare.slice(prefix.length);
	}
	if (base === null && (bare.startsWith('./') || bare.startsWith('../'))) {
		base = path.posix.join(path.posix.dirname(importer), bare);
	}
	if (base === null) return null;
	const normalized = path.posix.normalize(base);
	return normalized.startsWith('../') ? null : normalized;
}

/** @param {string} base @returns {string[]} */
function candidatesFor(base) {
	const candidates = CANDIDATE_SUFFIXES.map((suffix) => base + suffix);
	// TypeScript sources spell sibling imports with the emitted `.js` extension.
	if (base.endsWith('.js')) candidates.push(`${base.slice(0, -'.js'.length)}.ts`);
	return candidates;
}

/** @param {string} root @returns {(relativePath: string) => string} */
function fileReader(root) {
	return (relativePath) => {
		try {
			return fs.readFileSync(path.join(root, relativePath), 'utf8');
		} catch {
			return '';
		}
	};
}

/** @param {string} root @returns {(relativePath: string) => boolean} */
function existenceProbe(root) {
	/** @type {Map<string, boolean>} */
	const cache = new Map();
	return (relativePath) => {
		const cached = cache.get(relativePath);
		if (cached !== undefined) return cached;
		const present =
			fs.statSync(path.join(root, relativePath), { throwIfNoEntry: false })?.isFile() ?? false;
		cache.set(relativePath, present);
		return present;
	};
}

/** @param {UntrackedImportEdge} a @param {UntrackedImportEdge} b @returns {number} */
function byImporterThenSpecifier(a, b) {
	if (a.importer !== b.importer) return a.importer < b.importer ? -1 : 1;
	if (a.specifier !== b.specifier) return a.specifier < b.specifier ? -1 : 1;
	return 0;
}

/**
 * @param {object} options
 * @param {string} [options.root] Repository root for the default fs accessors.
 * @param {Iterable<string>} options.trackedFiles Repo-relative tracked paths.
 * @param {(relativePath: string) => string} [options.readFile] Source reader.
 * @param {(relativePath: string) => boolean} [options.fileExists] Disk probe.
 * @returns {UntrackedImportEdge[]} Deterministically sorted edges.
 */
export function scanTreeSelfContainment({
	root = process.cwd(),
	trackedFiles,
	readFile,
	fileExists
}) {
	const tracked = trackedFiles instanceof Set ? trackedFiles : new Set(trackedFiles);
	const read = readFile ?? fileReader(root);
	const exists = fileExists ?? existenceProbe(root);
	/** @type {UntrackedImportEdge[]} */
	const edges = [];
	for (const importer of tracked) {
		if (!SCANNED_FILE.test(importer)) continue;
		if (!SCANNED_ROOTS.some((prefix) => importer.startsWith(prefix))) continue;
		const source = read(importer);
		if (!source) continue;
		for (const specifier of specifiersIn(source)) {
			if (isVirtual(specifier)) continue;
			const base = resolutionBase(importer, specifier);
			if (base === null) continue;
			const resolved = candidatesFor(base).find(exists);
			if (resolved === undefined || tracked.has(resolved)) continue;
			edges.push({ importer, specifier, resolved });
		}
	}
	return edges.sort(byImporterThenSpecifier);
}

/** @param {string} root @returns {Set<string>} */
function trackedPaths(root) {
	const listing = execFileSync('git', ['ls-files', '-z'], {
		cwd: root,
		maxBuffer: GIT_LIST_MAX_BUFFER
	}).toString('utf8');
	return new Set(listing.split('\0').filter((entry) => entry.length > 0));
}

/** @param {string} manifestPath @returns {string[]} */
function manifestPaths(manifestPath) {
	return fs
		.readFileSync(manifestPath, 'utf8')
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** @param {string[]} [argv] @returns {number} Process exit code. */
export function main(argv = process.argv.slice(2)) {
	const root = process.cwd();
	const tracked = trackedPaths(root);
	const manifestFlag = argv.indexOf('--manifest');
	if (manifestFlag >= 0) {
		const manifestPath = argv[manifestFlag + 1];
		if (!manifestPath) throw new Error('--manifest requires a path.');
		for (const entry of manifestPaths(manifestPath)) tracked.add(entry);
	}
	const edges = scanTreeSelfContainment({ root, trackedFiles: tracked });
	if (argv.includes('--json')) {
		console.log(JSON.stringify(edges, null, 2));
		return edges.length > 0 ? 3 : 0;
	}
	if (edges.length === 0) {
		console.log('Tracked-tree self-containment passed: every resolved import is tracked.');
		return 0;
	}
	for (const edge of edges) {
		console.log(`${edge.importer} -> ${edge.specifier} (${edge.resolved})`);
	}
	console.log(`${edges.length} tracked import(s) resolve to untracked files.`);
	return 3;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
