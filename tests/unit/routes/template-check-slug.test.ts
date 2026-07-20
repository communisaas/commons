import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockServerQuery, mockGetInternalSecret, api } = vi.hoisted(() => ({
	mockServerQuery: vi.fn(),
	mockGetInternalSecret: vi.fn(() => 'template-slug-check-secret-32-bytes'),
	api: { templates: { templateSlugsExist: 'templates.templateSlugsExist' } }
}));

vi.mock('convex-sveltekit', () => ({ serverQuery: mockServerQuery }));
vi.mock('$lib/convex', () => ({ api }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: mockGetInternalSecret
}));

import { GET } from '../../../src/routes/api/templates/check-slug/+server';

function event(search = '') {
	return { url: new URL(`https://commons.email/api/templates/check-slug${search}`) } as never;
}

describe('GET /api/templates/check-slug', () => {
	beforeEach(() => {
		mockServerQuery.mockReset();
		mockGetInternalSecret.mockClear();
	});

	it.each(['', '?slug=UPPER', `?slug=${'a'.repeat(401)}`, '?slug=two--hyphens'])(
		'rejects invalid input before secret or Convex I/O: %s',
		async (search) => {
			const response = await GET(event(search));

			expect(response.status).toBe(400);
			expect(mockGetInternalSecret).not.toHaveBeenCalled();
			expect(mockServerQuery).not.toHaveBeenCalled();
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
	);

	it('checks the requested slug and every bounded suggestion in one secret-gated query', async () => {
		mockServerQuery.mockImplementation(async (_reference, args: { slugs: string[] }) =>
			args.slugs.map(() => false)
		);

		const response = await GET(event('?slug=protect-clean-water'));
		const body = await response.json();
		const [, args] = mockServerQuery.mock.calls[0] as [string, { _secret: string; slugs: string[] }];

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(body).toMatchObject({ success: true, data: { available: true } });
		expect(body.data.suggestions).toHaveLength(3);
		expect(mockServerQuery).toHaveBeenCalledOnce();
		expect(mockServerQuery).toHaveBeenCalledWith(api.templates.templateSlugsExist, {
			_secret: 'template-slug-check-secret-32-bytes',
			slugs: expect.any(Array)
		});
		expect(args.slugs[0]).toBe('protect-clean-water');
		expect(args.slugs).toHaveLength(6);
		expect(new Set(args.slugs).size).toBe(args.slugs.length);
		expect(args.slugs.every((slug) => new TextEncoder().encode(slug).byteLength <= 400)).toBe(
			true
		);
	});

	it('reports an occupied slug and returns only alternatives proven free in the batch', async () => {
		mockServerQuery.mockImplementation(async (_reference, args: { slugs: string[] }) =>
			args.slugs.map((_slug, index) => index < 2)
		);

		const response = await GET(event('?slug=clean-water'));
		const body = await response.json();
		const slugs = (mockServerQuery.mock.calls[0]?.[1] as { slugs: string[] }).slugs;

		expect(body.data.available).toBe(false);
		expect(body.data.suggestions).toEqual(slugs.slice(2, 5));
	});

	it('fails closed on a malformed Convex batch result', async () => {
		mockServerQuery.mockResolvedValue([false]);

		await expect(GET(event('?slug=clean-water'))).rejects.toThrow(
			'TEMPLATE_SLUG_EXISTENCE_CONTRACT_INVALID'
		);
	});
});
