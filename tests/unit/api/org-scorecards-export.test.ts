/**
 * GET /api/org/[slug]/scorecards/export — CSV export of org scorecards.
 *
 * Asserts the download contract: member-gated, CSV-only, one row per
 * scorecard with columns that trace to the org scorecard read, and the
 * derived response-time column labeled as an estimate rather than a
 * measurement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockServerQuery } = vi.hoisted(() => ({
	mockServerQuery: vi.fn()
}));

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery
}));

vi.mock('$lib/convex', () => ({
	api: {
		legislation: {
			exportScorecards: 'legislation.exportScorecards'
		}
	}
}));

import { GET } from '../../../src/routes/api/org/[slug]/scorecards/export/+server';

function buildEvent(overrides: Record<string, unknown> = {}) {
	return {
		params: { slug: 'climate-action-now' },
		url: new URL(
			'http://localhost/api/org/climate-action-now/scorecards/export?format=' +
				((overrides.format as string) ?? 'csv')
		),
		locals: 'locals' in overrides ? overrides.locals : { user: { id: 'user-1' } }
	} as never;
}

const scorecardRow = {
	name: 'Jane Doe',
	title: 'Senator',
	district: 'CA-12',
	reportsReceived: 14,
	reportsOpened: 9,
	verifyLinksClicked: 6,
	repliesLogged: 2,
	relevantVotes: 4,
	alignedVotes: 3,
	alignmentRate: 0.75,
	avgResponseTime: 50.4,
	lastContactDate: null,
	score: 77
};

describe('GET /api/org/[slug]/scorecards/export', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns a CSV download with one row per scorecard', async () => {
		mockServerQuery.mockResolvedValueOnce({ scorecards: [scorecardRow] });

		const response = await GET(buildEvent());

		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toContain('text/csv');
		expect(response.headers.get('Content-Disposition')).toContain('climate-action-now');

		const lines = (await response.text()).split('\n');
		expect(lines).toHaveLength(2);

		const headers = lines[0].split(',');
		const row = lines[1].split(',');
		expect(row).toHaveLength(headers.length);
		expect(row[0]).toBe('Jane Doe');
		expect(row[headers.indexOf('Reports Received')]).toBe('14');
		expect(row[headers.indexOf('Reports Opened')]).toBe('9');
		expect(row[headers.indexOf('Replies Logged')]).toBe('2');
		expect(row[headers.indexOf('Alignment Rate')]).toBe('75.0%');
		expect(row[headers.indexOf('Score')]).toBe('77');
	});

	it('labels the derived response-time column as an estimate, never as measured', async () => {
		mockServerQuery.mockResolvedValueOnce({ scorecards: [scorecardRow] });

		const response = await GET(buildEvent());
		const lines = (await response.text()).split('\n');
		const headers = lines[0].split(',');

		const estimateColumn = headers.findIndex((header) => /estimat/i.test(header));
		expect(estimateColumn).toBeGreaterThan(-1);
		expect(lines[0]).not.toMatch(/Avg Response Time/);
		expect(lines[1].split(',')[estimateColumn]).toBe('50.4');
	});

	it('leaves unknown values empty rather than fabricating zeros', async () => {
		mockServerQuery.mockResolvedValueOnce({
			scorecards: [
				{
					...scorecardRow,
					reportsOpened: null,
					avgResponseTime: null,
					alignmentRate: null,
					score: null
				}
			]
		});

		const response = await GET(buildEvent());
		const lines = (await response.text()).split('\n');
		const headers = lines[0].split(',');
		const row = lines[1].split(',');

		expect(row[headers.indexOf('Reports Opened')]).toBe('');
		expect(row[headers.indexOf('Alignment Rate')]).toBe('');
		expect(row[headers.indexOf('Score')]).toBe('');
	});

	it('requires an authenticated member', async () => {
		await expect(GET(buildEvent({ locals: {} }))).rejects.toMatchObject({ status: 401 });
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('rejects non-CSV formats', async () => {
		await expect(GET(buildEvent({ format: 'xlsx' }))).rejects.toMatchObject({ status: 400 });
	});
});
