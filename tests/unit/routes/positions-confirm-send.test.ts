import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockGetInternalSecret, mockServerMutation, mockServerQuery } = vi.hoisted(() => ({
	api: {
		positions: { confirmMailtoSend: 'positions.confirmMailtoSend' },
		users: { getShadowAtlasRegistration: 'users.getShadowAtlasRegistration' }
	},
	mockGetInternalSecret: vi.fn(() => 'position-delivery-secret'),
	mockServerMutation: vi.fn(),
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: { STANCE_POSITIONS: true } }));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/convex-work-budget', () => ({
	serverMutation: mockServerMutation,
	serverQuery: mockServerQuery
}));
vi.mock('$lib/server/internal/secret-auth', () => ({ getInternalSecret: mockGetInternalSecret }));

import { POST } from '../../../src/routes/api/positions/confirm-send/+server';

function eventWithRequest(
	request: Request,
	options: { authenticated?: boolean; verified?: boolean } = {}
) {
	const authenticated = options.authenticated ?? true;
	const verified = options.verified ?? true;
	return {
		request,
		locals: {
			session: authenticated ? { userId: 'user_1' } : null,
			user: authenticated
				? { id: 'user_1', identity_commitment: verified ? 'identity-commitment-1' : null }
				: null
		}
	} as never;
}

function event(body: unknown, options?: { authenticated?: boolean; verified?: boolean }) {
	return eventWithRequest(
		new Request('https://commons.email/api/positions/confirm-send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		options
	);
}

describe('POST /api/positions/confirm-send', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockServerQuery.mockResolvedValue({ congressionalDistrict: 'US-CA-01' });
		mockServerMutation.mockResolvedValue({
			registrationId: 'registration_1',
			isNewPosition: false,
			created: 1,
			existing: 0
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('rejects unauthenticated requests before reading the body or reserving Convex work', async () => {
		const candidate = event({ templateId: 'template_1' }, { authenticated: false }) as unknown as {
			request: Request;
		};
		const reader = vi.spyOn(candidate.request.body!, 'getReader');

		const response = await POST(candidate as never);

		expect(response.status).toBe(401);
		expect(reader).not.toHaveBeenCalled();
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('uses one district projection and no template-title lookup before the idempotent mutation', async () => {
		const response = await POST(event({ templateId: 'template_1' }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			registrationId: 'registration_1',
			isNewPosition: false,
			deliveryCreated: 1,
			deliveryExisting: 0,
			confirmed: true
		});
		expect(mockServerQuery).toHaveBeenCalledTimes(1);
		expect(mockServerQuery).toHaveBeenCalledWith(api.users.getShadowAtlasRegistration, {
			userId: 'user_1'
		});
		expect(mockServerMutation).toHaveBeenCalledWith(api.positions.confirmMailtoSend, {
			_secret: 'position-delivery-secret',
			templateId: 'template_1',
			identityCommitment: 'identity-commitment-1',
			districtCode: 'US-CA-01'
		});
	});

	it.each([
		['an extra field', { templateId: 'template_1', ignored: true }],
		['a missing template ID', {}],
		['an oversized template ID', { templateId: 'x'.repeat(65) }]
	])('rejects %s without Convex work', async (_label, body) => {
		const response = await POST(event(body));
		expect(response.status).toBe(400);
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects an oversized request while streaming', async () => {
		const response = await POST(event({ templateId: 'template_1', padding: 'x'.repeat(2 * 1024) }));
		expect(response.status).toBe(413);
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('requires a server-held verified identity before Convex work', async () => {
		const response = await POST(event({ templateId: 'template_1' }, { verified: false }));
		expect(response.status).toBe(403);
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('maps durable admission denial to 429', async () => {
		mockServerMutation.mockRejectedValue(new Error('POSITION_DELIVERY_RATE_LIMITED'));

		const response = await POST(event({ templateId: 'template_1' }));

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
	});

	it('maps shared registration cardinality failures to conflict', async () => {
		mockServerMutation.mockRejectedValue(
			new Error('POSITION_DELIVERY_REGISTRATION_CAP_EXCEEDED')
		);

		const response = await POST(event({ templateId: 'template_1' }));

		expect(response.status).toBe(409);
	});
});
