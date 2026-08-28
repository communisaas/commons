#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
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
	PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
	verifyPinnedPagesFinalizerWrangler
} from './finalize-pages-release-artifact.mjs';
import { validatePublicTemplateOgSourceConfig } from './verify-public-template-og-deployment.mjs';

export const PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY = 'public-template-og-consumer';
export const PUBLIC_TEMPLATE_OG_ARTIFACT_FILE = 'index.js';
export const PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD = 'public-template-og-finalization.json';
export const PUBLIC_TEMPLATE_OG_ENTRYPOINT = 'workers/public-template-og-consumer.ts';
export const PUBLIC_TEMPLATE_OG_RELEASE_RAW_LIMIT_BYTES = 512 * 1024;
export const PUBLIC_TEMPLATE_OG_RELEASE_GZIP_LIMIT_BYTES = 128 * 1024;

const FINALIZER_NAME = 'trusted-wrangler-og-consumer-v1';
const MAX_CONFIG_BYTES = 32 * 1024;
const MAX_METAFILE_BYTES = 2 * 1024 * 1024;
const MAX_RECORD_BYTES = 256 * 1024;
const MAX_INPUT_FILES = 512;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {Buffer|Uint8Array|string} value */
function sha256(value) {
	return createHash('sha256').update(value).digest('hex');
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

/** @param {string} root @param {string} candidate @param {string} label */
function assertOrdinaryFileWithin(root, candidate, label) {
	const resolvedRoot = realpathSync(path.resolve(root));
	const requested = path.resolve(candidate);
	const stat = lstatSync(requested);
	invariant(!stat.isSymbolicLink() && stat.isFile(), `${label} must be an ordinary file.`);
	const resolved = realpathSync(requested);
	const relative = path.relative(resolvedRoot, resolved);
	invariant(
		relative.length > 0 && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
		`${label} escapes the candidate checkout.`
	);
	return { absolute: resolved, relative: relative.split(path.sep).join('/') };
}

/**
 * Validate Wrangler's inert build graph before any bytes cross into the release
 * artifact. The builder has no credentials; every accepted input must still be
 * an ordinary file inside the exact candidate checkout.
 * @param {unknown} value
 * @param {string} candidateRoot
 */
export function validatePublicTemplateOgMetafile(value, candidateRoot) {
	const metafile = /** @type {Record<string, any>} */ (value);
	assertExactKeys(metafile, ['inputs', 'outputs'], 'OG consumer Wrangler metafile');
	invariant(
		metafile.inputs && typeof metafile.inputs === 'object' && !Array.isArray(metafile.inputs),
		'OG consumer metafile inputs must be an object.'
	);
	invariant(
		metafile.outputs && typeof metafile.outputs === 'object' && !Array.isArray(metafile.outputs),
		'OG consumer metafile outputs must be an object.'
	);
	const inputNames = Object.keys(metafile.inputs).sort();
	invariant(
		inputNames.length > 0 && inputNames.length <= MAX_INPUT_FILES,
		'OG input count is invalid.'
	);
	let totalBytes = 0;
	const inputs = inputNames.map((input) => {
		invariant(
			typeof input === 'string' &&
				input.length > 0 &&
				!path.isAbsolute(input) &&
				!input.split(/[\\/]/u).includes('..') &&
				!/\p{Cc}/u.test(input),
			`OG metafile contains an unsafe input path: ${JSON.stringify(input)}.`
		);
		const ordinary = assertOrdinaryFileWithin(
			candidateRoot,
			path.join(candidateRoot, input),
			`OG input ${input}`
		);
		invariant(
			ordinary.relative === input,
			`OG input path changed after canonical resolution: ${input}.`
		);
		const bytes = readFileSync(ordinary.absolute);
		totalBytes += bytes.byteLength;
		invariant(totalBytes <= MAX_INPUT_BYTES, 'OG input closure exceeds the byte limit.');
		return { path: input, bytes: bytes.byteLength, sha256: sha256(bytes) };
	});

	const outputs = Object.entries(metafile.outputs);
	const entryOutputs = outputs.filter(([, output]) => output?.entryPoint !== undefined);
	invariant(entryOutputs.length === 1, 'OG consumer must have exactly one entry output.');
	const [outputPath, output] = entryOutputs[0];
	invariant(
		output.entryPoint === PUBLIC_TEMPLATE_OG_ENTRYPOINT,
		'OG consumer entry output does not originate from the exact committed entrypoint.'
	);
	invariant(
		Array.isArray(output.imports) && output.imports.length === 0,
		'OG consumer artifact must be a single self-contained module.'
	);
	invariant(
		typeof outputPath === 'string' && outputPath.endsWith('/public-template-og-consumer.js'),
		'OG consumer output filename is not canonical.'
	);
	for (const [name, candidate] of outputs) {
		invariant(
			name === outputPath ||
				(name.endsWith('/public-template-og-consumer.js.map') &&
					candidate?.entryPoint === undefined),
			`OG consumer build emitted an unexpected output: ${name}.`
		);
	}
	return { inputs, inputBytes: totalBytes, outputPath };
}

/** @param {Buffer|Uint8Array} bytes */
export function measurePublicTemplateOgBundle(bytes) {
	const rawBytes = bytes.byteLength;
	const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
	invariant(
		rawBytes > 0 && rawBytes <= PUBLIC_TEMPLATE_OG_RELEASE_RAW_LIMIT_BYTES,
		'OG consumer bundle exceeds the raw release ceiling.'
	);
	invariant(
		gzipBytes <= PUBLIC_TEMPLATE_OG_RELEASE_GZIP_LIMIT_BYTES,
		'OG consumer bundle exceeds the gzip release ceiling.'
	);
	return { rawBytes, gzipBytes, sha256: sha256(bytes) };
}

/** @param {Buffer|Uint8Array} bundle @param {Array<{path:string;bytes:number;sha256:string}>} inputs @param {string} configSha256 */
export function createPublicTemplateOgFinalizationRecord(bundle, inputs, configSha256) {
	return {
		schemaVersion: 1,
		finalizer: FINALIZER_NAME,
		wranglerVersion: PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
		entrypoint: PUBLIC_TEMPLATE_OG_ENTRYPOINT,
		configSha256,
		inputs,
		bundle: {
			file: `${PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY}/${PUBLIC_TEMPLATE_OG_ARTIFACT_FILE}`,
			...measurePublicTemplateOgBundle(bundle),
			rawLimitBytes: PUBLIC_TEMPLATE_OG_RELEASE_RAW_LIMIT_BYTES,
			gzipLimitBytes: PUBLIC_TEMPLATE_OG_RELEASE_GZIP_LIMIT_BYTES,
			selfContained: true
		}
	};
}

/** @param {string} artifactRoot @param {string} trustedConfigPath */
export function validateFinalizedPublicTemplateOgArtifact(artifactRoot, trustedConfigPath) {
	const root = realpathSync(path.resolve(artifactRoot));
	const trustedConfigBytes = readBoundedOrdinaryFile(
		trustedConfigPath,
		MAX_CONFIG_BYTES,
		'Trusted OG Wrangler config'
	);
	validatePublicTemplateOgSourceConfig(trustedConfigBytes.toString('utf8'));
	const trustedConfigSha256 = sha256(trustedConfigBytes);
	const recordBytes = readBoundedOrdinaryFile(
		path.join(root, PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD),
		MAX_RECORD_BYTES,
		'OG finalization record'
	);
	const record = JSON.parse(recordBytes.toString('utf8'));
	assertExactKeys(
		record,
		[
			'schemaVersion',
			'finalizer',
			'wranglerVersion',
			'entrypoint',
			'configSha256',
			'inputs',
			'bundle'
		],
		'OG finalization record'
	);
	invariant(
		record.schemaVersion === 1 && record.finalizer === FINALIZER_NAME,
		'OG finalization identity is invalid.'
	);
	invariant(
		record.wranglerVersion === PINNED_PAGES_FINALIZER_WRANGLER_VERSION,
		'OG finalization Wrangler pin is invalid.'
	);
	invariant(
		record.entrypoint === PUBLIC_TEMPLATE_OG_ENTRYPOINT,
		'OG finalization entrypoint is invalid.'
	);
	invariant(
		record.configSha256 === trustedConfigSha256,
		'OG config digest does not match the exact trusted deployment config.'
	);
	invariant(
		Array.isArray(record.inputs) &&
			record.inputs.length > 0 &&
			record.inputs.length <= MAX_INPUT_FILES,
		'OG finalization inputs are invalid.'
	);
	let previous = '';
	for (const input of record.inputs) {
		assertExactKeys(input, ['path', 'bytes', 'sha256'], 'OG finalization input');
		invariant(
			typeof input.path === 'string' && input.path > previous,
			'OG finalization inputs must be unique and sorted.'
		);
		invariant(
			Number.isSafeInteger(input.bytes) && input.bytes > 0,
			'OG finalization input size is invalid.'
		);
		invariant(/^[a-f0-9]{64}$/.test(input.sha256), 'OG finalization input digest is invalid.');
		previous = input.path;
	}
	assertExactKeys(
		record.bundle,
		['file', 'rawBytes', 'gzipBytes', 'sha256', 'rawLimitBytes', 'gzipLimitBytes', 'selfContained'],
		'OG finalization bundle'
	);
	invariant(
		record.bundle.file ===
			`${PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY}/${PUBLIC_TEMPLATE_OG_ARTIFACT_FILE}`,
		'OG finalization bundle path is invalid.'
	);
	invariant(
		record.bundle.rawLimitBytes === PUBLIC_TEMPLATE_OG_RELEASE_RAW_LIMIT_BYTES &&
			record.bundle.gzipLimitBytes === PUBLIC_TEMPLATE_OG_RELEASE_GZIP_LIMIT_BYTES &&
			record.bundle.selfContained === true,
		'OG finalization bundle policy is invalid.'
	);
	const artifactDirectory = path.join(root, PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY);
	const entries = readdirSync(artifactDirectory, { withFileTypes: true });
	invariant(
		entries.length === 1 &&
			entries[0].isFile() &&
			entries[0].name === PUBLIC_TEMPLATE_OG_ARTIFACT_FILE,
		'OG artifact directory must contain only canonical index.js.'
	);
	const bundle = readBoundedOrdinaryFile(
		path.join(artifactDirectory, PUBLIC_TEMPLATE_OG_ARTIFACT_FILE),
		PUBLIC_TEMPLATE_OG_RELEASE_RAW_LIMIT_BYTES,
		'OG consumer bundle'
	);
	const measured = measurePublicTemplateOgBundle(bundle);
	invariant(
		measured.rawBytes === record.bundle.rawBytes &&
			measured.gzipBytes === record.bundle.gzipBytes &&
			measured.sha256 === record.bundle.sha256,
		'OG consumer bytes do not match their trusted finalization record.'
	);
	return record;
}

/**
 * @param {{artifactRoot:string,candidateRoot:string,candidateConfig:string,trustedConfig:string,wranglerPackageRoot:string,wranglerLockfile:string}} options
 */
export function finalizePublicTemplateOgReleaseArtifact(options) {
	const artifactRoot = realpathSync(path.resolve(options.artifactRoot));
	const metadata = JSON.parse(
		readBoundedOrdinaryFile(
			path.join(artifactRoot, 'release-metadata.json'),
			32 * 1024,
			'Release metadata'
		).toString('utf8')
	);
	invariant(
		metadata?.schemaVersion === 1 && metadata?.mode === 'normal',
		'OG finalizer is normal-mode only.'
	);
	const artifactDirectory = path.join(artifactRoot, PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY);
	const recordPath = path.join(artifactRoot, PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD);
	try {
		lstatSync(recordPath);
		throw new Error('OG finalization record must not pre-exist.');
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
	}
	try {
		lstatSync(artifactDirectory);
		throw new Error('OG artifact directory must not pre-exist.');
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
	}

	const candidateRoot = realpathSync(path.resolve(options.candidateRoot));
	const candidateConfig = assertOrdinaryFileWithin(
		candidateRoot,
		options.candidateConfig,
		'Candidate OG Wrangler config'
	);
	const trustedConfigBytes = readBoundedOrdinaryFile(
		options.trustedConfig,
		MAX_CONFIG_BYTES,
		'Trusted OG Wrangler config'
	);
	const candidateConfigBytes = readBoundedOrdinaryFile(
		candidateConfig.absolute,
		MAX_CONFIG_BYTES,
		'Candidate OG Wrangler config'
	);
	validatePublicTemplateOgSourceConfig(trustedConfigBytes.toString('utf8'));
	invariant(
		candidateConfigBytes.equals(trustedConfigBytes),
		'Candidate OG Wrangler config differs from trusted gate T.'
	);
	const configSha256 = sha256(trustedConfigBytes);
	const trustedWrangler = verifyPinnedPagesFinalizerWrangler(
		options.wranglerLockfile,
		options.wranglerPackageRoot
	);
	const workspace = mkdtempSync(path.join(tmpdir(), 'commons-og-finalizer-'));
	try {
		const outputDirectory = path.join(workspace, 'output');
		mkdirSync(outputDirectory, { mode: 0o700 });
		const metafilePath = path.join(workspace, 'metafile.json');
		const result = spawnSync(
			process.execPath,
			[
				trustedWrangler.cliPath,
				'deploy',
				'--dry-run',
				'--minify',
				'--config',
				candidateConfig.absolute,
				'--outdir',
				outputDirectory,
				'--metafile',
				metafilePath
			],
			{
				cwd: candidateRoot,
				encoding: 'utf8',
				shell: false,
				maxBuffer: 8 * 1024 * 1024,
				env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }
			}
		);
		invariant(
			result.status === 0,
			`Pinned Wrangler could not finalize OG consumer: ${(result.stderr || result.stdout || '').slice(0, 4000)}`
		);
		const metafile = JSON.parse(
			readBoundedOrdinaryFile(metafilePath, MAX_METAFILE_BYTES, 'OG Wrangler metafile').toString(
				'utf8'
			)
		);
		const graph = validatePublicTemplateOgMetafile(metafile, candidateRoot);
		const emitted = path.join(outputDirectory, path.basename(graph.outputPath));
		const emittedBytes = readBoundedOrdinaryFile(
			emitted,
			PUBLIC_TEMPLATE_OG_RELEASE_RAW_LIMIT_BYTES,
			'Emitted OG consumer bundle'
		);
		const canonicalText = emittedBytes
			.toString('utf8')
			.replace(/\n?\/\/# sourceMappingURL=public-template-og-consumer\.js\.map\s*$/u, '\n');
		const canonicalBytes = Buffer.from(canonicalText, 'utf8');
		const record = createPublicTemplateOgFinalizationRecord(
			canonicalBytes,
			graph.inputs,
			configSha256
		);
		const stagedDirectory = path.join(workspace, PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY);
		mkdirSync(stagedDirectory, { mode: 0o700 });
		writeFileSync(path.join(stagedDirectory, PUBLIC_TEMPLATE_OG_ARTIFACT_FILE), canonicalBytes, {
			mode: 0o600,
			flag: 'wx'
		});
		const stagedRecord = path.join(workspace, PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD);
		writeFileSync(stagedRecord, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: 'wx' });
		renameSync(stagedDirectory, artifactDirectory);
		copyFileSync(stagedRecord, recordPath);
		return validateFinalizedPublicTemplateOgArtifact(artifactRoot, options.trustedConfig);
	} catch (error) {
		rmSync(artifactDirectory, { recursive: true, force: true });
		rmSync(recordPath, { force: true });
		throw error;
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}

/** @param {string[]} argv */
export function parsePublicTemplateOgFinalizerArgs(argv) {
	const allowed = new Set([
		'--artifact-root',
		'--candidate-root',
		'--candidate-config',
		'--trusted-config',
		'--wrangler-package-root',
		'--wrangler-lockfile'
	]);
	const values = new Map();
	for (let index = 0; index < argv.length; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		invariant(
			allowed.has(flag) && value && !value.startsWith('--') && !values.has(flag),
			`Unknown, duplicate, or valueless argument: ${flag}.`
		);
		values.set(flag, value);
	}
	invariant(values.size === allowed.size, 'All OG finalizer arguments are required.');
	return {
		artifactRoot: values.get('--artifact-root'),
		candidateRoot: values.get('--candidate-root'),
		candidateConfig: values.get('--candidate-config'),
		trustedConfig: values.get('--trusted-config'),
		wranglerPackageRoot: values.get('--wrangler-package-root'),
		wranglerLockfile: values.get('--wrangler-lockfile')
	};
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		console.log(
			JSON.stringify(
				finalizePublicTemplateOgReleaseArtifact(
					parsePublicTemplateOgFinalizerArgs(process.argv.slice(2))
				)
			)
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
