/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';

import positionsSource from '../../../convex/positions.ts?raw';
import schemaSource from '../../../convex/schema.ts?raw';
import routeSource from '../../../src/routes/api/deliveries/record/+server.ts?raw';

function block(symbol: string, next: string): string {
	const start = positionsSource.indexOf(`export const ${symbol}`);
	const end = positionsSource.indexOf(next, start);
	if (start < 0 || end < 0) throw new Error(`Could not isolate ${symbol}`);
	return positionsSource.slice(start, end);
}

describe('direct delivery history bounds', () => {
	it('retires unused unbounded history readers before I/O', () => {
		for (const [symbol, next, code] of [
			['getDeliveries', '/**\n * Get all deliveries', 'POSITION_DELIVERY_HISTORY_RETIRED'],
			['getUserDeliveries', '/**\n * Get engagement', 'POSITION_USER_DELIVERY_HISTORY_RETIRED']
		] as const) {
			const source = block(symbol, next);
			expect(source).toContain(code);
			expect(source).not.toContain('ctx.db');
			expect(source).not.toContain('.collect(');
		}
	});

	it('owns direct delivery replay and lifetime cardinality through one bounded pair read', () => {
		const source = block('recordDirectDeliveries', '/**\n * Get full engagement');
		const appendStart = positionsSource.indexOf('async function appendDirectDeliveries');
		const appendEnd = positionsSource.indexOf('/**\n * Record delivery events directly', appendStart);
		const appendSource = positionsSource.slice(appendStart, appendEnd);
		expect(schemaSource).toContain(
			".index('by_templateId_pseudonymousId', ['templateId', 'pseudonymousId'])"
		);
		expect(positionsSource).toContain('DIRECT_DELIVERY_RECIPIENT_MAX = 20');
		expect(source).toContain('DIRECT_DELIVERY_INPUT_MAX_BYTES');
		expect(source).toContain('appendDirectDeliveries(ctx');
		expect(source).toContain("template.status !== 'published'");
		expect(appendSource).toContain("withIndex('by_templateId_pseudonymousId'");
		expect(appendSource).toContain('.take(DIRECT_DELIVERY_RECIPIENT_MAX + 1)');
		expect(appendSource).toContain('reserveDirectDeliveryAdmission(');
		expect(appendSource).toContain('DIRECT_DELIVERY_LIFETIME_CAP_EXCEEDED');
		expect(appendSource).not.toContain('.collect(');
		expect(source).not.toContain('.collect(');
		expect(routeSource).toContain('DIRECT_DELIVERY_RECIPIENT_MAX = 20');
		expect(routeSource).toContain('readBoundedJsonRequest(');
		expect(routeSource).toContain("hasExactKeys(value, ['name', 'deliveryMethod'])");
	});

	it('bounds and durably deduplicates stance-linked batch deliveries', () => {
		const source = block('batchRegisterDeliveries', 'function canonicalDirectPseudonymousId');
		const appendStart = positionsSource.indexOf(
			'async function appendRegistrationLinkedDeliveries'
		);
		const appendEnd = positionsSource.indexOf('/**\n * Get aggregate position counts', appendStart);
		const appendSource = positionsSource.slice(appendStart, appendEnd);
		const confirmSource = block('confirmMailtoSend', '/**\n * Batch-create delivery records');
		expect(schemaSource).toContain(
			".index('by_registrationId_recipientKey', ['registrationId', 'recipientKey'])"
		);
		expect(source).toContain('normalizePositionDeliveryRecipients(recipients)');
		expect(source).toContain('appendRegistrationLinkedDeliveries(ctx');
		expect(confirmSource).toContain('appendRegistrationLinkedDeliveries(ctx');
		expect(appendSource).toContain(
			'reserveRegistrationDeliveryAdmission(ctx, args.identityCommitment)'
		);
		expect(appendSource).toContain("withIndex('by_registrationId'");
		expect(appendSource).toContain('POSITION_DELIVERY_REGISTRATION_MAX_RECIPIENTS + 1');
		expect(appendSource).not.toContain('.collect(');
		expect(source).not.toContain('.collect(');
	});
});
