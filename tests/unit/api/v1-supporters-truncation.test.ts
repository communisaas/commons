/**
 * API v1 People browsing reuses the same opaque database-cursor foundation as
 * the operator UI. The filename is retained so the old scan-window regression
 * remains discoverable, but truncation is no longer an accepted behavior.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const v1Source = readFileSync(path.resolve(process.cwd(), 'convex/v1api.ts'), 'utf8');
const routeSource = readFileSync(
	path.resolve(process.cwd(), 'src/routes/api/v1/supporters/+server.ts'),
	'utf8'
);

describe('v1 supporter cursor pagination', () => {
	it('does not rebuild or truncate a 10000-row supporter window', () => {
		const body = v1Source.slice(
			v1Source.indexOf('export const listSupporters = query'),
			v1Source.indexOf('export const getSupporterById = query')
		);
		expect(body).toContain('readSupporterBrowsePage(ctx');
		expect(body).not.toContain('SUPPORTER_SCAN_LIMIT');
		expect(body).not.toMatch(/\.take\(10_?000/);
		expect(body).not.toMatch(/findIndex\([^)]*cursor/);
		expect(body).not.toContain('truncated');
		expect(body).not.toContain('scanLimit');
	});

	it('uses exact indexed lookup for an email hash and direct IDs for item operations', () => {
		const supporterSection = v1Source.slice(
			v1Source.indexOf('// SUPPORTERS (v1 API)'),
			v1Source.indexOf('// TAGS (v1 API)')
		);
		expect(supporterSection).toContain(".withIndex('by_orgId_emailHash'");
		expect(supporterSection).toContain("ctx.db.normalizeId('supporters', supporterId)");
		expect(supporterSection).not.toMatch(/\.withIndex\('by_orgId'[^;]+\.find\(/s);
	});

	it('omits unknown filtered totals instead of scanning to manufacture them', () => {
		expect(v1Source).toContain('Filtered cardinalities intentionally remain unknown');
		expect(routeSource).toContain('result.total === undefined');
		expect(routeSource).not.toContain('result.truncated');
		expect(routeSource).not.toContain('result.scanLimit');
	});
});
