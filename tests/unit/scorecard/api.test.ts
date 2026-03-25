import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db — the dbMockPlugin in vitest.config.ts redirects $lib/core/db
// to tests/mocks/db-mock.ts, so we mock that path instead.
const mockDmFindUnique = vi.fn();
const mockDmFindMany = vi.fn();
const mockSnapFindFirst = vi.fn();
const mockSnapFindMany = vi.fn();

vi.mock('$lib/core/db', () => ({
	db: {
		decisionMaker: {
			findUnique: (...args: unknown[]) => mockDmFindUnique(...args),
			findMany: (...args: unknown[]) => mockDmFindMany(...args)
		},
		scorecardSnapshot: {
			findFirst: (...args: unknown[]) => mockSnapFindFirst(...args),
			findMany: (...args: unknown[]) => mockSnapFindMany(...args)
		}
	}
}));

// Helper to create a mock RequestEvent
function createMockEvent(overrides: {
	params?: Record<string, string>;
	searchParams?: Record<string, string>;
} = {}) {
	const url = new URL('http://localhost:5173/api/test');
	if (overrides.searchParams) {
		for (const [key, value] of Object.entries(overrides.searchParams)) {
			url.searchParams.set(key, value);
		}
	}

	return {
		params: overrides.params ?? {},
		url,
		request: new Request(url.toString()),
		locals: {},
		platform: {},
		route: { id: '' },
		cookies: {
			get: vi.fn(),
			set: vi.fn(),
			delete: vi.fn(),
			getAll: vi.fn(() => []),
			serialize: vi.fn()
		},
		getClientAddress: vi.fn(() => '127.0.0.1'),
		isDataRequest: false,
		isSubRequest: false,
		fetch: vi.fn()
	};
}

const mockDm = {
	id: 'dm1',
	name: 'Jane Doe',
	title: 'Senator',
	party: 'Independent',
	district: 'District 5',
	jurisdiction: 'US'
};

const mockSnapshot = {
	id: 'snap1',
	decisionMakerId: 'dm1',
	periodStart: new Date('2026-03-01'),
	periodEnd: new Date('2026-03-31'),
	responsiveness: 72.3,
	alignment: 85.0,
	composite: 77.4,
	proofWeightTotal: 142.7,
	deliveriesSent: 14,
	deliveriesOpened: 9,
	deliveriesVerified: 6,
	repliesReceived: 2,
	alignedVotes: 3,
	totalScoredVotes: 4,
	methodologyVersion: 1,
	snapshotHash: 'abc123def456',
	createdAt: new Date()
};

describe('GET /api/dm/[id]/scorecard', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns scorecard data for a valid DM', async () => {
		mockDmFindUnique.mockResolvedValueOnce(mockDm);
		mockSnapFindFirst.mockResolvedValueOnce(mockSnapshot);
		mockSnapFindMany.mockResolvedValueOnce([]); // history

		const { GET } = await import('../../../src/routes/api/dm/[id]/scorecard/+server');
		const event = createMockEvent({ params: { id: 'dm1' } });
		const response = await GET(event as never);

		expect(response.status).toBe(200);
		const body = await response.json();

		expect(body.decisionMaker.id).toBe('dm1');
		expect(body.decisionMaker.name).toBe('Jane Doe');
		expect(body.current.responsiveness).toBe(72.3);
		expect(body.current.alignment).toBe(85.0);
		expect(body.current.composite).toBe(77.4);
		expect(body.current.proofWeightTotal).toBe(142.7);
		expect(body.current.attestationHash).toBe('abc123def456');
		expect(body.current.methodologyVersion).toBe(1);
		expect(body.current.period.start).toBe('2026-03-01');
		expect(body.current.period.end).toBe('2026-03-31');
		expect(body.transparency.deliveriesSent).toBe(14);
		expect(body.transparency.deliveriesOpened).toBe(9);
		expect(body.transparency.deliveriesVerified).toBe(6);
		expect(body.transparency.repliesReceived).toBe(2);
		expect(body.transparency.alignedVotes).toBe(3);
		expect(body.transparency.totalScoredVotes).toBe(4);
	});

	it('returns 404 for unknown DM', async () => {
		mockDmFindUnique.mockResolvedValueOnce(null);

		const { GET } = await import('../../../src/routes/api/dm/[id]/scorecard/+server');
		const event = createMockEvent({ params: { id: 'nonexistent' } });

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 404
		});
	});

	it('returns null scores when no snapshots exist', async () => {
		mockDmFindUnique.mockResolvedValueOnce(mockDm);
		mockSnapFindFirst.mockResolvedValueOnce(null);
		mockSnapFindMany.mockResolvedValueOnce([]); // no history

		const { GET } = await import('../../../src/routes/api/dm/[id]/scorecard/+server');
		const event = createMockEvent({ params: { id: 'dm1' } });
		const response = await GET(event as never);

		expect(response.status).toBe(200);
		const body = await response.json();

		expect(body.decisionMaker.id).toBe('dm1');
		expect(body.current).toBeNull();
		expect(body.history).toEqual([]);
		expect(body.transparency).toBeNull();
	});
});

describe('GET /api/dm/scorecard/compare', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('compares valid DM IDs', async () => {
		const dm2 = { ...mockDm, id: 'dm2', name: 'John Smith' };
		mockDmFindMany.mockResolvedValueOnce([mockDm, dm2]);
		mockSnapFindFirst
			.mockResolvedValueOnce(mockSnapshot)
			.mockResolvedValueOnce({ ...mockSnapshot, id: 'snap2', decisionMakerId: 'dm2', composite: 55.0 });

		const { GET } = await import('../../../src/routes/api/dm/scorecard/compare/+server');
		const event = createMockEvent({ searchParams: { ids: 'dm1,dm2' } });
		const response = await GET(event as never);

		expect(response.status).toBe(200);
		const body = await response.json();

		expect(body).toHaveLength(2);
		expect(body[0].decisionMaker.id).toBe('dm1');
		expect(body[1].decisionMaker.id).toBe('dm2');
	});

	it('returns 400 when more than 5 IDs provided', async () => {
		const { GET } = await import('../../../src/routes/api/dm/scorecard/compare/+server');
		const event = createMockEvent({
			searchParams: { ids: 'dm1,dm2,dm3,dm4,dm5,dm6' }
		});

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 400
		});
	});

	it('returns 400 when no ids parameter', async () => {
		const { GET } = await import('../../../src/routes/api/dm/scorecard/compare/+server');
		const event = createMockEvent({});

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 400
		});
	});

	it('returns 400 when ids is empty string', async () => {
		const { GET } = await import('../../../src/routes/api/dm/scorecard/compare/+server');
		const event = createMockEvent({ searchParams: { ids: '' } });

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 400
		});
	});
});

describe('GET /api/embed/scorecard/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns embed JSON with required fields', async () => {
		mockDmFindUnique.mockResolvedValueOnce(mockDm);
		mockSnapFindFirst.mockResolvedValueOnce(mockSnapshot);

		const { GET } = await import('../../../src/routes/api/embed/scorecard/[id]/+server');
		const event = createMockEvent({ params: { id: 'dm1' } });
		const response = await GET(event as never);

		expect(response.status).toBe(200);
		const body = await response.json();

		expect(body.decisionMaker.name).toBe('Jane Doe');
		expect(body.composite).toBe(77.4);
		expect(body.responsiveness).toBe(72.3);
		expect(body.alignment).toBe(85.0);
		expect(body.scorecardUrl).toContain('/dm/dm1/scorecard');
		expect(body.poweredBy).toBe('Commons');
		expect(body.period.start).toBe('2026-03-01');
	});

	it('returns 404 for unknown DM', async () => {
		mockDmFindUnique.mockResolvedValueOnce(null);

		const { GET } = await import('../../../src/routes/api/embed/scorecard/[id]/+server');
		const event = createMockEvent({ params: { id: 'nonexistent' } });

		await expect(GET(event as never)).rejects.toMatchObject({
			status: 404
		});
	});

	it('returns null scores when no snapshot exists', async () => {
		mockDmFindUnique.mockResolvedValueOnce(mockDm);
		mockSnapFindFirst.mockResolvedValueOnce(null);

		const { GET } = await import('../../../src/routes/api/embed/scorecard/[id]/+server');
		const event = createMockEvent({ params: { id: 'dm1' } });
		const response = await GET(event as never);

		expect(response.status).toBe(200);
		const body = await response.json();

		expect(body.composite).toBeNull();
		expect(body.responsiveness).toBeNull();
		expect(body.alignment).toBeNull();
		expect(body.period).toBeNull();
	});
});
