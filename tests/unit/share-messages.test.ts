import { describe, it, expect } from 'vitest';
import {
	generateShareMessage,
	type ShareMessageContext,
	type ShareVariant
} from '$lib/utils/share-messages';

const SHARE_URL = 'https://commons.email/s/clean-water-now?via=share';

function baseContext(overrides: Partial<ShareMessageContext> = {}): ShareMessageContext {
	return {
		template: {
			title: 'Clean Water Now',
			domain: 'Environment',
			description: 'A push for safer drinking water.'
		},
		contactedNames: [],
		totalRecipients: 0,
		shareUrl: SHARE_URL,
		...overrides
	};
}

const VARIANTS: ShareVariant[] = ['short', 'medium', 'long', 'sms'];

describe('generateShareMessage', () => {
	describe('every variant always embeds the action URL', () => {
		it.each(VARIANTS)('pre-confirmation %s includes shareUrl', (variant) => {
			const msg = generateShareMessage(baseContext(), variant);
			expect(msg).toContain(SHARE_URL);
		});

		it.each(VARIANTS)('post-confirmation %s includes shareUrl', (variant) => {
			const msg = generateShareMessage(
				baseContext({ contactedNames: ['Mayor Rodriguez'], totalRecipients: 1 }),
				variant
			);
			expect(msg).toContain(SHARE_URL);
		});
	});

	describe('pre/post-confirmation branching keys off contactedNames length', () => {
		it('uses recruiting (pre-confirmation) copy when no names are confirmed', () => {
			// totalRecipients alone is NOT evidence of action — must remain pre-confirmation.
			const msg = generateShareMessage(
				baseContext({ contactedNames: [], totalRecipients: 5 }),
				'medium'
			);
			expect(msg).toContain('I published an action page');
			expect(msg).not.toContain('My route to');
		});

		it('switches to first-person report once a name is confirmed', () => {
			const msg = generateShareMessage(
				baseContext({ contactedNames: ['Mayor Rodriguez'], totalRecipients: 1 }),
				'medium'
			);
			expect(msg).toContain('My route to Mayor Rodriguez is confirmed');
		});

		it('treats an empty totalRecipients pre-confirmation as a generic recruit', () => {
			const msg = generateShareMessage(baseContext(), 'short');
			expect(msg).toContain('decision-makers');
			expect(msg).toContain(SHARE_URL);
		});
	});

	describe('recipient formatting in post-confirmation copy', () => {
		it('renders a single name verbatim', () => {
			const msg = generateShareMessage(
				baseContext({ contactedNames: ['Mayor Rodriguez'], totalRecipients: 1 }),
				'short'
			);
			expect(msg).toContain('Mayor Rodriguez');
			expect(msg).not.toContain(' and ');
		});

		it('joins two names with "and"', () => {
			const msg = generateShareMessage(
				baseContext({
					contactedNames: ['Mayor Rodriguez', 'Council Member Chen'],
					totalRecipients: 2
				}),
				'short'
			);
			expect(msg).toContain('Mayor Rodriguez and Council Member Chen');
		});

		it('collapses three or more names into a counted overflow', () => {
			const msg = generateShareMessage(
				baseContext({
					contactedNames: ['Mayor Rodriguez', 'Council Member Chen', 'Supervisor Lee'],
					totalRecipients: 3
				}),
				'short'
			);
			expect(msg).toContain('Mayor Rodriguez, Council Member Chen, and 1 other');
		});

		it('pluralizes the overflow when more than one remains', () => {
			const msg = generateShareMessage(
				baseContext({
					contactedNames: ['Mayor Rodriguez', 'Council Member Chen', 'Supervisor Lee'],
					totalRecipients: 5
				}),
				'short'
			);
			expect(msg).toContain('and 3 others');
		});
	});

	describe('domain fallback', () => {
		it('falls back to "advocacy" when the domain is blank', () => {
			const msg = generateShareMessage(
				baseContext({ template: { title: 'Clean Water Now', domain: '   ', description: '' } }),
				'medium'
			);
			expect(msg).toContain('advocacy');
		});

		it('lowercases the provided domain', () => {
			const msg = generateShareMessage(baseContext(), 'medium');
			expect(msg).toContain('environment');
		});
	});

	describe('recruiting copy is present (not a bare URL)', () => {
		it('carries the template title alongside the URL', () => {
			const msg = generateShareMessage(baseContext(), 'long');
			expect(msg).toContain('Clean Water Now');
			expect(msg).toContain(SHARE_URL);
			// The copy is substantive — well beyond the URL alone.
			expect(msg.length).toBeGreaterThan(SHARE_URL.length + 20);
		});
	});
});
