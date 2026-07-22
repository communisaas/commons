import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, mockServerMutation } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockServerMutation: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery,
	serverMutation: mockServerMutation
}));
vi.mock('$lib/config/features', () => ({
	FEATURES: { DEBATE: true }
}));

import { GET, POST } from '../../../src/routes/api/debates/[debateId]/arguments/+server';

function getEvent(query = '') {
	return {
		params: { debateId: 'debate_1' },
		url: new URL(`https://commons.email/api/debates/debate_1/arguments${query}`)
	} as never;
}

const VALID_TX = `0x${'ab'.repeat(32)}`;
const VALID_ARGUMENT = {
	stance: 'SUPPORT',
	body: 'This argument easily clears the twenty character floor.',
	stakeAmount: 1000,
	proofHex: '0x1234',
	publicInputs: Array.from({ length: 31 }, () => '1'),
	nullifierHex: `0x${'cd'.repeat(32)}`,
	txHash: VALID_TX
};

function postEvent(body: unknown) {
	return {
		params: { debateId: 'debate_1' },
		request: new Request('https://commons.email/api/debates/debate_1/arguments', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: { session: { userId: 'user_1' }, user: { trust_tier: 3 } }
	} as never;
}

const ACTIVE_DEBATE = {
	status: 'active',
	deadline: new Date(Date.now() + 86_400_000).toISOString(),
	debateIdOnchain: '0x1'
};

describe('GET /api/debates/[debateId]/arguments validation', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		mockServerMutation.mockReset();
	});

	it('rejects an invalid stance before Convex I/O', async () => {
		await expect(GET(getEvent('?stance=NEUTRAL'))).rejects.toMatchObject({ status: 400 });

		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it.each(['?limit=abc', '?limit=0', '?limit=1.5', '?limit=9007199254740992'])(
		'rejects invalid limit %s before Convex I/O',
		async (query) => {
			await expect(GET(getEvent(query))).rejects.toMatchObject({ status: 400 });

			expect(mockServerQuery).not.toHaveBeenCalled();
		}
	);

	it.each(['?offset=-1', '?offset=1.5', '?offset=10001'])(
		'rejects invalid offset %s before Convex I/O',
		async (query) => {
			await expect(GET(getEvent(query))).rejects.toMatchObject({ status: 400 });

			expect(mockServerQuery).not.toHaveBeenCalled();
		}
	);

	it('clamps oversized limits to 100', async () => {
		mockServerQuery.mockResolvedValue({ arguments: [] });

		const response = await GET(getEvent('?limit=500'));

		expect(response.status).toBe(200);
		expect(mockServerQuery).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ limit: 100, offset: 0 })
		);
	});

	it('passes default list arguments parameters through', async () => {
		mockServerQuery.mockResolvedValue({ arguments: [] });

		const response = await GET(getEvent());

		expect(response.status).toBe(200);
		expect(mockServerQuery).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				debateId: 'debate_1',
				stance: undefined,
				limit: 50,
				offset: 0
			})
		);
	});
});

describe('POST /api/debates/[debateId]/arguments validation', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		mockServerMutation.mockReset();
	});

	it('rejects an array JSON body', async () => {
		mockServerQuery.mockResolvedValue(ACTIVE_DEBATE);

		await expect(POST(postEvent([]))).rejects.toMatchObject({ status: 400 });

		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it.each([
		['an argument body over 8,000 characters', { ...VALID_ARGUMENT, body: 'x'.repeat(8_001) }],
		[
			'an amendment text over 4,000 characters',
			{ ...VALID_ARGUMENT, stance: 'AMEND', amendmentText: 'x'.repeat(4_001) }
		],
		['a non-string proofHex', { ...VALID_ARGUMENT, proofHex: 1234 }],
		[
			'a wrong publicInputs arity',
			{ ...VALID_ARGUMENT, publicInputs: Array.from({ length: 30 }, () => '1') }
		],
		['an empty nullifier', { ...VALID_ARGUMENT, nullifierHex: '' }],
		['an over-long nullifier', { ...VALID_ARGUMENT, nullifierHex: `0x${'c'.repeat(300)}` }]
	])('rejects %s', async (_label, body) => {
		mockServerQuery.mockResolvedValue(ACTIVE_DEBATE);

		await expect(POST(postEvent(body))).rejects.toMatchObject({ status: 400 });

		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('rejects an oversized raw body', async () => {
		mockServerQuery.mockResolvedValue(ACTIVE_DEBATE);

		await expect(
			POST(postEvent({ ...VALID_ARGUMENT, padding: 'x'.repeat(200_000) }))
		).rejects.toMatchObject({ status: 413 });

		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('accepts a valid submission with a client transaction hash', async () => {
		mockServerQuery.mockImplementation((_fn, args) =>
			'nullifierHash' in (args as object) ? null : ACTIVE_DEBATE
		);
		mockServerMutation.mockResolvedValue('arg_1');

		const response = await POST(postEvent(VALID_ARGUMENT));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			argumentId: 'arg_1',
			verificationStatus: 'pending',
			chainStatus: 'pending_client_tx'
		});
		expect(mockServerMutation).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				debateId: 'debate_1',
				stance: 'SUPPORT',
				txHash: VALID_TX
			})
		);
	});
});
