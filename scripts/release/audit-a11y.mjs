#!/usr/bin/env node
/**
 * Phase 1 do-3 release artifact: automated accessibility audit.
 *
 * Drives Playwright's headless Chromium against the rendered route and runs
 * `@axe-core/playwright`'s default ruleset (wcag2a, wcag2aa, wcag21a,
 * wcag21aa, best-practice). Reports violations and exits non-zero if any
 * `serious` or `critical` violations remain unfixed.
 *
 * Manual screen-reader testing (VoiceOver / NVDA / JAWS) is user-deferred —
 * this is the automated gate, not the full a11y review.
 *
 * Output: `scripts/release/a11y-report.json` records the run as committed
 * evidence. The report contains the violation list, the URL audited, the
 * timestamp, and the axe ruleset tags. The release script consumes the
 * exit code; humans consume the JSON.
 */
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const ROUTE = '/record/vol-1/issue-1';
const REPORT_PATH = resolve(__dirname, 'a11y-report.json');

const FAIL_IMPACTS = new Set(['serious', 'critical']);

async function main() {
	const target = `${BASE_URL}${ROUTE}`;
	console.log(`[audit-a11y] auditing ${target}`);

	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
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

		const result = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
			.analyze();

		const summary = {
			url: target,
			timestamp: new Date().toISOString(),
			tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'],
			violationCount: result.violations.length,
			passCount: result.passes.length,
			incompleteCount: result.incomplete.length,
			violations: result.violations.map((v) => ({
				id: v.id,
				impact: v.impact,
				description: v.description,
				help: v.help,
				helpUrl: v.helpUrl,
				tags: v.tags,
				nodes: v.nodes.map((n) => ({
					target: n.target,
					html: n.html,
					failureSummary: n.failureSummary
				}))
			})),
			incomplete: result.incomplete.map((v) => ({
				id: v.id,
				impact: v.impact,
				description: v.description,
				nodes: v.nodes.map((n) => ({
					target: n.target,
					html: n.html
				}))
			}))
		};

		await mkdir(dirname(REPORT_PATH), { recursive: true });
		await writeFile(REPORT_PATH, JSON.stringify(summary, null, 2));
		console.log(`[audit-a11y] wrote ${REPORT_PATH}`);
		console.log(
			`[audit-a11y]   passes:      ${summary.passCount}`
		);
		console.log(
			`[audit-a11y]   incomplete:  ${summary.incompleteCount}`
		);
		console.log(
			`[audit-a11y]   violations:  ${summary.violationCount}`
		);

		if (summary.violationCount > 0) {
			console.log('');
			console.log('[audit-a11y] violations:');
			for (const v of summary.violations) {
				console.log(`  - [${v.impact}] ${v.id}: ${v.help}`);
				console.log(`    ${v.helpUrl}`);
				for (const node of v.nodes) {
					console.log(`      target: ${JSON.stringify(node.target)}`);
				}
			}
		}

		const blocking = summary.violations.filter((v) =>
			FAIL_IMPACTS.has(v.impact ?? '')
		);
		if (blocking.length > 0) {
			console.error('');
			console.error(
				`[audit-a11y] FAIL: ${blocking.length} serious/critical violation(s)`
			);
			process.exitCode = 1;
		} else {
			console.log('[audit-a11y] OK: no serious/critical violations');
		}
	} finally {
		await context.close();
		await browser.close();
	}
}

main().catch((err) => {
	console.error('[audit-a11y] failed:', err);
	process.exit(1);
});
