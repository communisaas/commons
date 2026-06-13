/**
 * Coalition proof-pressure + stats wiring contract.
 *
 * The network detail page, the public coalition stats API, and the org report
 * route all read LIVE aggregates from convex/networks.ts — none of them may
 * regress to hardcoded zero placeholders or 501 stubs. Proof pressure is
 * receipt-backed: per decision-maker it sums each member org's STRONGEST
 * receipt weight (an org cannot inflate pressure by splitting deliveries),
 * with a bounded row limit. The public stats route proves active network
 * membership before returning anything.
 *
 * Pure source-contract pins — no Convex runtime.
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

const networks = source('convex/networks.ts');
const pageServer = source('src/routes/org/[slug]/networks/[networkId]/+page.server.ts');
const publicStatsRoute = source('src/routes/api/v1/networks/[id]/stats/+server.ts');
const orgReportRoute = source('src/routes/api/org/[slug]/networks/[networkId]/report/+server.ts');

describe('convex aggregates exist and read real receipts', () => {
	it('exports getStats and getProofPressure as queries', () => {
		expect(networks).toContain('export const getStats = query');
		expect(networks).toContain('export const getProofPressure = query');
	});

	it('proof pressure reads accountability receipts per member org', () => {
		const proofPressure = section(networks, 'export const getProofPressure = query', 'return rows');
		expect(proofPressure).toContain(".query('accountabilityReceipts')");
		expect(proofPressure).toContain("withIndex('by_orgId'");
	});

	it('sums each org\'s strongest receipt weight (split deliveries cannot inflate)', () => {
		expect(networks).toContain('Math.max(entry.orgWeights.get(orgKey) ?? 0, receipt.proofWeight)');
	});

	it('exposes the cross-org evidence scalars', () => {
		expect(networks).toContain('verifiedActionEvidence');
		expect(networks).toContain('districtSignalCount');
		expect(networks).toContain('combinedProofWeight');
	});

	it('caps the row limit', () => {
		expect(networks).toContain('Math.min(Math.floor(limit ?? 12), 25)');
	});
});

describe('network detail page loads live data', () => {
	it('queries both aggregates server-side', () => {
		expect(pageServer).toContain('serverQuery(api.networks.getProofPressure');
		expect(pageServer).toContain('serverQuery(api.networks.getStats');
	});

	it('returns the live results in load data', () => {
		expect(pageServer).toContain('proofPressure,');
		expect(pageServer).toContain('stats');
	});

	it('carries no zeroed placeholder stats', () => {
		expect(pageServer).not.toContain('proofPressure is currently unwired');
		expect(pageServer).not.toContain('const proofPressure: Array');
		expect(pageServer).not.toContain('verifiedSupporters: 0');
		expect(pageServer).not.toContain('totalSupporters: 0');
		expect(pageServer).not.toContain('uniqueSupporters: 0');
	});
});

describe('public coalition stats route', () => {
	it('is wired to the live query, not a stub', () => {
		expect(publicStatsRoute).toContain('api.networks.getStats');
		expect(publicStatsRoute).not.toMatch(/501|not yet wired/i);
	});

	it('proves active membership before returning stats', () => {
		expect(publicStatsRoute).toContain('api.networks.checkMembership');
		expect(publicStatsRoute).toContain('not an active member');
		expect(publicStatsRoute.indexOf('api.networks.checkMembership')).toBeLessThan(
			publicStatsRoute.indexOf('api.networks.getStats')
		);
	});
});

describe('org report route', () => {
	it('verifies the network then returns the live stats payload', () => {
		expect(orgReportRoute).toContain('api.networks.get,');
		expect(orgReportRoute).toContain('api.networks.getStats');
		expect(orgReportRoute).toContain('return json({ data: stats })');
	});
});

describe('convex-layer access gate (route gates alone are bypassable)', () => {
	it('both aggregates gate on requireNetworkAccess before reading anything', () => {
		const stats = section(networks, 'export const getStats = query', 'export const getProofPressure');
		expect(stats).toContain('await requireNetworkAccess(ctx, networkId, _secret);');
		const pressure = networks.slice(networks.indexOf('export const getProofPressure = query'));
		expect(pressure).toContain('await requireNetworkAccess(ctx, networkId, _secret);');
	});

	it('the gate accepts a signed-in member or the internal secret, nothing else', () => {
		const gate = section(networks, 'async function requireNetworkAccess', 'function coalitionFloor5');
		expect(gate).toContain('requireInternalSecret(secret);');
		expect(gate).toContain('await requireAuth(');
		expect(gate).toContain("Access denied — no active membership in this network");
	});

	it('the API-key route presents the internal secret (it carries no user identity)', () => {
		expect(publicStatsRoute).toContain('_secret: getInternalSecret()');
	});
});
