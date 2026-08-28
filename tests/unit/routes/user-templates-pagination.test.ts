import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockServerQuery = vi.hoisted(() => vi.fn());

vi.mock('convex-sveltekit', () => ({
	serverQuery: mockServerQuery
}));

vi.mock('$lib/convex', () => ({
	api: { templates: { listByUserPage: 'templates.listByUserPage' } }
}));

import { GET } from '../../../src/routes/api/user/templates/+server';

function event(url = 'https://commons.email/api/user/templates', authenticated = true) {
	return {
		url: new URL(url),
		locals: { user: authenticated ? { id: 'user_1' } : null }
	} as never;
}

describe('GET /api/user/templates pagination', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
	});

	it('rejects unauthenticated requests before querying Convex', async () => {
		const response = await GET(event(undefined, false));

		expect(response.status).toBe(401);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});

	it('preserves the array body and marks a complete bounded page', async () => {
		mockServerQuery.mockResolvedValue({
			page: [{ _id: 'template_1', title: 'One' }],
			isDone: true,
			continueCursor: 'finished'
		});

		const response = await GET(event());

		expect(mockServerQuery).toHaveBeenCalledWith('templates.listByUserPage', {
			paginationOpts: { numItems: 50, cursor: null }
		});
		expect(response.headers.get('X-Templates-Complete')).toBe('true');
		expect(response.headers.get('Link')).toBeNull();
		await expect(response.json()).resolves.toEqual([{ _id: 'template_1', title: 'One' }]);
	});

	it('accepts the opaque cursor and publishes a standard next-page link without truncating silently', async () => {
		mockServerQuery.mockResolvedValue({
			page: [{ _id: 'template_2', title: 'Two' }],
			isDone: false,
			continueCursor: 'next/cursor=='
		});

		const response = await GET(
			event('https://commons.email/api/user/templates?cursor=current%2Fcursor%3D%3D')
		);

		expect(mockServerQuery).toHaveBeenCalledWith('templates.listByUserPage', {
			paginationOpts: { numItems: 50, cursor: 'current/cursor==' }
		});
		expect(response.headers.get('X-Templates-Complete')).toBe('false');
		expect(response.headers.get('Link')).toBe(
			'</api/user/templates?cursor=next%2Fcursor%3D%3D>; rel="next"'
		);
	});

	it('rejects an oversized cursor before querying Convex', async () => {
		const response = await GET(
			event(`https://commons.email/api/user/templates?cursor=${'x'.repeat(2_049)}`)
		);

		expect(response.status).toBe(400);
		expect(mockServerQuery).not.toHaveBeenCalled();
	});
});
