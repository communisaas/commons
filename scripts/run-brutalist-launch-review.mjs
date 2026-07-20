import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	watch as watchDirectory,
	writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	BRUTALIST_PACKAGE_INTEGRITY,
	BRUTALIST_PACKAGE_JSON_SHA256,
	BRUTALIST_PACKAGE_VERSION,
	BRUTALIST_ENTRYPOINT_SHA256,
	BRUTALIST_SIGNATURE_NAMESPACE,
	BRUTALIST_SDK_VERSION,
	BRUTALIST_RUNTIME_FILE_COUNT,
	BRUTALIST_RUNTIME_SHA256,
	BRUTALIST_RUNTIME_TOTAL_BYTES,
	DEFAULT_EVIDENCE_PATH,
	GENERATED_PROOF_PATHS,
	REQUIRED_REQUEST_CLIS,
	REQUIRED_REVIEWERS,
	assertRepositoryRoot,
	assertSourceCommitHasNoProofs,
	buildBrutalistLaunchContext,
	canonicalEvidenceBytes,
	canonicalSha256,
	computeDirectoryFingerprint,
	computeGitSnapshotFingerprint,
	computeGitTreeFingerprint,
	extractBrutalistReviewerEvidence,
	extractMcpResponseText,
	invariant,
	parseBrutalistMcpPage,
	readGitSnapshot,
	reconstructBrutalistMcpPages,
	sha256
} from './verify-brutalist-attestation.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;
const MCP_REQUEST_TIMEOUT_MS = 2 * 60 * 60 * 1000 + 10 * 60 * 1000;
const MCP_TOTAL_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const MAX_CAPTURE_PAGES = 1_000;

/** @param {string} repoRoot @param {string[]} args */
function git(repoRoot, args) {
	return execFileSync('git', args, {
		cwd: repoRoot,
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024
	});
}

/** @param {string} repoRoot @param {string[]} args */
function gitPaths(repoRoot, args) {
	return git(repoRoot, [...args, '-z'])
		.split('\0')
		.filter(Boolean);
}

/** @param {string} repoRoot */
export function assertCleanReviewSource(repoRoot) {
	const dirty = new Set([
		...gitPaths(repoRoot, ['diff', '--name-only']),
		...gitPaths(repoRoot, ['diff', '--cached', '--name-only']),
		...gitPaths(repoRoot, ['ls-files', '--others', '--exclude-standard'])
	]);
	const proofPaths = new Set(GENERATED_PROOF_PATHS);
	const nonProof = [...dirty].filter((entry) => !proofPaths.has(entry)).sort();
	invariant(
		nonProof.length === 0,
		`Brutalist review requires a clean committed source tree; dirty non-proof paths: ${nonProof.join(', ')}`
	);
	return [...dirty].sort();
}

/** @param {string} root @param {boolean} readOnly */
function setDirectoryReadOnly(root, readOnly) {
	/** @param {string} directory */
	const visit = (directory) => {
		if (!readOnly) chmodSync(directory, 0o700);
		for (const name of readdirSync(directory)) {
			const child = path.join(directory, name);
			const stat = lstatSync(child);
			invariant(!stat.isSymbolicLink(), `Review snapshot unexpectedly contains symlink: ${child}`);
			if (stat.isDirectory()) visit(child);
			else if (stat.isFile()) {
				const executable = (stat.mode & 0o111) !== 0;
				chmodSync(child, readOnly ? (executable ? 0o555 : 0o444) : executable ? 0o700 : 0o600);
			}
		}
		if (readOnly) chmodSync(directory, 0o555);
	};
	visit(root);
}

/**
 * Materialize the exact committed blobs as read-only review data. Reading the
 * blobs directly is load-bearing: `git archive` would honor candidate-owned
 * `export-subst` and could show reviewers bytes that were never committed.
 *
 * @param {{ repoRoot: string; commitSha: string }} input
 */
export function materializeReadOnlyReviewSnapshot({ repoRoot, commitSha }) {
	const source = computeGitTreeFingerprint({ repoRoot, commitSha });
	const expectedMaterialized = computeGitSnapshotFingerprint({ repoRoot, commitSha });
	const snapshot = readGitSnapshot({ repoRoot, commitSha });
	const container = mkdtempSync(path.join(os.tmpdir(), 'commons-brutalist-snapshot-'));
	const root = path.join(container, 'source');
	mkdirSync(root, { mode: 0o700 });
	try {
		for (const file of snapshot.files) {
			const target = path.join(root, file.path);
			mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
			writeFileSync(target, file.contents, { mode: file.mode === '100755' ? 0o700 : 0o600 });
		}
		const materialized = computeDirectoryFingerprint({ root });
		invariant(
			materialized.fileCount === source.fileCount &&
				materialized.fileCount === expectedMaterialized.fileCount &&
				materialized.totalBytes === expectedMaterialized.totalBytes &&
				materialized.digest === expectedMaterialized.digest,
			'Detached snapshot bytes or modes do not match the reviewed Git tree.'
		);
		setDirectoryReadOnly(root, true);
		return {
			root,
			container,
			source,
			materialized,
			cleanup() {
				try {
					setDirectoryReadOnly(root, false);
				} finally {
					rmSync(container, { recursive: true, force: true });
				}
			}
		};
	} catch (error) {
		rmSync(container, { recursive: true, force: true });
		throw error;
	}
}

/** @param {string} repoRoot */
function createCaptureJournal(repoRoot) {
	const gitDirectory = git(repoRoot, ['rev-parse', '--absolute-git-dir']).trim();
	const root = mkdtempSync(path.join(gitDirectory, 'brutalist-capture-'));
	return {
		root,
		/** @param {string} name @param {unknown} value */
		write(name, value) {
			const target = path.join(root, name);
			const temporary = `${target}.tmp`;
			writeFileSync(temporary, canonicalEvidenceBytes(value), { mode: 0o600 });
			renameSync(temporary, target);
		},
		remove() {
			rmSync(root, { recursive: true, force: true });
		}
	};
}

/** @param {string} command @param {string[]} args */
function commandOutput(command, args) {
	return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

function resolveBrutalistEntrypoint() {
	let requested = process.env.BRUTALIST_MCP_BIN?.trim();
	if (!requested) {
		try {
			requested = commandOutput('volta', ['which', 'brutalist-mcp']);
		} catch {
			requested = commandOutput('which', ['brutalist-mcp']);
		}
	}
	const entrypoint = realpathSync(requested);
	const packageRoot = path.dirname(path.dirname(entrypoint));
	const packageJsonPath = path.join(packageRoot, 'package.json');
	const packageJsonBytes = readFileSync(packageJsonPath);
	const packageJson = JSON.parse(packageJsonBytes.toString('utf8'));
	invariant(
		packageJson.name === '@brutalist/mcp',
		'Resolved Brutalist binary is not @brutalist/mcp.'
	);
	invariant(
		packageJson.version === BRUTALIST_PACKAGE_VERSION,
		`Resolved @brutalist/mcp ${packageJson.version}; ${BRUTALIST_PACKAGE_VERSION} is required.`
	);
	const sdkRoot = path.join(packageRoot, 'node_modules', '@modelcontextprotocol', 'sdk');
	const sdkPackage = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
	const packageJsonSha256 = sha256(packageJsonBytes);
	const entrypointSha256 = sha256(readFileSync(entrypoint));
	const runtime = computeDirectoryFingerprint({
		root: packageRoot,
		domain: 'commons-brutalist-mcp-runtime-v1',
		allowInternalSymlinks: true
	});
	invariant(
		packageJsonSha256 === BRUTALIST_PACKAGE_JSON_SHA256,
		'Resolved @brutalist/mcp package.json does not match the pinned 1.18.8 build.'
	);
	invariant(
		entrypointSha256 === BRUTALIST_ENTRYPOINT_SHA256,
		'Resolved @brutalist/mcp entrypoint does not match the pinned 1.18.8 build.'
	);
	invariant(
		sdkPackage.version === BRUTALIST_SDK_VERSION,
		'Resolved @brutalist/mcp SDK dependency does not match the pinned build.'
	);
	invariant(
		runtime.digest === BRUTALIST_RUNTIME_SHA256 &&
			runtime.fileCount === BRUTALIST_RUNTIME_FILE_COUNT &&
			runtime.totalBytes === BRUTALIST_RUNTIME_TOTAL_BYTES,
		'Resolved @brutalist/mcp runtime tree does not match the pinned build.'
	);
	return {
		entrypoint,
		packageRoot,
		packageJsonSha256,
		entrypointSha256,
		runtimeSha256: runtime.digest,
		runtimeFileCount: runtime.fileCount,
		runtimeTotalBytes: runtime.totalBytes,
		sdkRoot,
		sdkVersion: sdkPackage.version
	};
}

function captureCliVersions() {
	const agyHomeBinary = path.join(os.homedir(), '.local', 'bin', 'agy');
	const agyBinary =
		process.env.AGY_BIN?.trim() || (existsSync(agyHomeBinary) ? agyHomeBinary : 'agy');
	const claudeBinary = commandOutput('which', ['claude']);
	const codexBinary = commandOutput('which', ['codex']);
	const versions = {
		agy: commandOutput(agyBinary, ['--version']),
		claude: commandOutput(claudeBinary, ['--version']),
		codex: commandOutput(codexBinary, ['--version'])
	};
	for (const [reviewer, version] of Object.entries(versions)) {
		invariant(version.length > 0, `${reviewer} CLI version probe returned no evidence.`);
	}
	const executableDirectories = [
		path.dirname(agyBinary),
		path.dirname(claudeBinary),
		path.dirname(codexBinary),
		path.dirname(realpathSync(agyBinary)),
		path.dirname(realpathSync(claudeBinary)),
		path.dirname(realpathSync(codexBinary)),
		path.dirname(process.execPath),
		'/usr/local/bin',
		'/usr/bin',
		'/bin',
		'/usr/sbin',
		'/sbin'
	];
	return {
		agyBinary: realpathSync(agyBinary),
		pathValue: [...new Set(executableDirectories)].join(path.delimiter),
		versions
	};
}

/**
 * Build the deterministic MCP child environment. In particular, inherited
 * PR-diff injection would silently turn a full-repository review into a
 * changed-files-only review in @brutalist/mcp 1.18.8.
 *
 * @param {{ agyBinary: string; pathValue: string; reviewHome: string; environment?: Record<string, string | undefined> }} input
 */
export function buildBrutalistChildEnvironment({
	agyBinary,
	pathValue,
	reviewHome,
	environment = process.env
}) {
	invariant(path.isAbsolute(reviewHome), 'BRUTALIST_REVIEW_HOME must be absolute.');
	/** @type {Record<string, string>} */
	const childEnv = {};
	for (const name of [
		'LANG',
		'LC_ALL',
		'LC_CTYPE',
		'TZ',
		'SHELL',
		'USER',
		'LOGNAME',
		'TERM',
		'TMPDIR',
		'TMP',
		'TEMP',
		'ANTHROPIC_API_KEY',
		'CLAUDE_CODE_OAUTH_TOKEN',
		'OPENAI_API_KEY',
		'ANTIGRAVITY_EXECUTABLE_DATA_DIR'
	]) {
		if (typeof environment[name] === 'string' && environment[name]) {
			childEnv[name] = environment[name];
		}
	}
	childEnv.PATH = pathValue;
	childEnv.HOME = reviewHome;
	childEnv.AGY_BIN = agyBinary;
	childEnv.AGY_CLI_DISABLE_AUTO_UPDATE = '1';
	childEnv.BRUTALIST_CACHE_TTL_HOURS = '4';
	childEnv.BRUTALIST_TIMEOUT = String(2 * 60 * 60 * 1000);
	childEnv.BRUTALIST_CLI_CHECK_TIMEOUT = '10000';
	childEnv.BRUTALIST_MAX_BUFFER = String(10 * 1024 * 1024);
	childEnv.BRUTALIST_MAX_CONCURRENT = '3';
	childEnv.BRUTALIST_HTTP = 'false';
	childEnv.CODEX_USE_JSON = 'true';
	return childEnv;
}

/**
 * Capture unsigned raw evidence. This trusted builder never reads a signing
 * key; signing and finalization are separate, explicit operations.
 *
 * @param {{ baseSha: string; repoRoot?: string; operatorPrincipal?: string; repositoryId?: string; repositorySlug?: string }} options
 */
export async function runBrutalistLaunchReview({
	baseSha,
	repoRoot = process.cwd(),
	operatorPrincipal = process.env.BRUTALIST_OPERATOR_PRINCIPAL?.trim() ?? '',
	repositoryId = process.env.BRUTALIST_REPOSITORY_ID?.trim() ?? '',
	repositorySlug = process.env.BRUTALIST_REPOSITORY_SLUG?.trim() ?? ''
}) {
	const absoluteRoot = assertRepositoryRoot(repoRoot);
	invariant(SHA_RE.test(baseSha), 'BRUTALIST_BASE_SHA must be the exact lowercase PR base SHA.');
	invariant(
		/^[A-Za-z0-9._@+-]{1,120}$/u.test(operatorPrincipal),
		'BRUTALIST_OPERATOR_PRINCIPAL must explicitly name the enrolled dedicated signer.'
	);
	invariant(
		/^\d+$/u.test(repositoryId),
		'BRUTALIST_REPOSITORY_ID must be an immutable numeric ID.'
	);
	invariant(
		/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repositorySlug),
		'BRUTALIST_REPOSITORY_SLUG must be an owner/name repository identity.'
	);
	git(absoluteRoot, ['cat-file', '-e', `${baseSha}^{commit}`]);
	const reviewedHeadSha = git(absoluteRoot, ['rev-parse', 'HEAD']).trim();
	git(absoluteRoot, ['merge-base', '--is-ancestor', baseSha, reviewedHeadSha]);
	assertSourceCommitHasNoProofs({ repoRoot: absoluteRoot, commitSha: reviewedHeadSha });
	assertCleanReviewSource(absoluteRoot);
	for (const proofPath of GENERATED_PROOF_PATHS) {
		rmSync(path.join(absoluteRoot, proofPath), { force: true });
	}
	const brutalist = resolveBrutalistEntrypoint();
	const cliRuntime = captureCliVersions();
	const cliVersions = cliRuntime.versions;
	const { Client } = await import(
		pathToFileURL(path.join(brutalist.sdkRoot, 'dist', 'esm', 'client', 'index.js')).href
	);
	const { StdioClientTransport } = await import(
		pathToFileURL(path.join(brutalist.sdkRoot, 'dist', 'esm', 'client', 'stdio.js')).href
	);
	const reviewHomeInput = process.env.BRUTALIST_REVIEW_HOME?.trim() ?? '';
	invariant(
		path.isAbsolute(reviewHomeInput) && existsSync(reviewHomeInput),
		'BRUTALIST_REVIEW_HOME must name a provisioned, isolated reviewer home.'
	);
	const reviewHome = realpathSync(reviewHomeInput);
	invariant(
		reviewHome !== realpathSync(os.homedir()) &&
			!reviewHome.startsWith(`${absoluteRoot}${path.sep}`),
		'BRUTALIST_REVIEW_HOME must be separate from the operator home and candidate repository.'
	);
	const childEnv = buildBrutalistChildEnvironment({
		agyBinary: cliRuntime.agyBinary,
		pathValue: cliRuntime.pathValue,
		reviewHome
	});
	const snapshot = materializeReadOnlyReviewSnapshot({
		repoRoot: absoluteRoot,
		commitSha: reviewedHeadSha
	});
	let snapshotMutated = false;
	let watcher;
	try {
		watcher = watchDirectory(snapshot.root, { recursive: true }, () => {
			snapshotMutated = true;
		});
	} catch (error) {
		snapshot.cleanup();
		throw new Error(
			`Unable to monitor detached review snapshot: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
	const sourceFingerprint = `sha256:${snapshot.source.digest}`;
	const context = buildBrutalistLaunchContext({
		sourceFingerprint,
		sourceFileCount: snapshot.source.fileCount,
		baseSha,
		reviewedHeadSha
	});
	const request = {
		tool: 'roast',
		arguments: {
			domain: 'codebase',
			target: snapshot.root,
			context,
			clis: REQUIRED_REQUEST_CLIS,
			force_refresh: true,
			verbose: true,
			limit: 100000
		}
	};
	const requestSha256 = canonicalSha256(request);
	const journal = createCaptureJournal(absoluteRoot);
	journal.write('request.json', request);
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [brutalist.entrypoint],
		cwd: snapshot.root,
		env: childEnv,
		stderr: 'inherit'
	});
	const client = new Client({ name: 'commons-brutalist-launch-attestor', version: '3.0.0' });
	const pages = [];
	let contextId;
	let completed = false;
	try {
		await client.connect(transport);
		const server = client.getServerVersion();
		invariant(server?.name === 'brutalist-mcp', 'Connected MCP server has the wrong identity.');
		invariant(
			server.version === BRUTALIST_PACKAGE_VERSION,
			`Connected MCP server reported ${server.version}; ${BRUTALIST_PACKAGE_VERSION} is required.`
		);
		const roster = /** @type {{ tools: Array<{ name: string }> }} */ (await client.listTools());
		invariant(
			roster.tools.some((tool) => tool.name === 'roast'),
			'Pinned MCP server does not expose roast.'
		);

		/** @type {Record<string, any>} */
		let call = request;
		const seenOffsets = new Set();
		for (let index = 1; index <= MAX_CAPTURE_PAGES; index += 1) {
			const response = await client.callTool(
				{ name: call.tool, arguments: call.arguments },
				undefined,
				{
					timeout: MCP_REQUEST_TIMEOUT_MS,
					maxTotalTimeout: MCP_TOTAL_TIMEOUT_MS,
					resetTimeoutOnProgress: true,
					onprogress: () => {}
				}
			);
			const parsed = parseBrutalistMcpPage(extractMcpResponseText(response));
			contextId ??= parsed.contextId;
			invariant(parsed.contextId === contextId, `MCP context changed on page ${index}.`);
			const page = {
				index,
				call,
				callSha256: canonicalSha256(call),
				contextId: parsed.contextId,
				range: parsed.range,
				responseSha256: canonicalSha256(response),
				response
			};
			pages.push(page);
			journal.write(`page-${String(index).padStart(4, '0')}.json`, page);
			if (!parsed.range.hasMore) break;
			const nextOffset = parsed.range.nextOffset;
			invariant(
				nextOffset !== null && !seenOffsets.has(nextOffset),
				'MCP pagination repeated an offset.'
			);
			seenOffsets.add(nextOffset);
			call = {
				tool: 'roast',
				arguments: {
					domain: 'codebase',
					target: snapshot.root,
					context_id: contextId,
					offset: nextOffset,
					limit: 100000,
					verbose: true
				}
			};
		}
		const lastPage = pages.at(-1);
		invariant(lastPage, 'MCP returned no review page.');
		invariant(
			pages.length < MAX_CAPTURE_PAGES || !lastPage.range.hasMore,
			'MCP pagination exceeded the page bound.'
		);
		invariant(typeof contextId === 'string' && contextId.length > 0, 'MCP returned no context ID.');

		const reconstructed = reconstructBrutalistMcpPages(pages);
		const reviewers = extractBrutalistReviewerEvidence(reconstructed.content);
		await new Promise((resolve) => setTimeout(resolve, 25));
		const sourceAfter = computeDirectoryFingerprint({ root: snapshot.root });
		invariant(!snapshotMutated, 'Detached review snapshot received a filesystem mutation event.');
		invariant(
			sourceAfter.digest === snapshot.materialized.digest &&
				sourceAfter.fileCount === snapshot.materialized.fileCount &&
				sourceAfter.totalBytes === snapshot.materialized.totalBytes,
			'Detached review snapshot changed while the Brutalist review was running.'
		);
		invariant(
			git(absoluteRoot, ['rev-parse', 'HEAD']).trim() === reviewedHeadSha,
			'Repository HEAD changed during review.'
		);
		assertCleanReviewSource(absoluteRoot);

		const reviewedAt = new Date().toISOString();
		const mcp = {
			packageName: '@brutalist/mcp',
			packageVersion: BRUTALIST_PACKAGE_VERSION,
			packageIntegrity: BRUTALIST_PACKAGE_INTEGRITY,
			packageJsonSha256: brutalist.packageJsonSha256,
			entrypointSha256: brutalist.entrypointSha256,
			runtimeSha256: brutalist.runtimeSha256,
			runtimeFileCount: brutalist.runtimeFileCount,
			runtimeTotalBytes: brutalist.runtimeTotalBytes,
			sdkVersion: brutalist.sdkVersion,
			server
		};
		const evidence = {
			schemaVersion: 2,
			kind: 'commons.brutalist.raw-evidence',
			capturedAt: reviewedAt,
			repository: { id: repositoryId, slug: repositorySlug },
			operator: {
				principal: operatorPrincipal,
				signatureNamespace: BRUTALIST_SIGNATURE_NAMESPACE
			},
			baseSha,
			reviewedHeadSha,
			sourceFingerprint,
			sourceFileCount: snapshot.source.fileCount,
			snapshot: {
				format: 'git-blobs-read-only-v1',
				target: snapshot.root,
				fingerprint: `sha256:${snapshot.materialized.digest}`,
				fileCount: snapshot.materialized.fileCount,
				totalBytes: snapshot.materialized.totalBytes
			},
			mcp,
			cliVersions,
			request,
			requestSha256,
			contextId,
			pages,
			reconstructedResponseSha256: sha256(reconstructed.content),
			reviewers
		};
		const evidenceBytes = canonicalEvidenceBytes(evidence);
		const evidenceSha256 = sha256(evidenceBytes);
		const allReviewersPassed = reviewers.every(
			(reviewer) =>
				reviewer.success &&
				reviewer.verdict === 'pass' &&
				reviewer.openP0 === 0 &&
				reviewer.openP1 === 0
		);
		const proofDirectory = path.dirname(path.join(absoluteRoot, DEFAULT_EVIDENCE_PATH));
		mkdirSync(proofDirectory, { recursive: true });
		const evidenceTarget = path.join(absoluteRoot, DEFAULT_EVIDENCE_PATH);
		const evidenceTemporary = `${evidenceTarget}.tmp`;
		writeFileSync(evidenceTemporary, evidenceBytes, { mode: 0o600 });
		renameSync(evidenceTemporary, evidenceTarget);
		completed = true;
		journal.remove();

		if (!allReviewersPassed) {
			throw new Error(
				'Raw signed-ready evidence was captured, but at least one critic failed or retained launch blockers.'
			);
		}
		return { evidence, evidenceSha256 };
	} finally {
		await client.close().catch(() => transport.close().catch(() => {}));
		watcher.close();
		snapshot.cleanup();
		if (!completed) {
			console.error(`Incomplete Brutalist capture journal retained at ${journal.root}`);
		}
	}
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const baseSha = process.env.BRUTALIST_BASE_SHA?.trim() ?? '';
		const result = await runBrutalistLaunchReview({ baseSha });
		console.log(
			`Unsigned Brutalist evidence captured: context_id=${result.evidence.contextId}; ` +
				`fingerprint=${result.evidence.sourceFingerprint}; reviewed_head=${result.evidence.reviewedHeadSha}; ` +
				`evidence_sha256=${result.evidenceSha256}. ` +
				'Do not sign it until the isolated capture environment is destroyed and its credentials are revoked.'
		);
	} catch (error) {
		console.error(
			`Brutalist launch capture failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exit(1);
	}
}
