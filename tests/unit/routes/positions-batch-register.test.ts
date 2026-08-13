import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockGetInternalSecret, mockServerMutation } = vi.hoisted(() => ({
	api: { positions: { batchRegisterDeliveries: 'positions.batchRegisterDeliveries' } },
	mockGetInternalSecret: vi.fn(() => 'position-delivery-secret'),
	mockServerMutation: vi.fn()
}));

vi.mock('$lib/config/features', () => ({ FEATURES: { STANCE_POSITIONS: true } }));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/convex-work-budget', () => ({ serverMutation: mockServerMutation }));
vi.mock('$lib/server/internal/secret-auth', () => ({ getInternalSecret: mockGetInternalSecret }));

import { POST } from '../../../src/routes/api/positions/batch-register/+server';

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
		new Request('https://commons.email/api/positions/batch-register', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		options
	);
}

describe('POST /api/positions/batch-register', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockServerMutation.mockResolvedValue({ created: 1 });
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('rejects unauthenticated requests before reading the body or reserving Convex work', async () => {
		const candidate = event({ registrationId: 'registration_1', recipients: [] }, { authenticated: false }) as unknown as {
			request: Request;
		};
		const reader = vi.spyOn(candidate.request.body!, 'getReader');

		const response = await POST(candidate as never);

		expect(response.status).toBe(401);
		expect(reader).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('canonicalizes and request-deduplicates recipients before the mutation', async () => {
		const response = await POST(
			event({
				registrationId: 'registration_1',
				recipients: [
					{
						name: '  Rep. Jos\u00e9   Smith ',
						email: ' REP@EXAMPLE.COM ',
						deliveryMethod: 'email'
					},
					{
						name: 'rep jose smith',
						email: 'rep@example.com',
						deliveryMethod: 'email'
					}
				]
			})
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ deliveries: 1, existing: 0, duplicates: 1 });
		expect(mockServerMutation).toHaveBeenCalledWith(api.positions.batchRegisterDeliveries, {
			_secret: 'position-delivery-secret',
			registrationId: 'registration_1',
			identityCommitment: 'identity-commitment-1',
			recipients: [
				{
					name: 'Rep. Jos\u00e9 Smith',
					email: 'rep@example.com',
					deliveryMethod: 'email'
				}
			]
		});
	});

	it.each([
		['an extra top-level field', { registrationId: 'registration_1', recipients: [], extra: true }],
		[
			'an extra recipient field',
			{
				registrationId: 'registration_1',
				recipients: [{ name: 'Rep Smith', deliveryMethod: 'email', ignored: true }]
			}
		],
		[
			'a conflicting duplicate canonical key',
			{
				registrationId: 'registration_1',
				recipients: [
					{ name: 'Rep. Smith', deliveryMethod: 'email', email: 'one@example.com' },
					{ name: 'rep smith', deliveryMethod: 'email', email: 'two@example.com' }
				]
			}
		],
		[
			'an invalid delivery method',
			{
				registrationId: 'registration_1',
				recipients: [{ name: 'Rep Smith', deliveryMethod: 'fax' }]
			}
		]
	])('rejects %s without touching Convex', async (_label, body) => {
		const response = await POST(event(body));
		expect(response.status).toBe(400);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects more than 20 recipients before Convex', async () => {
		const response = await POST(
			event({
				registrationId: 'registration_1',
				recipients: Array.from({ length: 21 }, (_, index) => ({
					name: `Recipient ${index}`,
					deliveryMethod: 'recorded'
				}))
			})
		);
		expect(response.status).toBe(400);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects a request body that consumes the reserved Convex-envelope budget', async () => {
		const response = await POST(
			event({
				registrationId: 'registration_1',
				recipients: [{ name: 'x'.repeat(61 * 1024), deliveryMethod: 'recorded' }]
			})
		);
		expect(response.status).toBe(413);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('requires a server-held verified identity before Convex', async () => {
		const response = await POST(
			event(
				{
					registrationId: 'registration_1',
					recipients: [{ name: 'Rep Smith', deliveryMethod: 'recorded' }]
				},
				{ verified: false }
			)
		);
		expect(response.status).toBe(403);
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('maps the durable Convex admission denial to 429', async () => {
		mockServerMutation.mockRejectedValue(new Error('POSITION_DELIVERY_RATE_LIMITED'));

		const response = await POST(
			event({
				registrationId: 'registration_1',
				recipients: [{ name: 'Rep Smith', deliveryMethod: 'recorded' }]
			})
		);

		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('60');
	});

	it('maps the complete Convex-envelope byte denial to 413', async () => {
		mockServerMutation.mockRejectedValue(new Error('POSITION_DELIVERY_INPUT_TOO_LARGE'));

		const response = await POST(
			event({
				registrationId: 'registration_1',
				recipients: [{ name: 'Rep Smith', deliveryMethod: 'recorded' }]
			})
		);

		expect(response.status).toBe(413);
		await expect(response.json()).resolves.toEqual({ error: 'Request body exceeds maximum size' });
	});
});
