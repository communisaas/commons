/**
 * A lane either carries the sender's own words or it refuses them out loud.
 *
 * Three claims live here. First, the fence: a guest on a congressional template
 * goes out through the mailto relay, which delivers the typed note like any other
 * letter — suppressing on `deliveryMethod` instead of on the LANE would have
 * destroyed that path, so the fence states it as a literal the test owns. Second,
 * the authenticated congressional sender is on a lane that transmits a proof and
 * no body, so the letter they read has the sender-fill slots already gone. Third,
 * that erasure is byte-identical to what the send path produces — the two sides
 * are built from different call sites in different runtimes, so equality here is
 * agreement rather than a tautology.
 *
 * Every expectation is a literal this file owns. Asking product code what it
 * expects would pass no matter which way the two drifted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	LANE_CARRIES_SENDER_TEXT,
	SEND_LANES,
	SENDER_TEXT_NOT_CARRIED_REASON,
	laneCarriesSenderText,
	resolveSendLane,
	senderVisibleLetter,
	type SendLane
} from '$lib/services/send-lane';
import { generateMailtoUrl } from '$lib/services/emailService';
import {
	DELIVERABLE_PLACEHOLDER_DENYLIST,
	MANUAL_FILL_PLACEHOLDERS,
	manualFillReplacements,
	resolvePlaceholders,
	type TemplateReplacements
} from '$convex/lib/messagePlaceholders';
import type { EmailServiceUser } from '$lib/types/user';
import type { EmailFlowTemplate } from '$lib/types/template';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** The recipient side, read only off the URL — never off the inputs that built it. */
function recipientBody(url: string): string {
	return decodeURIComponent(new URL(url).search.match(/[?&]body=([^&]*)/)![1]);
}

// ── Test-owned literals ──────────────────────────────────────────────────────
const TYPED = 'My son waited eleven months for a hearing aid.';

/** A letter whose only bracket slots are the ones the sender fills by hand. */
const MANUAL_FILL_ONLY_BODY =
	'Dear official,\n\n[Personal Connection]\n\n[Your Story]\n\n[Personal Story]\n\nPlease act.';

/** The same letter once every sender-fill slot is gone: the lines close up. */
const MANUAL_FILL_ONLY_ERASED = 'Dear official,\n\nPlease act.';

const cwcTemplate: EmailFlowTemplate = {
	id: 'hearing-aid-wait-cwc',
	slug: 'hearing-aid-wait-cwc',
	title: 'Cut the hearing aid wait',
	description: 'A test template',
	deliveryMethod: 'cwc',
	message_body: MANUAL_FILL_ONLY_BODY,
	recipient_config: { emails: [] }
};

const directTemplate: EmailFlowTemplate = {
	...cwcTemplate,
	id: 'hearing-aid-wait',
	slug: 'hearing-aid-wait',
	deliveryMethod: 'email',
	recipient_config: { emails: ['official@example.test'] }
};

// Signing in is not the same as proving a district. The proof lane needs tier 2;
// an OAuth-only sender has authenticated and proved nothing, so they take the
// relay exactly as a guest does — and the relay carries their words.
const provenSender = {
	id: 'u1',
	email: 'ada@example.test',
	name: 'Ada Lovelace',
	street: '1 Main St',
	city: 'Springfield',
	state: 'CA',
	zip: '90210',
	is_verified: true,
	verification_method: 'civic_api',
	trust_tier: 2
};

/** Authenticated, no district proof — the class the lane split used to misroute. */
const oauthOnlySender = { ...provenSender, trust_tier: 1 };

// Kept under the old name so the assertions below read unchanged.
const sender = provenSender;

describe('the lane decides, not the delivery method', () => {
	it('a guest on a congressional template takes the relay, which carries their words', () => {
		expect(resolveSendLane(cwcTemplate, null)).toBe('mailto_congressional_relay');
		expect(laneCarriesSenderText(cwcTemplate, null)).toBe(true);

		const result = generateMailtoUrl(cwcTemplate, null, { personalConnection: TYPED });

		expect(result.error).toBeUndefined();
		const body = recipientBody(result.url as string);
		// The literal the guest typed is in the letter the mail app receives. This is
		// the working path a `deliveryMethod`-keyed suppression would have taken out.
		expect(body).toContain(TYPED);
		for (const placeholder of MANUAL_FILL_PLACEHOLDERS) {
			expect(body).not.toContain(placeholder);
		}
	});

	it('an authenticated sender WITHOUT district proof takes the relay, and keeps their words', () => {
		// Signing in with OAuth yields no district credential. Splitting the lane on
		// truthiness put this sender on the proof lane they cannot take, stripped the
		// note from the preview, and then refused the send while offering them the
		// very lane whose words had just been erased.
		expect(resolveSendLane(cwcTemplate, oauthOnlySender)).toBe('mailto_congressional_relay');
		expect(laneCarriesSenderText(cwcTemplate, oauthOnlySender)).toBe(true);
		expect(senderVisibleLetter(cwcTemplate, oauthOnlySender, MANUAL_FILL_ONLY_BODY)).toBe(
			MANUAL_FILL_ONLY_BODY
		);
	});

	it('a sender WITH district proof takes the proof lane, which does not carry their words', () => {
		expect(resolveSendLane(cwcTemplate, sender)).toBe('cwc_zkp');
		expect(laneCarriesSenderText(cwcTemplate, sender)).toBe(false);

		const letter = senderVisibleLetter(cwcTemplate, sender, MANUAL_FILL_ONLY_BODY);

		expect(letter).toBe(MANUAL_FILL_ONLY_ERASED);
		for (const placeholder of MANUAL_FILL_PLACEHOLDERS) {
			expect(letter).not.toContain(placeholder);
		}
	});

	it('an ordinary template is a direct mailto for guest and sender alike', () => {
		expect(resolveSendLane(directTemplate, null)).toBe('mailto_direct');
		expect(resolveSendLane(directTemplate, sender)).toBe('mailto_direct');
		expect(laneCarriesSenderText(directTemplate, sender)).toBe(true);
		// A carrying lane leaves the letter alone — the slots are the affordance.
		expect(senderVisibleLetter(directTemplate, sender, MANUAL_FILL_ONLY_BODY)).toBe(
			MANUAL_FILL_ONLY_BODY
		);
	});
});

describe('what the sender reads is what the recipient receives', () => {
	it('the erasure the preview shows is the erasure the send path performs', () => {
		// The send path's side, assembled the way the congressional delivery step
		// assembles it: the sender-fill table, then the identity substitutions, then
		// whatever the deliverable denylist still names, then one resolve.
		const address = { street: '1 Main St', city: 'Springfield', state: 'CA', zip: '90210' };
		const wholeAddress = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
		const officialName = 'Grace Hopper';
		const replacements: TemplateReplacements = {
			...manualFillReplacements(),
			'[Name]': 'Ada Lovelace',
			'[Your Name]': 'Ada Lovelace',
			'[Address]': wholeAddress,
			'[Your Address]': wholeAddress,
			'[City]': address.city,
			'[State]': address.state,
			'[ZIP]': address.zip,
			'[Zip Code]': address.zip,
			'[Representative Name]': officialName,
			'[Rep Name]': officialName,
			'[Representative]': `Rep. ${officialName}`,
			'[Senator Name]': null,
			'[Senator]': null
		};
		for (const placeholder of DELIVERABLE_PLACEHOLDER_DENYLIST) {
			if (!(placeholder in replacements)) replacements[placeholder] = null;
		}
		const recipientVisible = resolvePlaceholders(MANUAL_FILL_ONLY_BODY, replacements);

		// The sender's side, built from the other runtime's call site.
		const senderVisible = senderVisibleLetter(cwcTemplate, sender, MANUAL_FILL_ONLY_BODY);

		// Both sides are pinned to the literal, so this is not two wrongs agreeing.
		expect(recipientVisible).toBe(MANUAL_FILL_ONLY_ERASED);
		expect(senderVisible).toBe(MANUAL_FILL_ONLY_ERASED);
		expect(senderVisible).toBe(recipientVisible);
	});
});

describe('the table admits no gaps', () => {
	it('every lane declares whether it carries the sender text', () => {
		for (const lane of SEND_LANES) {
			expect(
				Object.prototype.hasOwnProperty.call(LANE_CARRIES_SENDER_TEXT, lane),
				`lane "${lane}" has no row in LANE_CARRIES_SENDER_TEXT`
			).toBe(true);
			expect(typeof LANE_CARRIES_SENDER_TEXT[lane]).toBe('boolean');
		}
		expect(Object.keys(LANE_CARRIES_SENDER_TEXT).sort()).toEqual([...SEND_LANES].sort());
	});

	it('the row a lane declares is the row the lane helper reads', () => {
		const pairs: Array<[SendLane, EmailFlowTemplate, EmailServiceUser | null]> = [
			['mailto_direct', directTemplate, sender],
			['mailto_congressional_relay', cwcTemplate, null],
			['cwc_zkp', cwcTemplate, sender]
		];
		for (const [lane, template, user] of pairs) {
			expect(resolveSendLane(template, user)).toBe(lane);
			expect(laneCarriesSenderText(template, user)).toBe(LANE_CARRIES_SENDER_TEXT[lane]);
		}
	});
});

describe('the proof route is the reason the row reads false', () => {
	const ROUTE = 'src/routes/api/submissions/create/+server.ts';

	/** The names the route's strict parse accepts, read out of the route itself. */
	function acceptedFields(): string[] {
		const route = src(ROUTE);
		const start = route.indexOf('const ACCEPTED_SUBMISSION_FIELDS = [');
		expect(start, `${ROUTE} declares no ACCEPTED_SUBMISSION_FIELDS`).toBeGreaterThan(-1);
		const end = route.indexOf('];', start);
		return [...route.slice(start, end).matchAll(/'([^']+)'/g)].map((m) => m[1]);
	}

	it('accepts no message-bearing field while the row says the lane cannot carry one', () => {
		expect(
			LANE_CARRIES_SENDER_TEXT.cwc_zkp,
			'LANE_CARRIES_SENDER_TEXT.cwc_zkp now reads true, but /api/submissions/create still ' +
				'accepts no message-bearing field, so the lane has no carrier. Building one means ' +
				'server-side fail-closed moderation on this route, a server-encrypted message ' +
				'envelope, and the matching TEE /resolve contract bump — flip the row after that ' +
				'exists, not before.'
		).toBe(false);

		const names = acceptedFields();
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) {
			expect(
				name,
				`"${name}" reads as a message-bearing field on a lane that cannot deliver one`
			).not.toMatch(/message|body|text|note|comment|connection|personal|story/i);
		}
	});

	it('refuses any field outside that set, by strict parse rather than by name', () => {
		const route = src(ROUTE);

		// A denylist of guessed names is beaten by renaming the field; only a strict
		// parse of the whole key set is a boundary.
		expect(route).toContain(
			'Object.keys(body).some((key) => !ACCEPTED_SUBMISSION_FIELDS.includes(key))'
		);
		expect(route).not.toMatch(/body\.personalConnection/);

		// Unconditional: the refusal must not be gated on the table row, or flipping
		// the row would switch the boundary off as a side effect.
		const guard = route.slice(
			route.indexOf('const ACCEPTED_SUBMISSION_FIELDS = ['),
			route.indexOf('const {', route.indexOf('const ACCEPTED_SUBMISSION_FIELDS = ['))
		);
		expect(guard).not.toContain('LANE_CARRIES_SENDER_TEXT');
	});
});

describe('the surfaces speak with one voice', () => {
	const SENTENCE_FRAGMENT = 'cannot travel with it';

	it('one module owns the sentence that explains the refusal', () => {
		expect(SENDER_TEXT_NOT_CARRIED_REASON).toContain(SENTENCE_FRAGMENT);
		expect(src('src/lib/services/send-lane.ts')).toContain(SENTENCE_FRAGMENT);

		const speakers = [
			'src/lib/components/template/TemplateModal.svelte',
			'src/lib/components/template-browser/TemplatePreview.svelte',
			'src/lib/components/template-browser/parts/ActionBar.svelte',
			'src/routes/s/[slug]/+page.svelte'
		];
		for (const path of speakers) {
			const text = src(path);
			expect(text, `${path} holds its own copy of the refusal sentence`).not.toContain(
				SENTENCE_FRAGMENT
			);
			expect(text).toContain('SENDER_TEXT_NOT_CARRIED_REASON');
		}
	});

	it('one module persists the sender text across the sign-in round trip', () => {
		const preview = src('src/lib/components/template-browser/TemplatePreview.svelte');
		expect(preview).toContain('sessionStorage.setItem');
		// The write is gated on the lane, so a note is never stored against a send
		// that would discard it.
		expect(preview).toContain('carriesSenderText && personalConnectionValue');
		// Nothing survives a lane that cannot carry it — a later mount finds nothing.
		expect(preview).toContain('sessionStorage.removeItem(storageKey)');
		expect(preview).toContain('discardedSenderText');

		expect(
			src('src/lib/components/template-browser/parts/ActionBar.svelte'),
			'a second writer of the personalization blob re-seeds a note past the lane gate'
		).not.toContain('sessionStorage');
	});

	it('the modal guard is a last resort, and the surfaces refuse before reaching it', () => {
		// The send button refuses rather than moderating words it will then drop.
		const actionBar = src('src/lib/components/template-browser/parts/ActionBar.svelte');
		const refusal = actionBar.indexOf('SENDER_TEXT_NOT_CARRIED_REASON');
		const moderate = actionBar.indexOf('await moderatePersonalConnection(');
		expect(refusal).toBeGreaterThan(-1);
		expect(refusal, 'the send button moderates the note before refusing it').toBeLessThan(
			moderate
		);

		// The detail page keys its guard on the user the modal will actually see.
		const page = src('src/routes/s/[slug]/+page.svelte');
		expect(page).toContain('!laneCarriesSenderText(template, modalUser)');

		// The modal's own guard is retained, not deleted.
		expect(src('src/lib/components/template/TemplateModal.svelte')).toContain(
			'proofSubmissionBlocked = SENDER_TEXT_NOT_CARRIED_REASON'
		);
	});

	it('the preview erases at the text level and restores nothing on a lane that cannot carry', () => {
		const preview = src('src/lib/components/template-browser/MessagePreview.svelte');
		// Segments are parsed from the erased letter, so no slot survives to render
		// as an editable card or as an inert chip naming itself.
		expect(preview).toContain('parseTemplate(senderVisibleLetter(');
		expect(preview).toContain('if (!carriesSenderText) return;');
	});
});
