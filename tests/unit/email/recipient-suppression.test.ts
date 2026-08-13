/**
 * The mailbox-addressed route off the platform.
 *
 * Two properties carry the whole feature. The token must be bound to ONE
 * mailbox hash under a key space that no other HMAC in the tree can reach — a
 * token that verifies in two places is a takedown that fires on the wrong
 * address. And the link must actually ride out in the message, unconditionally:
 * a suppression block that a surface can withhold, or that gets trimmed away to
 * make a long message fit, is a promise the recipient never receives.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		RECIPIENT_SUPPRESSION_SECRET: 'test-suppression-' + 'a'.repeat(48),
		UNSUBSCRIBE_SECRET: 'test-unsubscribe-' + 'a'.repeat(48),
		PUBLIC_BASE_URL: 'https://commons.email'
	}
}));

import {
	buildRecipientSuppressionUrl,
	generateRecipientSuppressionToken,
	isRecipientContactHash,
	verifyRecipientSuppressionToken
} from '$lib/server/email/recipient-suppression';
import { generateUnsubscribeToken, verifyUnsubscribeToken } from '$lib/server/email/unsubscribe';
import {
	assembleMailto,
	buildSuppressionZone,
	generateMailtoUrl,
	MAILTO_URL_MAX_LENGTH
} from '$lib/services/emailService';
import type { EmailFlowTemplate } from '$lib/types/template';
import { env } from '$env/dynamic/private';

const ACTIVE = 'test-suppression-' + 'a'.repeat(48);
const ROTATED = 'test-suppression-rotated-' + 'b'.repeat(40);
const RETIRED = 'test-suppression-retired-' + 'c'.repeat(40);
const HASH_A = 'a1'.repeat(32);
const HASH_B = 'b2'.repeat(32);

function setEnv(values: Record<string, string | undefined>): void {
	const mutable = env as Record<string, string | undefined>;
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete mutable[key];
		else mutable[key] = value;
	}
}

beforeEach(() => {
	setEnv({
		RECIPIENT_SUPPRESSION_SECRET: ACTIVE,
		RECIPIENT_SUPPRESSION_SECRET_PREVIOUS: undefined,
		UNSUBSCRIBE_SECRET: 'test-unsubscribe-' + 'a'.repeat(48),
		UNSUBSCRIBE_SECRET_PREVIOUS: undefined,
		PUBLIC_BASE_URL: 'https://commons.email'
	});
});

describe('recipient suppression token', () => {
	it('mints 64 hex characters, deterministically, for one hash', () => {
		const token = generateRecipientSuppressionToken(HASH_A);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(generateRecipientSuppressionToken(HASH_A)).toBe(token);
	});

	it('round-trips a freshly minted token', () => {
		expect(verifyRecipientSuppressionToken(HASH_A, generateRecipientSuppressionToken(HASH_A))).toBe(
			true
		);
	});

	it('rejects a tampered token', () => {
		const token = generateRecipientSuppressionToken(HASH_A);
		const tampered = (token[0] === '0' ? '1' : '0') + token.slice(1);
		expect(verifyRecipientSuppressionToken(HASH_A, tampered)).toBe(false);
	});

	it('returns false, never throws, on a wrong-length token', () => {
		expect(verifyRecipientSuppressionToken(HASH_A, '')).toBe(false);
		expect(verifyRecipientSuppressionToken(HASH_A, 'abc')).toBe(false);
		expect(verifyRecipientSuppressionToken(HASH_A, 'f'.repeat(128))).toBe(false);
	});

	it('rejects a token minted for a different contact hash', () => {
		expect(verifyRecipientSuppressionToken(HASH_B, generateRecipientSuppressionToken(HASH_A))).toBe(
			false
		);
	});

	it('rejects a contact hash that is not 64 lowercase hex characters', () => {
		for (const bad of ['', 'not-a-hash', 'A1'.repeat(32), 'a1'.repeat(31), 'a1'.repeat(33)]) {
			expect(isRecipientContactHash(bad)).toBe(false);
			expect(() => generateRecipientSuppressionToken(bad)).toThrow();
			expect(() => buildRecipientSuppressionUrl(bad)).toThrow();
			// Verification never throws on caller input — a mangled URL is a `false`.
			expect(verifyRecipientSuppressionToken(bad, 'f'.repeat(64))).toBe(false);
		}
	});

	it('keeps a link alive through a rotation window and lets a retired secret die', () => {
		const underActive = generateRecipientSuppressionToken(HASH_A);
		setEnv({ RECIPIENT_SUPPRESSION_SECRET: RETIRED });
		const underRetired = generateRecipientSuppressionToken(HASH_A);

		setEnv({
			RECIPIENT_SUPPRESSION_SECRET: ROTATED,
			RECIPIENT_SUPPRESSION_SECRET_PREVIOUS: ACTIVE
		});
		expect(verifyRecipientSuppressionToken(HASH_A, generateRecipientSuppressionToken(HASH_A))).toBe(
			true
		);
		expect(verifyRecipientSuppressionToken(HASH_A, underActive)).toBe(true);
		expect(verifyRecipientSuppressionToken(HASH_A, underRetired)).toBe(false);
	});

	it('treats an under-length previous secret as unset instead of bricking verification', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const token = generateRecipientSuppressionToken(HASH_A);
		setEnv({ RECIPIENT_SUPPRESSION_SECRET_PREVIOUS: 'too-short' });
		expect(verifyRecipientSuppressionToken(HASH_A, token)).toBe(true);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('carries no plaintext address in the URL', () => {
		const url = buildRecipientSuppressionUrl(HASH_A);
		expect(url).toBe(
			`https://commons.email/do-not-contact/${HASH_A}/${generateRecipientSuppressionToken(HASH_A)}`
		);
		expect(url).not.toContain('@');
	});
});

describe('domain separation from the supporter-scoped unsubscribe key space', () => {
	it('is enforced in both directions even when both key spaces share a secret', () => {
		const shared = 'shared-secret-for-both-key-spaces-' + 'd'.repeat(32);
		setEnv({ RECIPIENT_SUPPRESSION_SECRET: shared, UNSUBSCRIBE_SECRET: shared });

		// The unsubscribe preimage is `${supporterId}:${orgId}`; feeding it the same
		// hash is the closest an attacker gets to a collision.
		const unsubscribeToken = generateUnsubscribeToken(HASH_A, '');
		const suppressionToken = generateRecipientSuppressionToken(HASH_A);

		expect(suppressionToken).not.toBe(unsubscribeToken);
		expect(verifyRecipientSuppressionToken(HASH_A, unsubscribeToken)).toBe(false);
		expect(verifyUnsubscribeToken(HASH_A, '', suppressionToken)).toBe(false);
	});
});

describe('the link rides out in the message', () => {
	const suppressionUrl = (hash: string) => `https://commons.email/do-not-contact/${hash}/${'f'.repeat(64)}`;

	it('emits one line per recipient after the attestation block on the direct lane', () => {
		const recipients = ['one@example.test', 'two@example.test'];
		const assembly = assembleMailto({
			recipients,
			subject: 'A subject',
			zones: {
				body: 'A body',
				attestation: 'Self-reported constituent (Census geocoder) · CA-12',
				suppression: buildSuppressionZone(
					recipients.map((email, index) => ({
						email,
						doNotContactUrl: suppressionUrl(index === 0 ? HASH_A : HASH_B)
					}))
				)
			}
		});

		expect(assembly.ok).toBe(true);
		expect(assembly.messageText).toContain(`one@example.test — ${suppressionUrl(HASH_A)}`);
		expect(assembly.messageText).toContain(`two@example.test — ${suppressionUrl(HASH_B)}`);
		// One line per recipient, and after the verification footer.
		expect(assembly.messageText.match(/ — https:\/\/commons\.email\/do-not-contact\//g)).toHaveLength(
			2
		);
		expect(assembly.messageText.indexOf('Self-reported constituent')).toBeLessThan(
			assembly.messageText.indexOf('one@example.test —')
		);
	});

	it('fails with URL_TOO_LONG rather than trimming the block to fit', () => {
		const suppression = buildSuppressionZone([
			{ email: 'one@example.test', doNotContactUrl: suppressionUrl(HASH_A) }
		]);
		const assembly = assembleMailto({
			recipients: ['one@example.test'],
			subject: 'A subject',
			zones: { body: 'x'.repeat(MAILTO_URL_MAX_LENGTH + 1_000), suppression }
		});

		expect(assembly.ok).toBe(false);
		if (assembly.ok) throw new Error('unreachable');
		expect(assembly.code).toBe('URL_TOO_LONG');
		expect(assembly.messageText).toContain(`one@example.test — ${suppressionUrl(HASH_A)}`);
	});

	const template: EmailFlowTemplate = {
		id: 'suppression-lane',
		slug: 'suppression-lane',
		title: 'Suppression lane',
		description: 'Lane fixture',
		deliveryMethod: 'email',
		message_body: 'Dear official,\n\nPlease act.',
		recipient_config: { emails: ['official@example.test'] }
	};

	it('renders the block on the direct lane of generateMailtoUrl', () => {
		const result = generateMailtoUrl(template, null, {
			doNotContactUrls: { 'official@example.test': suppressionUrl(HASH_A) }
		});
		expect(result.error).toBeUndefined();
		expect(result.messageText).toContain(`official@example.test — ${suppressionUrl(HASH_A)}`);
	});

	it('renders no block on the congressional relay lane', () => {
		const result = generateMailtoUrl(
			{ ...template, deliveryMethod: 'cwc', recipient_config: { emails: [] } },
			null,
			{ doNotContactUrls: { 'official@example.test': suppressionUrl(HASH_A) } }
		);
		expect(result.error).toBeUndefined();
		expect(result.messageText).not.toContain('/do-not-contact/');
	});
});

describe('no public page load mints a suppression credential', () => {
	it('keeps the mint out of the anonymous /s/[slug] loader', () => {
		// A suppression URL is a permanent, global takedown credential. Minting one
		// eagerly for every published recipient on every page render makes the
		// credential exist before anyone asked for it and puts its exposure surface
		// on a public page. It is minted at send time, by POST
		// /api/do-not-contact/links, for the addresses one message carries.
		const loader = readFileSync(
			resolve(process.cwd(), 'src/routes/s/[slug]/+page.server.ts'),
			'utf8'
		);
		expect(loader).not.toContain('buildRecipientSuppressionUrl');
		expect(loader).not.toContain('doNotContactUrl');
	});
});
