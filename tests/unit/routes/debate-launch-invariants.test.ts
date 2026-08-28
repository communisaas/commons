import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockAppealResolution, mockServerMutation, mockServerQuery } = vi.hoisted(() => ({
	api: {
		debates: {
			get: 'debates.get',
			listArguments: 'debates.listArguments',
			updateStatus: 'debates.updateStatus'
		},
		campaigns: { getCampaignByDebateId: 'campaigns.getCampaignByDebateId' }
	},
	mockAppealResolution: vi.fn(),
	mockServerMutation: vi.fn(),
	mockServerQuery: vi.fn()
}));

vi.mock('$lib/convex', () => ({ api }));
vi.mock('convex-sveltekit', () => ({
	serverMutation: mockServerMutation,
	serverQuery: mockServerQuery
}));
vi.mock('$lib/config/features', () => ({ FEATURES: { DEBATE: true } }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'route-internal-secret'
}));
vi.mock('$lib/core/blockchain/debate-market-client', () => ({
	appealResolution: mockAppealResolution
}));

import { POST as appeal } from '../../../src/routes/api/debates/[debateId]/appeal/+server';
import { POST as settle } from '../../../src/routes/api/debates/[debateId]/settle/+server';

function appealEvent() {
	return {
		params: { debateId: 'debate-1' },
		locals: {
			session: { userId: 'user-1' },
			user: { id: 'user-1', trust_tier: 3 }
		}
	} as never;
}

function settleEvent(body: unknown, rawBody?: string) {
	return {
		params: { debateId: 'debate-1' },
		locals: {
			session: { userId: 'user-1' },
			user: { id: 'user-1', trust_tier: 3 }
		},
		request: new Request('https://commons.email/api/debates/debate-1/settle', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: rawBody ?? JSON.stringify(body)
		})
	} as never;
}

describe('debate launch transition routes', () => {
	beforeEach(() => {
		mockAppealResolution.mockReset();
		mockServerMutation.mockReset();
		mockServerQuery.mockReset();
	});

	it('persists a successful on-chain appeal as under_appeal using the observed state CAS', async () => {
		mockServerQuery.mockResolvedValue({
			_id: 'debate-1',
			status: 'resolved',
			debateIdOnchain: `0x${'11'.repeat(32)}`
		});
		mockAppealResolution.mockResolvedValue({ success: true, txHash: '0xappeal' });
		mockServerMutation.mockResolvedValue({ success: true });

		const response = await appeal(appealEvent());
		await expect(response.json()).resolves.toEqual({
			success: true,
			status: 'under_appeal',
			txHash: '0xappeal'
		});
		expect(mockServerMutation).toHaveBeenCalledWith(api.debates.updateStatus, {
			_secret: 'route-internal-secret',
			debateId: 'debate-1',
			expectedStatus: 'resolved',
			status: 'under_appeal'
		});
		expect(mockAppealResolution).toHaveBeenCalledWith(`0x${'11'.repeat(32)}`);
	});

	it('does not change the mirror when the on-chain appeal fails', async () => {
		mockServerQuery.mockResolvedValue({
			_id: 'debate-1',
			status: 'resolved',
			debateIdOnchain: `0x${'11'.repeat(32)}`
		});
		mockAppealResolution.mockResolvedValue({ success: false, error: 'chain rejected' });

		await expect(appeal(appealEvent())).rejects.toMatchObject({ status: 502 });
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('forbids ordinary members from campaign settlement', async () => {
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.debates.get) return { _id: 'debate-1', status: 'active' };
			if (ref === api.campaigns.getCampaignByDebateId) {
				return { _id: 'campaign-1', settlementRole: null };
			}
			throw new Error(`Unexpected query: ${ref}`);
		});

		await expect(
			settle(settleEvent({ outcome: 'support', reasoning: 'A sufficiently clear reason.' }))
		).rejects.toMatchObject({ status: 403 });
		expect(mockServerMutation).not.toHaveBeenCalled();
	});

	it('settles for editors with a status CAS and bounded normalized reasoning', async () => {
		mockServerQuery.mockImplementation(async (ref: string) => {
			if (ref === api.debates.get) return { _id: 'debate-1', status: 'active' };
			if (ref === api.campaigns.getCampaignByDebateId) {
				return { _id: 'campaign-1', settlementRole: 'editor' };
			}
			if (ref === api.debates.listArguments) {
				return { arguments: [{ argumentIndex: 7 }] };
			}
			throw new Error(`Unexpected query: ${ref}`);
		});
		mockServerMutation.mockResolvedValue({ success: true });

		const response = await settle(
			settleEvent({ outcome: 'oppose', reasoning: '  The evidence supports opposition.  ' })
		);
		await expect(response.json()).resolves.toMatchObject({
			status: 'resolved',
			winningStance: 'OPPOSE',
			winningArgumentIndex: 7,
			reasoning: 'The evidence supports opposition.'
		});
		expect(mockServerMutation).toHaveBeenCalledWith(api.debates.updateStatus, {
			_secret: 'route-internal-secret',
			debateId: 'debate-1',
			expectedStatus: 'active',
			status: 'resolved',
			winningStance: 'OPPOSE',
			winningArgumentIndex: 7,
			resolutionMethod: 'org_settlement',
			governanceJustification: 'The evidence supports opposition.'
		});
	});

	it('rejects an oversized settlement before spending any Convex I/O', async () => {
		await expect(
			settle(settleEvent(null, JSON.stringify({ outcome: 'support', reasoning: 'x'.repeat(9_000) })))
		).rejects.toMatchObject({ status: 413 });
		expect(mockServerQuery).not.toHaveBeenCalled();
		expect(mockServerMutation).not.toHaveBeenCalled();
	});
});
