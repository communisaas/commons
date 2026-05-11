#!/usr/bin/env node
/**
 * Phase 1 do-3 release artifact: PDF export.
 *
 * Drives Playwright's headless Chromium to load the rendered route at
 * `/record/vol-1/issue-1` and saves a faithful PDF presentation as
 * `static/record/vol-1/issue-1.pdf`. Same typography, same hierarchy, same
 * hash manifest — the PDF is the print register of the same publication.
 *
 * Run-time:
 *   BASE_URL is read from env (default http://localhost:5173 — the dev
 *   server). The release script (`cut-issue-1.sh`) boots `vite preview` on
 *   :4173 and passes BASE_URL=http://localhost:4173 so the PDF reflects the
 *   production build, not dev HMR injection.
 *
 * This script runs at BUILD TIME via Node tooling. The SvelteKit production
 * deploy uses the Cloudflare adapter (no `node:fs`); Playwright is build-
 * time tooling and is not bundled into the worker.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const ROUTE = '/record/vol-1/issue-1';
const OUTPUT_PATH = resolve(REPO_ROOT, 'static/record/vol-1/issue-1.pdf');

async function main() {
	const target = `${BASE_URL}${ROUTE}`;
	console.log(`[export-pdf] navigating to ${target}`);

	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		// Use a desktop viewport so layout matches the print register.
		viewport: { width: 1024, height: 1366 },
		// Force light scheme so the white reading-room ground plane prints.
		colorScheme: 'light'
	});
	const page = await context.newPage();

	try {
		const response = await page.goto(target, {
			waitUntil: 'networkidle',
			timeout: 60_000
		});
		if (!response || !response.ok()) {
			throw new Error(
				`route returned status ${response ? response.status() : '<no response>'}`
			);
		}

		// Force `print` media so any @media print rules apply.
		await page.emulateMedia({ media: 'print' });

		// Wait an extra beat for fonts to flush.
		await page.evaluate(async () => {
			if (document.fonts && typeof document.fonts.ready === 'object') {
				await document.fonts.ready;
			}
		});

		await mkdir(dirname(OUTPUT_PATH), { recursive: true });

		await page.pdf({
			path: OUTPUT_PATH,
			format: 'Letter',
			printBackground: true,
			preferCSSPageSize: false,
			margin: {
				top: '0.75in',
				bottom: '0.75in',
				left: '0.75in',
				right: '0.75in'
			}
		});

		console.log(`[export-pdf] wrote ${OUTPUT_PATH}`);
	} finally {
		await context.close();
		await browser.close();
	}
}

main().catch((err) => {
	console.error('[export-pdf] failed:', err);
	process.exit(1);
});
