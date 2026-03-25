/**
 * Unit tests for POST /api/debates/[debateId]/settle
 *
 * Tests the settlement endpoint validation logic, auth checks,
 * and state transitions without requiring a live database.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════════════

// Mock FEATURES
vi.mock('$lib/config/features', () => ({
	FEATURES: { DEBATE: true }
}));

// Prisma mock
const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();

vi.mock('$lib/core/db', () => ({
	prisma: {
		debate: {
			findUnique: (...args: unknown[]) => mockFindUnique(...args),
			update: (...args: unknown[]) => mockUpdate(...args)
		}
	}
}));

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** Import the handler fresh (mocks must be set up first) */
async function getHandler() {
	const mod = await import(
		'../../../src/routes/api/debates/[debateId]/settle/+server'
	);
	return mod.POST;
}

interface MockRequestOptions {
	debateId?: string;
	userId?: string | null;
	body?: Record<string, unknown> | null;
}

function createMockEvent({
	debateId = 'debate-1',
	userId = 'user-1',
	body = { outcome: 'support', reasoning: 'The community supports this initiative based on evidence' }
}: MockRequestOptions = {}) {
	return {
		params: { debateId },
		locals: {
			user: userId ? { id: userId } : null,
			session: userId ? { userId } : null
		},
		request: {
			json: body !== null
				? vi.fn().mockResolvedValue(body)
				: vi.fn().mockRejectedValue(new Error('No body'))
		}
	} as unknown as Parameters<Awaited<ReturnType<typeof getHandler>>>[0];
}

// Standard debate row returned by findUnique
function makeDebateRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 'debate-1',
		status: 'active',
		arguments: [
			{ argument_index: 0, stance: 'SUPPORT', weighted_score: BigInt(1000) },
			{ argument_index: 1, stance: 'OPPOSE', weighted_score: BigInt(500) }
		],
		campaign: {
			id: 'campaign-1',
			orgId: 'org-1',
			org: {
				slug: 'test-org',
				memberships: [{ role: 'owner' }]
			}
		},
		...overrides
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/debates/[debateId]/settle', () => {
	let POST: Awaited<ReturnType<typeof getHandler>>;

	beforeEach(async () => {
		vi.clearAllMocks();
		POST = await getHandler();
	});

	// ── AUTH CHECKS ──────────────────────────────────────────────────────

	it('returns 401 when not authenticated', async () => {
		const event = createMockEvent({ userId: null });
		await expect(POST(event)).rejects.toMatchObject({
			status: 401
		});
	});

	it('returns 404 when debate not found', async () => {
		mockFindUnique.mockResolvedValue(null);
		const event = createMockEvent();
		await expect(POST(event)).rejects.toMatchObject({
			status: 404
		});
	});

	it('returns 400 when debate has no campaign', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow({ campaign: null }));
		const event = createMockEvent();
		await expect(POST(event)).rejects.toMatchObject({
			status: 400
		});
	});

	it('returns 403 when user is not a member of the org', async () => {
		mockFindUnique.mockResolvedValue(
			makeDebateRow({
				campaign: {
					id: 'campaign-1',
					orgId: 'org-1',
					org: { slug: 'test-org', memberships: [] }
				}
			})
		);
		const event = createMockEvent();
		await expect(POST(event)).rejects.toMatchObject({
			status: 403
		});
	});

	it('returns 403 when user is a regular member (not editor/owner)', async () => {
		mockFindUnique.mockResolvedValue(
			makeDebateRow({
				campaign: {
					id: 'campaign-1',
					orgId: 'org-1',
					org: { slug: 'test-org', memberships: [{ role: 'member' }] }
				}
			})
		);
		const event = createMockEvent();
		await expect(POST(event)).rejects.toMatchObject({
			status: 403
		});
	});

	// ── STATUS CHECKS ────────────────────────────────────────────────────

	it('returns 400 when debate is already resolved', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow({ status: 'resolved' }));
		const event = createMockEvent();
		await expect(POST(event)).rejects.toMatchObject({
			status: 400
		});
	});

	it('returns 400 when debate is under appeal', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow({ status: 'under_appeal' }));
		const event = createMockEvent();
		await expect(POST(event)).rejects.toMatchObject({
			status: 400
		});
	});

	// ── VALIDATION ───────────────────────────────────────────────────────

	it('returns 400 for invalid outcome', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow());
		const event = createMockEvent({ body: { outcome: 'abstain', reasoning: 'Long enough reason here' } });
		await expect(POST(event)).rejects.toMatchObject({
			status: 400
		});
	});

	it('returns 400 for missing outcome', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow());
		const event = createMockEvent({ body: { reasoning: 'Long enough reason here' } });
		await expect(POST(event)).rejects.toMatchObject({
			status: 400
		});
	});

	it('returns 400 for reasoning shorter than 10 characters', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow());
		const event = createMockEvent({ body: { outcome: 'support', reasoning: 'short' } });
		await expect(POST(event)).rejects.toMatchObject({
			status: 400
		});
	});

	it('returns 400 for reasoning over 2000 characters', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow());
		const event = createMockEvent({
			body: { outcome: 'support', reasoning: 'x'.repeat(2001) }
		});
		await expect(POST(event)).rejects.toMatchObject({
			status: 400
		});
	});

	// ── HAPPY PATHS ──────────────────────────────────────────────────────

	it('settles a debate as support and returns correct response', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow());
		mockUpdate.mockResolvedValue({
			id: 'debate-1',
			status: 'resolved',
			winning_stance: 'SUPPORT',
			winning_argument_index: 0,
			resolved_at: new Date('2026-03-23T00:00:00Z'),
			resolution_method: 'org_settlement',
			governance_justification: 'The community supports this initiative based on evidence'
		});

		const event = createMockEvent();
		const response = await POST(event);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.debateId).toBe('debate-1');
		expect(body.status).toBe('resolved');
		expect(body.outcome).toBe('support');
		expect(body.winningStance).toBe('SUPPORT');
		expect(body.winningArgumentIndex).toBe(0);
		expect(body.reasoning).toBeTruthy();

		// Verify Prisma update was called with correct args
		expect(mockUpdate).toHaveBeenCalledOnce();
		const updateArgs = mockUpdate.mock.calls[0][0];
		expect(updateArgs.where.id).toBe('debate-1');
		expect(updateArgs.data.status).toBe('resolved');
		expect(updateArgs.data.winning_stance).toBe('SUPPORT');
		expect(updateArgs.data.resolution_method).toBe('org_settlement');
	});

	it('settles a debate as oppose and matches the correct argument', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow());
		mockUpdate.mockResolvedValue({
			id: 'debate-1',
			status: 'resolved',
			winning_stance: 'OPPOSE',
			winning_argument_index: 1,
			resolved_at: new Date('2026-03-23T00:00:00Z'),
			resolution_method: 'org_settlement',
			governance_justification: 'Evidence does not support this proposition'
		});

		const event = createMockEvent({
			body: { outcome: 'oppose', reasoning: 'Evidence does not support this proposition' }
		});
		const response = await POST(event);
		const body = await response.json();

		expect(body.outcome).toBe('oppose');
		expect(body.winningStance).toBe('OPPOSE');

		const updateArgs = mockUpdate.mock.calls[0][0];
		expect(updateArgs.data.winning_stance).toBe('OPPOSE');
		expect(updateArgs.data.winning_argument_index).toBe(1);
	});

	it('allows editors (not just owners) to settle', async () => {
		mockFindUnique.mockResolvedValue(
			makeDebateRow({
				campaign: {
					id: 'campaign-1',
					orgId: 'org-1',
					org: { slug: 'test-org', memberships: [{ role: 'editor' }] }
				}
			})
		);
		mockUpdate.mockResolvedValue({
			id: 'debate-1',
			status: 'resolved',
			winning_stance: 'SUPPORT',
			winning_argument_index: 0,
			resolved_at: new Date(),
			resolution_method: 'org_settlement',
			governance_justification: 'Consensus achieved'
		});

		const event = createMockEvent({
			body: { outcome: 'support', reasoning: 'Consensus achieved through deliberation' }
		});
		const response = await POST(event);
		expect(response.status).toBe(200);
	});

	it('handles concurrent resolution (P2025 error) gracefully', async () => {
		mockFindUnique.mockResolvedValue(makeDebateRow());
		mockUpdate.mockRejectedValue({ code: 'P2025' });

		const event = createMockEvent();
		await expect(POST(event)).rejects.toMatchObject({
			status: 409
		});
	});

	it('sets winning_argument_index to null when no argument matches the outcome stance', async () => {
		mockFindUnique.mockResolvedValue(
			makeDebateRow({
				arguments: [
					{ argument_index: 0, stance: 'AMEND', weighted_score: BigInt(1000) }
				]
			})
		);
		mockUpdate.mockResolvedValue({
			id: 'debate-1',
			status: 'resolved',
			winning_stance: 'SUPPORT',
			winning_argument_index: null,
			resolved_at: new Date(),
			resolution_method: 'org_settlement',
			governance_justification: 'Support despite no matching arguments'
		});

		const event = createMockEvent({
			body: { outcome: 'support', reasoning: 'Support despite no matching arguments submitted' }
		});
		const response = await POST(event);
		const body = await response.json();

		expect(body.winningArgumentIndex).toBeNull();
		const updateArgs = mockUpdate.mock.calls[0][0];
		expect(updateArgs.data.winning_argument_index).toBeNull();
	});
});
