/**
 * Manual bounce-report consensus suppression contract.
 *
 * A single verified user reporting a bounce must never suppress an address —
 * suppression requires N independent verified reporters (consensus), runs
 * through internal-only cron machinery, propagates to supporter email status
 * without clobbering stronger states, and auto-resolves stale unconfirmed
 * reports so the queue cannot grow unbounded. The reporting endpoint mirrors
 * the canonical global email hash so reports join supporters deterministically.
 *
 * Pure source-contract pins — no Convex runtime. The endpoint's _secret
 * gating is covered separately by the internal-secret-gates suite.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/** Slice between two unique markers; asserts both exist. */
function section(src: string, start: string, end: string): string {
	const startIdx = src.indexOf(start);
	expect(startIdx, `marker not found: ${start}`).toBeGreaterThanOrEqual(0);
	const endIdx = src.indexOf(end, startIdx + start.length);
	expect(endIdx, `marker not found: ${end}`).toBeGreaterThan(startIdx);
	return src.slice(startIdx, endIdx);
}

const email = source('convex/email.ts');
const schema = source('convex/schema.ts');
const reportEndpoint = source('src/routes/api/emails/report-bounce/+server.ts');

describe('consensus threshold', () => {
	it('requires two independent reporters with a bounded scan', () => {
		expect(email).toContain('const USER_BOUNCE_REPORT_THRESHOLD = 2;');
		expect(email).toContain('const USER_BOUNCE_REPORT_SCAN_LIMIT = 500;');
	});

	it('counts DISTINCT reporters, not raw report rows', () => {
		expect(email).toContain('new Set(reports.map((report) => report.reportedBy)).size');
		expect(email).toContain('if (reporterCount < USER_BOUNCE_REPORT_THRESHOLD) continue;');
	});
});

describe('cron machinery is internal-only', () => {
	it('processor, queries, and mutations are not publicly callable', () => {
		expect(email).toContain('export const processBounceReports = internalAction');
		expect(email).toContain('export const getPendingBounceReports = internalQuery');
		expect(email).toContain('export const getStaleBounceReports = internalQuery');
		expect(email).toContain('export const suppressReportedBounce = internalMutation');
		expect(email).toContain('export const resolveBounceReport = internalMutation');
	});

	it('wires the consensus steps through function references', () => {
		expect(email).toContain('const getPendingBounceReportsRef = makeFunctionReference');
		expect(email).toContain('const suppressReportedBounceRef = makeFunctionReference');
	});
});

describe('pending scan uses the resolved index', () => {
	it('schema defines by_resolved on bounceReports', () => {
		const bounceTable = section(schema, 'bounceReports: defineTable', 'agentTraces: defineTable');
		expect(bounceTable).toContain(".index('by_resolved', ['resolved'])");
	});

	it('pending + stale queries filter unresolved via the index', () => {
		const occurrences =
			email.match(/\.withIndex\('by_resolved', \(q\) => q\.eq\('resolved', false\)\)/g) ?? [];
		expect(occurrences.length).toBeGreaterThanOrEqual(2);
	});
});

describe('suppression effects', () => {
	it('suppression record attributes the consensus source', () => {
		const suppress = section(
			email,
			'export const suppressReportedBounce = internalMutation',
			'export const sendAlertDigests'
		);
		expect(suppress).toContain("source: 'user_report'");
		expect(suppress).toContain("suppressedBy: 'verified_user_report_consensus'");
	});

	it('propagates to supporters via the global email hash index', () => {
		expect(email).toContain(
			".withIndex('by_globalEmailHash', (q) => q.eq('globalEmailHash', emailHash))"
		);
	});

	it('never downgrades a complained supporter to bounced', () => {
		expect(email).toContain("if (supporter.emailStatus === 'complained') continue;");
	});

	it('marks the consumed reports with the consensus probe result', () => {
		expect(email).toContain("probeResult: 'suppressed_by_consensus'");
	});
});

describe('stale auto-resolution', () => {
	it('unconfirmed reports past the window resolve as stale', () => {
		expect(email).toContain("resolution: 'auto_resolved_stale'");
	});

	it('the processor returns real work counts, not a zeroed stub', () => {
		expect(email).toContain(
			'return { processed, suppressed, staleResolved, groupsChecked: reportGroups.size };'
		);
		expect(email).not.toContain('return { processed: 0, suppressed: 0, staleResolved };');
	});
});

describe('report endpoint hash canonicalization', () => {
	it('mirrors the canonical global email hash preimage', () => {
		expect(reportEndpoint).toContain('Mirrors computeGlobalEmailHash in convex/_orgHash.ts');
		expect(reportEndpoint).toContain('encode(`email:${email.trim().toLowerCase()}`)');
		expect(reportEndpoint).toContain("crypto.subtle.digest('SHA-256'");
	});

	it('keeps triage opaque: dedup and fresh reports return the same response', () => {
		const accepted = reportEndpoint.match(/status: 'reported'/g) ?? [];
		expect(accepted.length).toBeGreaterThanOrEqual(2);
	});
});
