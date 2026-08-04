/**
 * ONE assembly for every send lane.
 *
 * A mailto handoff has two faces: the URL the mail app opens (what the RECIPIENT
 * receives) and the copy the send peak shows (what the SENDER believes was sent).
 * When each lane built those separately they drifted, and nothing failed. These
 * tests parse the recipient side back out of the URL and demand it equal the
 * sender side byte for byte — the one relationship a second construction breaks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	analyzeEmailFlow,
	assembleMailto,
	encodeMailboxForMailto,
	MAILTO_URL_MAX_LENGTH,
	type MailtoZones
} from '$lib/services/emailService';
import { resolveTemplate } from '$lib/utils/templateResolver';
import type { EmailServiceUser } from '$lib/types/user';
import type { EmailFlowTemplate } from '$lib/types/template';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** The recipient side, derived only from the URL — never from the input zones. */
function recipientVisible(url: string): { subject: string; body: string } {
	const parsed = new URL(url);
	return {
		subject: parsed.searchParams.get('subject') ?? '',
		body: parsed.searchParams.get('body') ?? ''
	};
}

const ATTESTATION = 'Self-reported constituent (Census geocoder) · CA-12';

describe('sender-visible text equals recipient-visible text', () => {
	const lanes = [
		{
			name: 'single direct recipient',
			input: {
				recipients: ['rep@example.test'],
				subject: 'A subject',
				zones: { body: 'A body', attestation: ATTESTATION }
			}
		},
		{
			name: 'batch of three recipients',
			input: {
				recipients: ['one@example.test', 'two@example.test', 'three@example.test'],
				subject: 'A subject',
				zones: {
					body: 'A body',
					attestation: ATTESTATION
				}
			}
		},
		{
			name: 'congressional relay',
			input: {
				recipients: ['congress@commons.email'],
				subject: 'A subject',
				zones: {
					body: 'A body',
					metadata: '[Template: a-slug]\n[From: ada@example.test]',
					attestation: ATTESTATION
				}
			}
		}
	];

	for (const lane of lanes) {
		it(`${lane.name}: messageText is the URL's own subject and body`, () => {
			const result = assembleMailto(lane.input);
			if (!result.ok) throw new Error(result.message);

			const seen = recipientVisible(result.url);
			expect(result.messageText).toBe(`Subject: ${seen.subject}\n\n${seen.body}`);
		});
	}

	it('the attestation reaches both faces of the single lane', () => {
		const result = assembleMailto(lanes[0].input);
		if (!result.ok) throw new Error(result.message);

		expect(result.messageText).toContain(ATTESTATION);
		expect(recipientVisible(result.url).body).toContain(ATTESTATION);
	});

	it('the batch lane carries its whole body to both faces', () => {
		const result = assembleMailto(lanes[1].input);
		if (!result.ok) throw new Error(result.message);

		expect(result.messageText).toContain('A body');
		expect(recipientVisible(result.url).body).toContain('A body');
	});
});

describe('the congressional flow entry point carries the same equality', () => {
	const congressionalTemplate: EmailFlowTemplate = {
		id: 'assembly-relay',
		slug: 'assembly-relay',
		title: 'A subject',
		description: 'A test template',
		deliveryMethod: 'cwc',
		message_body: 'A body',
		recipient_config: { emails: [] }
	};

	const addressedUser: EmailServiceUser = {
		id: 'u1',
		email: 'ada@example.test',
		name: 'Ada',
		street: '1 Main St',
		city: 'Springfield',
		state: 'CA',
		zip: '90210',
		is_verified: true,
		verification_method: 'civic_api'
	};

	it('analyzeEmailFlow returns a messageText produced by the same assembly as its URL', () => {
		const flow = analyzeEmailFlow(congressionalTemplate, addressedUser, { trustTier: 2 });

		expect(flow.error).toBeUndefined();
		expect(flow.nextAction).toBe('email');
		expect(flow.mailtoUrl).toBeTruthy();

		const seen = recipientVisible(flow.mailtoUrl as string);
		expect(flow.messageText).toBe(`Subject: ${seen.subject}\n\n${seen.body}`);
	});

	it('the relay routing lines survive as their own intact lines', () => {
		const flow = analyzeEmailFlow(congressionalTemplate, addressedUser, { trustTier: 2 });
		const lines = recipientVisible(flow.mailtoUrl as string).body.split('\n');

		// An external mail relay parses these; a substring match would pass even if
		// they were merged into one line or fused with the attestation.
		expect(lines).toContain('[Template: assembly-relay]');
		expect(lines).toContain('[From: ada@example.test]');
	});
});

describe('recipients', () => {
	it('encodes every mailbox in a multi-recipient list independently', () => {
		const recipients = ['official+press@example.test', 'second@example.test', 'third@example.test'];
		const result = assembleMailto({
			recipients,
			subject: 'A subject',
			zones: { body: 'A body' }
		});
		if (!result.ok) throw new Error(result.message);

		expect(new URL(result.url).pathname.split(',')).toEqual(
			recipients.map(encodeMailboxForMailto)
		);
	});

	it('cannot be used to smuggle a header into the URL', () => {
		const result = assembleMailto({
			recipients: ['victim@example.test?bcc=attacker@example.test'],
			subject: 'A subject',
			zones: { body: 'A body' }
		});
		if (!result.ok) throw new Error(result.message);

		expect(new URL(result.url).searchParams.get('bcc')).toBeNull();
	});
});

describe('zone order and separators', () => {
	it('a fully populated message has one order and one rule', () => {
		const result = assembleMailto({
			recipients: ['rep@example.test'],
			subject: 'A subject',
			zones: {
				body: 'A body',
				metadata: '[Template: a-slug]\n[From: ada@example.test]',
				attestation: ATTESTATION
			}
		});
		if (!result.ok) throw new Error(result.message);

		expect(recipientVisible(result.url).body).toBe(
			'A body\n\n---\n\n' + `[Template: a-slug]\n[From: ada@example.test]\n${ATTESTATION}`
		);
	});

	it('empty zones vanish without leaving blank-line residue', () => {
		const result = assembleMailto({
			recipients: ['rep@example.test'],
			subject: 'A subject',
			zones: {
				body: '  A body  ',
				metadata: '',
				attestation: undefined
			}
		});
		if (!result.ok) throw new Error(result.message);

		const body = recipientVisible(result.url).body;
		expect(body).toBe('A body');
		expect(body).not.toMatch(/\n{3,}/);
	});

	it('never emits three consecutive newlines, whichever zones are present', () => {
		const zoneSets: MailtoZones[] = [
			{ body: 'A body' },
			{ body: 'A body', attestation: ATTESTATION },
			{ body: '', attestation: ATTESTATION },
			{ body: 'A body', metadata: 'A line', attestation: ATTESTATION }
		];

		for (const zones of zoneSets) {
			const result = assembleMailto({
				recipients: ['rep@example.test'],
				subject: 'A subject',
				zones
			});
			if (!result.ok) throw new Error(result.message);
			expect(recipientVisible(result.url).body).not.toMatch(/\n{3,}/);
		}
	});
});

describe('nothing the sender did not see is prepended', () => {
	it('the letter is the first thing the recipient reads, on every zone combination', () => {
		const zoneSets: MailtoZones[] = [
			{ body: 'A body' },
			{ body: 'A body', attestation: ATTESTATION },
			{ body: 'A body', metadata: 'A line', attestation: ATTESTATION }
		];

		for (const zones of zoneSets) {
			const result = assembleMailto({
				recipients: ['rep@example.test'],
				subject: 'A subject',
				zones
			});
			if (!result.ok) throw new Error(result.message);

			expect(recipientVisible(result.url).body.startsWith('A body')).toBe(true);
		}
	});

	it('the resolved letter reaches the recipient starting at its own salutation', () => {
		// The expected side is a literal this test owns; the actual side is parsed
		// back out of the URL, so a prepended zone growing back cannot satisfy both.
		const TYPED = 'The clinic near me closed in March.';
		const template: EmailFlowTemplate = {
			id: 'assembly-prepend',
			slug: 'assembly-prepend',
			title: 'A subject',
			description: 'A test template',
			deliveryMethod: 'email',
			message_body: 'Dear official,\n\n[Personal Connection]\n\nPlease act.',
			recipient_config: { emails: ['rep@example.test'] }
		};
		const sender: EmailServiceUser = {
			id: 'u1',
			email: 'ada@example.test',
			name: 'Ada',
			street: '1 Main St',
			city: 'Springfield',
			state: 'CA',
			zip: '90210',
			is_verified: true,
			verification_method: 'civic_api'
		};

		const resolved = resolveTemplate(template, sender, { personalConnection: TYPED });
		const result = assembleMailto({
			recipients: ['rep@example.test'],
			subject: 'A subject',
			// The detail page hands the resolver's output straight to the assembly.
			zones: { body: resolved.body, attestation: ATTESTATION }
		});
		if (!result.ok) throw new Error(result.message);

		const body = recipientVisible(result.url).body;
		expect(body.startsWith('Dear official,')).toBe(true);
		expect(body).toContain(TYPED);
	});

	it('the detail page hands the assembly no text of the recipient record', () => {
		const text = src('src/routes/s/[slug]/+page.svelte');

		expect(text).not.toContain('accountabilityOpener');
		// `noopener` in the contact-form window feature string has no word boundary
		// before `opener` and no colon after it, so it cannot satisfy this.
		expect(text).not.toMatch(/\bopener\s*:/);
	});
});

describe('one failure contract', () => {
	const longBody = 'x'.repeat(MAILTO_URL_MAX_LENGTH);

	it('an over-length message is blocked identically for one recipient and for many', () => {
		for (const recipients of [['rep@example.test'], ['a@example.test', 'b@example.test']]) {
			const result = assembleMailto({
				recipients,
				subject: 'A subject',
				zones: { body: longBody }
			});

			expect(result.ok).toBe(false);
			expect(result.ok === false && result.code).toBe('URL_TOO_LONG');
			// The block still shows the sender exactly what it would have sent —
			// there is no URL left to parse it out of, so a blocked send is the one
			// place the expected text is stated directly.
			expect(result.ok === false && result.messageText).toBe(`Subject: A subject\n\n${longBody}`);
		}
	});

	it('a message with no recipient is named, not silently dropped', () => {
		const result = assembleMailto({
			recipients: ['', '   '],
			subject: 'A subject',
			zones: { body: 'A body' }
		});

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.code).toBe('NO_RECIPIENTS');
		expect(result.ok === false && result.messageText).toBe('Subject: A subject\n\nA body');
	});

	it('a message with nothing in it is named too', () => {
		const result = assembleMailto({
			recipients: ['rep@example.test'],
			subject: '   ',
			zones: { body: '', attestation: '' }
		});

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.code).toBe('EMPTY_MESSAGE');
	});
});

describe('no second construction survives', () => {
	it('the route builds no message text of its own', () => {
		const text = src('src/routes/s/[slug]/+page.svelte');

		expect(text).not.toContain('mailto:');
		expect(text).not.toContain('copyBodyParts');
		expect(text).not.toContain('encodeMailboxForMailto');
		expect(text).not.toContain('8000');
		expect(text.match(/assembleMailto\(/g) ?? []).toHaveLength(2);

		// One declaration types the field; every other occurrence must READ the
		// text off an assembly result rather than compose a string.
		const occurrences = text.match(/messageText:.*/g) ?? [];
		const assignments = occurrences.filter((line) => !line.startsWith('messageText: string'));
		expect(assignments).toHaveLength(2);
		for (const line of assignments) {
			expect(line).toMatch(/^messageText:\s*\w+\.messageText/);
		}
	});

	it('the service holds exactly one mailto construction and one length limit', () => {
		const text = src('src/lib/services/emailService.ts');

		// The construction form, not the bare scheme: `startsWith('mailto:')` and
		// the doc comments are legitimate mentions, and banning them would fail a
		// correct refactor.
		expect(text.match(/`mailto:\$\{/g) ?? []).toHaveLength(1);
		expect(text.match(/8000/g) ?? []).toHaveLength(1);

		// The mailbox encoder, the template-lane entry point, and the one
		// assembler. A fourth name here is a second builder growing back.
		expect((text.match(/export function \w*[Mm]ailto\w*/g) ?? []).sort()).toEqual([
			'export function assembleMailto',
			'export function encodeMailboxForMailto',
			'export function generateMailtoUrl'
		]);
	});
});
