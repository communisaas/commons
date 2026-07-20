/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import agentTracesSource from '../../../convex/agentTraces.ts?raw';
import delegationSource from '../../../convex/delegation.ts?raw';
import donationsSource from '../../../convex/donations.ts?raw';
import networksSource from '../../../convex/networks.ts?raw';
import organizationsSource from '../../../convex/organizations.ts?raw';
import submissionsSource from '../../../convex/submissions.ts?raw';
import supportersSource from '../../../convex/supporters.ts?raw';
import usersSource from '../../../convex/users.ts?raw';

function exportedBlock(source: string, symbol: string, nextMarker: string): string {
	const start = source.indexOf(`export const ${symbol}`);
	const end = source.indexOf(nextMarker, start);
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${symbol}`);
	return source.slice(start, end);
}

describe('retired public queries and projected aggregates', () => {
	it('rejects the donation donor-list surface before database work', () => {
		const block = exportedBlock(donationsSource, 'listPublicByCampaign', 'const DONATION_STATUS_VALIDATOR');
		expect(block).toContain('PUBLIC_DONATION_LIST_RETIRED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('.collect(');
	});

	it('rejects the homepage submission aggregate before clock or database work', () => {
		const block = exportedBlock(submissionsSource, 'aggregateForHero', 'export const retryDelivery');
		expect(block).toContain('SUBMISSIONS_HERO_AGGREGATE_RETIRED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('Date.now');
		expect(block).not.toContain('.collect(');
	});

	it('rejects the retired dashboard aggregate before database work', () => {
		const block = exportedBlock(
			organizationsSource,
			'getDashboardStats',
			'/** @deprecated Memberships are supplied by compact, route-owned settings reads. */'
		);
		expect(block).toContain('ORGANIZATION_DASHBOARD_STATS_RETIRED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('computeDistrictVerified');
		expect(block).not.toContain('computeGrowthWindow');
	});

	it.each([
		['getDashboard', 'export const getDashboardStats', 'ORGANIZATION_DASHBOARD_RETIRED'],
		['getMembers', 'export const getOrgContext', 'ORGANIZATION_MEMBERS_QUERY_RETIRED'],
		[
			'getUserOrgPlan',
			'export const getBillingContext',
			'ORGANIZATION_USER_PLAN_QUERY_RETIRED'
		],
		[
			'listTwilioNumbers',
			'export const registerTwilioNumber',
			'ORGANIZATION_TWILIO_NUMBER_LIST_RETIRED'
		]
	])('keeps organizations.%s as a pre-I/O tombstone', (symbol, nextMarker, code) => {
		const block = exportedBlock(organizationsSource, symbol, nextMarker);
		expect(block).toContain(code);
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('requireOrgRole');
	});

	it.each([
		['listGrants', 'export const getGrant'],
		['getGrant', 'export const listActions'],
		['listActions', '// =============================================================================\n// ACTIONS']
	])('keeps delegation.%s launch-disabled before I/O', (symbol, nextMarker) => {
		const block = exportedBlock(delegationSource, symbol, nextMarker);
		expect(block).toContain('DELEGATION_NOT_LAUNCHED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('requireAuth');
	});

	it.each([
		['createGrant', 'export const updateGrant'],
		['updateGrant', '// =============================================================================\n// MUTATIONS'],
		['revokeGrant', '/**\n * Record a delegated action'],
		['recordAction', '/**\n * Submit a review decision'],
		['submitReview', '// =============================================================================\n// INTERNAL MUTATIONS'],
		['insertGrant', '/**\n * Patch a delegation grant'],
		['patchGrant', '']
	])('keeps the delegation writer %s launch-disabled before I/O', (symbol, nextMarker) => {
		const start = delegationSource.indexOf(`export const ${symbol}`);
		const end = nextMarker ? delegationSource.indexOf(nextMarker, start) : delegationSource.length;
		expect(start).toBeGreaterThanOrEqual(0);
		expect(end).toBeGreaterThan(start);
		const block = delegationSource.slice(start, end);
		expect(block).toContain('DELEGATION_NOT_LAUNCHED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('ctx.run');
		expect(block).not.toContain('requireAuth');
	});

	it('retires the unused cross-organization reputation fan-out before I/O', () => {
		const block = exportedBlock(
			usersSource,
			'getMyReputationPortable',
			'const REPUTATION_THRESHOLDS'
		);
		expect(block).toContain('USER_REPUTATION_PORTABLE_RETIRED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('requireAuth');
	});

	it('retires the historical coalition-wide packet scan before I/O', () => {
		const block = exportedBlock(
			networksSource,
			'refreshCoalitionPacketHash',
			'function rebuildAccumulator'
		);
		expect(block).toContain('COALITION_PACKET_HASH_RETIRED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('requireOrgRole');
		expect(block).not.toContain('.collect(');
	});

	it('cursor-pages trace replay within explicit row and byte ceilings', () => {
		const block = exportedBlock(agentTracesSource, 'listByTrace', '/**\n * Summarize');
		expect(block).toContain('.paginate({');
		expect(block).toContain('numItems: TRACE_EVENT_PAGE_SIZE');
		expect(block).toContain('maximumRowsRead: TRACE_EVENT_PAGE_SIZE');
		expect(block).toContain('maximumBytesRead: TRACE_EVENT_PAGE_MAX_BYTES');
		expect(block).toContain('continueCursor');
		expect(block).not.toContain('.collect(');
	});

	it('keeps unsafe partial trace erasure disabled before I/O', () => {
		const start = agentTracesSource.indexOf('export const deleteByUserId');
		expect(start).toBeGreaterThanOrEqual(0);
		const block = agentTracesSource.slice(start);
		expect(block).toContain('AGENT_TRACE_USER_ERASURE_NOT_LAUNCHED');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('.collect(');
	});

	it('serves district verification from the readiness-gated exact scalar', () => {
		const block = exportedBlock(
			supportersSource,
			'getDistrictVerifiedCount',
			'/**\n * List tags for an org.'
		);
		expect(block).toContain('assertSupporterAudienceActionReady(ctx)');
		expect(block).toContain('org.districtVerifiedSupporterCount ?? 0');
		expect(block).not.toContain('campaignActions');
		expect(block).not.toContain('ctx.db');
		expect(block).not.toContain('.take(');
	});
});
