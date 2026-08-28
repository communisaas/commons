import { describe, it, expect } from 'vitest';
import { recipientEmailsFromConfig } from '$lib/types/template';
import { isValidDeliveryConfig } from '$lib/types/templateConfig';

describe('Recipient Email Extraction Integration', () => {
	describe('recipientEmailsFromConfig', () => {
		// Use parameterized tests for edge cases
		it.each([
			[null, []],
			[undefined, []],
			[{}, []],
			[{ emails: [] }, []],
			// `recipients` is a real persisted shape, read by the count arithmetic too
			[{ recipients: ['test@example.com'] }, ['test@example.com']],
			[{ emails: 'test@example.com' }, []], // string instead of array
			// junk elements are dropped individually, never all-or-nothing
			[{ emails: ['test@example.com', 123, null] }, ['test@example.com']],
			[{ emails: ['valid@email.com'] }, ['valid@email.com']],
			[{ emails: ['a@b.com', 'c@d.org', 'e@f.net'] }, ['a@b.com', 'c@d.org', 'e@f.net']]
		])('extracts emails from %p', (input, expected) => {
			expect(recipientEmailsFromConfig(input)).toEqual(expected);
		});

		it('handles large email arrays efficiently', () => {
			const largeArray = Array.from({ length: 100 }, (_, i) => `user${i}@example.com`);
			const config = { emails: largeArray };

			const result = recipientEmailsFromConfig(config);
			expect(result).toHaveLength(100);
			expect(result[0]).toBe('user0@example.com');
			expect(result[99]).toBe('user99@example.com');
		});
	});

	describe('isValidDeliveryConfig', () => {
		const validBase = {
			timing: 'immediate' as const,
			followUp: false
		};

		it.each([
			[null, false],
			[undefined, false],
			[{}, false],
			[{ timing: 'immediate' }, false], // missing followUp
			[{ followUp: false }, false], // missing timing
			[validBase, true],
			[{ ...validBase, timing: 'invalid' }, false],
			[{ ...validBase, timing: 'scheduled', followUp: true }, true],
			[{ ...validBase, followUp: null }, false]
		])('validates delivery config %p as %p', (input, expected) => {
			expect(isValidDeliveryConfig(input)).toBe(expected);
		});

		it('validates allowed timing values', () => {
			const timings = ['immediate', 'scheduled'];
			timings.forEach((timing) => {
				const config = { ...validBase, timing };
				expect(isValidDeliveryConfig(config)).toBe(true);
			});

			expect(isValidDeliveryConfig({ ...validBase, timing: 'invalid' })).toBe(false);
		});
	});

	describe('Consolidated Template Schema Compatibility', () => {
		it('should work with full consolidated template model', () => {
			const consolidatedTemplate = {
				id: 'template-consolidated',
				title: 'Consolidated Template',
				subject: 'Test Subject',
				message_body: 'Test message body',

				// Test new consolidated verification fields
				verification_status: 'approved',
				quality_score: 85,
				consensus_score: 0.9,
				grammar_score: 90,
				clarity_score: 88,
				completeness_score: 92,
				agent_votes: { approve: 3, reject: 0, abstain: 1 },
				reputation_delta: 10,
				reputation_applied: true,
				reviewed_at: new Date(),

				// Template config fields
				delivery_config: {
					timing: 'immediate',
					followUp: false
				},
				recipient_config: {
					emails: ['consolidated@example.com', 'test@example.com']
				},

				// Usage tracking
				send_count: 5,
				last_sent_at: new Date(),

				// Geographic scope
				applicable_countries: ['US'],
				jurisdiction_level: 'federal',
				specific_locations: []
			};

			const emails = recipientEmailsFromConfig(consolidatedTemplate.recipient_config);
			expect(emails).toEqual(['consolidated@example.com', 'test@example.com']);

			const isValidDelivery = isValidDeliveryConfig(consolidatedTemplate.delivery_config);
			expect(isValidDelivery).toBe(true);
		});

		it('should handle templates with missing optional consolidated fields', () => {
			const partialTemplate = {
				id: 'template-partial',
				title: 'Partial Template',
				message_body: 'Basic message',

				// Only basic fields, missing most consolidated verification fields
				verification_status: null,
				quality_score: null,
				consensus_score: null,

				recipient_config: {
					emails: ['partial@example.com']
				},
				delivery_config: {
					timing: 'scheduled',
					followUp: true
				}
			};

			// Should still work with partial data
			const emails = recipientEmailsFromConfig(partialTemplate.recipient_config);
			expect(emails).toEqual(['partial@example.com']);
		});
	});

	describe('Email Validation', () => {
		const validateEmail = (email: string): boolean => {
			const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
			return emailRegex.test(email);
		};

		it.each([
			['valid@email.com', true],
			['user.name@domain.org', true],
			['user+tag@example.co.uk', true],
			['invalid', false],
			['@domain.com', false],
			['user@', false],
			['user @domain.com', false],
			['user@domain', false]
		])('validates email %s as %p', (email, expected) => {
			expect(validateEmail(email)).toBe(expected);
		});
	});

	describe('Bulk Operations', () => {
		it('filters invalid emails from bulk list', () => {
			const emails = [
				'valid1@example.com',
				'invalid-email',
				'valid2@example.org',
				'@invalid.com',
				'valid3@example.net'
			];

			const filtered = emails.filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

			expect(filtered).toEqual(['valid1@example.com', 'valid2@example.org', 'valid3@example.net']);
		});

		it('deduplicates email list', () => {
			const emails = [
				'duplicate@example.com',
				'unique@example.com',
				'duplicate@example.com',
				'another@example.com',
				'unique@example.com'
			];

			const unique = [...new Set(emails)];

			expect(unique).toEqual([
				'duplicate@example.com',
				'unique@example.com',
				'another@example.com'
			]);
		});

		it('normalizes email case', () => {
			const emails = ['Test@Example.COM', 'test@example.com', 'TEST@EXAMPLE.COM'];

			const normalized = emails.map((e) => e.toLowerCase());
			const unique = [...new Set(normalized)];

			expect(unique).toEqual(['test@example.com']);
		});
	});
});
