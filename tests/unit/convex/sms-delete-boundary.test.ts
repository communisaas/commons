/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import smsSource from '../../../convex/sms.ts?raw';
import smsRouteSource from '../../../src/routes/api/org/[slug]/sms/[id]/+server.ts?raw';

describe('SMS blast deletion boundary', () => {
	it('deletes only an empty draft with a constant-cardinality child probe', () => {
		const start = smsSource.indexOf('export const deleteBlast');
		expect(start).toBeGreaterThanOrEqual(0);
		const block = smsSource.slice(start);
		expect(block).toContain('SMS_BLAST_DELETE_DRAFT_ONLY');
		expect(block).toContain('SMS_BLAST_DELETE_REQUIRES_RETENTION_WORKFLOW');
		expect(block).toContain('.first()');
		expect(block).not.toContain('.collect(');
	});

	it('refuses message-bearing lifecycle states at the HTTP boundary', () => {
		expect(smsRouteSource).toContain("existing.blast.status !== 'draft'");
		expect(smsRouteSource).toContain('Only an empty text delivery draft can be deleted');
	});
});
