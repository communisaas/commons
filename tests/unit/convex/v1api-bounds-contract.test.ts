/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import source from '../../../convex/v1api.ts?raw';

function exportedBlock(name: string): string {
	const start = source.indexOf(`export const ${name} =`);
	if (start < 0) throw new Error(`missing export ${name}`);
	const next = source.indexOf('\nexport const ', start + 1);
	return source.slice(start, next < 0 ? source.length : next);
}

describe('v1 API cardinality contract', () => {
	it('contains no unbounded collection, rebuilt 10k window, template corpus, or raw receipt scan', () => {
		expect(source).not.toContain('.collect(');
		expect(source).not.toContain('take(10_000)');
		expect(source).not.toContain("query('templates')");
		expect(source).not.toContain("query('accountabilityReceipts')");
	});

	it.each([
		'listTags',
		'listCampaigns',
		'listCampaignActions',
		'listCallsV1',
		'listDonationsV1',
		'listSmsBlastsV1',
		'listEventsV1',
		'listWorkflowsV1',
		'listNetworksV1',
		'listRepresentativesV1',
		'listWebhooks',
		'listActivityFeed'
	])('%s is backed by an opaque bounded database page', (name) => {
		const block = exportedBlock(name);
		expect(block).toContain('.paginate(v1Pagination(');
		expect(block).toContain('requireCompleteV1Page(');
	});

	it.each([
		['getCampaignById', 'campaigns'],
		['getDonationById', 'donations'],
		['getEventById', 'events'],
		['getWorkflowById', 'workflows'],
		['getNetworkByIdV1', 'orgNetworks'],
		['getSubmissionStatus', 'submissions'],
		['getDelegationGrant', 'delegationGrants']
	])('%s normalizes an exact %s id before point lookup', (name, table) => {
		expect(exportedBlock(name)).toContain(`normalizeId('${table}'`);
	});

	it('activity requires one decision-maker and one closed source type', () => {
		const block = exportedBlock('listActivityFeed');
		expect(block).toContain("decisionMakerId: v.string()");
		expect(block).toContain("v.literal('vote')");
		expect(block).toContain("v.literal('sponsor')");
		expect(block).toContain("v.literal('receipt')");
		expect(block).toContain("query('accountabilityReceiptProjections')");
	});

	it('representatives return a compact DTO from one byte-bounded country page', () => {
		const block = exportedBlock('listRepresentativesV1');
		expect(block).not.toContain("query('externalIds')");
		expect(block).not.toContain('...dm');
		expect(block).toContain('.paginate(v1Pagination(');
		expect(source).toContain('maximumBytesRead');
		expect(block).toContain('constituencyId: null');
	});

	it('organization and network-owner identity use the compact directory projection', () => {
		const org = exportedBlock('getOrgForApiKey');
		expect(org).toContain("query('publicOrganizationDirectory')");
		expect(org).not.toContain('ctx.db.get(orgId)');
		const network = exportedBlock('getNetworkByIdV1');
		expect(network).toContain("query('publicOrganizationDirectory')");
		expect(network).not.toContain('ctx.db.get(network.ownerOrgId)');
	});
});
