/**
 * THE GATE: what the sender READS must equal what the recipient RECEIVES.
 *
 * The preview footer and the outgoing mailto body are two different surfaces.
 * When each composed its own tier copy they drifted, and the drift ran in the
 * dishonest direction — the sender was shown a stronger verification class than
 * the mail actually carried. This test renders the real preview component and
 * builds the real mailto through the real send path — `generateMailtoUrl`, the
 * entry point every lane calls, never the assembler with a hand-fed zone — then
 * asserts strict string equality between the two. A source-grep would not catch
 * a re-divergence; only a render plus a real send can.
 *
 * The second direction matters as much as the first: a lane whose preview shows
 * no footer must send no footer, or the recipient reads a verification claim
 * about a sender who was never shown it.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';

import PreviewContent from '$lib/components/template-browser/parts/PreviewContent.svelte';
import { generateMailtoUrl } from '$lib/services/emailService';
import type { EmailServiceUser } from '$lib/types/user';
import type { Template } from '$lib/types/template';

const HASH = 'a'.repeat(64);

/** One sender, read independently by each surface. */
interface Sender {
	id: string;
	name: string;
	email: string;
	trust_tier: number;
	district_code: string;
	credentialHash: string;
	verification_method: string;
}

const template = {
	id: 't1',
	slug: 'attestation-parity',
	title: 'A subject',
	description: 'A test template',
	domain: 'Testing',
	type: 'advocacy',
	deliveryMethod: 'email',
	subject: 'A subject',
	message_body: 'A body',
	delivery_config: {},
	recipient_config: { emails: ['rep@example.test'] },
	coordinationScale: 0,
	isNew: false,
	status: 'published',
	is_public: true,
	send_count: 0
} as unknown as Template;

/** What the sender reads, straight out of the rendered preview. */
function senderVisibleLine(user: Sender): string {
	const { container } = render(PreviewContent, {
		props: {
			template,
			inModal: false,
			context: 'page',
			user,
			onScroll: () => {},
			personalConnectionValue: '',
			componentId: 'attestation-parity'
		} as never
	});

	const node = container.querySelector('[data-testid="attestation-line"]');
	expect(node, 'the preview must render an attestation line for a tier-2+ sender').toBeTruthy();
	return (node?.textContent ?? '').trim();
}

/** The declared-field projection of the sender the send path actually accepts. */
function asEmailServiceUser(user: Sender): EmailServiceUser {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		is_verified: true,
		verification_method: user.verification_method,
		credentialHash: user.credentialHash
	};
}

/**
 * The whole footer the recipient receives, decoded off the URL the real send
 * path returned — never off `messageText`, and never off the zone that built it.
 * Empty string when the lane sent no footer at all.
 */
function recipientFooter(user: Sender, attests: boolean): string {
	const result = generateMailtoUrl(template, asEmailServiceUser(user), {
		trustTier: user.trust_tier,
		attestation: attests ? { districtCode: user.district_code } : undefined
	});
	expect(result.error).toBeUndefined();

	const url = result.url as string;
	const marker = '&body=';
	const body = decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
	if (!body.includes('---')) return '';
	return (body.split('---').pop() ?? '').trim();
}

/** The one line both surfaces must agree on, byte for byte. */
function recipientVisibleLine(user: Sender): string {
	return recipientFooter(user, true).split('\n')[0];
}

const censusSender: Sender = {
	id: 'u1',
	name: 'Ada',
	email: 'ada@example.test',
	trust_tier: 2,
	district_code: 'CA-12',
	credentialHash: HASH,
	verification_method: 'civic_api'
};

const mdlSender: Sender = { ...censusSender, trust_tier: 3, verification_method: 'mdl' };

describe('sender-visible attestation == recipient-visible attestation', () => {
	it('a self-reported (Census-geocoded) tier-2 sender reads exactly what the mail carries', () => {
		const senderVisible = senderVisibleLine(censusSender);
		const recipientLine = recipientVisibleLine(censusSender);

		expect(senderVisible).toBe(recipientLine);
		expect(senderVisible).toBe('Self-reported constituent (Census geocoder) · CA-12');
		expect(senderVisible).not.toContain('Verified resident');
	});

	it('an mDL tier-3 sender reads exactly what the mail carries', () => {
		const senderVisible = senderVisibleLine(mdlSender);
		const recipientLine = recipientVisibleLine(mdlSender);

		expect(senderVisible).toBe(recipientLine);
		expect(senderVisible).toBe('Address-resolved constituent (mDL) · CA-12');
		expect(senderVisible).not.toContain('Verified resident');
	});

	it('the verify offer the preview links is the one the mail carries', () => {
		// The hash is a second recipient-visible claim on the same footer. The
		// preview links it; the mail must offer the same record, not a stale or
		// truncated one that 404s.
		const { container } = render(PreviewContent, {
			props: {
				template,
				inModal: false,
				context: 'page',
				user: censusSender,
				onScroll: () => {},
				personalConnectionValue: '',
				componentId: 'attestation-parity-verify'
			} as never
		});
		const href = container.querySelector('a[href^="/v/"]')?.getAttribute('href');
		expect(href).toBe(`/v/${HASH}`);

		expect(recipientFooter(censusSender, true)).toContain(
			`https://commons.email/v/${HASH}`
		);
	});

	it('a lane that shows the sender no footer sends the recipient none', () => {
		// The same sender on the same template through the same entry point, with
		// the lane not opted in. A footer here would be a verification claim the
		// sender never read.
		expect(recipientFooter(censusSender, false)).toBe('');
	});
});
