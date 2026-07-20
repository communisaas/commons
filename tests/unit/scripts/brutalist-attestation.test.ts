import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	buildBrutalistChildEnvironment,
	materializeReadOnlyReviewSnapshot
} from '../../../scripts/run-brutalist-launch-review.mjs';
import { signBrutalistEvidence } from '../../../scripts/sign-brutalist-evidence.mjs';
import {
	createBrutalistProofCommit,
	finalizeBrutalistLaunchReview
} from '../../../scripts/finalize-brutalist-launch-review.mjs';

import {
	BRUTALIST_LAUNCH_VERDICT_PREFIX,
	BRUTALIST_SIGNATURE_NAMESPACE,
	BRUTALIST_ENTRYPOINT_SHA256,
	BRUTALIST_PACKAGE_INTEGRITY,
	BRUTALIST_PACKAGE_JSON_SHA256,
	BRUTALIST_PACKAGE_VERSION,
	BRUTALIST_RUNTIME_FILE_COUNT,
	BRUTALIST_RUNTIME_SHA256,
	BRUTALIST_RUNTIME_TOTAL_BYTES,
	BRUTALIST_SDK_VERSION,
	DEFAULT_ATTESTATION_PATH,
	DEFAULT_EVIDENCE_PATH,
	DEFAULT_REPORT_PATH,
	DEFAULT_SIGNATURE_PATH,
	GENERATED_PROOF_PATHS,
	REQUIRED_REQUEST_CLIS,
	REQUIRED_REVIEWERS,
	assertRepositoryRoot,
	assertProofCommitEnvelope,
	assertSourceCommitHasNoProofs,
	brutalistAttestationRef,
	buildBrutalistLaunchContext,
	canonicalEvidenceBytes,
	canonicalSha256,
	computeGitSnapshotFingerprint,
	computeGitTreeFingerprint,
	computeRepositoryFingerprint,
	extractBrutalistReviewerEvidence,
	renderBrutalistLaunchReport,
	sha256,
	verifyBrutalistAttestation
} from '../../../scripts/verify-brutalist-attestation.mjs';

const TEST_OPERATOR_PRINCIPAL = 'commons-brutalist-test';
const ATTESTATION_RUNBOOK = readFileSync(
	'docs/strategy/public-discovery-release-hypergraph/docs/BRUTALIST-ATTESTATION.md',
	'utf8'
);
const TEST_SIGNING_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'commons-brutalist-signing-'));
const TEST_SIGNING_KEY = path.join(TEST_SIGNING_DIRECTORY, 'operator-ed25519');
const TEST_ALLOWED_SIGNERS = path.join(TEST_SIGNING_DIRECTORY, 'allowed-signers');
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', TEST_SIGNING_KEY]);
writeFileSync(
	TEST_ALLOWED_SIGNERS,
	`${TEST_OPERATOR_PRINCIPAL} namespaces="${BRUTALIST_SIGNATURE_NAMESPACE}" ${readFileSync(`${TEST_SIGNING_KEY}.pub`, 'utf8')}`
);
const TEST_SIGNER_KEY_FINGERPRINT = execFileSync(
	'ssh-keygen',
	['-lf', `${TEST_SIGNING_KEY}.pub`, '-E', 'sha256'],
	{ encoding: 'utf8' }
)
	.trim()
	.split(/\s+/u)[1];

type JsonRecord = Record<string, any>;

interface Fixture {
	root: string;
	baseSha: string;
	reviewedHeadSha: string;
	proofCommitSha: string;
	contextId: string;
	content: string;
}

function git(root: string, args: string[]) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function commit(root: string, message: string) {
	git(root, ['add', '.']);
	git(root, ['commit', '-qm', message]);
	return git(root, ['rev-parse', 'HEAD']);
}

function writeJson(file: string, value: unknown) {
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function proofFiles(root: string) {
	return new Map(
		GENERATED_PROOF_PATHS.map((proofPath) => [
			proofPath,
			readFileSync(path.join(root, proofPath))
		])
	);
}

function rebuildProofCommit(fixture: Fixture) {
	fixture.proofCommitSha = createBrutalistProofCommit({
		repoRoot: fixture.root,
		sourceCommitSha: fixture.reviewedHeadSha,
		capturedAt: readJson(fixture.root, DEFAULT_ATTESTATION_PATH).reviewedAt,
		proofFiles: proofFiles(fixture.root)
	});
}

function createCustomProofCommit(
	fixture: Fixture,
	options: {
		parents?: string[];
		omit?: string;
		extra?: string;
		modeOverrides?: Record<string, string>;
	} = {}
) {
	const indexDirectory = mkdtempSync(path.join(tmpdir(), 'commons-brutalist-proof-index-'));
	const indexPath = path.join(indexDirectory, 'index');
	const env = { ...process.env, GIT_INDEX_FILE: indexPath };
	const gitWithEnv = (args: string[], input?: Buffer | string) =>
		execFileSync('git', args, {
			cwd: fixture.root,
			encoding: 'utf8',
			env,
			input
		}).trim();
	try {
		gitWithEnv(['read-tree', '--empty']);
		const files = proofFiles(fixture.root);
		if (options.extra) files.set(options.extra, Buffer.from('unexpected proof data\n'));
		for (const [proofPath, contents] of files) {
			if (proofPath === options.omit) continue;
			const objectId = gitWithEnv(['hash-object', '-w', '--stdin'], contents);
			const mode = options.modeOverrides?.[proofPath] ?? '100644';
			gitWithEnv(['update-index', '--add', '--cacheinfo', `${mode},${objectId},${proofPath}`]);
		}
		const tree = gitWithEnv(['write-tree']);
		const parents = options.parents ?? [fixture.reviewedHeadSha];
		return gitWithEnv(
			['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent])],
			'custom adversarial proof envelope\n'
		);
	} finally {
		rmSync(indexDirectory, { recursive: true, force: true });
	}
}

function signEvidence(evidenceText: Buffer) {
	return execFileSync(
		'ssh-keygen',
		['-Y', 'sign', '-f', TEST_SIGNING_KEY, '-n', BRUTALIST_SIGNATURE_NAMESPACE, '-'],
		{ input: evidenceText }
	);
}

function readJson(root: string, relativePath: string): JsonRecord {
	return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function reviewerOutput(name: string) {
	return [
		`# ${name} launch review`,
		'',
		`No launch blockers found by ${name}.`,
		`${BRUTALIST_LAUNCH_VERDICT_PREFIX}{"verdict":"pass","findings":[]}`
	].join('\n');
}

function reviewerBlock(name: string, index: number) {
	return [
		`<!-- BRUTALIST_CLI_BEGIN cli="${name}" model="${name}-test-model" exec_ms="${100 + index}" success="true" -->`,
		`### CLI: ${name.toUpperCase()}`,
		'',
		reviewerOutput(name),
		'',
		`<!-- BRUTALIST_CLI_END cli="${name}" -->`
	].join('\n');
}

function rawPageText(
	contextId: string,
	content: string,
	range: {
		start: number;
		end: number;
		total: number;
		chunkIndex: number;
		totalChunks: number;
		hasMore: boolean;
		nextOffset: number | null;
	}
) {
	const status = range.hasMore ? ' • Use offset parameter to continue' : ' • Complete';
	const header = [
		'# Brutalist Analysis Results',
		'',
		`**🔑 Context ID:** ${contextId}`,
		`**📊 Pagination Status:** Part ${range.chunkIndex}/${range.totalChunks}: chars ${range.start}-${range.end} of ${range.total}${status}`,
		'',
		'---',
		'',
		''
	].join('\n');
	const footer = range.hasMore
		? [
				'',
				'',
				'---',
				'',
				`📖 **End of chunk ${range.chunkIndex}/${range.totalChunks}**`,
				`🔄 To continue: Include \`context_id: "${contextId}"\` with \`offset: ${range.nextOffset}\` in next request; omit \`resume\``
			].join('\n')
		: `\n\n---\n\n✅ **Complete analysis shown** (${range.total} characters total)`;
	return `${header}${content}${footer}`;
}

function rawResponse(text: string) {
	return { content: [{ type: 'text', text }] };
}

function makePages({
	request,
	contextId,
	content,
	overlap = 200
}: {
	request: JsonRecord;
	contextId: string;
	content: string;
	overlap?: number;
}) {
	const firstEnd = Math.ceil(content.length * 0.58);
	const secondStart = firstEnd - overlap;
	const ranges = [
		{
			start: 0,
			end: firstEnd,
			total: content.length,
			chunkIndex: 1,
			totalChunks: 2,
			hasMore: true,
			nextOffset: firstEnd
		},
		{
			start: secondStart,
			end: content.length,
			total: content.length,
			chunkIndex: 2,
			totalChunks: 2,
			hasMore: false,
			nextOffset: null
		}
	];
	const calls = [
		structuredClone(request),
		{
			tool: 'roast',
			arguments: {
				domain: 'codebase',
				target: request.arguments.target,
				context_id: contextId,
				offset: firstEnd,
				limit: 100000,
				verbose: true
			}
		}
	];

	return ranges.map((range, index) => {
		const response = rawResponse(
			rawPageText(contextId, content.slice(range.start, range.end), range)
		);
		return {
			index: index + 1,
			requestOffset: index === 0 ? 0 : firstEnd,
			contextId,
			range,
			call: calls[index],
			callSha256: canonicalSha256(calls[index]),
			response,
			responseSha256: canonicalSha256(response)
		};
	});
}

function attestedReviewers(reviewers: JsonRecord[]) {
	return reviewers.map(
		({
			name,
			model,
			success,
			verdict,
			findingsSha256,
			openP0,
			openP1,
			openP2,
			openP3,
			outputSha256
		}) => ({
			name,
			model,
			success,
			verdict,
			findingsSha256,
			openP0,
			openP1,
			openP2,
			openP3,
			outputSha256
		})
	);
}

function makeRepository(): Fixture {
	const root = mkdtempSync(path.join(tmpdir(), 'commons-brutalist-v2-'));
	execFileSync('git', ['init', '-q'], { cwd: root });
	git(root, ['config', 'user.name', 'Attestation Test']);
	git(root, ['config', 'user.email', 'attestation@example.invalid']);
	writeFileSync(path.join(root, 'source.ts'), 'export const bounded = "pending";\n');
	const baseSha = commit(root, 'base');
	writeFileSync(path.join(root, 'source.ts'), 'export const bounded = true;\n');
	const reviewedHeadSha = commit(root, 'reviewed source');

	const fingerprint = computeGitTreeFingerprint({ repoRoot: root, commitSha: reviewedHeadSha });
	const snapshotFingerprint = computeGitSnapshotFingerprint({
		repoRoot: root,
		commitSha: reviewedHeadSha
	});
	const sourceFingerprint = `sha256:${fingerprint.digest}`;
	const contextId = 'brutalist-test-context';
	const request = {
		tool: 'roast',
		arguments: {
			domain: 'codebase',
			target: root,
			context: buildBrutalistLaunchContext({
				sourceFingerprint,
				sourceFileCount: fingerprint.fileCount,
				baseSha,
				reviewedHeadSha
			}),
			clis: [...REQUIRED_REQUEST_CLIS],
			force_refresh: true,
			verbose: true,
			limit: 100000
		}
	};
	const content = REQUIRED_REVIEWERS.map(reviewerBlock).join('\n');
	const reviewers = extractBrutalistReviewerEvidence(content);
	const evidence = {
		schemaVersion: 2,
		kind: 'commons.brutalist.raw-evidence',
		capturedAt: '2026-07-19T00:00:00.000Z',
		repository: { id: '123456789', slug: 'communisaas/commons' },
		baseSha,
		reviewedHeadSha,
		sourceFingerprint,
		sourceFileCount: fingerprint.fileCount,
		snapshot: {
			format: 'git-blobs-read-only-v1',
			target: root,
			fingerprint: `sha256:${snapshotFingerprint.digest}`,
			fileCount: snapshotFingerprint.fileCount,
			totalBytes: snapshotFingerprint.totalBytes
		},
		mcp: {
			packageName: '@brutalist/mcp',
			packageVersion: BRUTALIST_PACKAGE_VERSION,
			packageIntegrity: BRUTALIST_PACKAGE_INTEGRITY,
			packageJsonSha256: BRUTALIST_PACKAGE_JSON_SHA256,
			entrypointSha256: BRUTALIST_ENTRYPOINT_SHA256,
			runtimeSha256: BRUTALIST_RUNTIME_SHA256,
			runtimeFileCount: BRUTALIST_RUNTIME_FILE_COUNT,
			runtimeTotalBytes: BRUTALIST_RUNTIME_TOTAL_BYTES,
			sdkVersion: BRUTALIST_SDK_VERSION,
			server: { name: 'brutalist-mcp', version: BRUTALIST_PACKAGE_VERSION }
		},
		cliVersions: { agy: 'agy-test', claude: 'claude-test', codex: 'codex-test' },
		contextId,
		request,
		requestSha256: canonicalSha256(request),
		pages: makePages({ request, contextId, content }),
		reconstructedResponseSha256: sha256(content),
		reviewers,
		operator: {
			principal: TEST_OPERATOR_PRINCIPAL,
			signatureNamespace: BRUTALIST_SIGNATURE_NAMESPACE
		}
	};

	mkdirSync(path.dirname(path.join(root, DEFAULT_REPORT_PATH)), { recursive: true });
	const evidenceText = canonicalEvidenceBytes(evidence);
	writeFileSync(path.join(root, DEFAULT_EVIDENCE_PATH), evidenceText);
	const evidenceSha256 = sha256(evidenceText);
	const signature = signEvidence(evidenceText);
	writeFileSync(path.join(root, DEFAULT_SIGNATURE_PATH), signature);
	const report = renderBrutalistLaunchReport(evidence, evidenceSha256);
	writeFileSync(path.join(root, DEFAULT_REPORT_PATH), report);
	const attestation = {
		schemaVersion: 3,
		scope: 'launch-foundations-full-repository',
		reviewedAt: '2026-07-19T00:00:00.000Z',
		baseSha,
		reviewedHeadSha,
		repositoryId: '123456789',
		repositorySlug: 'communisaas/commons',
		contextId,
		reportPath: DEFAULT_REPORT_PATH,
		reportSha256: sha256(report),
		evidencePath: DEFAULT_EVIDENCE_PATH,
		evidenceSha256,
		signaturePath: DEFAULT_SIGNATURE_PATH,
		signatureSha256: sha256(signature),
		operatorPrincipal: TEST_OPERATOR_PRINCIPAL,
		signerKeyFingerprint: TEST_SIGNER_KEY_FINGERPRINT,
		sourceFingerprint,
		sourceFileCount: fingerprint.fileCount,
		snapshotFingerprint: evidence.snapshot.fingerprint,
		requestSha256: evidence.requestSha256,
		reconstructedResponseSha256: evidence.reconstructedResponseSha256,
		findings: { openP0: 0, openP1: 0, openP2: 0, openP3: 0, total: 0 },
		reviewers: attestedReviewers(reviewers)
	};
	writeJson(path.join(root, DEFAULT_ATTESTATION_PATH), attestation);
	const proofCommitSha = createBrutalistProofCommit({
		repoRoot: root,
		sourceCommitSha: reviewedHeadSha,
		capturedAt: evidence.capturedAt,
		proofFiles: proofFiles(root)
	});
	return { root, baseSha, reviewedHeadSha, proofCommitSha, contextId, content };
}

function verify(
	fixture: Fixture,
	expectedHeadSha = fixture.reviewedHeadSha,
	proofCommitSha = fixture.proofCommitSha
) {
	return verifyBrutalistAttestation({
		repoRoot: fixture.root,
		expectedBaseSha: fixture.baseSha,
		expectedHeadSha,
		proofCommitSha,
		expectedRepositoryId: '123456789',
		expectedRepositorySlug: 'communisaas/commons',
		allowedSignersPath: TEST_ALLOWED_SIGNERS,
		now: new Date('2026-07-19T00:01:00.000Z')
	});
}

function mutateAttestation(fixture: Fixture, mutate: (attestation: JsonRecord) => void) {
	const attestation = readJson(fixture.root, DEFAULT_ATTESTATION_PATH);
	mutate(attestation);
	writeJson(path.join(fixture.root, DEFAULT_ATTESTATION_PATH), attestation);
	rebuildProofCommit(fixture);
}

function sealEvidence(
	fixture: Fixture,
	evidence: JsonRecord,
	mutateAttestation?: (attestation: JsonRecord) => void
) {
	const attestation = readJson(fixture.root, DEFAULT_ATTESTATION_PATH);
	mutateAttestation?.(attestation);
	const evidenceText = canonicalEvidenceBytes(evidence);
	writeFileSync(path.join(fixture.root, DEFAULT_EVIDENCE_PATH), evidenceText);
	const evidenceSha256 = sha256(evidenceText);
	const signature = signEvidence(evidenceText);
	writeFileSync(path.join(fixture.root, DEFAULT_SIGNATURE_PATH), signature);
	let report = readFileSync(path.join(fixture.root, DEFAULT_REPORT_PATH), 'utf8');
	try {
		report = renderBrutalistLaunchReport(evidence, evidenceSha256);
	} catch {
		// Preserve the prior report so malformed evidence reaches the semantic
		// verifier instead of failing inside this adversarial test helper.
	}
	writeFileSync(path.join(fixture.root, DEFAULT_REPORT_PATH), report);
	attestation.evidenceSha256 = evidenceSha256;
	attestation.signatureSha256 = sha256(signature);
	attestation.reportSha256 = sha256(report);
	writeJson(path.join(fixture.root, DEFAULT_ATTESTATION_PATH), attestation);
	rebuildProofCommit(fixture);
}

function rebindInitialRequest(evidence: JsonRecord, attestation: JsonRecord) {
	evidence.requestSha256 = canonicalSha256(evidence.request);
	evidence.pages[0].call = structuredClone(evidence.request);
	evidence.pages[0].callSha256 = canonicalSha256(evidence.pages[0].call);
	attestation.requestSha256 = evidence.requestSha256;
}

describe('Brutalist launch review attestation v3', () => {
	it('makes the disposable-capture and offline-signing boundary operationally explicit', () => {
		expect(ATTESTATION_RUNBOOK).toMatch(/dedicated operating-system UID/);
		expect(ATTESTATION_RUNBOOK).toMatch(/disposable VM/);
		expect(ATTESTATION_RUNBOOK).toMatch(/operator's normal home or SSH agent/);
		expect(ATTESTATION_RUNBOOK).toMatch(/dedicated signing private key/);
		expect(ATTESTATION_RUNBOOK).toMatch(/protected trusted-base checkout/);
		expect(ATTESTATION_RUNBOOK).toMatch(/control-plane credentials/);
		expect(ATTESTATION_RUNBOOK).toMatch(/host IPC, credential-helper/);
		expect(ATTESTATION_RUNBOOK).toMatch(/signing key physically offline and unmounted/);
		expect(ATTESTATION_RUNBOOK).toMatch(/destroy the capture VM/);
		expect(ATTESTATION_RUNBOOK).toMatch(/revoke every\s+reviewer credential/);
		expect(ATTESTATION_RUNBOOK).toMatch(/before reconnecting the signing key/);
		expect(ATTESTATION_RUNBOOK).toMatch(/Disconnect\s+network access before mounting/);
		expect(ATTESTATION_RUNBOOK).toMatch(/HOME.*is \*\*not containment\*\*/);
	});

	it('makes the MCP child environment full-repository and native-panel deterministic', () => {
		const childEnvironment = buildBrutalistChildEnvironment({
			agyBinary: '/pinned/agy',
			pathValue: '/trusted/bin:/usr/bin:/bin',
			reviewHome: '/isolated/reviewer-home',
			environment: {
				GITHUB_TOKEN: 'must-not-leak',
				CLOUDFLARE_API_TOKEN: 'must-not-leak',
				CONVEX_DEPLOY_KEY: 'must-not-leak',
				ANTHROPIC_API_KEY: 'reviewer-claude-only',
				OPENAI_API_KEY: 'reviewer-codex-only',
				npm_package_version: 'forged',
				BRUTALIST_SUBPROCESS: '1',
				BRUTALIST_PR_DIFF: 'diff --git a/source.ts b/source.ts',
				BRUTALIST_PR_DIFF_FILE: '/tmp/partial.diff',
				BRUTALIST_CLAUDE_CLIENTS: '[{"id":"routed"}]',
				BRUTALIST_MCP_SERVERS: '{"extra":{"command":"false"}}',
				BRUTALIST_AGY_TIMEOUT: '1',
				BRUTALIST_CODEX_ALLOW_MODEL_OVERRIDE: 'true',
				BRUTALIST_MAX_CPU_TIME: '1',
				BRUTALIST_MAX_MEMORY: '1',
				CODEX_CI: '1',
				CODEX_MANAGED_BY_NPM: '1',
				CODEX_MANAGED_PACKAGE_ROOT: '/candidate-controlled',
				CODEX_THREAD_ID: 'parent-session',
				BRUTALIST_HTTP: 'true',
				CODEX_USE_JSON: 'false'
			}
		});

		expect(childEnvironment).toMatchObject({
			PATH: '/trusted/bin:/usr/bin:/bin',
			HOME: '/isolated/reviewer-home',
			ANTHROPIC_API_KEY: 'reviewer-claude-only',
			OPENAI_API_KEY: 'reviewer-codex-only',
			AGY_BIN: '/pinned/agy',
			AGY_CLI_DISABLE_AUTO_UPDATE: '1',
			BRUTALIST_CACHE_TTL_HOURS: '4',
			BRUTALIST_TIMEOUT: '7200000',
			BRUTALIST_CLI_CHECK_TIMEOUT: '10000',
			BRUTALIST_MAX_BUFFER: '10485760',
			BRUTALIST_MAX_CONCURRENT: '3',
			BRUTALIST_HTTP: 'false',
			CODEX_USE_JSON: 'true'
		});
		for (const removed of [
			'GITHUB_TOKEN',
			'CLOUDFLARE_API_TOKEN',
			'CONVEX_DEPLOY_KEY',
			'npm_package_version',
			'BRUTALIST_SUBPROCESS',
			'BRUTALIST_PR_DIFF',
			'BRUTALIST_PR_DIFF_FILE',
			'BRUTALIST_CLAUDE_CLIENTS',
			'BRUTALIST_MCP_SERVERS',
			'BRUTALIST_AGY_TIMEOUT',
			'BRUTALIST_CODEX_ALLOW_MODEL_OVERRIDE',
			'BRUTALIST_MAX_CPU_TIME',
			'BRUTALIST_MAX_MEMORY',
			'CODEX_CI',
			'CODEX_MANAGED_BY_NPM',
			'CODEX_MANAGED_PACKAGE_ROOT',
			'CODEX_THREAD_ID'
		]) {
			expect(childEnvironment).not.toHaveProperty(removed);
		}
	});

	it('rejects a passing terminal verdict that contradicts a P1 in reviewer prose', () => {
		const contradictory = REQUIRED_REVIEWERS.map(reviewerBlock)
			.join('\n')
			.replace('No launch blockers found by agy.', 'P1 launch-blocking auth bypass remains open.');
		expect(() => extractBrutalistReviewerEvidence(contradictory)).toThrow(
			/unstructured severity token/
		);
	});

	it('accepts exact-source evidence from a separate four-blob proof commit', () => {
		const fixture = makeRepository();
		const result = verify(fixture);
		expect(result).toMatchObject({
			contextId: fixture.contextId,
			reviewedHeadSha: fixture.reviewedHeadSha,
			proofCommitSha: fixture.proofCommitSha,
			reviewers: REQUIRED_REVIEWERS
		});
		expect(result.fileCount).toBe(1);
		expect(git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.reviewedHeadSha);
	});

	it('keeps capture, dedicated-key signing, and deterministic finalization separate', () => {
		const fixture = makeRepository();
		const evidenceBytes = readFileSync(path.join(fixture.root, DEFAULT_EVIDENCE_PATH));
		git(fixture.root, ['switch', '-q', '-c', 'unsigned-review', fixture.reviewedHeadSha]);
		mkdirSync(path.dirname(path.join(fixture.root, DEFAULT_EVIDENCE_PATH)), { recursive: true });
		writeFileSync(path.join(fixture.root, DEFAULT_EVIDENCE_PATH), evidenceBytes);
		const evidenceSha256 = sha256(evidenceBytes);
		const signed = signBrutalistEvidence({
			repoRoot: fixture.root,
			signingKey: TEST_SIGNING_KEY,
			operatorPrincipal: TEST_OPERATOR_PRINCIPAL,
			expectedEvidenceSha256: evidenceSha256,
			allowedSignersPath: TEST_ALLOWED_SIGNERS
		});
		expect(signed.keyFingerprint).toBe(TEST_SIGNER_KEY_FINGERPRINT);
		const finalized = finalizeBrutalistLaunchReview({
			repoRoot: fixture.root,
			expectedBaseSha: fixture.baseSha,
			expectedEvidenceSha256: evidenceSha256,
			expectedRepositoryId: '123456789',
			expectedRepositorySlug: 'communisaas/commons',
			allowedSignersPath: TEST_ALLOWED_SIGNERS,
			now: new Date('2026-07-19T00:01:00.000Z')
		});
		expect(finalized.attestation).toMatchObject({
			operatorPrincipal: TEST_OPERATOR_PRINCIPAL,
			signerKeyFingerprint: TEST_SIGNER_KEY_FINGERPRINT,
			schemaVersion: 3
		});
		expect(finalized.proofRef).toBe(brutalistAttestationRef(fixture.reviewedHeadSha));
		expect(git(fixture.root, ['rev-parse', finalized.proofRef])).toBe(
			finalized.proofCommitSha
		);
		expect(git(fixture.root, ['rev-parse', 'HEAD'])).toBe(fixture.reviewedHeadSha);
		for (const proofPath of GENERATED_PROOF_PATHS) {
			expect(existsSync(path.join(fixture.root, proofPath))).toBe(false);
		}
	});

	it('requires the capture evidence digest at both signing and finalization boundaries', () => {
		expect(readFileSync('scripts/run-brutalist-launch-review.mjs', 'utf8')).toContain(
			'evidence_sha256=${result.evidenceSha256}'
		);
		const fixture = makeRepository();
		const actualDigest = sha256(readFileSync(path.join(fixture.root, DEFAULT_EVIDENCE_PATH)));
		expect(() =>
			signBrutalistEvidence({
				repoRoot: fixture.root,
				signingKey: TEST_SIGNING_KEY,
				operatorPrincipal: TEST_OPERATOR_PRINCIPAL,
				expectedEvidenceSha256: '0'.repeat(64),
				allowedSignersPath: TEST_ALLOWED_SIGNERS
			})
		).toThrow(/explicitly approved SHA-256/);
		expect(actualDigest).toMatch(/^[a-f0-9]{64}$/);
		expect(() =>
			finalizeBrutalistLaunchReview({
				repoRoot: fixture.root,
				expectedBaseSha: fixture.baseSha,
				expectedEvidenceSha256: 'f'.repeat(64),
				expectedRepositoryId: '123456789',
				expectedRepositorySlug: 'communisaas/commons',
				allowedSignersPath: TEST_ALLOWED_SIGNERS,
				now: new Date('2026-07-19T00:01:00.000Z')
			})
		).toThrow(/explicitly approved SHA-256/);
	});

	it('materializes only the reviewed Git tree as a detached read-only snapshot', () => {
		const fixture = makeRepository();
		const snapshot = materializeReadOnlyReviewSnapshot({
			repoRoot: fixture.root,
			commitSha: fixture.reviewedHeadSha
		});
		try {
			expect(snapshot.root).not.toBe(fixture.root);
			expect(readFileSync(path.join(snapshot.root, 'source.ts'), 'utf8')).toContain('true');
			expect(statSync(path.join(snapshot.root, 'source.ts')).mode & 0o222).toBe(0);
			for (const proofPath of GENERATED_PROOF_PATHS) {
				expect(existsSync(path.join(snapshot.root, proofPath))).toBe(false);
			}
			expect(snapshot.materialized.fileCount).toBe(snapshot.source.fileCount);
			expect(snapshot.materialized.digest).toBe(
				computeGitSnapshotFingerprint({
					repoRoot: fixture.root,
					commitSha: fixture.reviewedHeadSha
				}).digest
			);
		} finally {
			snapshot.cleanup();
		}
	});

	it('materializes committed blob bytes without applying candidate export-subst attributes', () => {
		const root = mkdtempSync(path.join(tmpdir(), 'commons-brutalist-export-subst-'));
		execFileSync('git', ['init', '-q'], { cwd: root });
		git(root, ['config', 'user.name', 'Attestation Test']);
		git(root, ['config', 'user.email', 'attestation@example.invalid']);
		writeFileSync(path.join(root, '.gitattributes'), 'source.txt export-subst\n');
		writeFileSync(path.join(root, 'source.txt'), 'committed=$Format:%B$\n');
		const head = commit(root, 'candidate-controlled substitution text');
		const snapshot = materializeReadOnlyReviewSnapshot({ repoRoot: root, commitSha: head });
		try {
			expect(readFileSync(path.join(snapshot.root, 'source.txt'), 'utf8')).toBe(
				'committed=$Format:%B$\n'
			);
			expect(snapshot.materialized.digest).toBe(
				computeGitSnapshotFingerprint({ repoRoot: root, commitSha: head }).digest
			);
		} finally {
			snapshot.cleanup();
		}
	});

	it('rejects a nested target instead of silently reviewing a subdirectory', () => {
		const fixture = makeRepository();
		const nested = path.join(fixture.root, 'nested');
		mkdirSync(nested);
		expect(() => assertRepositoryRoot(nested)).toThrow(/Git top-level root/);
	});

	it('rejects gitlinks from the committed review tree', () => {
		const fixture = makeRepository();
		git(fixture.root, [
			'update-index',
			'--add',
			'--cacheinfo',
			`160000,${fixture.reviewedHeadSha},vendor/submodule`
		]);
		git(fixture.root, ['commit', '-qm', 'add gitlink']);
		const gitlinkHead = git(fixture.root, ['rev-parse', 'HEAD']);
		expect(() =>
			computeGitTreeFingerprint({ repoRoot: fixture.root, commitSha: gitlinkHead })
		).toThrow(/gitlinks\/submodules/);
	});

	it.each([
		['model', (attestation: JsonRecord) => (attestation.reviewers[0].model = 'invented-model')],
		[
			'output digest',
			(attestation: JsonRecord) => (attestation.reviewers[0].outputSha256 = '0'.repeat(64))
		],
		['success', (attestation: JsonRecord) => (attestation.reviewers[0].success = false)],
		['verdict', (attestation: JsonRecord) => (attestation.reviewers[0].verdict = 'fail')]
	])('rejects fabricated reviewer %s metadata', (_label, mutate) => {
		const fixture = makeRepository();
		mutateAttestation(fixture, mutate);
		expect(() => verify(fixture)).toThrow(/reviewer metadata is fabricated or stale/);
	});

	it('rejects finding totals asserted independently of the raw reviewer verdicts', () => {
		const fixture = makeRepository();
		mutateAttestation(fixture, (attestation) => {
			attestation.findings.openP1 = 1;
		});
		expect(() => verify(fixture)).toThrow(/finding counts are not derived/);
	});

	it('rejects an otherwise digest-matched report with additional claims', () => {
		const fixture = makeRepository();
		const reportPath = path.join(fixture.root, DEFAULT_REPORT_PATH);
		const report = `${readFileSync(reportPath, 'utf8')}\nUnreviewed launch claim.\n`;
		writeFileSync(reportPath, report);
		const attestation = readJson(fixture.root, DEFAULT_ATTESTATION_PATH);
		attestation.reportSha256 = sha256(report);
		writeJson(path.join(fixture.root, DEFAULT_ATTESTATION_PATH), attestation);
		rebuildProofCommit(fixture);
		expect(() => verify(fixture)).toThrow(/exact canonical rendering/);
	});

	it('rejects cryptographically invalid signature bytes even with a matching digest', () => {
		const fixture = makeRepository();
		const signaturePath = path.join(fixture.root, DEFAULT_SIGNATURE_PATH);
		const signature = readFileSync(signaturePath);
		signature[signature.length - 2] ^= 1;
		writeFileSync(signaturePath, signature);
		const attestation = readJson(fixture.root, DEFAULT_ATTESTATION_PATH);
		attestation.signatureSha256 = sha256(signature);
		writeJson(path.join(fixture.root, DEFAULT_ATTESTATION_PATH), attestation);
		rebuildProofCommit(fixture);
		expect(() => verify(fixture)).toThrow(/not valid for an allowed operator/);
	});

	it('rejects evidence outside the seven-day launch window', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.capturedAt = '2026-07-10T00:00:00.000Z';
		sealEvidence(fixture, evidence, (attestation) => {
			attestation.reviewedAt = evidence.capturedAt;
		});
		expect(() => verify(fixture)).toThrow(/older than the seven-day/);
	});

	it('rejects a fabricated reviewer summary inside an otherwise re-sealed evidence file', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.reviewers[0].executionTimeMs += 1;
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/reviewer records do not match reconstructed MCP output/);
	});

	it('rejects an altered raw MCP page even when the outer evidence envelope is re-sealed', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.pages[0].response.content[0].text += '\nforged';
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/page 1 response digest does not match/);
	});

	it('rejects pagination with no overlap between adjacent MCP pages', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.pages = makePages({
			request: evidence.request,
			contextId: evidence.contextId,
			content: fixture.content,
			overlap: 0
		});
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/overlap/);
	});

	it('rejects a page whose recorded range is missing', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		delete evidence.pages[0].range;
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/recorded range does not match/);
	});

	it('rejects evidence truncated before the final declared page', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.pages = evidence.pages.slice(0, 1);
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/truncated before the final page/);
	});

	it('rejects a raw page with its context header removed', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		const response = evidence.pages[1].response;
		response.content[0].text = response.content[0].text.replace(
			/^\*\*🔑 Context ID:\*\*.*\n/mu,
			''
		);
		evidence.pages[1].responseSha256 = canonicalSha256(response);
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/page is missing its context ID/);
	});

	it('rejects a self-consistent request that is not the exact launch request', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.request.arguments.force_refresh = false;
		sealEvidence(fixture, evidence, (attestation) => {
			rebindInitialRequest(evidence, attestation);
		});
		expect(() => verify(fixture)).toThrow(/must force a fresh analysis/);
	});

	it('rejects evidence attributed to a different package build', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.mcp.packageVersion = '1.18.9';
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/wrong MCP package version/);
	});

	it('rejects a re-sealed evidence file cross-bound to a different source fingerprint', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.sourceFingerprint = `sha256:${'f'.repeat(64)}`;
		sealEvidence(fixture, evidence);
		expect(() => verify(fixture)).toThrow(/source fingerprint does not match the attestation/);
	});

	it('rejects a self-consistent request with a substituted launch context', () => {
		const fixture = makeRepository();
		const evidence = readJson(fixture.root, DEFAULT_EVIDENCE_PATH);
		evidence.request.arguments.context += '\nFABRICATED_SOURCE_CONTEXT: true';
		sealEvidence(fixture, evidence, (attestation) => {
			rebindInitialRequest(evidence, attestation);
		});
		expect(() => verify(fixture)).toThrow(/prompt does not match the exact reviewed source context/);
	});

	it('verifies committed Git objects instead of mutable worktree bytes', () => {
		const fixture = makeRepository();
		writeFileSync(path.join(fixture.root, 'source.ts'), 'export const bounded = false;\n');
		expect(() => verify(fixture)).not.toThrow();
	});

	it('keeps worktree recovery fingerprints narrow without excluding proofs from Git source identity', () => {
		const fixture = makeRepository();
		const before = computeRepositoryFingerprint({ repoRoot: fixture.root });
		for (const proofPath of GENERATED_PROOF_PATHS) {
			writeFileSync(path.join(fixture.root, proofPath), `changed ${proofPath}\n`);
		}
		const afterGeneratedProofChanges = computeRepositoryFingerprint({ repoRoot: fixture.root });
		expect(afterGeneratedProofChanges).toEqual(before);

		writeFileSync(
			path.join(path.dirname(path.join(fixture.root, DEFAULT_ATTESTATION_PATH)), 'unlisted-proof.json'),
			'{}\n'
		);
		const afterUnlistedProof = computeRepositoryFingerprint({ repoRoot: fixture.root });
		expect(afterUnlistedProof.digest).not.toBe(before.digest);
		expect(afterUnlistedProof.fileCount).toBe(before.fileCount + 1);
	});

	it('fingerprints the entire committed source tree and forbids every proof path in source', () => {
		const fixture = makeRepository();
		const before = computeGitTreeFingerprint({
			repoRoot: fixture.root,
			commitSha: fixture.reviewedHeadSha
		});
		git(fixture.root, ['add', DEFAULT_REPORT_PATH]);
		git(fixture.root, ['commit', '-qm', 'candidate embeds approval in source']);
		const poisonedSource = git(fixture.root, ['rev-parse', 'HEAD']);
		const after = computeGitTreeFingerprint({ repoRoot: fixture.root, commitSha: poisonedSource });
		expect(after.fileCount).toBe(before.fileCount + 1);
		expect(after.digest).not.toBe(before.digest);
		expect(() =>
			assertSourceCommitHasNoProofs({ repoRoot: fixture.root, commitSha: poisonedSource })
		).toThrow(/must contain none of the four proof paths/);
	});

	it('stores no proof in source and exactly four regular blobs in the detached proof tree', () => {
		const fixture = makeRepository();
		for (const proofPath of GENERATED_PROOF_PATHS) {
			expect(git(fixture.root, ['ls-tree', '-r', '--name-only', fixture.reviewedHeadSha, '--', proofPath]))
				.toBe('');
		}
		expect(
			git(fixture.root, ['ls-tree', '-r', '--name-only', fixture.proofCommitSha])
				.split('\n')
				.filter(Boolean)
				.sort()
		).toEqual([...GENERATED_PROOF_PATHS].sort());
		expect(() =>
			assertProofCommitEnvelope({
				repoRoot: fixture.root,
				proofCommitSha: fixture.proofCommitSha,
				sourceCommitSha: fixture.reviewedHeadSha
			})
		).not.toThrow();
	});

	it.each([
		[
			'extra path',
			(fixture: Fixture) =>
				createCustomProofCommit(fixture, {
					extra: 'docs/strategy/public-discovery-release-hypergraph/proof/untrusted.txt'
				})
		],
		[
			'missing path',
			(fixture: Fixture) =>
				createCustomProofCommit(fixture, { omit: DEFAULT_SIGNATURE_PATH })
		],
		[
			'wrong mode',
			(fixture: Fixture) =>
				createCustomProofCommit(fixture, {
					modeOverrides: { [DEFAULT_REPORT_PATH]: '100755' }
				})
		],
		[
			'wrong parent',
			(fixture: Fixture) =>
				createCustomProofCommit(fixture, { parents: [fixture.baseSha] })
		],
		[
			'merge commit',
			(fixture: Fixture) =>
				createCustomProofCommit(fixture, {
					parents: [fixture.reviewedHeadSha, fixture.baseSha]
				})
		]
	])('rejects a proof envelope with an %s', (_label, makeInvalidProof) => {
		const fixture = makeRepository();
		const invalidProof = makeInvalidProof(fixture);
		expect(() => verify(fixture, fixture.reviewedHeadSha, invalidProof)).toThrow(
			/Unable to read Brutalist proof artifacts|exactly the four fixed proof blobs|missing path, extra path, or wrong mode|exactly one parent/
		);
	});

	it('rejects proof-ref retargeting to any source head other than the reviewed PR head', () => {
		const fixture = makeRepository();
		expect(() => verify(fixture, fixture.baseSha, fixture.proofCommitSha)).toThrow(
			/exact current PR\/source head/
		);
	});

	it('keeps the pull-request diagnostic base-owned and proof-ref immutable', () => {
		const workflow = readFileSync('.github/workflows/brutalist-review.yml', 'utf8');
		const expression = (value: string) => '$' + '{{ ' + value + ' }}';

		expect(workflow).toContain('name: Brutalist Review (diagnostic)');
		expect(workflow).toMatch(/^\s*pull_request_target:/m);
		expect(workflow).toContain('types: [opened, synchronize, reopened, ready_for_review]');
		expect(workflow).toContain('ref: ' + expression('github.event.pull_request.base.sha'));
		expect(workflow).toContain('path: gate');
		expect(workflow).toContain('persist-credentials: false');
		expect(workflow).toContain(
			'SOURCE_SHA: ' + expression('github.event.pull_request.head.sha')
		);
		expect(workflow).toContain(
			'attestation_ref="refs/heads/brutalist-attestations/$SOURCE_SHA"'
		);
		expect(workflow).toContain('"+$attestation_ref:refs/brutalist/fetched-proof"');
		expect(workflow).toContain(
			"rev-parse --verify 'refs/brutalist/fetched-proof^{commit}'"
		);
		expect(workflow).toContain(
			'echo "proof_commit_sha=$proof_commit_sha" >> "$GITHUB_OUTPUT"'
		);
		expect(workflow).toContain(
			'BRUTALIST_PROOF_COMMIT_SHA: ' +
				expression('steps.fetch_inert_objects.outputs.proof_commit_sha')
		);
		expect(workflow).toContain(
			'BRUTALIST_EXPECTED_BASE_SHA: ' + expression('github.event.pull_request.base.sha')
		);
		expect(workflow).toContain(
			'BRUTALIST_EXPECTED_HEAD_SHA: ' + expression('github.event.pull_request.head.sha')
		);
		expect(workflow).toContain(
			'BRUTALIST_EXPECTED_REPOSITORY_ID: ' + expression('github.repository_id')
		);
		expect(workflow).toContain(
			'BRUTALIST_EXPECTED_REPOSITORY_SLUG: ' + expression('github.repository')
		);
		expect(workflow).toContain(
			'BRUTALIST_REPOSITORY_GIT_DIR: ' +
				expression('runner.temp') +
				'/commons-candidate.git'
		);
		expect(workflow).toContain('run: node gate/scripts/verify-brutalist-attestation.mjs');
		expect(workflow).toContain('ordinary Actions contexts can be spoofed');
		expect(workflow).not.toContain('$' + '{{ secrets.');
		expect(workflow).not.toMatch(/^\s+[a-z-]+:\s+write\s*$/m);
		expect(workflow).not.toMatch(/npm install|curl\s/);
		expect(workflow).not.toContain(
			'ref: ' + expression('github.event.pull_request.head.sha')
		);
		expect(workflow).not.toContain('node scripts/verify-brutalist-attestation.mjs');
		expect(workflow).not.toContain('BASE_REF:');
		expect(workflow).not.toContain('refs/heads/$BASE_REF');
	});
});
