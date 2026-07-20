#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	PAGES_FINALIZATION_RECORD,
	validateFinalizedPagesWorker
} from './finalize-pages-release-artifact.mjs';
import {
	PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY,
	PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD,
	validateFinalizedPublicTemplateOgArtifact
} from './finalize-public-template-og-release-artifact.mjs';
import { validateTrustedReleaseWorkerArtifact } from './finalize-trusted-release-worker.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const BRANCHES = new Set(['production', 'main', 'staging']);
const MODES = new Set(['normal', 'containment']);
const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024;
const MAX_DEPTH = 32;

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {string} value */
function assertSafeName(value) {
	invariant(
		value.length > 0 &&
			value !== '.' &&
			value !== '..' &&
			!value.includes('/') &&
			!value.includes('\\') &&
			!/\p{Cc}/u.test(value),
		`Release artifact contains an unsafe path segment: ${JSON.stringify(value)}.`
	);
}

/**
 * Treat the candidate-built artifact only as bounded filesystem data. No file
 * in this tree is imported, spawned, sourced, or used as deployment tooling.
 *
 * @param {string} root
 */
export function inspectArtifactTree(root) {
	const absoluteRoot = realpathSync(path.resolve(root));
	const rootStat = lstatSync(absoluteRoot);
	invariant(rootStat.isDirectory(), 'Release artifact root must be a directory.');
	let files = 0;
	let bytes = 0;
	/** @type {string[]} */
	const relativeFiles = [];
	/** @type {Array<{ absolute: string; relative: string; depth: number }>} */
	const pending = [{ absolute: absoluteRoot, relative: '', depth: 0 }];

	while (pending.length > 0) {
		const directory = pending.pop();
		invariant(directory, 'Release artifact traversal failed.');
		invariant(directory.depth <= MAX_DEPTH, 'Release artifact exceeds the directory depth limit.');
		const entries = readdirSync(directory.absolute, { withFileTypes: true }).sort((left, right) =>
			Buffer.from(left.name).compare(Buffer.from(right.name))
		);
		for (const entry of entries) {
			assertSafeName(entry.name);
			const relative = directory.relative ? `${directory.relative}/${entry.name}` : entry.name;
			const absolute = path.join(directory.absolute, entry.name);
			const stat = lstatSync(absolute);
			invariant(!stat.isSymbolicLink(), `Release artifact forbids symbolic links: ${relative}.`);
			if (stat.isDirectory()) {
				pending.push({ absolute, relative, depth: directory.depth + 1 });
				continue;
			}
			invariant(stat.isFile(), `Release artifact forbids special files: ${relative}.`);
			invariant(stat.size <= MAX_FILE_BYTES, `Release artifact file exceeds limit: ${relative}.`);
			files += 1;
			bytes += stat.size;
			invariant(files <= MAX_FILES, 'Release artifact exceeds the file-count limit.');
			invariant(bytes <= MAX_TOTAL_BYTES, 'Release artifact exceeds the total-byte limit.');
			relativeFiles.push(relative);
		}
	}

	return { root: absoluteRoot, files, bytes, relativeFiles: relativeFiles.sort() };
}

/**
 * @param {{ artifactRoot: string; expectedSourceSha: string; expectedTrustedGateSha: string; expectedMode: string; expectedBranch: string; expectedPublicRuntime: Record<string, string> }} options
 */
export function validatePagesReleaseArtifact({
	artifactRoot,
	expectedSourceSha,
	expectedTrustedGateSha,
	expectedMode,
	expectedBranch,
	expectedPublicRuntime
}) {
	invariant(SHA_RE.test(expectedSourceSha), 'Expected release source must be an exact SHA.');
	invariant(SHA_RE.test(expectedTrustedGateSha), 'Expected trusted gate must be an exact SHA.');
	invariant(MODES.has(expectedMode), 'Expected release mode is invalid.');
	invariant(BRANCHES.has(expectedBranch), 'Expected release branch is invalid.');
	invariant(
		expectedMode !== 'containment' || expectedBranch === 'production',
		'Containment artifacts are production-only.'
	);

	const tree = inspectArtifactTree(artifactRoot);
	const topLevel = new Set(
		readdirSync(tree.root, { withFileTypes: true }).map((entry) => entry.name)
	);
	const expectedTopLevel = new Set(['pages', 'release-metadata.json']);
	const expectsGate = expectedMode === 'normal';
	const expectsWorkBudget = expectedMode === 'normal' && expectedBranch === 'production';
	const expectsTrustedPagesEdge = expectedMode === 'normal';
	const expectsOgConsumer = expectedMode === 'normal';
	const expectsCron = expectedMode === 'normal' && expectedBranch === 'production';
	if (expectsGate && expectedBranch === 'production') expectedTopLevel.add('manifest-gate');
	if (expectsGate) expectedTopLevel.add('manifest-gate-nonprod');
	if (expectsWorkBudget) expectedTopLevel.add('convex-work-budget');
	if (expectsTrustedPagesEdge) {
		expectedTopLevel.add(
			expectedBranch === 'production' ? 'trusted-pages-edge' : 'trusted-pages-edge-staging'
		);
	}
	if (expectedMode === 'normal') expectedTopLevel.add(PAGES_FINALIZATION_RECORD);
	if (expectsOgConsumer) {
		expectedTopLevel.add(PUBLIC_TEMPLATE_OG_ARTIFACT_DIRECTORY);
		expectedTopLevel.add(PUBLIC_TEMPLATE_OG_FINALIZATION_RECORD);
	}
	if (expectsCron) expectedTopLevel.add('manifest-cron');
	invariant(
		topLevel.size === expectedTopLevel.size &&
			[...topLevel].every((entry) => expectedTopLevel.has(entry)),
		`Release artifact top-level entries are not exact: ${[...topLevel].sort().join(', ')}.`
	);

	const workerPath = path.join(tree.root, 'pages', '_worker.js');
	const workerStat = lstatSync(workerPath);
	invariant(
		workerStat.isFile() && workerStat.size > 0,
		'Pages artifact needs a non-empty _worker.js.'
	);
	const pagesFinalization =
		expectedMode === 'normal' ? validateFinalizedPagesWorker(tree.root) : undefined;
	const trustedSourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const ogFinalization = expectsOgConsumer
		? validateFinalizedPublicTemplateOgArtifact(
				tree.root,
				path.join(trustedSourceRoot, 'wrangler.public-template-og.toml')
			)
		: undefined;
	const manifestGateProductionFinalization =
		expectsGate && expectedBranch === 'production'
			? validateTrustedReleaseWorkerArtifact(tree.root, trustedSourceRoot, 'manifest-gate')
			: undefined;
	const manifestGatePreviewFinalization = expectsGate
		? validateTrustedReleaseWorkerArtifact(tree.root, trustedSourceRoot, 'manifest-gate-nonprod')
		: undefined;
	const workBudgetFinalization = expectsWorkBudget
		? validateTrustedReleaseWorkerArtifact(tree.root, trustedSourceRoot, 'convex-work-budget')
		: undefined;
	const manifestCronFinalization = expectsCron
		? validateTrustedReleaseWorkerArtifact(tree.root, trustedSourceRoot, 'manifest-cron')
		: undefined;
	const trustedPagesEdgeFinalization = expectsTrustedPagesEdge
		? validateTrustedReleaseWorkerArtifact(
				tree.root,
				trustedSourceRoot,
				expectedBranch === 'production' ? 'trusted-pages-edge' : 'trusted-pages-edge-staging'
			)
		: undefined;
	if (expectsGate) {
		const gatePath = path.join(tree.root, 'manifest-gate-nonprod', 'index.js');
		const gateStat = lstatSync(gatePath);
		invariant(
			gateStat.isFile() && gateStat.size > 0,
			'Normal artifact needs manifest-gate-nonprod index.js.'
		);
		if (expectedBranch === 'production') {
			const productionGatePath = path.join(tree.root, 'manifest-gate', 'index.js');
			const productionGateStat = lstatSync(productionGatePath);
			invariant(
				productionGateStat.isFile() && productionGateStat.size > 0,
				'Normal production artifact needs manifest-gate index.js.'
			);
		}
	}
	if (expectsWorkBudget) {
		const budgetPath = path.join(tree.root, 'convex-work-budget', 'index.js');
		const budgetStat = lstatSync(budgetPath);
		invariant(
			budgetStat.isFile() && budgetStat.size > 0,
			'Normal artifact needs convex-work-budget index.js.'
		);
	}
	if (expectsCron) {
		const cronPath = path.join(tree.root, 'manifest-cron', 'index.js');
		const cronStat = lstatSync(cronPath);
		invariant(
			cronStat.isFile() && cronStat.size > 0,
			'Normal production artifact needs cron index.js.'
		);
	}

	const metadataPath = path.join(tree.root, 'release-metadata.json');
	const metadataStat = lstatSync(metadataPath);
	invariant(
		metadataStat.isFile() && metadataStat.size > 0 && metadataStat.size <= MAX_METADATA_BYTES,
		'Release metadata must be a small non-empty ordinary file.'
	);
	const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
	const metadataKeys = [
		'schemaVersion',
		'sourceSha',
		'trustedGateSha',
		'finalizationBoundary',
		'mode',
		'branch',
		'manifestGateIncluded',
		'convexWorkBudgetIncluded',
		'trustedPagesEdgeIncluded',
		'publicTemplateOgConsumerIncluded',
		'manifestCronIncluded',
		'publicRuntime'
	];
	invariant(
		metadata &&
			typeof metadata === 'object' &&
			!Array.isArray(metadata) &&
			Object.keys(metadata).sort().join('\0') === metadataKeys.slice().sort().join('\0'),
		'Release metadata keys are not exact.'
	);
	invariant(metadata?.schemaVersion === 1, 'Release metadata schemaVersion must be 1.');
	invariant(metadata?.sourceSha === expectedSourceSha, 'Release metadata source SHA mismatch.');
	invariant(
		metadata?.trustedGateSha === expectedTrustedGateSha,
		'Release metadata trusted gate SHA mismatch.'
	);
	invariant(
		metadata?.finalizationBoundary ===
			(expectedMode === 'normal'
				? 'fresh-runner-trusted-finalization-v1'
				: 'secret-job-trusted-containment-v1'),
		'Release metadata finalization boundary mismatch.'
	);
	invariant(metadata?.mode === expectedMode, 'Release metadata mode mismatch.');
	invariant(metadata?.branch === expectedBranch, 'Release metadata branch mismatch.');
	invariant(
		metadata?.manifestGateIncluded === expectsGate,
		'Release metadata gate posture mismatch.'
	);
	invariant(
		metadata?.convexWorkBudgetIncluded === expectsWorkBudget,
		'Release metadata Convex work-budget posture mismatch.'
	);
	invariant(
		metadata?.trustedPagesEdgeIncluded === expectsTrustedPagesEdge,
		'Release metadata trusted Pages edge posture mismatch.'
	);
	invariant(
		metadata?.publicTemplateOgConsumerIncluded === expectsOgConsumer,
		'Release metadata public-template OG consumer posture mismatch.'
	);
	invariant(
		metadata?.manifestCronIncluded === expectsCron,
		'Release metadata cron posture mismatch.'
	);
	const runtimeKeys = [
		'PUBLIC_CONVEX_URL',
		'ATLAS_BASE_URL',
		'VITE_ATLAS_BASE_URL',
		'EXPECTED_CELL_MAP_ROOT',
		'EXPECTED_CELL_MAP_DEPTH'
	];
	invariant(
		metadata.publicRuntime &&
			typeof metadata.publicRuntime === 'object' &&
			!Array.isArray(metadata.publicRuntime) &&
			Object.keys(metadata.publicRuntime).sort().join('\0') ===
				runtimeKeys.slice().sort().join('\0'),
		'Release metadata publicRuntime keys are not exact.'
	);
	for (const key of runtimeKeys) {
		invariant(
			typeof expectedPublicRuntime[key] === 'string' && expectedPublicRuntime[key].length > 0,
			`Trusted release context is missing ${key}.`
		);
		invariant(
			metadata.publicRuntime[key] === expectedPublicRuntime[key],
			`Release metadata ${key} does not match the trusted release context.`
		);
	}

	return {
		files: tree.files,
		bytes: tree.bytes,
		sourceSha: expectedSourceSha,
		trustedGateSha: expectedTrustedGateSha,
		finalizationBoundary: metadata.finalizationBoundary,
		mode: expectedMode,
		branch: expectedBranch,
		manifestGateIncluded: expectsGate,
		convexWorkBudgetIncluded: expectsWorkBudget,
		trustedPagesEdgeIncluded: expectsTrustedPagesEdge,
		publicTemplateOgConsumerIncluded: expectsOgConsumer,
		manifestCronIncluded: expectsCron,
		pagesWorkerGzipBytes: pagesFinalization?.bundle.gzipBytes,
		publicTemplateOgWorkerGzipBytes: ogFinalization?.bundle.gzipBytes,
		manifestGateProductionWorkerGzipBytes: manifestGateProductionFinalization?.bundle.gzipBytes,
		manifestGatePreviewWorkerGzipBytes: manifestGatePreviewFinalization?.bundle.gzipBytes,
		convexWorkBudgetWorkerGzipBytes: workBudgetFinalization?.bundle.gzipBytes,
		manifestCronWorkerGzipBytes: manifestCronFinalization?.bundle.gzipBytes,
		trustedPagesEdgeWorkerGzipBytes: trustedPagesEdgeFinalization?.bundle.gzipBytes
	};
}

/** @param {string[]} args */
function parseArgs(args) {
	const values = new Map();
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		invariant(
			[
				'--artifact-root',
				'--expected-source-sha',
				'--expected-trusted-gate-sha',
				'--expected-mode',
				'--expected-branch'
			].includes(argument),
			`Unknown argument: ${argument}.`
		);
		invariant(!values.has(argument), `Duplicate argument: ${argument}.`);
		const value = args[index + 1];
		invariant(value && !value.startsWith('--'), `${argument} requires a value.`);
		values.set(argument, value);
		index += 1;
	}
	for (const option of [
		'--artifact-root',
		'--expected-source-sha',
		'--expected-trusted-gate-sha',
		'--expected-mode',
		'--expected-branch'
	]) {
		invariant(values.has(option), `${option} is required.`);
	}
	return values;
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const values = parseArgs(process.argv.slice(2));
		const result = validatePagesReleaseArtifact({
			artifactRoot: /** @type {string} */ (values.get('--artifact-root')),
			expectedSourceSha: /** @type {string} */ (values.get('--expected-source-sha')),
			expectedTrustedGateSha: /** @type {string} */ (values.get('--expected-trusted-gate-sha')),
			expectedMode: /** @type {string} */ (values.get('--expected-mode')),
			expectedBranch: /** @type {string} */ (values.get('--expected-branch')),
			expectedPublicRuntime: Object.fromEntries(
				[
					'PUBLIC_CONVEX_URL',
					'ATLAS_BASE_URL',
					'VITE_ATLAS_BASE_URL',
					'EXPECTED_CELL_MAP_ROOT',
					'EXPECTED_CELL_MAP_DEPTH'
				].map((key) => [key, process.env[`TRUSTED_${key}`] ?? ''])
			)
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(
			`Pages release artifact rejected: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exit(1);
	}
}
