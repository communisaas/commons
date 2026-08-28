#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	closeSync,
	constants,
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { isBuiltin } from 'node:module';

export const PINNED_PAGES_FINALIZER_WRANGLER_VERSION = '4.112.0';
export const PINNED_PAGES_FINALIZER_WRANGLER_RESOLVED =
	'https://registry.npmjs.org/wrangler/-/wrangler-4.112.0.tgz';
export const PINNED_PAGES_FINALIZER_WRANGLER_INTEGRITY =
	'sha512-5H+XUD0TySCv1LuktFHDIEOkboH2nTfQs+35L+USt3MtntjDTMVIJprLgQcL2WBjulOyjxpd1vyTiSTJVW5MjQ==';
export const PAGES_FINALIZER_COMPATIBILITY_DATE = '2025-04-01';
export const PAGES_FINALIZER_COMPATIBILITY_FLAGS = [
	'nodejs_compat',
	'nodejs_als',
	'global_fetch_strictly_public'
];
export const PAGES_WORKER_PLATFORM_GZIP_LIMIT_BYTES = 3_000_000;
export const PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES = 2_900_000;
export const PAGES_FINALIZATION_RECORD = 'pages-finalization.json';
export const TRUSTED_PAGES_CANDIDATE_ADAPTER_PATH =
	'workers/access-safe-sveltekit-pages-adapter.ts';
export const TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_RUNTIME_PATH =
	'src/lib/server/public-discovery-bootstrap-runtime.ts';
export const TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_PROTOCOL_PATH =
	'src/lib/server/public-discovery-bootstrap-protocol.mjs';
export const TRUSTED_PAGES_CANDIDATE_SOURCE_INPUT_PATHS = Object.freeze([
	TRUSTED_PAGES_CANDIDATE_ADAPTER_PATH,
	TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_RUNTIME_PATH,
	TRUSTED_PAGES_CANDIDATE_BOOTSTRAP_PROTOCOL_PATH
]);
export const TRUSTED_PAGES_CANDIDATE_ENTRY_ID = 'generated-access-safe-sveltekit-pages-v1';
export const TRUSTED_PAGES_ROUTES_FILE = '_routes.json';
export const TRUSTED_PAGES_ROUTES_SOURCE = '{"version":1,"include":["/*"],"exclude":[]}\n';
export const PAGES_DYNAMIC_PROOF_PATHS = Object.freeze([
	'/api/release-candidate',
	'/api/release-origin'
]);

const FINALIZER_NAME = 'trusted-wrangler-isolated-pages-candidate-v4';
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_RECORD_BYTES = 32 * 1024;
const ALLOWED_RUNTIME_MODULE_RE = /^(?:node:|cloudflare:|workerd:)[A-Za-z0-9_./-]+$/;
const PINNED_WRANGLER_NAMESPACE_INPUTS = new Set([
	'node-built-in-modules:buffer',
	'node-built-in-modules:crypto',
	'node-built-in-modules:fs',
	'node-built-in-modules:path',
	'node-built-in-modules:url',
	'required-unenv-alias:inherits'
]);
const PINNED_WRANGLER_PACKAGE_VIRTUAL_INPUTS = new Set([
	'_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console',
	'_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process'
]);
const PINNED_OPTIONAL_DEPENDENCY_STUBS = [
	{
		specifier: 'redis',
		filename: 'redis.mjs',
		source:
			'throw new Error("Optional dependency redis is unavailable in this canonical Pages artifact.");\nexport {};\n',
		compiledInput: 'output/server/chunks/rate-limiter.js',
		contractStart: '\tasync connect() {',
		contractEnd: '\n\tasync reserve',
		contractSha256: 'a7a3f92c0bfcd0ae03cf99e85d99ef96e20e80e832ba65ca6929444d25709310'
	},
	{
		specifier: '@voter-protocol/ai-evaluator',
		filename: 'ai-evaluator.mjs',
		source:
			'throw new Error("Optional dependency @voter-protocol/ai-evaluator is unavailable in this canonical Pages artifact.");\nexport {};\n',
		compiledInput: 'output/server/entries/endpoints/api/debates/_debateId_/evaluate/_server.ts.js',
		contractStart: '\t\tlet aiEvaluator;\n\t\ttry {',
		contractEnd: '\n\t\tlet modelConfigs;',
		contractSha256: '7a9e1a950fdf1181658a9ee0dc42394f0b8b6d1538d5326f78fc700c4bfdaacf'
	}
];

const DEFAULT_TRUSTED_SOURCE_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);

function createTrustedPagesCandidateEntrypoint() {
	return [
		"import { Server } from '../input/.svelte-kit/output/server/index.js';",
		"import { manifest, prerendered, base_path } from '../input/.svelte-kit/cloudflare-tmp/manifest.js';",
		"import { createAccessSafeSvelteKitPagesAdapter } from './access-safe-sveltekit-pages-adapter.ts';",
		'',
		'export default createAccessSafeSvelteKitPagesAdapter({',
		'\tServer,',
		'\tbasePath: base_path,',
		'\tmanifest,',
		'\tprerendered',
		'});',
		''
	].join('\n');
}

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} moduleName */
function isApprovedRuntimeModule(moduleName) {
	return (
		typeof moduleName === 'string' &&
		(ALLOWED_RUNTIME_MODULE_RE.test(moduleName) ||
			(/^[A-Za-z0-9_./-]+$/.test(moduleName) && isBuiltin(moduleName)))
	);
}

/** @param {unknown} value @param {string[]} keys @param {string} label */
function assertExactKeys(value, keys, label) {
	invariant(
		value !== null && typeof value === 'object' && !Array.isArray(value),
		`${label} must be an object.`
	);
	const actual = Object.keys(value).sort();
	const expected = keys.slice().sort();
	invariant(actual.join('\0') === expected.join('\0'), `${label} keys are not exact.`);
}

/** @param {string} filePath @param {number} maximumBytes @param {string} label */
function readBoundedOrdinaryFile(filePath, maximumBytes, label) {
	const stat = lstatSync(filePath);
	invariant(!stat.isSymbolicLink() && stat.isFile(), `${label} must be an ordinary file.`);
	invariant(stat.size > 0 && stat.size <= maximumBytes, `${label} has an invalid byte length.`);
	return readFileSync(filePath);
}

/** @param {string} trustedSourceRoot */
function readTrustedPagesCandidateSourceInputs(trustedSourceRoot) {
	const root = realpathSync(path.resolve(trustedSourceRoot));
	return TRUSTED_PAGES_CANDIDATE_SOURCE_INPUT_PATHS.map((sourcePath) => {
		const requested = path.join(root, ...sourcePath.split('/'));
		let contents;
		try {
			contents = readBoundedOrdinaryFile(
				requested,
				MAX_FILE_BYTES,
				`Trusted Pages runtime source input ${sourcePath}`
			);
		} catch (error) {
			throw new Error(`Trusted Pages runtime source input is unavailable: ${sourcePath}.`, {
				cause: error
			});
		}
		const real = realpathSync(requested);
		const normalized = path.relative(root, real).split(path.sep).join('/');
		invariant(
			isWithin(root, real) && normalized === sourcePath,
			`Trusted Pages runtime source input escaped its exact path: ${sourcePath}.`
		);
		return {
			path: sourcePath,
			contents,
			bytes: contents.byteLength,
			sha256: createHash('sha256').update(contents).digest('hex')
		};
	});
}

/**
 * @param {Array<{path:string;contents:Buffer;bytes:number;sha256:string}>} sourceInputs
 */
function canonicalTrustedPagesCandidateSourceInputProofs(sourceInputs) {
	invariant(
		Array.isArray(sourceInputs) &&
			sourceInputs.length === TRUSTED_PAGES_CANDIDATE_SOURCE_INPUT_PATHS.length,
		'Trusted Pages runtime source-input closure is incomplete.'
	);
	return sourceInputs.map((input, index) => {
		const expectedPath = TRUSTED_PAGES_CANDIDATE_SOURCE_INPUT_PATHS[index];
		invariant(
			expectedPath !== undefined &&
				input?.path === expectedPath &&
				Buffer.isBuffer(input.contents) &&
				input.contents.byteLength > 0 &&
				input.contents.byteLength <= MAX_FILE_BYTES &&
				input.bytes === input.contents.byteLength &&
				input.sha256 === createHash('sha256').update(input.contents).digest('hex'),
			`Trusted Pages runtime source-input proof drifted: ${String(expectedPath)}.`
		);
		return { path: input.path, bytes: input.bytes, sha256: input.sha256 };
	});
}

/** @param {string} value */
function assertSafeSegment(value) {
	invariant(
		value.length > 0 &&
			value !== '.' &&
			value !== '..' &&
			!value.includes('/') &&
			!value.includes('\\') &&
			!/\p{Cc}/u.test(value),
		`Pages finalizer encountered an unsafe path segment: ${JSON.stringify(value)}.`
	);
}

/**
 * Copy only bounded ordinary input files into Wrangler's disposable workspace.
 * Candidate-created links and devices are rejected before trusted tooling sees
 * them.
 *
 * @param {string} sourceRoot
 * @param {string} destinationRoot
 * @param {{files: number; bytes: number}} budget
 * @param {string} label
 */
function copyBoundedTree(sourceRoot, destinationRoot, budget, label) {
	const requested = path.resolve(sourceRoot);
	const requestedStat = lstatSync(requested);
	invariant(
		!requestedStat.isSymbolicLink() && requestedStat.isDirectory(),
		`${label} must be an ordinary directory.`
	);
	const source = realpathSync(requested);
	mkdirSync(destinationRoot, { recursive: false, mode: 0o700 });
	/** @type {Array<{source: string; destination: string; depth: number}>} */
	const pending = [{ source, destination: destinationRoot, depth: 0 }];
	while (pending.length > 0) {
		const directory = pending.pop();
		invariant(directory, 'Pages finalizer traversal failed.');
		invariant(directory.depth <= MAX_DEPTH, `${label} exceeds the finalizer depth limit.`);
		const entries = readdirSync(directory.source, { withFileTypes: true }).sort((left, right) =>
			Buffer.from(left.name).compare(Buffer.from(right.name))
		);
		for (const entry of entries) {
			assertSafeSegment(entry.name);
			const sourcePath = path.join(directory.source, entry.name);
			const destinationPath = path.join(directory.destination, entry.name);
			const stat = lstatSync(sourcePath);
			invariant(
				!stat.isSymbolicLink(),
				`Pages finalizer forbids symbolic links in ${label}: ${entry.name}.`
			);
			if (stat.isDirectory()) {
				mkdirSync(destinationPath, { mode: 0o700 });
				pending.push({
					source: sourcePath,
					destination: destinationPath,
					depth: directory.depth + 1
				});
				continue;
			}
			invariant(stat.isFile(), `Pages finalizer forbids special files in ${label}: ${entry.name}.`);
			invariant(
				stat.size <= MAX_FILE_BYTES,
				`Pages finalizer input file is too large in ${label}: ${entry.name}.`
			);
			budget.files += 1;
			budget.bytes += stat.size;
			invariant(
				budget.files <= MAX_FILES,
				'Svelte closure exceeds the finalizer file-count limit.'
			);
			invariant(
				budget.bytes <= MAX_TOTAL_BYTES,
				'Svelte closure exceeds the finalizer total-byte limit.'
			);
			copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL);
		}
	}
	return budget;
}

/** @param {string} root @param {string} label */
export function assertNoPhysicalProofRouteArtifacts(root, label) {
	const requestedRoot = path.resolve(root);
	const rootStat = lstatSync(requestedRoot);
	invariant(
		!rootStat.isSymbolicLink() && rootStat.isDirectory(),
		`${label} must be an ordinary directory.`
	);
	const physicalRoot = realpathSync(requestedRoot);
	for (const proofPath of PAGES_DYNAMIC_PROOF_PATHS) {
		const relativeProofPath = proofPath.slice(1);
		for (const relativePath of [
			relativeProofPath,
			`${relativeProofPath}.html`,
			`${relativeProofPath}/index.html`
		]) {
			const candidate = path.join(physicalRoot, ...relativePath.split('/'));
			try {
				lstatSync(candidate);
				throw new Error(
					`Pages finalizer forbids a physical static proof-route artifact in ${label}: ${relativePath}.`
				);
			} catch (error) {
				if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
			}
		}
	}
}

/** @param {string} lockfilePath @param {string} packageRoot */
export function verifyPinnedPagesFinalizerWrangler(lockfilePath, packageRoot) {
	const lockfile = JSON.parse(
		readBoundedOrdinaryFile(lockfilePath, 16 * 1024 * 1024, 'Trusted Wrangler lockfile').toString(
			'utf8'
		)
	);
	assertExactKeys(
		lockfile,
		['name', 'version', 'lockfileVersion', 'requires', 'packages'],
		'Trusted Wrangler lockfile'
	);
	invariant(lockfile.lockfileVersion === 3, 'Trusted Wrangler lockfileVersion must be 3.');
	const rootPackage = lockfile.packages?.[''];
	invariant(
		rootPackage?.dependencies?.wrangler === PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
		'Trusted release-gate dependency must pin the exact Wrangler finalizer version.'
	);
	const lockedWrangler = lockfile.packages?.['node_modules/wrangler'];
	invariant(
		lockedWrangler?.version === PINNED_PAGES_FINALIZER_WRANGLER_VERSION &&
			lockedWrangler?.resolved === PINNED_PAGES_FINALIZER_WRANGLER_RESOLVED &&
			lockedWrangler?.integrity === PINNED_PAGES_FINALIZER_WRANGLER_INTEGRITY,
		'Trusted Wrangler lock entry does not match the pinned package identity.'
	);

	const requestedRoot = path.resolve(packageRoot);
	const rootStat = lstatSync(requestedRoot);
	invariant(
		!rootStat.isSymbolicLink() && rootStat.isDirectory(),
		'Installed Wrangler package root must be an ordinary directory.'
	);
	const installedRoot = realpathSync(requestedRoot);
	const packageJson = JSON.parse(
		readBoundedOrdinaryFile(
			path.join(installedRoot, 'package.json'),
			256 * 1024,
			'Installed Wrangler package manifest'
		).toString('utf8')
	);
	invariant(packageJson.name === 'wrangler', 'Installed finalizer package must be Wrangler.');
	invariant(
		packageJson.version === PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
		'Installed Wrangler version does not match the trusted finalizer pin.'
	);
	invariant(
		packageJson.bin?.wrangler === './bin/wrangler.js',
		'Installed Wrangler CLI entry does not match the trusted finalizer pin.'
	);
	const cliPath = path.join(installedRoot, 'bin', 'wrangler.js');
	const cliStat = lstatSync(cliPath);
	invariant(
		!cliStat.isSymbolicLink() && cliStat.isFile() && cliStat.size > 0,
		'Installed Wrangler CLI must be an ordinary non-empty file.'
	);
	invariant(
		realpathSync(cliPath).startsWith(`${installedRoot}${path.sep}`),
		'Installed Wrangler CLI escapes its package root.'
	);
	return {
		cliPath,
		version: packageJson.version,
		lockfile,
		nodeModulesRoot: path.dirname(installedRoot)
	};
}

/** @param {string} lockfilePath @param {string} nodeModulesRoot */
function verifyCandidateNodeModules(lockfilePath, nodeModulesRoot) {
	const lockfile = JSON.parse(
		readBoundedOrdinaryFile(lockfilePath, 32 * 1024 * 1024, 'Candidate package lockfile').toString(
			'utf8'
		)
	);
	invariant(
		lockfile?.lockfileVersion === 3 &&
			lockfile.packages !== null &&
			typeof lockfile.packages === 'object' &&
			!Array.isArray(lockfile.packages),
		'Candidate package lockfile must be one complete npm lockfileVersion 3 authority.'
	);
	const requestedRoot = path.resolve(nodeModulesRoot);
	const stat = lstatSync(requestedRoot);
	invariant(
		!stat.isSymbolicLink() && stat.isDirectory(),
		'Candidate node_modules root must be an ordinary directory produced by npm ci.'
	);
	return { lockfile, nodeModulesRoot: realpathSync(requestedRoot) };
}

/** @param {{lockfile: Record<string, any>; nodeModulesRoot: string}} candidate */
function verifyOptionalDependenciesRemainAbsent(candidate) {
	const rootPackage = candidate.lockfile.packages?.[''] ?? {};
	for (const stub of PINNED_OPTIONAL_DEPENDENCY_STUBS) {
		for (const dependencyField of [
			'dependencies',
			'devDependencies',
			'optionalDependencies',
			'peerDependencies'
		]) {
			invariant(
				!Object.prototype.hasOwnProperty.call(rootPackage[dependencyField] ?? {}, stub.specifier),
				`Optional dependency ${stub.specifier} is now declared and must not use the trusted absence stub.`
			);
		}
		const lockSuffix = `/node_modules/${stub.specifier}`;
		invariant(
			!Object.keys(candidate.lockfile.packages).some(
				(key) => key === `node_modules/${stub.specifier}` || key.endsWith(lockSuffix)
			),
			`Optional dependency ${stub.specifier} is now lock-backed and must not use the trusted absence stub.`
		);
		const installedPath = path.join(candidate.nodeModulesRoot, ...stub.specifier.split('/'));
		try {
			lstatSync(installedPath);
			throw new Error(
				`Optional dependency ${stub.specifier} is installed and must not use the trusted absence stub.`
			);
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		}
	}
}

/** @param {string} parent @param {string} candidate */
function isWithin(parent, candidate) {
	const relative = path.relative(parent, candidate);
	return (
		relative.length > 0 &&
		relative !== '..' &&
		!relative.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(relative)
	);
}

/**
 * @param {string} filePath
 * @param {{lockfile: Record<string, any>; nodeModulesRoot: string}} authority
 * @param {string} label
 */
function verifyLockedPackageForInput(filePath, authority, label) {
	let directory = path.dirname(filePath);
	while (
		directory !== authority.nodeModulesRoot &&
		isWithin(authority.nodeModulesRoot, directory)
	) {
		const manifestPath = path.join(directory, 'package.json');
		try {
			const stat = lstatSync(manifestPath);
			if (!stat.isSymbolicLink() && stat.isFile() && stat.size > 0 && stat.size <= 1024 * 1024) {
				const relative = path
					.relative(authority.nodeModulesRoot, directory)
					.split(path.sep)
					.join('/');
				const lockKey = `node_modules/${relative}`;
				const locked = authority.lockfile.packages?.[lockKey];
				if (locked) {
					const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
					invariant(
						typeof locked.version === 'string' &&
							locked.version === manifest.version &&
							locked.link !== true,
						`${label} input is not backed by an exact installed lock entry: ${lockKey}.`
					);
					return lockKey;
				}
			}
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
		}
		directory = path.dirname(directory);
	}
	throw new Error(`${label} input has no locked package authority: ${filePath}.`);
}

/** @param {unknown} inputRecord @param {string} inputName */
function boundedMetafileInputBytes(inputRecord, inputName) {
	const bytes = Number(/** @type {Record<string, unknown>} */ (inputRecord).bytes);
	invariant(
		Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= MAX_FILE_BYTES,
		`Wrangler input has an invalid byte count: ${inputName}.`
	);
	return bytes;
}

/**
 * Wrangler's pinned Node-compatibility plugin creates a small number of
 * namespace-backed inputs that deliberately have no filesystem inode. Keep
 * these fail-closed: the namespace names are part of the exact Wrangler pin,
 * while disabled files must still resolve into an exact lock-backed package.
 *
 * @param {string} inputName
 * @param {unknown} inputRecord
 * @param {{workspace: string; candidate: {lockfile: Record<string, any>; nodeModulesRoot: string}; trusted: {lockfile: Record<string, any>; nodeModulesRoot: string}}} options
 */
function verifyPinnedWranglerVirtualInput(inputName, inputRecord, options) {
	const bytes = boundedMetafileInputBytes(inputRecord, inputName);
	if (inputName.startsWith('(disabled):')) {
		invariant(bytes === 0, `Disabled Wrangler input must be empty: ${inputName}.`);
		const requested = path.resolve(options.workspace, inputName.slice('(disabled):'.length));
		const candidates = [requested, `${requested}.js`];
		for (const candidate of candidates) {
			try {
				const real = realpathSync(candidate);
				const stat = lstatSync(real);
				invariant(
					stat.isFile() && !stat.isSymbolicLink(),
					`Disabled Wrangler input is not an ordinary file: ${inputName}.`
				);
				if (isWithin(options.candidate.nodeModulesRoot, real)) {
					return {
						bytes,
						authority: verifyLockedPackageForInput(
							real,
							options.candidate,
							'Disabled candidate dependency'
						)
					};
				}
				if (isWithin(options.trusted.nodeModulesRoot, real)) {
					return {
						bytes,
						authority: verifyLockedPackageForInput(
							real,
							options.trusted,
							'Disabled trusted dependency'
						)
					};
				}
				throw new Error(`Disabled Wrangler input escaped locked packages: ${inputName}.`);
			} catch (error) {
				if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
			}
		}
		throw new Error(`Disabled Wrangler input has no lock-backed source file: ${inputName}.`);
	}

	if (inputName.includes(':')) {
		if (!PINNED_WRANGLER_NAMESPACE_INPUTS.has(inputName)) return null;
		invariant(bytes > 0, `Pinned Wrangler virtual input must be non-empty: ${inputName}.`);
		return { bytes, authority: `pinned-wrangler:${inputName}` };
	}

	const requested = path.resolve(options.workspace, inputName);
	const packageRoot = realpathSync(path.join(options.trusted.nodeModulesRoot, 'wrangler'));
	let parent;
	try {
		parent = realpathSync(path.dirname(requested));
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
		throw error;
	}
	if (parent !== packageRoot) return null;
	const basename = path.basename(requested);
	if (!PINNED_WRANGLER_PACKAGE_VIRTUAL_INPUTS.has(basename)) return null;
	invariant(bytes > 0, `Pinned Wrangler package virtual input must be non-empty: ${inputName}.`);
	return { bytes, authority: `pinned-wrangler:${basename}` };
}

/**
 * @param {unknown} metafile
 * @param {{workspace: string; isolatedBuildRoot: string; candidate: {lockfile: Record<string, any>; nodeModulesRoot: string}; trusted: {lockfile: Record<string, any>; nodeModulesRoot: string}; trustedFiles?: Map<string, {label:string;sha256:string}>}} options
 */
export function verifyWranglerInputClosure(
	metafile,
	{ workspace, isolatedBuildRoot, candidate, trusted, trustedFiles = new Map() }
) {
	const isolatedRoot = realpathSync(isolatedBuildRoot);
	invariant(
		metafile !== null && typeof metafile === 'object' && !Array.isArray(metafile),
		'Wrangler metafile must be an object.'
	);
	const inputs = /** @type {Record<string, unknown>} */ (metafile).inputs;
	invariant(
		inputs !== null && typeof inputs === 'object' && !Array.isArray(inputs),
		'Wrangler metafile inputs are missing.'
	);
	const entries = Object.entries(/** @type {Record<string, unknown>} */ (inputs));
	invariant(
		entries.length > 0 && entries.length <= MAX_FILES,
		'Wrangler input count is outside the bounded closure.'
	);
	let bytes = 0;
	const packages = new Set();
	for (const [inputName, inputRecord] of entries) {
		invariant(
			inputRecord !== null && typeof inputRecord === 'object' && !Array.isArray(inputRecord),
			`Wrangler input record is invalid: ${inputName}.`
		);
		const virtual = verifyPinnedWranglerVirtualInput(inputName, inputRecord, {
			workspace,
			candidate,
			trusted
		});
		if (virtual) {
			bytes += virtual.bytes;
			invariant(bytes <= MAX_TOTAL_BYTES, 'Wrangler input closure exceeds the byte limit.');
			packages.add(virtual.authority);
			continue;
		}
		const absolute = path.resolve(workspace, inputName);
		let real;
		try {
			real = realpathSync(absolute);
		} catch (error) {
			throw new Error(`Wrangler input is not one ordinary allowlisted file: ${inputName}.`, {
				cause: error
			});
		}
		const stat = lstatSync(real);
		invariant(
			stat.isFile() && !stat.isSymbolicLink(),
			`Wrangler input is not an ordinary file: ${inputName}.`
		);
		bytes += stat.size;
		invariant(bytes <= MAX_TOTAL_BYTES, 'Wrangler input closure exceeds the byte limit.');
		if (isWithin(isolatedRoot, real)) continue;
		const trustedFile = trustedFiles.get(real);
		if (trustedFile) {
			invariant(
				createHash('sha256').update(readFileSync(real)).digest('hex') === trustedFile.sha256,
				`Trusted Pages adapter or generated input drifted: ${trustedFile.label}.`
			);
			packages.add(`trusted-source:${trustedFile.label}`);
			continue;
		}
		if (isWithin(candidate.nodeModulesRoot, real)) {
			packages.add(verifyLockedPackageForInput(real, candidate, 'Candidate dependency'));
			continue;
		}
		if (isWithin(trusted.nodeModulesRoot, real)) {
			packages.add(verifyLockedPackageForInput(real, trusted, 'Trusted finalizer dependency'));
			continue;
		}
		throw new Error(`Wrangler input escaped the Svelte and locked-package closure: ${inputName}.`);
	}
	return { files: entries.length, bytes, packages: [...packages].sort() };
}

/**
 * Prove that each trusted absence stub replaces only the reviewed, caught
 * dynamic import in the compiled candidate. Zero uses are safe; any new use,
 * static import, installed package, or changed failure contract fails closed.
 *
 * @param {unknown} metafile
 * @param {{isolatedBuildRoot: string}} options
 */
export function verifyOptionalDependencyStubSemantics(metafile, { isolatedBuildRoot }) {
	const inputs = /** @type {Record<string, any>} */ (
		/** @type {Record<string, unknown>} */ (metafile).inputs
	);
	for (const stub of PINNED_OPTIONAL_DEPENDENCY_STUBS) {
		const expectedStubPath = `input/.svelte-kit/trusted-finalizer-stubs/${stub.filename}`;
		const uses = [];
		for (const [inputName, inputRecord] of Object.entries(inputs)) {
			for (const imported of Array.isArray(inputRecord.imports) ? inputRecord.imports : []) {
				if (imported.original === stub.specifier || imported.path === expectedStubPath) {
					uses.push({ inputName, imported });
				}
			}
		}
		if (uses.length === 0) continue;
		invariant(
			uses.length === 1,
			`Optional dependency ${stub.specifier} must have at most one reviewed import site.`
		);
		const use = uses[0];
		invariant(use, `Optional dependency ${stub.specifier} import proof is missing.`);
		invariant(
			use.imported.kind === 'dynamic-import' &&
				use.imported.original === stub.specifier &&
				use.imported.path === expectedStubPath &&
				use.inputName.split(path.sep).join('/').endsWith(`input/.svelte-kit/${stub.compiledInput}`),
			`Optional dependency ${stub.specifier} no longer uses its reviewed dynamic import site.`
		);
		const compiledSource = readBoundedOrdinaryFile(
			path.join(isolatedBuildRoot, stub.compiledInput),
			MAX_FILE_BYTES,
			`Optional dependency ${stub.specifier} compiled failure contract`
		).toString('utf8');
		const start = compiledSource.indexOf(stub.contractStart);
		const end = start < 0 ? -1 : compiledSource.indexOf(stub.contractEnd, start);
		invariant(
			start >= 0 && end > start && compiledSource.indexOf(stub.contractStart, start + 1) < 0,
			`Optional dependency ${stub.specifier} compiled failure contract is ambiguous or absent.`
		);
		const contractHash = createHash('sha256')
			.update(compiledSource.slice(start, end))
			.digest('hex');
		invariant(
			contractHash === stub.contractSha256,
			`Optional dependency ${stub.specifier} is no longer caught with the reviewed failure semantics.`
		);
	}
}

/** @param {unknown} metafile */
export function assertSelfContainedWranglerMetafile(metafile) {
	invariant(
		metafile !== null && typeof metafile === 'object' && !Array.isArray(metafile),
		'Wrangler metafile must be an object.'
	);
	const metafileRecord = /** @type {Record<string, unknown>} */ (metafile);
	assertExactKeys(metafileRecord, ['inputs', 'outputs'], 'Wrangler metafile');
	invariant(
		metafileRecord.outputs !== null && typeof metafileRecord.outputs === 'object',
		'Wrangler metafile outputs are missing.'
	);
	const outputEntries = Object.entries(
		/** @type {Record<string, unknown>} */ (metafileRecord.outputs)
	);
	const entryOutputs = outputEntries.filter(
		([, value]) =>
			value !== null &&
			typeof value === 'object' &&
			!Array.isArray(value) &&
			typeof (/** @type {Record<string, unknown>} */ (value).entryPoint) === 'string'
	);
	invariant(
		entryOutputs.length === 1,
		`Finalized Pages Worker must have exactly one Wrangler entry output; got ${outputEntries.map(([name]) => name).join(', ')}.`
	);
	for (const [name, value] of outputEntries) {
		if (name === entryOutputs[0]?.[0]) continue;
		invariant(
			name.endsWith('.map') &&
				value !== null &&
				typeof value === 'object' &&
				!Array.isArray(value) &&
				!('entryPoint' in value),
			`Wrangler emitted a non-map dependency output: ${name}.`
		);
	}
	const output = entryOutputs[0]?.[1];
	invariant(
		output && typeof output === 'object' && !Array.isArray(output),
		'Wrangler output record is invalid.'
	);
	const outputRecord = /** @type {Record<string, unknown>} */ (output);
	invariant(
		typeof outputRecord.entryPoint === 'string' && outputRecord.entryPoint.length > 0,
		'Wrangler output must name one entry point.'
	);
	invariant(
		Number.isSafeInteger(outputRecord.bytes) && Number(outputRecord.bytes) > 0,
		'Wrangler output byte count is invalid.'
	);
	invariant(Array.isArray(outputRecord.imports), 'Wrangler output imports must be an array.');
	const runtimeModules = [];
	for (const imported of outputRecord.imports) {
		invariant(
			imported && typeof imported === 'object' && !Array.isArray(imported),
			'Wrangler output import is invalid.'
		);
		invariant(
			imported.external === true,
			'Wrangler left a non-external module dependency in the finalized Worker.'
		);
		invariant(
			isApprovedRuntimeModule(imported.path),
			`Wrangler left an unapproved runtime module dependency: ${String(imported.path)}.`
		);
		runtimeModules.push(imported.path);
	}
	return {
		bytes: Number(outputRecord.bytes),
		externalRuntimeModules: [...new Set(runtimeModules)].sort()
	};
}

/** @param {Buffer} workerBytes */
export function measureFinalizedPagesWorker(workerBytes) {
	invariant(
		Buffer.isBuffer(workerBytes) && workerBytes.byteLength > 0,
		'Finalized Pages Worker must be non-empty bytes.'
	);
	const gzipBytes = gzipSync(workerBytes, { level: 9 }).byteLength;
	invariant(
		gzipBytes < PAGES_WORKER_PLATFORM_GZIP_LIMIT_BYTES,
		`Finalized Pages Worker gzip size ${gzipBytes} must be below the 3,000,000-byte platform limit.`
	);
	invariant(
		gzipBytes < PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES,
		`Finalized Pages Worker gzip size ${gzipBytes} exceeds the ${PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES}-byte release ceiling.`
	);
	return {
		sha256: createHash('sha256').update(workerBytes).digest('hex'),
		bytes: workerBytes.byteLength,
		gzipBytes
	};
}

/** @param {Buffer} workerBytes */
function removeWranglerSourceMapDirective(workerBytes) {
	const source = new TextDecoder('utf-8', { fatal: true }).decode(workerBytes);
	const directive = /(?:\r?\n)?\/\/# sourceMappingURL=_worker\.js\.map(?:\r?\n)?$/u;
	const finalized = source.replace(directive, '\n');
	invariant(
		!/^[\t ]*(?:\/\/[#@]|\/\*[#@])[\t ]*sourceMappingURL=/mu.test(finalized),
		'Pinned Wrangler output retained a noncanonical source-map dependency.'
	);
	return Buffer.from(finalized, 'utf8');
}

/**
 * @param {Buffer} workerBytes
 * @param {string[]} externalRuntimeModules
 * @param {Array<{path:string;contents:Buffer;bytes:number;sha256:string}>} [trustedSourceInputs]
 */
export function createPagesFinalizationRecord(
	workerBytes,
	externalRuntimeModules,
	trustedSourceInputs = readTrustedPagesCandidateSourceInputs(DEFAULT_TRUSTED_SOURCE_ROOT)
) {
	invariant(Array.isArray(externalRuntimeModules), 'External runtime modules must be an array.');
	const trustedSourceInputProofs =
		canonicalTrustedPagesCandidateSourceInputProofs(trustedSourceInputs);
	const trustedAdapterInput = trustedSourceInputs[0];
	invariant(trustedAdapterInput, 'Trusted Access-safe Pages adapter input is missing.');
	const modules = [...new Set(externalRuntimeModules)].sort();
	for (const moduleName of modules) {
		invariant(
			isApprovedRuntimeModule(moduleName),
			`Finalization record contains an unapproved runtime module: ${String(moduleName)}.`
		);
	}
	const measurement = measureFinalizedPagesWorker(workerBytes);
	const optionalDependencyStubs = PINNED_OPTIONAL_DEPENDENCY_STUBS.map((stub) => ({
		specifier: stub.specifier,
		behavior: 'throw-on-dynamic-module-initialization',
		sha256: createHash('sha256').update(stub.source).digest('hex'),
		content: stub.source
	}));
	return {
		schemaVersion: 2,
		finalizer: FINALIZER_NAME,
		wrangler: {
			version: PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
			resolved: PINNED_PAGES_FINALIZER_WRANGLER_RESOLVED,
			integrity: PINNED_PAGES_FINALIZER_WRANGLER_INTEGRITY
		},
		compatibilityDate: PAGES_FINALIZER_COMPATIBILITY_DATE,
		compatibilityFlags: [...PAGES_FINALIZER_COMPATIBILITY_FLAGS],
		isolation: {
			candidateArtifact: 'pages/_worker.js',
			cacheApi: 'forbidden-access-boundary',
			releaseAuthority: 'separate-trusted-edge-worker',
			runtimeAdapterPath: TRUSTED_PAGES_CANDIDATE_ADAPTER_PATH,
			runtimeAdapterSha256: trustedAdapterInput.sha256,
			runtimeSourceInputs: trustedSourceInputProofs,
			runtimeEntrypoint: TRUSTED_PAGES_CANDIDATE_ENTRY_ID,
			runtimeEntrypointSha256: createHash('sha256')
				.update(createTrustedPagesCandidateEntrypoint())
				.digest('hex'),
			trustedEdgeImported: false
		},
		routing: {
			path: `pages/${TRUSTED_PAGES_ROUTES_FILE}`,
			sha256: createHash('sha256').update(TRUSTED_PAGES_ROUTES_SOURCE).digest('hex'),
			include: ['/*'],
			exclude: []
		},
		bundle: {
			mode: 'wrangler-deploy-dry-run-minify',
			selfContained: true,
			path: 'pages/_worker.js',
			sha256: measurement.sha256,
			bytes: measurement.bytes,
			gzipBytes: measurement.gzipBytes,
			releaseGzipLimitBytes: PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES,
			platformGzipLimitBytes: PAGES_WORKER_PLATFORM_GZIP_LIMIT_BYTES,
			externalRuntimeModules: modules,
			optionalDependencyStubs
		}
	};
}

/** @param {string} artifactRoot */
export function validateFinalizedPagesWorker(
	artifactRoot,
	trustedSourceRoot = DEFAULT_TRUSTED_SOURCE_ROOT
) {
	const root = realpathSync(path.resolve(artifactRoot));
	assertNoPhysicalProofRouteArtifacts(
		path.join(root, 'pages'),
		'finalized Cloudflare Pages output'
	);
	const recordPath = path.join(root, PAGES_FINALIZATION_RECORD);
	const recordBytes = readBoundedOrdinaryFile(
		recordPath,
		MAX_RECORD_BYTES,
		'Pages finalization record'
	);
	const record = JSON.parse(recordBytes.toString('utf8'));
	assertExactKeys(
		record,
		[
			'schemaVersion',
			'finalizer',
			'wrangler',
			'compatibilityDate',
			'compatibilityFlags',
			'isolation',
			'routing',
			'bundle'
		],
		'Pages finalization record'
	);
	invariant(record.schemaVersion === 2, 'Pages finalization schemaVersion must be 2.');
	invariant(record.finalizer === FINALIZER_NAME, 'Pages finalization authority is invalid.');
	assertExactKeys(
		record.wrangler,
		['version', 'resolved', 'integrity'],
		'Pages finalization Wrangler identity'
	);
	invariant(
		record.wrangler.version === PINNED_PAGES_FINALIZER_WRANGLER_VERSION &&
			record.wrangler.resolved === PINNED_PAGES_FINALIZER_WRANGLER_RESOLVED &&
			record.wrangler.integrity === PINNED_PAGES_FINALIZER_WRANGLER_INTEGRITY,
		'Pages finalization Wrangler identity is not pinned.'
	);
	invariant(
		record.compatibilityDate === PAGES_FINALIZER_COMPATIBILITY_DATE,
		'Pages finalization compatibility date drifted.'
	);
	invariant(
		Array.isArray(record.compatibilityFlags) &&
			record.compatibilityFlags.join('\0') === PAGES_FINALIZER_COMPATIBILITY_FLAGS.join('\0'),
		'Pages finalization compatibility flags drifted.'
	);
	assertExactKeys(
		record.isolation,
		[
			'candidateArtifact',
			'cacheApi',
			'releaseAuthority',
			'runtimeAdapterPath',
			'runtimeAdapterSha256',
			'runtimeSourceInputs',
			'runtimeEntrypoint',
			'runtimeEntrypointSha256',
			'trustedEdgeImported'
		],
		'Pages finalization isolate boundary'
	);
	const trustedSourceInputs = readTrustedPagesCandidateSourceInputs(trustedSourceRoot);
	const trustedSourceInputProofs =
		canonicalTrustedPagesCandidateSourceInputProofs(trustedSourceInputs);
	const trustedAdapterInput = trustedSourceInputs[0];
	invariant(trustedAdapterInput, 'Trusted Access-safe Pages adapter authority is missing.');
	invariant(
		Array.isArray(record.isolation.runtimeSourceInputs) &&
			record.isolation.runtimeSourceInputs.length === trustedSourceInputProofs.length,
		'Pages finalization runtime source-input closure is incomplete.'
	);
	for (let index = 0; index < trustedSourceInputProofs.length; index += 1) {
		assertExactKeys(
			record.isolation.runtimeSourceInputs[index],
			['path', 'bytes', 'sha256'],
			`Pages finalization runtime source-input proof ${index}`
		);
	}
	invariant(
		record.isolation.candidateArtifact === 'pages/_worker.js' &&
			record.isolation.cacheApi === 'forbidden-access-boundary' &&
			record.isolation.releaseAuthority === 'separate-trusted-edge-worker' &&
			record.isolation.runtimeAdapterPath === TRUSTED_PAGES_CANDIDATE_ADAPTER_PATH &&
			record.isolation.runtimeAdapterSha256 === trustedAdapterInput.sha256 &&
			JSON.stringify(record.isolation.runtimeSourceInputs) ===
				JSON.stringify(trustedSourceInputProofs) &&
			record.isolation.runtimeEntrypoint === TRUSTED_PAGES_CANDIDATE_ENTRY_ID &&
			record.isolation.runtimeEntrypointSha256 ===
				createHash('sha256').update(createTrustedPagesCandidateEntrypoint()).digest('hex') &&
			record.isolation.trustedEdgeImported === false,
		'Pages finalization isolate boundary drifted.'
	);
	assertExactKeys(
		record.routing,
		['path', 'sha256', 'include', 'exclude'],
		'Pages finalization routing authority'
	);
	const routesBytes = readBoundedOrdinaryFile(
		path.join(root, 'pages', TRUSTED_PAGES_ROUTES_FILE),
		MAX_RECORD_BYTES,
		'Trusted Pages routing authority'
	);
	invariant(
		record.routing.path === `pages/${TRUSTED_PAGES_ROUTES_FILE}` &&
			record.routing.sha256 ===
				createHash('sha256').update(TRUSTED_PAGES_ROUTES_SOURCE).digest('hex') &&
			JSON.stringify(record.routing.include) === JSON.stringify(['/*']) &&
			JSON.stringify(record.routing.exclude) === JSON.stringify([]) &&
			routesBytes.equals(Buffer.from(TRUSTED_PAGES_ROUTES_SOURCE)),
		'Pages finalization routing authority drifted.'
	);
	assertExactKeys(
		record.bundle,
		[
			'mode',
			'selfContained',
			'path',
			'sha256',
			'bytes',
			'gzipBytes',
			'releaseGzipLimitBytes',
			'platformGzipLimitBytes',
			'externalRuntimeModules',
			'optionalDependencyStubs'
		],
		'Pages finalization bundle'
	);
	invariant(
		record.bundle.mode === 'wrangler-deploy-dry-run-minify' &&
			record.bundle.selfContained === true &&
			record.bundle.path === 'pages/_worker.js',
		'Pages finalization bundle posture is invalid.'
	);
	invariant(
		record.bundle.releaseGzipLimitBytes === PAGES_WORKER_RELEASE_GZIP_LIMIT_BYTES &&
			record.bundle.platformGzipLimitBytes === PAGES_WORKER_PLATFORM_GZIP_LIMIT_BYTES,
		'Pages finalization gzip limits drifted.'
	);
	const workerBytes = readBoundedOrdinaryFile(
		path.join(root, 'pages', '_worker.js'),
		MAX_FILE_BYTES,
		'Finalized Pages Worker'
	);
	const expected = createPagesFinalizationRecord(
		workerBytes,
		Array.isArray(record.bundle.externalRuntimeModules) ? record.bundle.externalRuntimeModules : [],
		trustedSourceInputs
	);
	invariant(
		JSON.stringify(record) === JSON.stringify(expected),
		'Pages finalization record does not match the canonical Worker bytes.'
	);
	return record;
}

/** @param {string} filePath @param {Buffer|string} contents */
function writeExclusive(filePath, contents) {
	const descriptor = openSync(
		filePath,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600
	);
	try {
		writeFileSync(descriptor, contents);
	} finally {
		closeSync(descriptor);
	}
}

/**
 * @param {{artifactRoot: string; svelteBuildRoot: string; candidateNodeModules: string; candidateLockfile: string; wranglerPackageRoot: string; wranglerLockfile: string; trustedSourceRoot: string}} options
 */
export function finalizePagesReleaseArtifact({
	artifactRoot,
	svelteBuildRoot,
	candidateNodeModules,
	candidateLockfile,
	wranglerPackageRoot,
	wranglerLockfile,
	trustedSourceRoot
}) {
	const requestedRoot = path.resolve(artifactRoot);
	const requestedStat = lstatSync(requestedRoot);
	invariant(
		!requestedStat.isSymbolicLink() && requestedStat.isDirectory(),
		'Release artifact root must be an ordinary directory.'
	);
	const root = realpathSync(requestedRoot);
	const metadata = JSON.parse(
		readBoundedOrdinaryFile(
			path.join(root, 'release-metadata.json'),
			16 * 1024,
			'Release metadata'
		).toString('utf8')
	);
	invariant(
		metadata?.schemaVersion === 1 && metadata?.mode === 'normal',
		'Trusted Pages finalization is normal-mode only.'
	);
	invariant(
		typeof metadata.sourceSha === 'string' && /^[a-f0-9]{40}$/u.test(metadata.sourceSha),
		'Trusted Pages finalization needs one exact source SHA.'
	);
	const requestedTrustedRoot = path.resolve(trustedSourceRoot);
	const trustedRootStat = lstatSync(requestedTrustedRoot);
	invariant(
		!trustedRootStat.isSymbolicLink() && trustedRootStat.isDirectory(),
		'Trusted Pages finalizer source root must be an ordinary directory.'
	);
	const trustedRoot = realpathSync(requestedTrustedRoot);
	const trustedSourceInputs = readTrustedPagesCandidateSourceInputs(trustedRoot);
	const trustedAdapterInput = trustedSourceInputs[0];
	invariant(trustedAdapterInput, 'Trusted Access-safe Pages adapter input is missing.');
	const trustedEntrypointBytes = Buffer.from(createTrustedPagesCandidateEntrypoint(), 'utf8');
	const finalizationPath = path.join(root, PAGES_FINALIZATION_RECORD);
	invariant(
		!readdirSync(root).includes(PAGES_FINALIZATION_RECORD),
		'Pages finalization record must not exist before trusted finalization.'
	);
	const pagesRoot = path.join(root, 'pages');
	const pagesStat = lstatSync(pagesRoot);
	invariant(
		!pagesStat.isSymbolicLink() && pagesStat.isDirectory() && readdirSync(pagesRoot).length === 0,
		'Canonical pages directory must be empty before trusted finalization.'
	);
	const requestedBuildRoot = path.resolve(svelteBuildRoot);
	const requestedBuildStat = lstatSync(requestedBuildRoot);
	invariant(
		!requestedBuildStat.isSymbolicLink() && requestedBuildStat.isDirectory(),
		'Svelte build root must be an ordinary directory.'
	);
	const buildRoot = realpathSync(requestedBuildRoot);
	const cloudflareSource = path.join(buildRoot, 'cloudflare');
	const serverSource = path.join(buildRoot, 'output', 'server');
	const cloudflareTmpSource = path.join(buildRoot, 'cloudflare-tmp');
	readBoundedOrdinaryFile(
		path.join(cloudflareSource, '_worker.js'),
		MAX_FILE_BYTES,
		'Svelte Cloudflare Worker entry'
	);
	readBoundedOrdinaryFile(
		path.join(cloudflareTmpSource, 'manifest.js'),
		MAX_FILE_BYTES,
		'Svelte Cloudflare temporary manifest'
	);
	assertNoPhysicalProofRouteArtifacts(cloudflareSource, 'Svelte Cloudflare source output');
	const wrangler = verifyPinnedPagesFinalizerWrangler(wranglerLockfile, wranglerPackageRoot);
	const candidateDependencies = verifyCandidateNodeModules(candidateLockfile, candidateNodeModules);
	verifyOptionalDependenciesRemainAbsent(candidateDependencies);

	const workspace = mkdtempSync(path.join(tmpdir(), 'commons-pages-finalizer-'));
	const inputRoot = path.join(workspace, 'input');
	const isolatedBuildRoot = path.join(inputRoot, '.svelte-kit');
	const outputRoot = path.join(workspace, 'output');
	const outputBundleRoot = path.join(outputRoot, 'bundle');
	const isolatedCloudflareRoot = path.join(isolatedBuildRoot, 'cloudflare');
	const isolatedServerRoot = path.join(isolatedBuildRoot, 'output', 'server');
	const isolatedCloudflareTmpRoot = path.join(isolatedBuildRoot, 'cloudflare-tmp');
	const trustedStubRoot = path.join(isolatedBuildRoot, 'trusted-finalizer-stubs');
	const trustedInputRoot = path.join(workspace, 'trusted');
	const trustedAdapterPath = path.join(trustedInputRoot, 'access-safe-sveltekit-pages-adapter.ts');
	const trustedEntrypointPath = path.join(trustedInputRoot, '_worker.ts');
	const configPath = path.join(workspace, 'wrangler.toml');
	const outputPath = path.join(outputBundleRoot, '_worker.js');
	const metafilePath = path.join(outputRoot, 'metafile.json');
	const replacementPath = path.join(pagesRoot, '._worker.js.finalized');
	try {
		mkdirSync(inputRoot, { mode: 0o700 });
		mkdirSync(isolatedBuildRoot, { mode: 0o700 });
		mkdirSync(path.join(isolatedBuildRoot, 'output'), { mode: 0o700 });
		mkdirSync(outputRoot, { mode: 0o700 });
		mkdirSync(outputBundleRoot, { mode: 0o700 });
		mkdirSync(trustedInputRoot, { mode: 0o700 });
		writeExclusive(trustedAdapterPath, trustedAdapterInput.contents);
		for (const input of trustedSourceInputs.slice(1)) {
			const destination = path.join(workspace, ...input.path.split('/'));
			mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
			writeExclusive(destination, input.contents);
		}
		writeExclusive(trustedEntrypointPath, trustedEntrypointBytes);
		const closureBudget = { files: 0, bytes: 0 };
		copyBoundedTree(
			cloudflareSource,
			isolatedCloudflareRoot,
			closureBudget,
			'Svelte cloudflare output'
		);
		// Pages evaluates its routing control before `_worker.js`. Candidate
		// exclusions or redirects could therefore bypass the candidate Worker.
		// Strip those control files and emit the one exact all-routes authority
		// from T; public release authority lives in a separate trusted Worker.
		rmSync(path.join(isolatedCloudflareRoot, TRUSTED_PAGES_ROUTES_FILE), {
			recursive: true,
			force: true
		});
		rmSync(path.join(isolatedCloudflareRoot, '_redirects'), {
			recursive: true,
			force: true
		});
		writeExclusive(
			path.join(isolatedCloudflareRoot, TRUSTED_PAGES_ROUTES_FILE),
			TRUSTED_PAGES_ROUTES_SOURCE
		);
		copyBoundedTree(
			serverSource,
			isolatedServerRoot,
			closureBudget,
			'Svelte output/server closure'
		);
		copyBoundedTree(
			cloudflareTmpSource,
			isolatedCloudflareTmpRoot,
			closureBudget,
			'Svelte cloudflare-tmp closure'
		);
		mkdirSync(trustedStubRoot, { mode: 0o700 });
		for (const stub of PINNED_OPTIONAL_DEPENDENCY_STUBS) {
			writeExclusive(path.join(trustedStubRoot, stub.filename), stub.source);
		}
		symlinkSync(
			candidateDependencies.nodeModulesRoot,
			path.join(inputRoot, 'node_modules'),
			process.platform === 'win32' ? 'junction' : 'dir'
		);
		writeExclusive(
			configPath,
			[
				'name = "commons-pages-release-finalizer"',
				`compatibility_date = "${PAGES_FINALIZER_COMPATIBILITY_DATE}"`,
				`compatibility_flags = [${PAGES_FINALIZER_COMPATIBILITY_FLAGS.map((flag) => JSON.stringify(flag)).join(', ')}]`,
				'[alias]',
				...PINNED_OPTIONAL_DEPENDENCY_STUBS.map(
					(stub) =>
						`${JSON.stringify(stub.specifier)} = ${JSON.stringify(`./input/.svelte-kit/trusted-finalizer-stubs/${stub.filename}`)}`
				),
				''
			].join('\n')
		);
		const isolatedEnvironment = Object.fromEntries(
			[
				['PATH', process.env.PATH],
				['SystemRoot', process.env.SystemRoot],
				['WINDIR', process.env.WINDIR]
			].filter((entry) => typeof entry[1] === 'string' && entry[1].length > 0)
		);
		Object.assign(isolatedEnvironment, {
			HOME: workspace,
			TMPDIR: workspace,
			CI: 'true',
			NO_COLOR: '1',
			WRANGLER_SEND_METRICS: 'false',
			SOURCE_DATE_EPOCH: '0',
			LANG: 'C',
			LC_ALL: 'C'
		});
		const result = spawnSync(
			process.execPath,
			[
				wrangler.cliPath,
				'deploy',
				'trusted/_worker.ts',
				'--dry-run',
				'--minify',
				'--outdir',
				'output/bundle',
				'--metafile',
				'output/metafile.json',
				'--config',
				'wrangler.toml',
				'--no-autoconfig'
			],
			{
				cwd: workspace,
				env: isolatedEnvironment,
				encoding: 'utf8',
				maxBuffer: 16 * 1024 * 1024,
				timeout: 5 * 60 * 1000
			}
		);
		invariant(
			!result.error,
			`Pinned Wrangler dry-run failed to start: ${result.error?.message ?? 'unknown error'}.`
		);
		invariant(
			result.status === 0 && result.signal === null,
			`Pinned Wrangler dry-run failed: ${(result.stderr || result.stdout || 'no diagnostic').trim().slice(0, 4000)}`
		);
		const wranglerWorkerBytes = readBoundedOrdinaryFile(
			outputPath,
			MAX_FILE_BYTES,
			'Wrangler finalized Worker'
		);
		const metafile = JSON.parse(
			readBoundedOrdinaryFile(metafilePath, 16 * 1024 * 1024, 'Wrangler metafile').toString('utf8')
		);
		/** @type {Map<string, {label:string;sha256:string}>} */
		const trustedFiles = new Map();
		for (const [index, input] of trustedSourceInputs.entries()) {
			const stagedPath =
				index === 0 ? trustedAdapterPath : path.join(workspace, ...input.path.split('/'));
			trustedFiles.set(realpathSync(stagedPath), {
				label: input.path,
				sha256: input.sha256
			});
		}
		trustedFiles.set(realpathSync(trustedEntrypointPath), {
			label: TRUSTED_PAGES_CANDIDATE_ENTRY_ID,
			sha256: createHash('sha256').update(trustedEntrypointBytes).digest('hex')
		});
		verifyWranglerInputClosure(metafile, {
			workspace,
			isolatedBuildRoot,
			candidate: candidateDependencies,
			trusted: {
				lockfile: wrangler.lockfile,
				nodeModulesRoot: wrangler.nodeModulesRoot
			},
			trustedFiles
		});
		verifyOptionalDependencyStubSemantics(metafile, { isolatedBuildRoot });
		const bundle = assertSelfContainedWranglerMetafile(metafile);
		invariant(
			wranglerWorkerBytes.byteLength >= bundle.bytes &&
				wranglerWorkerBytes.byteLength - bundle.bytes <= 64 * 1024,
			`Pinned Wrangler post-processing expanded the Worker from ${bundle.bytes} to ${wranglerWorkerBytes.byteLength} bytes unexpectedly.`
		);
		const workerBytes = removeWranglerSourceMapDirective(wranglerWorkerBytes);
		const record = createPagesFinalizationRecord(
			workerBytes,
			bundle.externalRuntimeModules,
			trustedSourceInputs
		);
		rmSync(pagesRoot, { recursive: true });
		copyBoundedTree(
			isolatedCloudflareRoot,
			pagesRoot,
			{ files: 0, bytes: 0 },
			'Canonical Cloudflare pages output'
		);
		assertNoPhysicalProofRouteArtifacts(pagesRoot, 'canonical Cloudflare Pages output');
		const workerPath = path.join(pagesRoot, '_worker.js');
		writeExclusive(replacementPath, workerBytes);
		renameSync(replacementPath, workerPath);
		writeExclusive(finalizationPath, `${JSON.stringify(record)}\n`);
		validateFinalizedPagesWorker(root, trustedRoot);
		return record;
	} finally {
		rmSync(replacementPath, { force: true });
		rmSync(workspace, { recursive: true, force: true });
	}
}

/** @param {string[]} argv */
export function parsePagesFinalizerArgs(argv) {
	const values = new Map();
	const accepted = new Set([
		'--artifact-root',
		'--svelte-build-root',
		'--candidate-node-modules',
		'--candidate-lockfile',
		'--wrangler-package-root',
		'--wrangler-lockfile',
		'--trusted-source-root'
	]);
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		invariant(accepted.has(flag), `Unknown argument: ${flag}.`);
		invariant(!values.has(flag), `Duplicate argument: ${flag}.`);
		const value = argv[index + 1];
		invariant(value && !value.startsWith('--'), `${flag} requires a value.`);
		values.set(flag, value);
		index += 1;
	}
	for (const flag of accepted) invariant(values.has(flag), `${flag} is required.`);
	return {
		artifactRoot: /** @type {string} */ (values.get('--artifact-root')),
		svelteBuildRoot: /** @type {string} */ (values.get('--svelte-build-root')),
		candidateNodeModules: /** @type {string} */ (values.get('--candidate-node-modules')),
		candidateLockfile: /** @type {string} */ (values.get('--candidate-lockfile')),
		wranglerPackageRoot: /** @type {string} */ (values.get('--wrangler-package-root')),
		wranglerLockfile: /** @type {string} */ (values.get('--wrangler-lockfile')),
		trustedSourceRoot: /** @type {string} */ (values.get('--trusted-source-root'))
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const result = finalizePagesReleaseArtifact(parsePagesFinalizerArgs(process.argv.slice(2)));
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(
			`Pages release artifact finalization failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exitCode = 1;
	}
}
