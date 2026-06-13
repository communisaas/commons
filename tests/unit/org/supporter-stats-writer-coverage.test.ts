/**
 * Completeness guard for the supporter breakdown counters (CI ratchet).
 *
 * organizations.supporterStats is a denormalized funnel counter: it stays exact
 * ONLY if every mutation that creates, deletes, or transitions a counted
 * supporter applies the matching delta via `applySupporterStatsDelta` /
 * `applySupporterStatsDeltaBatch` (see convex/_supporterStats.ts). That is an
 * "honor-system invariant" — a single new writer that forgets the delta drifts
 * the funnel forever, silently.
 *
 * This test removes the honor system: it greps every convex/*.ts for supporter
 * write sites and asserts each FILE that writes supporters also references the
 * delta helper. A new file or mutation that inserts/patches/deletes a supporter
 * without wiring the counter fails here, in CI, before it can ship.
 *
 * Allowlist (files that legitimately write supporters WITHOUT a delta):
 *   - seed.ts       : test/dev fixtures only — never runs in production; the
 *                     seed sets supporterStats wholesale, not incrementally.
 *   - backfill.ts   : operator one-shot migration (run once, manually, via
 *                     `npx convex run`). It only patches non-counted fields
 *                     (global hash pair) on legacy rows, so it can't drift the
 *                     counted buckets.
 *   - _supporterStats.ts : the helper module itself (it DEFINES the delta math
 *                     and is referenced by name in its own doc comments).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CONVEX_DIR = path.resolve(process.cwd(), 'convex');

/** Files that write supporters but are NOT required to apply a counter delta. */
const ALLOWLIST = new Set(['seed.ts', 'backfill.ts', '_supporterStats.ts']);

// ── Supporter write-site signals ──────────────────────────────────────────
// A file is a "supporter writer" if it inserts into the supporters table, or
// patches/deletes a supporter document. Insert is unambiguous. For patch/delete
// we match the write argument: unambiguously-supporter-named identifiers always
// count; the generic loop name `s._id` counts only when the same file also reads
// the supporters table (so a `for (const s of <other table>)` loop — e.g.
// submissions.ts iterating submissions — can't trip the ratchet).
const INSERT_RE = /ctx\.db\.insert\((["'])supporters\1/;
const NAMED_WRITE_RE = /ctx\.db\.(?:patch|delete)\(\s*(?:supporter\._id|supporterId|args\.supporterId)\b/;
const LOOPVAR_WRITE_RE = /ctx\.db\.(?:patch|delete)\(\s*s\._id\b/;
const SUPPORTERS_QUERY_RE = /\.query\((["'])supporters\1/;

// References the delta helper (covers both the single + batch variants).
const DELTA_RE = /applySupporterStatsDelta(?:Batch)?\b/;

function isSupporterWriter(src: string): boolean {
	if (INSERT_RE.test(src)) return true;
	if (NAMED_WRITE_RE.test(src)) return true;
	if (LOOPVAR_WRITE_RE.test(src) && SUPPORTERS_QUERY_RE.test(src)) return true;
	return false;
}

function listConvexSources(): Array<{ file: string; src: string }> {
	return readdirSync(CONVEX_DIR)
		.filter((f) => f.endsWith('.ts'))
		.map((file) => ({ file, src: readFileSync(path.join(CONVEX_DIR, file), 'utf8') }));
}

describe('supporter-stats writer coverage (honor-system ratchet)', () => {
	const sources = listConvexSources();
	const writers = sources.filter(({ src }) => isSupporterWriter(src));

	it('detects the known supporter-writer files (so the grep patterns stay live)', () => {
		// If a refactor renames a write pattern out from under the regexes, the
		// ratchet would silently stop catching anything. Pin the known writer set
		// so a pattern that no longer matches surfaces here.
		const detected = writers.map((w) => w.file).sort();
		expect(detected).toEqual(
			['backfill.ts', 'campaigns.ts', 'email.ts', 'seed.ts', 'supporters.ts', 'v1api.ts', 'webhooks.ts'].sort()
		);
	});

	it('every supporter-writer file applies the counter delta (or is allowlisted)', () => {
		const violations = writers
			.filter(({ file }) => !ALLOWLIST.has(file))
			.filter(({ src }) => !DELTA_RE.test(src))
			.map(({ file }) => file);

		expect(
			violations,
			`These convex files write supporters but never reference applySupporterStatsDelta — ` +
				`every supporter create/delete/status-transition MUST apply the matching counter ` +
				`delta or the verification funnel drifts. Wire the delta, or (if the writer truly ` +
				`can't drift counted fields) add the file to the documented ALLOWLIST. Offenders: ` +
				violations.join(', ')
		).toEqual([]);
	});

	it('allowlisted writers are real (no stale entries masking a regression)', () => {
		// A stale allowlist entry for a file that no longer writes supporters would
		// hide a future regression in that file. Keep the allowlist honest: every
		// allowlisted file must still be a detected supporter writer.
		const writerFiles = new Set(writers.map((w) => w.file));
		for (const allowed of ALLOWLIST) {
			if (allowed === '_supporterStats.ts') continue; // the helper module, not a writer
			expect(writerFiles.has(allowed), `${allowed} is allowlisted but no longer writes supporters`).toBe(
				true
			);
		}
	});
});
