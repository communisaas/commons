import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	DEFAULT_ALLOWED_SIGNERS_PATH,
	DEFAULT_ATTESTATION_PATH,
	DEFAULT_EVIDENCE_PATH,
	DEFAULT_REPORT_PATH,
	DEFAULT_SIGNATURE_PATH,
	GENERATED_PROOF_PATHS,
	assertRepositoryRoot,
	assertProofCommitEnvelope,
	brutalistAttestationRef,
	canonicalEvidenceBytes,
	computeGitTreeFingerprint,
	invariant,
	renderBrutalistLaunchReport,
	sha256,
	verifyBrutalistAttestation,
	verifyEvidenceSignature
} from './verify-brutalist-attestation.mjs';

/**
 * Create the proof-only commit through Git's object plumbing. The temporary
 * index starts empty, so the resulting root tree cannot inherit source files.
 * HEAD and the source branch are never updated.
 *
 * @param {{ repoRoot: string; sourceCommitSha: string; capturedAt: string; proofFiles: Map<string, Buffer> }} options
 */
export function createBrutalistProofCommit({ repoRoot, sourceCommitSha, capturedAt, proofFiles }) {
	const expectedPaths = [...GENERATED_PROOF_PATHS].sort();
	invariant(
		JSON.stringify([...proofFiles.keys()].sort()) === JSON.stringify(expectedPaths),
		'Proof commit builder requires exactly the four fixed proof paths.'
	);
	const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: repoRoot,
		encoding: 'utf8'
	}).trim();
	invariant(
		headBefore === sourceCommitSha,
		'Proof commit builder requires HEAD to remain at the exact reviewed source commit.'
	);
	const gitDirectory = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
		cwd: repoRoot,
		encoding: 'utf8'
	}).trim();
	const indexDirectory = mkdtempSync(path.join(gitDirectory, 'brutalist-proof-index-'));
	const indexPath = path.join(indexDirectory, 'index');
	const objectEnvironment = { ...process.env, GIT_INDEX_FILE: indexPath };
	/** @param {string[]} args @param {Buffer | string | undefined} [input] */
	const git = (args, input) =>
		execFileSync('git', args, {
			cwd: repoRoot,
			encoding: 'utf8',
			input,
			env: objectEnvironment,
			maxBuffer: 64 * 1024 * 1024
		}).trim();
	try {
		git(['read-tree', '--empty']);
		for (const proofPath of expectedPaths) {
			const objectId = git(['hash-object', '-w', '--stdin'], proofFiles.get(proofPath));
			git(['update-index', '--add', '--cacheinfo', `100644,${objectId},${proofPath}`]);
		}
		const treeId = git(['write-tree']);
		const commitEnvironment = {
			...objectEnvironment,
			GIT_AUTHOR_NAME: 'Commons Brutalist Attestor',
			GIT_AUTHOR_EMAIL: 'brutalist-attestor@commons.invalid',
			GIT_AUTHOR_DATE: capturedAt,
			GIT_COMMITTER_NAME: 'Commons Brutalist Attestor',
			GIT_COMMITTER_EMAIL: 'brutalist-attestor@commons.invalid',
			GIT_COMMITTER_DATE: capturedAt
		};
		const proofCommitSha = execFileSync('git', ['commit-tree', treeId, '-p', sourceCommitSha], {
			cwd: repoRoot,
			encoding: 'utf8',
			input: `Commons Brutalist launch proof for ${sourceCommitSha}\n`,
			env: commitEnvironment,
			maxBuffer: 1024 * 1024
		}).trim();
		invariant(
			execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim() ===
				headBefore,
			'Git HEAD changed while creating the detached proof commit.'
		);
		assertProofCommitEnvelope({ repoRoot, proofCommitSha, sourceCommitSha });
		return proofCommitSha;
	} finally {
		rmSync(indexDirectory, { recursive: true, force: true });
	}
}

/** @param {Record<string, any>[]} reviewers */
function attestedReviewers(reviewers) {
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

/** @param {Record<string, any>[]} reviewers */
function findingCounts(reviewers) {
	/** @param {string} field */
	const count = (field) =>
		reviewers.reduce((sum, reviewer) => {
			invariant(
				Number.isSafeInteger(reviewer[field]) && reviewer[field] >= 0,
				`Raw evidence has an invalid ${field} reviewer count.`
			);
			return sum + reviewer[field];
		}, 0);
	const openP0 = count('openP0');
	const openP1 = count('openP1');
	const openP2 = count('openP2');
	const openP3 = count('openP3');
	return { openP0, openP1, openP2, openP3, total: openP0 + openP1 + openP2 + openP3 };
}

/**
 * Verify the operator signature, derive the canonical Markdown/attestation,
 * create a detached four-blob proof commit, then run the full local gate.
 *
 * @param {{ repoRoot?: string; expectedBaseSha: string; expectedEvidenceSha256: string; expectedRepositoryId: string; expectedRepositorySlug: string; allowedSignersPath?: string; now?: Date }} options
 */
export function finalizeBrutalistLaunchReview({
	repoRoot = process.cwd(),
	expectedBaseSha,
	expectedEvidenceSha256,
	expectedRepositoryId,
	expectedRepositorySlug,
	allowedSignersPath = DEFAULT_ALLOWED_SIGNERS_PATH,
	now = new Date()
}) {
	const absoluteRoot = assertRepositoryRoot(repoRoot);
	const evidenceBytes = readFileSync(path.join(absoluteRoot, DEFAULT_EVIDENCE_PATH));
	invariant(
		/^[a-f0-9]{64}$/u.test(expectedEvidenceSha256),
		'Finalizer requires the explicit expected raw-evidence SHA-256 approved for signing.'
	);
	invariant(
		sha256(evidenceBytes) === expectedEvidenceSha256,
		'Raw Brutalist evidence does not match the explicitly approved SHA-256.'
	);
	const evidence = JSON.parse(evidenceBytes.toString('utf8'));
	invariant(
		evidenceBytes.equals(canonicalEvidenceBytes(evidence)),
		'Raw Brutalist evidence is not in canonical signed form.'
	);
	const signature = readFileSync(path.join(absoluteRoot, DEFAULT_SIGNATURE_PATH));
	const signer = verifyEvidenceSignature({ evidence, signature, allowedSignersPath });
	invariant(evidence.baseSha === expectedBaseSha, 'Raw evidence is bound to another PR base.');
	invariant(
		evidence.repository?.id === expectedRepositoryId &&
			evidence.repository?.slug === expectedRepositorySlug,
		'Raw evidence is bound to another repository identity.'
	);
	const source = computeGitTreeFingerprint({
		repoRoot: absoluteRoot,
		commitSha: evidence.reviewedHeadSha
	});
	invariant(
		evidence.sourceFingerprint === `sha256:${source.digest}` &&
			evidence.sourceFileCount === source.fileCount,
		'Raw evidence is not bound to the reviewed Git tree.'
	);
	const evidenceSha256 = sha256(evidenceBytes);
	const report = renderBrutalistLaunchReport(evidence, evidenceSha256);
	const findings = findingCounts(evidence.reviewers);
	const attestation = {
		schemaVersion: 3,
		scope: 'launch-foundations-full-repository',
		reviewedAt: evidence.capturedAt,
		repositoryId: evidence.repository.id,
		repositorySlug: evidence.repository.slug,
		baseSha: evidence.baseSha,
		reviewedHeadSha: evidence.reviewedHeadSha,
		contextId: evidence.contextId,
		reportPath: DEFAULT_REPORT_PATH,
		reportSha256: sha256(report),
		evidencePath: DEFAULT_EVIDENCE_PATH,
		evidenceSha256,
		signaturePath: DEFAULT_SIGNATURE_PATH,
		signatureSha256: sha256(signature),
		operatorPrincipal: signer.principal,
		signerKeyFingerprint: signer.keyFingerprint,
		sourceFingerprint: evidence.sourceFingerprint,
		sourceFileCount: evidence.sourceFileCount,
		snapshotFingerprint: evidence.snapshot?.fingerprint,
		requestSha256: evidence.requestSha256,
		reconstructedResponseSha256: evidence.reconstructedResponseSha256,
		findings,
		reviewers: attestedReviewers(evidence.reviewers)
	};
	const attestationBytes = Buffer.from(`${JSON.stringify(attestation, null, 2)}\n`, 'utf8');
	const proofFiles = new Map([
		[DEFAULT_ATTESTATION_PATH, attestationBytes],
		[DEFAULT_REPORT_PATH, Buffer.from(report, 'utf8')],
		[DEFAULT_EVIDENCE_PATH, evidenceBytes],
		[DEFAULT_SIGNATURE_PATH, signature]
	]);
	const proofCommitSha = createBrutalistProofCommit({
		repoRoot: absoluteRoot,
		sourceCommitSha: evidence.reviewedHeadSha,
		capturedAt: evidence.capturedAt,
		proofFiles
	});
	verifyBrutalistAttestation({
		repoRoot: absoluteRoot,
		expectedBaseSha,
		expectedHeadSha: evidence.reviewedHeadSha,
		proofCommitSha,
		expectedRepositoryId,
		expectedRepositorySlug,
		allowedSignersPath,
		now
	});
	const proofRef = brutalistAttestationRef(evidence.reviewedHeadSha);
	execFileSync('git', ['update-ref', proofRef, proofCommitSha], {
		cwd: absoluteRoot,
		maxBuffer: 1024 * 1024
	});
	for (const proofPath of GENERATED_PROOF_PATHS) {
		rmSync(path.join(absoluteRoot, proofPath), { force: true });
	}
	return { attestation, report, proofCommitSha, proofRef };
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const result = finalizeBrutalistLaunchReview({
			expectedBaseSha: process.env.BRUTALIST_EXPECTED_BASE_SHA?.trim() ?? '',
			expectedEvidenceSha256: process.env.BRUTALIST_EXPECTED_EVIDENCE_SHA256?.trim() ?? '',
			expectedRepositoryId: process.env.BRUTALIST_EXPECTED_REPOSITORY_ID?.trim() ?? '',
			expectedRepositorySlug: process.env.BRUTALIST_EXPECTED_REPOSITORY_SLUG?.trim() ?? ''
		});
		console.log(
			`Brutalist proof finalized: context_id=${result.attestation.contextId}; ` +
				`evidence_sha256=${result.attestation.evidenceSha256}; ` +
				`proof_commit=${result.proofCommitSha}; proof_ref=${result.proofRef}; ` +
				`signer=${result.attestation.signerKeyFingerprint}. HEAD was not changed.`
		);
	} catch (error) {
		console.error(
			`Brutalist finalization failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exit(1);
	}
}
