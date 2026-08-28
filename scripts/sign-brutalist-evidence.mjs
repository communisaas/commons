import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	BRUTALIST_SIGNATURE_NAMESPACE,
	DEFAULT_ALLOWED_SIGNERS_PATH,
	DEFAULT_EVIDENCE_PATH,
	DEFAULT_SIGNATURE_PATH,
	assertRepositoryRoot,
	canonicalEvidenceBytes,
	invariant,
	sha256,
	verifyEvidenceSignature
} from './verify-brutalist-attestation.mjs';

/**
 * Sign canonical raw evidence with an explicitly selected, dedicated key.
 * The key must already be enrolled in the trusted allowed-signers file.
 *
 * @param {{ repoRoot?: string; signingKey: string; operatorPrincipal: string; expectedEvidenceSha256: string; allowedSignersPath?: string }} options
 */
export function signBrutalistEvidence({
	repoRoot = process.cwd(),
	signingKey,
	operatorPrincipal,
	expectedEvidenceSha256,
	allowedSignersPath = DEFAULT_ALLOWED_SIGNERS_PATH
}) {
	const absoluteRoot = assertRepositoryRoot(repoRoot);
	invariant(
		path.isAbsolute(signingKey),
		'BRUTALIST_SIGNING_KEY must be an explicit absolute path.'
	);
	invariant(
		/^[A-Za-z0-9._@+-]{1,120}$/u.test(operatorPrincipal),
		'BRUTALIST_OPERATOR_PRINCIPAL is invalid.'
	);
	const evidenceBytes = readFileSync(path.join(absoluteRoot, DEFAULT_EVIDENCE_PATH));
	invariant(
		/^[a-f0-9]{64}$/u.test(expectedEvidenceSha256),
		'Signer requires the explicit expected raw-evidence SHA-256 printed by capture.'
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
	invariant(
		evidence.operator?.principal === operatorPrincipal &&
			evidence.operator?.signatureNamespace === BRUTALIST_SIGNATURE_NAMESPACE,
		'Explicit signer identity does not match the raw evidence operator receipt.'
	);
	const publicKey = execFileSync('ssh-keygen', ['-y', '-f', signingKey], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024
	}).trim();
	invariant(
		publicKey.startsWith('ssh-ed25519 '),
		'Brutalist evidence requires a dedicated Ed25519 key.'
	);
	const signature = execFileSync(
		'ssh-keygen',
		['-Y', 'sign', '-f', signingKey, '-n', BRUTALIST_SIGNATURE_NAMESPACE, '-'],
		{ input: evidenceBytes, maxBuffer: 1024 * 1024 }
	);
	const verified = verifyEvidenceSignature({ evidence, signature, allowedSignersPath });
	const target = path.join(absoluteRoot, DEFAULT_SIGNATURE_PATH);
	const temporary = `${target}.tmp`;
	writeFileSync(temporary, signature, { mode: 0o600 });
	renameSync(temporary, target);
	return verified;
}

const isMain =
	process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
	try {
		const result = signBrutalistEvidence({
			signingKey: process.env.BRUTALIST_SIGNING_KEY?.trim() ?? '',
			operatorPrincipal: process.env.BRUTALIST_OPERATOR_PRINCIPAL?.trim() ?? '',
			expectedEvidenceSha256: process.env.BRUTALIST_EXPECTED_EVIDENCE_SHA256?.trim() ?? ''
		});
		console.log(
			`Brutalist raw evidence signed: evidence_sha256=${process.env.BRUTALIST_EXPECTED_EVIDENCE_SHA256?.trim()}; ` +
				`principal=${result.principal}; key=${result.keyFingerprint}.`
		);
	} catch (error) {
		console.error(
			`Brutalist evidence signing failed: ${error instanceof Error ? error.message : String(error)}`
		);
		process.exit(1);
	}
}
