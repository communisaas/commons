#!/usr/bin/env node
/**
 * Phase 1 do-3 release artifact: plain-text export.
 *
 * Concatenates Issue 1 (post-stripIssuePreamble) and CONSTITUTION.md into a
 * single combined plain-text file. Markdown is already a plain-text register
 * — asterisks for emphasis, hash headings, pipe tables — so the export
 * preserves the source markdown verbatim, framed by a chrome-equivalent
 * masthead that mirrors the rendered web masthead's facts and hash manifest.
 *
 * This is the federation-archive-mirror form: a screen reader, a federal
 * archive, a 2056 plain-text database can ingest the document without
 * rendering. Where any conflict arises between this rendering and the source
 * markdown, the source markdown governs (per CONSTITUTION.md §2 and the
 * issue's §A).
 *
 * Self-hash closure
 * -----------------
 * A file cannot include its own sha256 in its bytes — substituting the hash
 * into the file changes the bytes, which changes the hash. The standard
 * closure idiom (used by GPG-signed mail, signed source tarballs, etc.) is
 * to define the self-hash claim as sha256(file with the hash field zeroed).
 * That is the meaning of the `record/vol-1/issue-1.txt` line in the manifest:
 * the value displayed is sha256 of this file with that very line's hash
 * digits replaced by 64 zeros. Verifiers who want to re-derive it use the
 * same procedure.
 *
 * The manifest.json (separate artifact) records the *unmodified* sha256 of
 * the TXT file as actually written. Verifiers can use either; they answer
 * different questions (the in-file claim is self-anchoring; the manifest
 * value is the post-write integrity hash).
 *
 * Sibling-hash dependency
 * -----------------------
 * The PDF must already exist at `static/record/vol-1/issue-1.pdf` for its
 * sha256 to enter the manifest. The release script orchestrates the order
 * (export-pdf → export-text) so this constraint is met. If the PDF is
 * absent at the time of TXT export, the manifest entry reads
 * `pdf-not-yet-built` rather than a misleading zero hash; the operator can
 * re-run the script after building the PDF to refresh.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const CONSTITUTION_PATH = resolve(REPO_ROOT, 'CONSTITUTION.md');
const ISSUE_PATH = resolve(REPO_ROOT, 'docs/record/vol-1/issue-1.md');
const PDF_PATH = resolve(REPO_ROOT, 'static/record/vol-1/issue-1.pdf');
const OUTPUT_PATH = resolve(REPO_ROOT, 'static/record/vol-1/issue-1.txt');

const ZERO_HASH = '0'.repeat(64);
// Fixed-width placeholder. Length 64 (a full hex sha256) so substituting in
// the actual hash preserves byte-for-byte file size and column alignment.
const TXT_HASH_PLACEHOLDER = ZERO_HASH;

const META = {
	volume: 1,
	issue: 1,
	date: '2026-05-06',
	status: 'Inaugural · Promulgates CONSTITUTION.md@v1.0.0',
	maintainer: 'Communiqué PBC',
	licence: "at the recipient's choice, CC-BY-4.0 or Apache-2.0",
	version: 'v1.0.0'
};

/**
 * Mirror the loader's `stripIssuePreamble`: cut from the start of the file
 * to the line *before* `## §A Promulgation`. The chrome masthead emitted by
 * this script supplies the equivalent header (date, status, maintainer,
 * licence, hash manifest), so the issue's own duplicate masthead would
 * lecture the reader twice.
 */
function stripIssuePreamble(md) {
	const lines = md.split('\n');
	const cutIndex = lines.findIndex((line) => /^##\s+§A\s+Promulgation\b/.test(line));
	if (cutIndex < 0) return md;
	return lines.slice(cutIndex).join('\n');
}

function sha256Hex(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

async function fileExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function maybeFileSha256(path, fallback) {
	if (!(await fileExists(path))) return fallback;
	const buf = await readFile(path);
	return sha256Hex(buf);
}

function buildHeader({ constitutionHash, issueHash, pdfHash, txtHash }) {
	const sep = '='.repeat(72);
	const rule = '-'.repeat(72);
	return [
		sep,
		`Public Record · Volume ${META.volume} · Issue ${META.issue}`,
		sep,
		'',
		`Date:        ${META.date}`,
		`Status:      ${META.status}`,
		`Maintainer:  ${META.maintainer}`,
		`Licence:     ${META.licence}`,
		`Version:     ${META.version}`,
		'',
		'First-publication hash manifest',
		rule,
		`CONSTITUTION.md@${META.version}            sha256:${constitutionHash}`,
		`record/vol-1/issue-1.md@${META.version}    sha256:${issueHash}`,
		`record/vol-1/issue-1.pdf                   sha256:${pdfHash}`,
		`record/vol-1/issue-1.txt                   sha256:${txtHash}`,
		rule,
		'',
		'The first-publication sha256 of each source document (CONSTITUTION.md',
		'and record/vol-1/issue-1.md) is canonical and immutable. The PDF and',
		'TXT hashes are the rendered-form hashes computed at the release tag.',
		'',
		'Where any conflict arises between this plain-text rendering and the',
		'source markdown, the source markdown governs.',
		'',
		sep,
		'',
		''
	].join('\n');
}

function artifactSeparator() {
	const rule = '='.repeat(72);
	return [
		'',
		'',
		rule,
		`PROMULGATED ARTIFACT · CONSTITUTION.md@${META.version}`,
		rule,
		'',
		''
	].join('\n');
}

async function main() {
	const constitutionMd = await readFile(CONSTITUTION_PATH, 'utf8');
	const issueMd = await readFile(ISSUE_PATH, 'utf8');

	const constitutionHash = sha256Hex(constitutionMd);
	const issueHash = sha256Hex(issueMd);
	const pdfHash = await maybeFileSha256(PDF_PATH, 'pdf-not-yet-built'.padEnd(64, '-'));

	const issueBody = stripIssuePreamble(issueMd);
	const constitutionBody = constitutionMd;

	// Pass 1: emit with the placeholder zeros in the TXT's self-hash slot.
	// The hash of THIS body is the canonical self-hash claim. The line in
	// the final file remains literally the placeholder zeros, so a verifier
	// can recompute the claim with the same one-line procedure.
	const headerWithPlaceholder = buildHeader({
		constitutionHash,
		issueHash,
		pdfHash,
		txtHash: TXT_HASH_PLACEHOLDER
	});
	const bodyWithPlaceholder = `${headerWithPlaceholder}${issueBody}${artifactSeparator()}${constitutionBody}`;

	// The "self-hash" — sha256 of the TXT with the self-hash field zeroed.
	const selfHashClaim = sha256Hex(bodyWithPlaceholder);

	// Render the line as a human-readable slot that documents the closure
	// procedure rather than asserting a hash that the file as-written does
	// not in fact have. The verifier can recompute the claim by zeroing
	// that line and re-hashing.
	const selfHashLineFrom = `record/vol-1/issue-1.txt                   sha256:${TXT_HASH_PLACEHOLDER}`;
	const selfHashLineTo = `record/vol-1/issue-1.txt                   sha256:${selfHashClaim}  (= sha256 of this file with this line's hash zeroed)`;
	if (!bodyWithPlaceholder.includes(selfHashLineFrom)) {
		throw new Error('self-hash placeholder line not present — substitution would silently fail');
	}
	const finalBody = bodyWithPlaceholder.replace(selfHashLineFrom, selfHashLineTo);

	await mkdir(dirname(OUTPUT_PATH), { recursive: true });
	await writeFile(OUTPUT_PATH, finalBody, 'utf8');

	// The integrity hash of the file AS WRITTEN. This is the value that
	// goes into the manifest.json and the masthead, and is the value other
	// tools (sha256sum, git diff) will see. Distinct from the self-hash
	// claim above by construction.
	const integrityHash = sha256Hex(finalBody);

	// Sanity: verify the claim by reproducing it from the written file
	// (zero the self-hash line, re-hash, compare). This is the procedure a
	// third-party verifier would use; checking it here catches regressions
	// in the substitution logic.
	const written = await readFile(OUTPUT_PATH, 'utf8');
	const verifyZeroed = written.replace(selfHashLineTo, selfHashLineFrom);
	const verifyHash = sha256Hex(verifyZeroed);
	if (verifyHash !== selfHashClaim) {
		throw new Error(
			`self-hash claim does not verify: claim ${selfHashClaim}, recomputed ${verifyHash}`
		);
	}

	console.log(`[export-text] wrote ${OUTPUT_PATH}`);
	console.log(`[export-text]   constitution.md sha256:    ${constitutionHash}`);
	console.log(`[export-text]   issue-1.md      sha256:    ${issueHash}`);
	console.log(`[export-text]   issue-1.pdf     sha256:    ${pdfHash}`);
	console.log(`[export-text]   issue-1.txt     sha256:    ${integrityHash}  (file as written)`);
	console.log(`[export-text]   issue-1.txt     self-claim: ${selfHashClaim}  (zeroed-line)`);
}

main().catch((err) => {
	console.error('[export-text] failed:', err);
	process.exit(1);
});
