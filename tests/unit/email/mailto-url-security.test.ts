import { describe, expect, it, vi } from 'vitest';

import {
	encodeMailboxForMailto,
	generateMailtoUrl,
	generatePersonalizedMailto
} from '$lib/services/emailService';
import type { EmailFlowTemplate } from '$lib/types/template';

describe('mailto recipient encoding', () => {
	it('encodes plus-addressed mailboxes independently in a recipient list', () => {
		const template: EmailFlowTemplate = {
			id: 'mailto-multiple',
			slug: 'mailto-multiple',
			title: 'A subject',
			description: 'A test template',
			deliveryMethod: 'email',
			message_body: 'A body',
			recipient_config: {
				emails: ['official+press@example.test', 'second@example.test']
			}
		};

		const result = generateMailtoUrl(template, null);
		expect(result.error).toBeUndefined();
		expect(result.url).toBe(
			'mailto:official%2Bpress@example.test,second@example.test?subject=A%20subject&body=A%20body'
		);
	});

	it('keeps delimiter-bearing recipient data out of mailto headers', () => {
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		const template: EmailFlowTemplate = {
			id: 'mailto-security',
			slug: 'mailto-security',
			title: 'A subject',
			description: 'A test template',
			deliveryMethod: 'email',
			message_body: 'A body',
			recipient_config: {
				emails: ['official@example.test', 'victim@example.test?bcc=attacker@example.test']
			}
		};

		const result = generateMailtoUrl(template, null);
		expect(result.error).toBeUndefined();
		expect(result.url).toBe(
			'mailto:official@example.test,victim%40example.test%3Fbcc%3Dattacker@example.test?subject=A%20subject&body=A%20body'
		);
		expect(result.url?.match(/\?bcc=/g)).toBeNull();
	});

	it('keeps only the final at-sign literal for quoted local parts', () => {
		expect(encodeMailboxForMailto('"night@desk"@example.test')).toBe(
			'%22night%40desk%22@example.test'
		);
	});

	it('uses the mailbox encoder for personalized mailto URLs', () => {
		const result = generatePersonalizedMailto({
			recipient: { name: 'Night Desk', email: 'night+alerts@example.test?bcc=attacker@example.test' },
			subject: 'A subject',
			opener: '',
			templateBody: 'A body'
		});

		expect(result).toEqual({
			url: 'mailto:night%2Balerts%40example.test%3Fbcc%3Dattacker@example.test?subject=A%20subject&body=A%20body'
		});
	});
});
