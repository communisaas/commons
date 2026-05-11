#!/usr/bin/env node
/**
 * Phase 1 do-3 release script: cut Issue 1.
 *
 * Single-entry-point orchestrator that produces all release artifacts in
 * the correct order, computes the manifest, and prepares (but does NOT
 * execute) the git tag. The tag is the user's deliberate act.
 *
 * Order matters
 * -------------
 *   pre-flight  → confirm git tree is clean
 *   build       → npm run build
 *   preview     → spawn `vite preview` on :4173
 *   audit-a11y  → fail closed on serious/critical violations (against the
 *                 production build, not dev HMR)
 *   export-pdf  → Playwright drives :4173 → static/record/vol-1/issue-1.pdf
 *   export-text → reads PDF sha256 into the manifest →
 *                 static/record/vol-1/issue-1.txt
 *   manifest    → write static/record/vol-1/issue-1.manifest.json
 *   stop preview
 *   summary     → print git tag command (do NOT execute)
 *
 * The PDF must be built BEFORE the TXT so the TXT's manifest can include
 * the PDF's sha256.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const PREVIEW_PORT = process.env.PREVIEW_PORT
	? Number(process.env.PREVIEW_PORT)
	: 4173;
const PREVIEW_BASE_URL = `http://localhost:${PREVIEW_PORT}`;
const SKIP_BUILD = process.env.SKIP_BUILD === '1';
const SKIP_DIRTY_CHECK = process.env.SKIP_DIRTY_CHECK === '1';
const USE_DEV = process.env.USE_DEV === '1';

const GIT_TAG_NAME = 'record/vol-1-issue-1-v1.0.0';
const META = {
	version: 'v1.0.0',
	date: '2026-05-06'
};

const RELEASE = {
	constitution: {
		path: 'CONSTITUTION.md',
		form: 'source · markdown'
	},
	issue: {
		path: 'docs/record/vol-1/issue-1.md',
		form: 'source · markdown'
	},
	pdf: {
		path: 'static/record/vol-1/issue-1.pdf',
		form: 'rendered · print'
	},
	txt: {
		path: 'static/record/vol-1/issue-1.txt',
		form: 'rendered · plain-text'
	}
};

function log(msg) {
	console.log(`[cut-issue-1] ${msg}`);
}

function err(msg) {
	console.error(`[cut-issue-1] ${msg}`);
}

function run(cmd, args, opts = {}) {
	return new Promise((resolveProc, rejectProc) => {
		const child = spawn(cmd, args, {
			stdio: 'inherit',
			cwd: REPO_ROOT,
			...opts
		});
		child.on('exit', (code) => {
			if (code === 0) resolveProc();
			else rejectProc(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
		});
		child.on('error', rejectProc);
	});
}

function runCapture(cmd, args, opts = {}) {
	return new Promise((resolveProc, rejectProc) => {
		const child = spawn(cmd, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			cwd: REPO_ROOT,
			...opts
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d.toString()));
		child.stderr.on('data', (d) => (stderr += d.toString()));
		child.on('exit', (code) => {
			if (code === 0) resolveProc({ stdout, stderr });
			else rejectProc(
				Object.assign(new Error(`${cmd} exit ${code}`), { stdout, stderr, code })
			);
		});
		child.on('error', rejectProc);
	});
}

async function fileExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function sha256Of(path) {
	const buf = await readFile(path);
	return createHash('sha256').update(buf).digest('hex');
}

async function preflightCleanTree() {
	if (SKIP_DIRTY_CHECK) {
		log('SKIP_DIRTY_CHECK=1 — skipping clean-tree check');
		return;
	}
	const { stdout } = await runCapture('git', ['status', '--porcelain']);
	if (stdout.trim().length > 0) {
		err('git tree is dirty — refusing to cut release.');
		err('Stage and commit (or stash) before running. Output of git status:');
		err(stdout);
		throw new Error('git tree dirty');
	}
	log('pre-flight: git tree clean');
}

async function getCommitSha() {
	try {
		const { stdout } = await runCapture('git', ['rev-parse', 'HEAD']);
		return stdout.trim();
	} catch {
		return 'unknown';
	}
}

async function waitForServer(url, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	let lastErr = null;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(url);
			if (r.ok) return;
			lastErr = new Error(`status ${r.status}`);
		} catch (e) {
			lastErr = e;
		}
		await sleep(500);
	}
	throw new Error(`server at ${url} did not become ready: ${lastErr?.message}`);
}

async function spawnPreview() {
	log(`booting vite preview on :${PREVIEW_PORT}`);
	const child = spawn(
		'npx',
		['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'],
		{
			cwd: REPO_ROOT,
			stdio: 'pipe',
			env: { ...process.env }
		}
	);
	let exited = false;
	child.on('exit', () => (exited = true));
	child.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`));
	child.stderr.on('data', (d) => process.stderr.write(`[preview] ${d}`));
	try {
		await waitForServer(`${PREVIEW_BASE_URL}/record/vol-1/issue-1`);
	} catch (e) {
		if (!exited) child.kill('SIGTERM');
		throw e;
	}
	log(`preview is serving ${PREVIEW_BASE_URL}`);
	return child;
}

async function killPreview(child) {
	if (!child) return;
	if (child.exitCode !== null) return;
	log('stopping preview');
	child.kill('SIGTERM');
	await sleep(500);
	if (child.exitCode === null) child.kill('SIGKILL');
}

async function writeManifest({
	commitSha,
	constitutionHash,
	issueHash,
	pdfHash,
	txtHash
}) {
	const manifest = {
		version: META.version,
		date: META.date,
		commit: commitSha,
		git_tag: GIT_TAG_NAME,
		documents: {
			'constitution.md': {
				path: RELEASE.constitution.path,
				sha256: constitutionHash,
				form: RELEASE.constitution.form
			},
			'issue-1.md': {
				path: RELEASE.issue.path,
				sha256: issueHash,
				form: RELEASE.issue.form
			},
			'issue-1.pdf': {
				path: RELEASE.pdf.path,
				sha256: pdfHash,
				form: RELEASE.pdf.form
			},
			'issue-1.txt': {
				path: RELEASE.txt.path,
				sha256: txtHash,
				form: RELEASE.txt.form
			}
		}
	};
	const out = resolve(
		REPO_ROOT,
		'static/record/vol-1/issue-1.manifest.json'
	);
	await writeFile(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
	log(`wrote ${out}`);
	return { manifest, path: out };
}

async function main() {
	await preflightCleanTree();

	let baseUrl = USE_DEV ? 'http://localhost:5173' : PREVIEW_BASE_URL;
	let previewChild = null;

	try {
		if (!USE_DEV) {
			if (!SKIP_BUILD) {
				log('build: npm run build');
				await run('npm', ['run', 'build']);
			} else {
				log('SKIP_BUILD=1 — skipping build');
			}
			previewChild = await spawnPreview();
		} else {
			log('USE_DEV=1 — using dev server at http://localhost:5173');
			await waitForServer(`${baseUrl}/record/vol-1/issue-1`, 5_000);
		}

		log('audit-a11y');
		await run('node', ['scripts/release/audit-a11y.mjs'], {
			env: { ...process.env, BASE_URL: baseUrl }
		});

		log('export-pdf');
		await run('node', ['scripts/release/export-pdf.mjs'], {
			env: { ...process.env, BASE_URL: baseUrl }
		});

		log('export-text');
		await run('node', ['scripts/release/export-text.mjs']);

		const constitutionHash = await sha256Of(
			resolve(REPO_ROOT, RELEASE.constitution.path)
		);
		const issueHash = await sha256Of(resolve(REPO_ROOT, RELEASE.issue.path));
		const pdfHash = await sha256Of(resolve(REPO_ROOT, RELEASE.pdf.path));
		const txtHash = await sha256Of(resolve(REPO_ROOT, RELEASE.txt.path));
		const commitSha = await getCommitSha();

		await writeManifest({
			commitSha,
			constitutionHash,
			issueHash,
			pdfHash,
			txtHash
		});

		await killPreview(previewChild);
		previewChild = null;

		console.log('');
		console.log('===========================================================');
		console.log(' Release artifacts produced');
		console.log('===========================================================');
		console.log(`  ${RELEASE.constitution.path}`);
		console.log(`    sha256: ${constitutionHash}`);
		console.log(`  ${RELEASE.issue.path}`);
		console.log(`    sha256: ${issueHash}`);
		console.log(`  ${RELEASE.pdf.path}`);
		console.log(`    sha256: ${pdfHash}`);
		console.log(`  ${RELEASE.txt.path}`);
		console.log(`    sha256: ${txtHash}`);
		console.log(`  static/record/vol-1/issue-1.manifest.json`);
		console.log('');
		console.log(' Verify hashes match the route masthead');
		console.log(`   src/routes/record/vol-1/issue-1/+page.server.ts`);
		console.log(`     CANONICAL_HASHES.constitution must equal:`);
		console.log(`       ${constitutionHash}`);
		console.log(`     CANONICAL_HASHES.issue must equal:`);
		console.log(`       ${issueHash}`);
		console.log('');
		console.log(' To publish, run (DELIBERATE ACT — not run by this script):');
		console.log('');
		console.log(
			`   git tag -a ${GIT_TAG_NAME} -m 'First publication of CONSTITUTION.md@v1.0.0'`
		);
		console.log('');
		console.log(' Then push the tag:');
		console.log('');
		console.log(`   git push origin ${GIT_TAG_NAME}`);
		console.log('');
		console.log('===========================================================');
	} catch (e) {
		err(`failed: ${e.message ?? e}`);
		process.exitCode = 1;
	} finally {
		await killPreview(previewChild);
	}
}

main();
