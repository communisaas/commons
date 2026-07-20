/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import invitesSource from '../../../convex/invites.ts?raw';
import limitsSource from '../../../convex/lib/orgConfigurationLimits.ts?raw';
import organizationsSource from '../../../convex/organizations.ts?raw';
import segmentsSource from '../../../convex/segments.ts?raw';
import workflowsSource from '../../../convex/workflows.ts?raw';

function exportedBlock(source: string, symbol: string, nextMarker: string): string {
	const start = source.indexOf(`export const ${symbol}`);
	const end = source.indexOf(nextMarker, start);
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${symbol}`);
	return source.slice(start, end);
}

describe('finite organization configuration invariants', () => {
	it('uses one shared segment cap at both list and create boundaries', () => {
		const list = exportedBlock(segmentsSource, 'list', '// =============================================================================\n// MUTATIONS');
		const create = exportedBlock(segmentsSource, 'create', '/**\n * Update an existing segment');
		expect(segmentsSource).toContain('export const MAX_SEGMENTS_PER_ORG = 100');
		for (const block of [list, create]) {
			expect(block).toContain('.take(MAX_SEGMENTS_PER_ORG + 1)');
		}
		expect(list).toContain('SEGMENT_CARDINALITY_REPAIR_REQUIRED');
		expect(create).toContain('SEGMENT_LIMIT_EXCEEDED');
		expect(create).toContain('boundedSegmentFilter(args.filters)');
	});

	it('bounds invite history, seat fan-out, and one action batch independently', () => {
		expect(limitsSource).toContain('MAX_INVITE_RECORDS_PER_ORG = 100');
		expect(limitsSource).toContain('MAX_ORG_SEATS = 25');
		expect(invitesSource).toContain('.take(MAX_INVITE_RECORDS_PER_ORG + 1)');
		expect(invitesSource).toContain('.take(MAX_ORG_SEATS + 1)');
		expect(invitesSource).toContain('if (args.invites.length > 20)');
		expect(invitesSource).toContain('ORG_INVITE_CARDINALITY_REPAIR_REQUIRED');
		expect(invitesSource).toContain('Seat limit reached (${seatLimit})');
	});

	it('couples issue-domain and workflow read caps to writer refusal', () => {
		expect(organizationsSource).toContain('const MAX_DOMAINS_PER_ORG = 20');
		expect(organizationsSource).toContain('.take(MAX_DOMAINS_PER_ORG + 1)');
		expect(organizationsSource).toContain('ISSUE_DOMAIN_CARDINALITY_REPAIR_REQUIRED');
		expect(organizationsSource).toContain(
			'Maximum of ${MAX_DOMAINS_PER_ORG} issue domains per organization'
		);

		expect(workflowsSource).toContain('export const MAX_WORKFLOWS_PER_ORG = 100');
		expect(workflowsSource).toContain('.take(MAX_WORKFLOWS_PER_ORG + 1)');
		expect(workflowsSource).toContain('WORKFLOW_CARDINALITY_REPAIR_REQUIRED');
		expect(workflowsSource).toContain('WORKFLOW_LIMIT_EXCEEDED');
	});

	it('keeps operator summaries on compact rows rather than source history', () => {
		const workflowList = exportedBlock(
			workflowsSource,
			'list',
			'export const workflowExecutionCountMigrationStatus'
		);
		expect(workflowList).toContain("query('workflows')");
		expect(workflowList).not.toContain("query('workflowExecutions')");
	});
});
