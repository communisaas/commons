#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	closeSync,
	constants,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
	PINNED_PAGES_FINALIZER_WRANGLER_INTEGRITY,
	PINNED_PAGES_FINALIZER_WRANGLER_RESOLVED,
	PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
	assertSelfContainedWranglerMetafile,
	verifyPinnedPagesFinalizerWrangler
} from './finalize-pages-release-artifact.mjs';

export const TRUSTED_RELEASE_WORKER_FINALIZATION_FILE = 'finalization.json';

export const TRUSTED_RELEASE_WORKER_PROFILES = Object.freeze({
	'manifest-gate': Object.freeze({
		artifactDirectory: 'manifest-gate',
		config: 'wrangler.public-discovery-manifest-gate.toml',
		entrypoint: 'workers/public-discovery-manifest-refresh-gate.ts',
		emittedFile: 'public-discovery-manifest-refresh-gate.js',
		productionOnly: true,
		nonProductionOnly: false
	}),
	'manifest-gate-nonprod': Object.freeze({
		artifactDirectory: 'manifest-gate-nonprod',
		config: 'wrangler.public-discovery-manifest-gate-nonprod.toml',
		entrypoint: 'workers/public-discovery-manifest-refresh-gate.ts',
		emittedFile: 'public-discovery-manifest-refresh-gate.js',
		productionOnly: false,
		nonProductionOnly: false
	}),
	'convex-work-budget': Object.freeze({
		artifactDirectory: 'convex-work-budget',
		config: 'wrangler.convex-work-budget.toml',
		entrypoint: 'workers/convex-work-budget.ts',
		emittedFile: 'convex-work-budget.js',
		productionOnly: true,
		nonProductionOnly: false
	}),
	'manifest-cron': Object.freeze({
		artifactDirectory: 'manifest-cron',
		config: 'wrangler.public-discovery-manifest.toml',
		entrypoint: 'workers/public-discovery-manifest-cron.ts',
		emittedFile: 'public-discovery-manifest-cron.js',
		productionOnly: true,
		nonProductionOnly: false
	}),
	'trusted-pages-edge': Object.freeze({
		artifactDirectory: 'trusted-pages-edge',
		config: 'wrangler.trusted-pages-release-edge.toml',
		entrypoint: 'workers/trusted-pages-release-edge-entry.ts',
		emittedFile: 'trusted-pages-release-edge-entry.js',
		productionOnly: true,
		nonProductionOnly: false,
		sourceShaBound: true
	}),
	'trusted-pages-edge-staging': Object.freeze({
		artifactDirectory: 'trusted-pages-edge-staging',
		config: 'wrangler.trusted-pages-release-edge-staging.toml',
		entrypoint: 'workers/trusted-pages-release-edge-entry.ts',
		emittedFile: 'trusted-pages-release-edge-entry.js',
		productionOnly: false,
		nonProductionOnly: true,
		sourceShaBound: true
	})
});

const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_METADATA_BYTES = 32 * 1024;
const MAX_METAFILE_BYTES = 4 * 1024 * 1024;
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_INPUT_FILES = 256;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_WORKER_RAW_BYTES = 512 * 1024;
const MAX_WORKER_GZIP_BYTES = 128 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} profile */
function trustedReleaseWorkerProfile(profile) {
	invariant(
		Object.prototype.hasOwnProperty.call(TRUSTED_RELEASE_WORKER_PROFILES, profile),
		`Unknown trusted standalone Worker profile: ${profile}.`
	);
	return /** @type {any} */ (TRUSTED_RELEASE_WORKER_PROFILES)[profile];
}

/** @param {string} filePath @param {number} maximumBytes @param {string} label */
function readBoundedOrdinaryFile(filePath, maximumBytes, label) {
	const stat = lstatSync(filePath);
	invariant(!stat.isSymbolicLink() && stat.isFile(), `${label} must be an ordinary file.`);
	invariant(stat.size > 0 && stat.size <= maximumBytes, `${label} has an invalid byte length.`);
	return readFileSync(filePath);
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

/** @param {Buffer} bytes @param {string} emittedFile */
function canonicalWorkerBytes(bytes, emittedFile) {
	const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	const escaped = emittedFile.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	const directive = new RegExp(
		`(?:\\r?\\n)?//[#@] sourceMappingURL=${escaped}\\.map(?:\\r?\\n)?$`,
		'u'
	);
	const canonical = source.replace(directive, '\n');
	invariant(
		!/[\t ]*(?:\/\/[#@]|\/\*[#@])[\t ]*sourceMappingURL=/u.test(canonical),
		'Trusted standalone Worker retained a source-map dependency.'
	);
	const result = Buffer.from(canonical, 'utf8');
	invariant(
		!result.subarray(0, 128).toString('utf8').includes('formdata-undici') &&
			!result.subarray(0, 2).equals(Buffer.from('--')) &&
			!result.includes(Buffer.from('Content-Disposition: form-data; name="metadata"')),
		'Trusted standalone Worker is a multipart upload body, not executable JavaScript.'
	);
	const gzipBytes = gzipSync(result, { level: 9 }).byteLength;
	invariant(
		result.byteLength > 0 && result.byteLength <= MAX_WORKER_RAW_BYTES,
		'Trusted standalone Worker exceeds its raw byte bound.'
	);
	invariant(
		gzipBytes <= MAX_WORKER_GZIP_BYTES,
		'Trusted standalone Worker exceeds its gzip byte bound.'
	);
	return {
		bytes: result,
		sha256: createHash('sha256').update(result).digest('hex'),
		rawBytes: result.byteLength,
		gzipBytes
	};
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

/**
 * @param {{profile:string;configSha256:string;inputs:Array<{path:string;bytes:number;sha256:string}>;bundle:Buffer;releaseSourceSha?:string|null}} options
 */
export function createTrustedReleaseWorkerFinalizationRecord({
	profile,
	configSha256,
	inputs,
	bundle,
	releaseSourceSha = null
}) {
	const selected = trustedReleaseWorkerProfile(profile);
	invariant(
		/^[a-f0-9]{64}$/u.test(configSha256),
		'Trusted standalone Worker config digest is invalid.'
	);
	invariant(
		Array.isArray(inputs) && inputs.length > 0,
		'Trusted standalone Worker inputs are missing.'
	);
	invariant(
		selected.sourceShaBound
			? typeof releaseSourceSha === 'string' && /^[a-f0-9]{40}$/u.test(releaseSourceSha)
			: releaseSourceSha === null,
		'Trusted standalone Worker release-source binding is invalid.'
	);
	const measured = canonicalWorkerBytes(bundle, selected.emittedFile);
	if (selected.sourceShaBound) {
		invariant(
			measured.bytes.includes(Buffer.from(/** @type {string} */ (releaseSourceSha))),
			'Trusted Pages edge bundle does not embed its exact release source SHA.'
		);
	}
	return {
		schemaVersion: 1,
		finalizer: 'trusted-wrangler-standalone-worker-v1',
		profile,
		releaseSourceSha,
		wrangler: {
			version: PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
			resolved: PINNED_PAGES_FINALIZER_WRANGLER_RESOLVED,
			integrity: PINNED_PAGES_FINALIZER_WRANGLER_INTEGRITY
		},
		config: { path: selected.config, sha256: configSha256 },
		entrypoint: selected.entrypoint,
		inputs,
		bundle: {
			file: `${selected.artifactDirectory}/index.js`,
			sha256: measured.sha256,
			rawBytes: measured.rawBytes,
			gzipBytes: measured.gzipBytes,
			rawLimitBytes: MAX_WORKER_RAW_BYTES,
			gzipLimitBytes: MAX_WORKER_GZIP_BYTES,
			selfContained: true,
			externalRuntimeModules: []
		}
	};
}

/**
 * @param {string} artifactRoot
 * @param {string} trustedSourceRoot
 * @param {string} profile
 */
export function validateTrustedReleaseWorkerArtifact(artifactRoot, trustedSourceRoot, profile) {
	const selected = trustedReleaseWorkerProfile(profile);
	const requestedArtifact = path.resolve(artifactRoot);
	const artifactRootStat = lstatSync(requestedArtifact);
	invariant(
		!artifactRootStat.isSymbolicLink() && artifactRootStat.isDirectory(),
		'Trusted standalone Worker artifact root must be an ordinary directory.'
	);
	const artifact = realpathSync(requestedArtifact);
	const releaseMetadata = JSON.parse(
		readBoundedOrdinaryFile(
			path.join(artifact, 'release-metadata.json'),
			MAX_METADATA_BYTES,
			'Release metadata'
		).toString('utf8')
	);
	const requestedSource = path.resolve(trustedSourceRoot);
	const sourceRootStat = lstatSync(requestedSource);
	invariant(
		!sourceRootStat.isSymbolicLink() && sourceRootStat.isDirectory(),
		'Trusted standalone Worker source root must be an ordinary directory.'
	);
	const source = realpathSync(requestedSource);
	const directory = path.join(artifact, selected.artifactDirectory);
	const directoryStat = lstatSync(directory);
	invariant(
		!directoryStat.isSymbolicLink() &&
			directoryStat.isDirectory() &&
			isWithin(artifact, realpathSync(directory)),
		`Trusted standalone Worker ${profile} artifact directory is invalid.`
	);
	const entries = readdirSync(directory, { withFileTypes: true });
	invariant(
		entries.length === 2 &&
			entries.every(
				(entry) =>
					entry.isFile() &&
					['index.js', TRUSTED_RELEASE_WORKER_FINALIZATION_FILE].includes(entry.name)
			),
		`Trusted standalone Worker ${profile} artifact entries are not exact.`
	);
	const recordBytes = readBoundedOrdinaryFile(
		path.join(directory, TRUSTED_RELEASE_WORKER_FINALIZATION_FILE),
		MAX_RECORD_BYTES,
		`Trusted standalone Worker ${profile} finalization record`
	);
	const record = JSON.parse(recordBytes.toString('utf8'));
	assertExactKeys(
		record,
		[
			'schemaVersion',
			'finalizer',
			'profile',
			'releaseSourceSha',
			'wrangler',
			'config',
			'entrypoint',
			'inputs',
			'bundle'
		],
		'Trusted standalone Worker finalization record'
	);
	invariant(
		record.schemaVersion === 1 &&
			record.finalizer === 'trusted-wrangler-standalone-worker-v1' &&
			record.profile === profile &&
			record.entrypoint === selected.entrypoint,
		'Trusted standalone Worker finalization identity is invalid.'
	);
	const expectedReleaseSourceSha = selected.sourceShaBound ? releaseMetadata?.sourceSha : null;
	invariant(
		(selected.sourceShaBound
			? typeof expectedReleaseSourceSha === 'string' &&
				/^[a-f0-9]{40}$/u.test(expectedReleaseSourceSha)
			: expectedReleaseSourceSha === null) && record.releaseSourceSha === expectedReleaseSourceSha,
		'Trusted standalone Worker release-source proof does not match metadata.'
	);
	assertExactKeys(
		record.wrangler,
		['version', 'resolved', 'integrity'],
		'Trusted standalone Worker Wrangler identity'
	);
	invariant(
		record.wrangler.version === PINNED_PAGES_FINALIZER_WRANGLER_VERSION &&
			record.wrangler.resolved === PINNED_PAGES_FINALIZER_WRANGLER_RESOLVED &&
			record.wrangler.integrity === PINNED_PAGES_FINALIZER_WRANGLER_INTEGRITY,
		'Trusted standalone Worker Wrangler identity drifted.'
	);
	assertExactKeys(record.config, ['path', 'sha256'], 'Trusted standalone Worker config proof');
	const configBytes = readBoundedOrdinaryFile(
		path.join(source, selected.config),
		MAX_CONFIG_BYTES,
		'Trusted standalone Worker config authority'
	);
	invariant(
		record.config.path === selected.config &&
			record.config.sha256 === createHash('sha256').update(configBytes).digest('hex'),
		'Trusted standalone Worker config proof does not match T.'
	);
	invariant(
		Array.isArray(record.inputs) &&
			record.inputs.length > 0 &&
			record.inputs.length <= MAX_INPUT_FILES,
		'Trusted standalone Worker input proof is invalid.'
	);
	let previous = '';
	let sawEntrypoint = false;
	let inputBytes = 0;
	for (const input of record.inputs) {
		assertExactKeys(input, ['path', 'bytes', 'sha256'], 'Trusted standalone Worker input proof');
		invariant(
			typeof input.path === 'string' &&
				(previous.length === 0 || Buffer.from(input.path).compare(Buffer.from(previous)) > 0) &&
				!path.isAbsolute(input.path) &&
				!input.path.includes('\\') &&
				/** @type {string[]} */ (input.path.split('/')).every(
					(segment) => segment.length > 0 && segment !== '.' && segment !== '..'
				) &&
				!/\p{Cc}/u.test(input.path),
			'Trusted standalone Worker input proofs must be unique and sorted.'
		);
		const requested = path.join(source, input.path);
		const requestedStat = lstatSync(requested);
		const realInput = realpathSync(requested);
		const normalizedInput = path.relative(source, realInput).split(path.sep).join('/');
		invariant(
			!requestedStat.isSymbolicLink() &&
				requestedStat.isFile() &&
				isWithin(source, realInput) &&
				normalizedInput === input.path,
			`Trusted standalone Worker input proof escaped T: ${input.path}.`
		);
		const file = readBoundedOrdinaryFile(
			requested,
			MAX_INPUT_BYTES,
			`Trusted standalone Worker input authority ${input.path}`
		);
		inputBytes += file.byteLength;
		invariant(
			inputBytes <= MAX_INPUT_BYTES,
			'Trusted standalone Worker input proof exceeds its byte bound.'
		);
		invariant(
			input.bytes === file.byteLength &&
				input.sha256 === createHash('sha256').update(file).digest('hex'),
			`Trusted standalone Worker input proof drifted from T: ${input.path}.`
		);
		if (input.path === selected.entrypoint) sawEntrypoint = true;
		previous = input.path;
	}
	invariant(sawEntrypoint, 'Trusted standalone Worker proof omitted its entrypoint.');
	assertExactKeys(
		record.bundle,
		[
			'file',
			'sha256',
			'rawBytes',
			'gzipBytes',
			'rawLimitBytes',
			'gzipLimitBytes',
			'selfContained',
			'externalRuntimeModules'
		],
		'Trusted standalone Worker bundle proof'
	);
	const bundle = readBoundedOrdinaryFile(
		path.join(directory, 'index.js'),
		MAX_WORKER_RAW_BYTES,
		`Trusted standalone Worker ${profile} bundle`
	);
	const canonicalBundle = canonicalWorkerBytes(bundle, selected.emittedFile);
	invariant(
		bundle.equals(canonicalBundle.bytes),
		`Trusted standalone Worker ${profile} bundle is not canonical standalone JavaScript.`
	);
	const expected = createTrustedReleaseWorkerFinalizationRecord({
		profile,
		configSha256: record.config.sha256,
		inputs: record.inputs,
		bundle,
		releaseSourceSha: expectedReleaseSourceSha
	});
	invariant(
		JSON.stringify(record) === JSON.stringify(expected) &&
			recordBytes.equals(Buffer.from(`${JSON.stringify(expected)}\n`, 'utf8')),
		`Trusted standalone Worker ${profile} bytes do not match their T finalization record.`
	);
	return record;
}

/**
 * @param {unknown} metafile
 * @param {{trustedSourceRoot:string;entrypoint:string}} options
 */
export function verifyTrustedReleaseWorkerInputClosure(
	metafile,
	{ trustedSourceRoot, entrypoint }
) {
	invariant(
		metafile && typeof metafile === 'object' && !Array.isArray(metafile),
		'Trusted standalone Worker metafile must be an object.'
	);
	const inputs = /** @type {Record<string, unknown>} */ (metafile).inputs;
	invariant(
		inputs && typeof inputs === 'object' && !Array.isArray(inputs),
		'Trusted standalone Worker metafile inputs are missing.'
	);
	const entries = Object.entries(/** @type {Record<string, any>} */ (inputs));
	invariant(
		entries.length > 0 && entries.length <= MAX_INPUT_FILES,
		'Trusted standalone Worker input count is invalid.'
	);
	const root = realpathSync(path.resolve(trustedSourceRoot));
	let inputBytes = 0;
	let sawEntrypoint = false;
	const closure = [];
	for (const [inputName, record] of entries) {
		invariant(
			typeof inputName === 'string' &&
				inputName.length > 0 &&
				!path.isAbsolute(inputName) &&
				!inputName.split(/[\\/]/u).includes('..') &&
				!/\p{Cc}/u.test(inputName),
			`Trusted standalone Worker has an unsafe input: ${JSON.stringify(inputName)}.`
		);
		invariant(
			record && typeof record === 'object' && !Array.isArray(record),
			`Trusted standalone Worker input record is invalid: ${inputName}.`
		);
		const requested = path.resolve(root, inputName);
		const stat = lstatSync(requested);
		invariant(
			!stat.isSymbolicLink() && stat.isFile(),
			`Trusted standalone Worker input must be an ordinary file: ${inputName}.`
		);
		const real = realpathSync(requested);
		invariant(isWithin(root, real), `Trusted standalone Worker input escaped T: ${inputName}.`);
		inputBytes += stat.size;
		invariant(
			inputBytes <= MAX_INPUT_BYTES,
			'Trusted standalone Worker input closure exceeds its byte bound.'
		);
		const normalized = path.relative(root, real).split(path.sep).join('/');
		invariant(
			normalized === inputName,
			`Trusted standalone Worker input path drifted: ${inputName}.`
		);
		if (normalized === entrypoint) sawEntrypoint = true;
		closure.push({
			path: normalized,
			bytes: stat.size,
			sha256: createHash('sha256').update(readFileSync(real)).digest('hex')
		});
	}
	invariant(sawEntrypoint, 'Trusted standalone Worker metafile omitted its exact entrypoint.');
	return {
		inputs: closure.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path))),
		inputBytes
	};
}

/**
 * Bind Wrangler's single executable output to the selected immutable-T profile.
 * Wrangler records metafile paths relative to its trusted source working directory,
 * including when the configured output directory lives elsewhere.
 *
 * @param {unknown} metafile
 * @param {{trustedSourceRoot:string;outputRoot:string;profile:string}} options
 */
export function verifyTrustedReleaseWorkerMetafileOutput(
	metafile,
	{ trustedSourceRoot, outputRoot, profile }
) {
	const selected = trustedReleaseWorkerProfile(profile);
	invariant(
		metafile && typeof metafile === 'object' && !Array.isArray(metafile),
		'Trusted standalone Worker metafile must be an object.'
	);
	const outputs = /** @type {Record<string, unknown>} */ (metafile).outputs;
	invariant(
		outputs && typeof outputs === 'object' && !Array.isArray(outputs),
		'Trusted standalone Worker metafile outputs are missing.'
	);
	const executable = Object.entries(/** @type {Record<string, any>} */ (outputs)).filter(
		([, output]) =>
			output &&
			typeof output === 'object' &&
			!Array.isArray(output) &&
			typeof output.entryPoint === 'string'
	);
	invariant(
		executable.length === 1,
		'Trusted standalone Worker must have exactly one executable metafile output.'
	);
	const [outputName, output] = /** @type {[string, Record<string, any>]} */ (executable[0]);
	const source = path.resolve(trustedSourceRoot);
	const expectedEntrypoint = path.resolve(source, selected.entrypoint);
	const actualEntrypoint = path.resolve(source, output.entryPoint);
	invariant(
		actualEntrypoint === expectedEntrypoint &&
			path.relative(source, actualEntrypoint).split(path.sep).join('/') === selected.entrypoint,
		`Trusted standalone Worker ${profile} metafile entrypoint does not match its fixed profile.`
	);
	const expectedOutput = path.resolve(outputRoot, selected.emittedFile);
	const actualOutput = path.resolve(source, outputName);
	invariant(
		path.basename(outputName) === selected.emittedFile && actualOutput === expectedOutput,
		`Trusted standalone Worker ${profile} metafile output does not match its fixed profile.`
	);
	return { outputName, entrypoint: output.entryPoint };
}

/**
 * @param {{artifactRoot:string;trustedSourceRoot:string;profile:string;wranglerPackageRoot:string;wranglerLockfile:string}} options
 */
export function finalizeTrustedReleaseWorker({
	artifactRoot,
	trustedSourceRoot,
	profile,
	wranglerPackageRoot,
	wranglerLockfile
}) {
	const selected = trustedReleaseWorkerProfile(profile);
	const artifact = realpathSync(path.resolve(artifactRoot));
	const metadata = JSON.parse(
		readBoundedOrdinaryFile(
			path.join(artifact, 'release-metadata.json'),
			MAX_METADATA_BYTES,
			'Release metadata'
		).toString('utf8')
	);
	invariant(
		metadata?.schemaVersion === 1 &&
			metadata?.mode === 'normal' &&
			(!selected.productionOnly || metadata?.branch === 'production') &&
			(!selected.nonProductionOnly || metadata?.branch !== 'production') &&
			(!selected.sourceShaBound ||
				(typeof metadata?.sourceSha === 'string' && /^[a-f0-9]{40}$/u.test(metadata.sourceSha))),
		'Trusted standalone Worker profile is incompatible with release metadata.'
	);
	const releaseSourceSha = selected.sourceShaBound ? metadata.sourceSha : null;
	const source = realpathSync(path.resolve(trustedSourceRoot));
	const configPath = path.join(source, selected.config);
	const entrypointPath = path.join(source, selected.entrypoint);
	const configBytes = readBoundedOrdinaryFile(
		configPath,
		MAX_CONFIG_BYTES,
		'Trusted standalone Worker config'
	);
	readBoundedOrdinaryFile(entrypointPath, MAX_INPUT_BYTES, 'Trusted standalone Worker entrypoint');
	invariant(
		configBytes.toString('utf8').includes(`main = ${JSON.stringify(selected.entrypoint)}`),
		'Trusted standalone Worker config does not name its exact entrypoint.'
	);
	const artifactDirectory = path.join(artifact, selected.artifactDirectory);
	try {
		lstatSync(artifactDirectory);
		throw new Error(
			`Trusted standalone Worker artifact already exists: ${selected.artifactDirectory}.`
		);
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
	}

	const wrangler = verifyPinnedPagesFinalizerWrangler(wranglerLockfile, wranglerPackageRoot);
	const workspace = mkdtempSync(path.join(tmpdir(), `commons-${profile}-finalizer-`));
	const output = path.join(workspace, 'output');
	const metafilePath = path.join(workspace, 'metafile.json');
	const staged = path.join(workspace, selected.artifactDirectory);
	try {
		mkdirSync(output, { mode: 0o700 });
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
		const defineArguments = selected.sourceShaBound
			? ['--define', `TRUSTED_RELEASE_SOURCE_SHA:${JSON.stringify(releaseSourceSha)}`]
			: [];
		const result = spawnSync(
			process.execPath,
			[
				wrangler.cliPath,
				'deploy',
				'--dry-run',
				'--minify',
				'--outdir',
				output,
				'--metafile',
				metafilePath,
				'--config',
				configPath,
				...defineArguments,
				'--no-autoconfig'
			],
			{
				cwd: source,
				env: isolatedEnvironment,
				encoding: 'utf8',
				shell: false,
				maxBuffer: 8 * 1024 * 1024,
				timeout: 2 * 60 * 1000
			}
		);
		invariant(
			!result.error && result.status === 0 && result.signal === null,
			`Pinned Wrangler could not finalize ${profile}: ${(result.stderr || result.stdout || result.error?.message || '').slice(0, 4000)}`
		);
		const metafile = JSON.parse(
			readBoundedOrdinaryFile(
				metafilePath,
				MAX_METAFILE_BYTES,
				'Trusted standalone Worker metafile'
			).toString('utf8')
		);
		const closure = verifyTrustedReleaseWorkerInputClosure(metafile, {
			trustedSourceRoot: source,
			entrypoint: selected.entrypoint
		});
		verifyTrustedReleaseWorkerMetafileOutput(metafile, {
			trustedSourceRoot: source,
			outputRoot: output,
			profile
		});
		const bundle = assertSelfContainedWranglerMetafile(metafile);
		invariant(
			bundle.externalRuntimeModules.length === 0,
			'Trusted standalone Worker must not retain runtime module imports.'
		);
		const emitted = readBoundedOrdinaryFile(
			path.join(output, selected.emittedFile),
			MAX_WORKER_RAW_BYTES,
			'Trusted standalone Worker output'
		);
		const canonical = canonicalWorkerBytes(emitted, selected.emittedFile);
		const record = createTrustedReleaseWorkerFinalizationRecord({
			profile,
			configSha256: createHash('sha256').update(configBytes).digest('hex'),
			inputs: closure.inputs,
			bundle: canonical.bytes,
			releaseSourceSha
		});
		mkdirSync(staged, { mode: 0o700 });
		writeExclusive(path.join(staged, 'index.js'), canonical.bytes);
		writeExclusive(
			path.join(staged, TRUSTED_RELEASE_WORKER_FINALIZATION_FILE),
			`${JSON.stringify(record)}\n`
		);
		renameSync(staged, artifactDirectory);
		validateTrustedReleaseWorkerArtifact(artifact, source, profile);
		return {
			profile,
			artifactDirectory: selected.artifactDirectory,
			sha256: canonical.sha256,
			rawBytes: canonical.rawBytes,
			gzipBytes: canonical.gzipBytes,
			inputs: closure.inputs,
			inputBytes: closure.inputBytes
		};
	} catch (error) {
		rmSync(artifactDirectory, { recursive: true, force: true });
		throw error;
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}

/** @param {string[]} argv */
export function parseTrustedReleaseWorkerArgs(argv) {
	const accepted = new Set([
		'--artifact-root',
		'--trusted-source-root',
		'--profile',
		'--wrangler-package-root',
		'--wrangler-lockfile'
	]);
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
	invariant(values.size === accepted.size, 'All trusted standalone Worker arguments are required.');
	return {
		artifactRoot: /** @type {string} */ (values.get('--artifact-root')),
		trustedSourceRoot: /** @type {string} */ (values.get('--trusted-source-root')),
		profile: /** @type {string} */ (values.get('--profile')),
		wranglerPackageRoot: /** @type {string} */ (values.get('--wrangler-package-root')),
		wranglerLockfile: /** @type {string} */ (values.get('--wrangler-lockfile'))
	};
}

/** @param {string[]} argv */
export function parseTrustedReleaseWorkerValidationArgs(argv) {
	const accepted = new Set(['--artifact-root', '--trusted-source-root', '--profile']);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			accepted.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Unknown, duplicate, or valueless validation argument: ${String(flag)}.`
		);
		values.set(flag, value);
	}
	invariant(
		values.size === accepted.size,
		'All trusted standalone Worker validation arguments are required.'
	);
	return {
		artifactRoot: /** @type {string} */ (values.get('--artifact-root')),
		trustedSourceRoot: /** @type {string} */ (values.get('--trusted-source-root')),
		profile: /** @type {string} */ (values.get('--profile'))
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const argv = process.argv.slice(2);
		if (argv[0] === 'validate') {
			const validation = parseTrustedReleaseWorkerValidationArgs(argv.slice(1));
			const record = validateTrustedReleaseWorkerArtifact(
				validation.artifactRoot,
				validation.trustedSourceRoot,
				validation.profile
			);
			console.log(
				JSON.stringify({
					profile: validation.profile,
					sha256: record.bundle.sha256,
					rawBytes: record.bundle.rawBytes,
					gzipBytes: record.bundle.gzipBytes
				})
			);
		} else {
			const result = finalizeTrustedReleaseWorker(parseTrustedReleaseWorkerArgs(argv));
			console.log(JSON.stringify(result));
		}
	} catch (error) {
		console.error(
			`Trusted standalone Worker finalization failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exitCode = 1;
	}
}
