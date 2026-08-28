/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import campaignsSource from '../../../convex/campaigns.ts?raw';
import schemaSource from '../../../convex/schema.ts?raw';
import submissionsSource from '../../../convex/submissions.ts?raw';

describe('congressional campaign attribution authority', () => {
	it('uses one exact active same-org campaign and fails closed on multiplicity', () => {
		const start = submissionsSource.indexOf('export const emitCongressionalAction');
		const end = submissionsSource.indexOf('/**\n * Internal query: Get submission', start);
		const block = submissionsSource.slice(start, end);
		expect(schemaSource).toContain(".index('by_templateId_orgId_status', [");
		expect(block).toContain('by_templateId_orgId_status');
		expect(block).toContain(".eq('status', 'ACTIVE')");
		expect(block).toContain('.take(2)');
		expect(block).toContain('CONGRESSIONAL_CAMPAIGN_ATTRIBUTION_MULTIPLICITY');
		expect(block).not.toContain('.collect(');
	});

	it('serializes activation against the same template attribution identity', () => {
		expect(campaignsSource).toContain('assertActiveTemplateAttributionAvailable');
		expect(campaignsSource).toContain('CAMPAIGN_ACTIVE_TEMPLATE_ATTRIBUTION_CONFLICT');
		expect(campaignsSource).toContain('by_templateId_orgId_status');
	});
});
