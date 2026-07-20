import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCachedPublicTemplatePageArtifact } = vi.hoisted(() => ({
	mockGetCachedPublicTemplatePageArtifact: vi.fn()
}));

vi.mock('$lib/server/public-template-queries', () => ({
	getCachedPublicTemplatePageArtifact: mockGetCachedPublicTemplatePageArtifact
}));
vi.mock('$lib/config/features', () => ({
	FEATURES: { CONGRESSIONAL: false }
}));

import { analyzeEmailFlow } from '$lib/services/emailService';
import type { ComponentTemplate } from '$lib/types/component-props';
import { load as loadTemplateDetail } from '../../../src/routes/s/[slug]/+layout.server';
import { load as loadTemplateModal } from '../../../src/routes/template-modal/[slug]/+page.server';

const targetEmail = 'recipient@example.test';
const recipientConfig = {
	decisionMakers: [
		{
			name: 'Public Recipient',
			title: 'Director',
			organization: 'Public Agency',
			email: targetEmail
		}
	]
};

const convexDetail = {
	id: 'template_123',
	slug: 'clean-water',
	title: 'Protect clean water',
	description: 'Ask the agency to protect clean water.',
	domain: 'environment',
	topics: ['water'],
	type: 'email',
	deliveryMethod: 'email',
	subject: 'Protect clean water',
	message_body: 'Please protect clean water.',
	preview: 'Please protect clean water.',
	delivery_config: {},
	recipient_config: recipientConfig,
	recipientEmails: [targetEmail],
	recipient_count: 1,
	author: null,
	createdAt: '2026-07-18T00:00:00.000Z'
};

describe('public template recipient boundary', () => {
	beforeEach(() => {
		mockGetCachedPublicTemplatePageArtifact.mockReset();
		mockGetCachedPublicTemplatePageArtifact.mockResolvedValue({
			detail: convexDetail,
			aggregate: {}
		});
	});

	it('keeps /s detail data uncached and usable by the direct-email action', async () => {
		const setHeaders = vi.fn();
		const result = (await loadTemplateDetail({
			params: { slug: convexDetail.slug },
			request: new Request(`https://commons.email/s/${convexDetail.slug}`),
			setHeaders,
			url: new URL(`https://commons.email/s/${convexDetail.slug}`),
			platform: undefined
		} as never)) as { template: ComponentTemplate };

		expect(mockGetCachedPublicTemplatePageArtifact).toHaveBeenCalledWith(
			{
				url: new URL(`https://commons.email/s/${convexDetail.slug}`),
				platform: undefined
			},
			convexDetail.slug
		);
		expect(setHeaders).toHaveBeenCalledWith({
			'Cache-Control': 'private, no-store, max-age=0'
		});
		expect(result.template.recipient_config).toEqual(recipientConfig);

		const flow = analyzeEmailFlow({ ...result.template, metrics: {} }, null);
		expect(flow.error).toBeUndefined();
		expect(flow.mailtoUrl).toMatch(/^mailto:recipient@example\.test\?/);
	});

	it('preserves the same no-store recipient data for the dedicated TemplateModal route', async () => {
		const setHeaders = vi.fn();
		const result = (await loadTemplateModal({
			params: { slug: convexDetail.slug },
			locals: { user: null },
			setHeaders,
			url: new URL(`https://commons.email/template-modal/${convexDetail.slug}`),
			platform: undefined
		} as never)) as { template: ComponentTemplate };

		expect(setHeaders).toHaveBeenCalledWith({
			'Cache-Control': 'private, no-store, max-age=0'
		});
		expect(result.template).toMatchObject({
			recipient_config: recipientConfig,
			recipientEmails: [targetEmail],
			recipient_count: 1
		});

		const flow = analyzeEmailFlow({ ...result.template, metrics: {} }, null);
		expect(flow.error).toBeUndefined();
		expect(flow.mailtoUrl).toMatch(/^mailto:recipient@example\.test\?/);
	});
});
