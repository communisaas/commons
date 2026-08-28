import { describe, expect, it, vi } from 'vitest';
import {
	normalizePagesDeploymentUrl,
	verifyPagesDeploymentRetired
} from '../../../scripts/verify-pages-deployment-retired.mjs';

describe('retired Pages deployment proof', () => {
	it('accepts only immutable project origins and blocked terminal responses', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('gone', { status: 404 }));
		await expect(
			verifyPagesDeploymentRetired({
				url: 'https://a1b2c3d4.communique-site.pages.dev',
				fetchImpl: fetchFn
			})
		).resolves.toEqual({
			origin: 'https://a1b2c3d4.communique-site.pages.dev',
			status: 404,
			executable: false
		});
		expect(fetchFn).toHaveBeenCalledWith(
			'https://a1b2c3d4.communique-site.pages.dev/api/live',
			expect.objectContaining({ redirect: 'manual' })
		);
		expect(() => normalizePagesDeploymentUrl('https://commons.email')).toThrow(/immutable/);
	});

	it('accepts the exact pre-Function canonical origin-closure redirect', async () => {
		await expect(
			verifyPagesDeploymentRetired({
				url: 'https://old.communique-site.pages.dev',
				fetchImpl: vi
					.fn<typeof fetch>()
					.mockResolvedValue(
						new Response(null, {
							status: 301,
							headers: { location: 'https://commons.email/api/live' }
						})
					)
			})
		).resolves.toEqual({
			origin: 'https://old.communique-site.pages.dev',
			status: 301,
			executable: false
		});
	});

	it('fails if the old deployment remains executable or redirects elsewhere', async () => {
		await expect(
			verifyPagesDeploymentRetired({
				url: 'https://old.communique-site.pages.dev',
				fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 503 }))
			})
		).rejects.toThrow(/remains publicly executable/);
		await expect(
			verifyPagesDeploymentRetired({
				url: 'https://old.communique-site.pages.dev',
				fetchImpl: vi
					.fn<typeof fetch>()
					.mockResolvedValue(
						new Response(null, { status: 403, headers: { location: 'https://commons.email' } })
					)
			})
		).rejects.toThrow(/unapproved redirect/);
	});
});
