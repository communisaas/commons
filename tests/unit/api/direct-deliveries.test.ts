/**
 * Launch containment for direct delivery persistence.
 *
 * The route remains mounted for old clients, but it must reject before reading
 * recipient data or touching Convex until durable bounded admission is ready.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const { mockServerQuery, mockServerMutation } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));

import { POST as recordDelivery } from '../../../src/routes/api/deliveries/record/+server';

function buildEventArgs(
	session: { userId?: string } | null,
	request: unknown = { json: vi.fn() }
) {
	return {
		request,
		locals: { session },
		params: {},
		url: new URL('http://localhost/api/deliveries/record')
	} as any;
}

describe('POST /api/deliveries/record — launch containment', () => {
	it('preserves the authentication boundary before inspecting the request', async () => {
		const parseBody = vi.fn(() => {
			throw new Error('request body must not be read');
		});

		const response = await recordDelivery(buildEventArgs(null, { json: parseBody }));

		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual({ error: 'Authentication required' });
		expect(parseBody).not.toHaveBeenCalled();
	});

	it('returns a clear non-cacheable 503 to authenticated callers without parsing PII', async () => {
		const parseBody = vi.fn(() => ({
			templateId: 'template-secret',
			recipients: [{ name: 'Private Recipient', email: 'private@example.test' }]
		}));

		const response = await recordDelivery(
			buildEventArgs({ userId: 'user-1' }, { json: parseBody })
		);
		const payload = await response.json();

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(payload).toEqual({ error: 'Delivery recording is temporarily unavailable' });
		expect(JSON.stringify(payload)).not.toContain('Private Recipient');
		expect(JSON.stringify(payload)).not.toContain('private@example.test');
		expect(parseBody).not.toHaveBeenCalled();
	});

	it('does not issue Convex reads or mutations', async () => {
		await recordDelivery(buildEventArgs({ userId: 'user-1' }));

		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('fails closed at the authoritative Convex boundary before database access', () => {
		const source = readFileSync(resolve(process.cwd(), 'convex/positions.ts'), 'utf8');
		const start = source.indexOf('export const recordDirectDeliveries = mutation({');
		const end = source.indexOf('\nexport const ', start + 1);
		const boundary = source.slice(start, end === -1 ? source.length : end);

		expect(start).toBeGreaterThanOrEqual(0);
		expect(boundary.indexOf('requireInternalSecret(_secret)')).toBeGreaterThanOrEqual(0);
		expect(boundary.indexOf('throw new Error("DIRECT_DELIVERY_RECORDING_DISABLED")')).toBeGreaterThan(
			boundary.indexOf('requireInternalSecret(_secret)')
		);
		expect(boundary).not.toContain('ctx.db');
	});
});
