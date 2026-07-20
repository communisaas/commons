import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, mockServerAction } = vi.hoisted(() => ({
	api: { templates: { search: 'templates.search' } },
	mockServerAction: vi.fn()
}));

vi.mock('$lib/convex', () => ({ api }));
vi.mock('convex-sveltekit', () => ({ serverAction: mockServerAction }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: () => 'search-route-secret'
}));

import {
	POST,
	_convexErrorCode,
	_searchErrorResponse
} from '../../../src/routes/api/templates/search/+server';

function event(body: unknown, user: { id: string } | null = { id: 'user-1' }) {
	return {
		locals: { user },
		request: new Request('https://commons.email/api/templates/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as never;
}

function rawEvent(body: string, headers: Record<string, string> = {}) {
	return {
		locals: { user: { id: 'user-1' } },
		request: new Request('https://commons.email/api/templates/search', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body
		})
	} as never;
}

describe('POST /api/templates/search', () => {
	beforeEach(() => mockServerAction.mockReset());

	it('requires authentication before invoking Convex', async () => {
		await expect(POST(event({ query: 'water' }, null))).rejects.toMatchObject({ status: 401 });
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('forwards the server secret and stable authenticated actor', async () => {
		mockServerAction.mockResolvedValue({ templates: [], method: 'keyword' });
		const response = await POST(event({ query: ' clean water ', limit: 500 }));
		await expect(response.json()).resolves.toEqual({ templates: [], method: 'keyword' });
		expect(mockServerAction).toHaveBeenCalledWith(api.templates.search, {
			_secret: 'search-route-secret',
			actorKey: 'user-1',
			query: 'clean water',
			limit: 20
		});
	});

	it('rejects an oversized body before invoking Convex', async () => {
		await expect(POST(rawEvent(JSON.stringify({ query: 'x'.repeat(5_000) })))).rejects.toMatchObject(
			{ status: 413 }
		);
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('rejects malformed field types before invoking Convex', async () => {
		await expect(POST(event({ query: 42 }))).rejects.toMatchObject({ status: 400 });
		await expect(POST(event({ query: 'water', limit: '20' }))).rejects.toMatchObject({
			status: 400
		});
		expect(mockServerAction).not.toHaveBeenCalled();
	});

	it('maps the structured Convex burst code to HTTP 429', () => {
		const rejection = {
			data: { code: 'TEMPLATE_SEARCH_BURST_LIMITED' }
		};
		expect(_convexErrorCode(rejection)).toBe('TEMPLATE_SEARCH_BURST_LIMITED');
		const response = _searchErrorResponse(rejection)!;
		expect(response.status).toBe(429);
		expect(response.headers.get('Retry-After')).toBe('60');
	});
});
