import { describe, expect, it } from 'vitest';

import { validateExactPreviewRelease } from '../../../scripts/verify-pages-preview-release.mjs';

const sha = 'a'.repeat(40);

function deployment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'deployment-main',
		aliases: ['https://main.communique-site.pages.dev'],
		created_on: '2026-07-20T00:00:00.000Z',
		modified_on: '2026-07-20T00:01:00.000Z',
		environment: 'preview',
		is_skipped: false,
		latest_stage: { status: 'success' },
		deployment_trigger: {
			type: 'ad_hoc',
			metadata: { branch: 'main', commit_dirty: false, commit_hash: sha }
		},
		...overrides
	};
}

describe('exact normal preview prerequisite', () => {
	it('accepts the latest clean successful exact-SHA main release and alias', () => {
		expect(
			validateExactPreviewRelease({ deployments: [deployment()], expectedSha: sha })
		).toEqual({
			deploymentId: 'deployment-main',
			branch: 'main',
			releaseSha: sha,
			releaseTransaction: null,
			trustedGateSha: null,
			artifactDigest: null,
			releaseComponent: null,
			releaseRealm: null
		});
	});

	it('rejects an older matching SHA when the latest main deployment drifted', () => {
		expect(() =>
			validateExactPreviewRelease({
				deployments: [
					deployment(),
					deployment({
						id: 'newer',
						created_on: '2026-07-20T01:00:00.000Z',
						deployment_trigger: {
							type: 'ad_hoc',
							metadata: { branch: 'main', commit_dirty: false, commit_hash: 'b'.repeat(40) }
						}
					})
				],
				expectedSha: sha
			})
		).toThrow(/latest main preview is not the exact/i);
	});

	it.each([
		{ aliases: [] },
		{ is_skipped: true },
		{ latest_stage: { status: 'failure' } },
		{
			deployment_trigger: {
				type: 'ad_hoc',
				metadata: { branch: 'main', commit_dirty: true, commit_hash: sha }
			}
		}
	])('rejects an unqualified preview %#', (override) => {
		expect(() =>
			validateExactPreviewRelease({ deployments: [deployment(override)], expectedSha: sha })
		).toThrow();
	});
});
