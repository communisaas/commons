/**
 * A receipt may only claim what someone actually witnessed.
 *
 * Two lanes end at the operating system, which tells the browser nothing back:
 * their only witness is the sender. One lane POSTs to this system's own API and
 * gets a row back, so acceptance *here* was observed — still not delivery. The
 * receipt therefore branches on WHO WATCHED, never on the delivery method, and
 * the table it branches through is keyed on the whole `SendLane` union so a lane
 * added later cannot inherit the optimistic answer by omission.
 *
 * Every expectation is a literal this file owns. Asking the product code what it
 * expects would pass no matter which way the two drifted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	LANE_SEND_EVIDENCE,
	RECEIPT_HEADING,
	RECEIPT_TIME_LABEL,
	SELF_REPORTED_SEND_BASIS,
	SEND_LANES,
	SERVER_ACCEPTED_SEND_BASIS,
	resolveSendLane,
	sendEvidence,
	type SendEvidence,
	type SendLane
} from '$lib/services/send-lane';

/** The claim this file refuses to let any self-reported surface make. */
const DELIVERY_CLAIM = /\b(delivered|received by|reached their inbox)\b/i;

/** Both witnesses, spelled out here rather than derived from the module. */
const EVIDENCE_KINDS: SendEvidence[] = ['self_reported', 'server_accepted'];

const congressional = { deliveryMethod: 'cwc' };
const ordinary = { deliveryMethod: 'email' };

const guest = null;
/** Signed in, nothing proved: the proof lane needs tier 2 (`send-lane.ts:47`). */
const tierOne = { id: 'u1', trust_tier: 1 };
const tierTwo = { id: 'u2', trust_tier: 2 };

describe('LANE_SEND_EVIDENCE — every lane names its witness', () => {
	it('has a row for every lane, with no undefined leaking through', () => {
		for (const lane of SEND_LANES) {
			expect(LANE_SEND_EVIDENCE[lane], `lane ${lane} has no evidence row`).toBeDefined();
			expect(EVIDENCE_KINDS).toContain(LANE_SEND_EVIDENCE[lane]);
		}
		// The table holds exactly the lanes that exist — no orphan row either.
		expect(Object.keys(LANE_SEND_EVIDENCE).sort()).toEqual([...SEND_LANES].sort());
	});

	it('both mailto lanes are self-reported; only the proof lane is server-accepted', () => {
		expect(LANE_SEND_EVIDENCE.mailto_direct).toBe('self_reported');
		expect(LANE_SEND_EVIDENCE.mailto_congressional_relay).toBe('self_reported');
		expect(LANE_SEND_EVIDENCE.cwc_zkp).toBe('server_accepted');
	});
});

describe('sendEvidence() — agrees with the lane decision, sender by sender', () => {
	const cases: Array<{ name: string; template: { deliveryMethod: string }; user: unknown }> = [
		{ name: 'guest, ordinary', template: ordinary, user: guest },
		{ name: 'guest, congressional', template: congressional, user: guest },
		{ name: 'tier 1, ordinary', template: ordinary, user: tierOne },
		{ name: 'tier 1, congressional', template: congressional, user: tierOne },
		{ name: 'tier 2, ordinary', template: ordinary, user: tierTwo },
		{ name: 'tier 2, congressional', template: congressional, user: tierTwo }
	];

	for (const { name, template, user } of cases) {
		it(`${name}: evidence is the lane's row`, () => {
			const lane: SendLane = resolveSendLane(template, user);
			expect(sendEvidence(template, user)).toBe(LANE_SEND_EVIDENCE[lane]);
		});
	}

	it('only a tier-2 congressional sender earns the server-accepted receipt', () => {
		expect(sendEvidence(congressional, tierTwo)).toBe('server_accepted');
		// Signing in is not proving a district: tier 1 rides the relay, self-reported.
		expect(sendEvidence(congressional, tierOne)).toBe('self_reported');
		expect(sendEvidence(congressional, guest)).toBe('self_reported');
		// A tier-2 sender on an ordinary template is still on a mailto lane.
		expect(sendEvidence(ordinary, tierTwo)).toBe('self_reported');
	});
});

describe('the self-reported basis sentence — whose claim it is', () => {
	it("keeps the register already ratified in SendConfirmation.svelte:150", () => {
		expect(SELF_REPORTED_SEND_BASIS).toContain("we can't see your mail app");
	});

	it('claims no delivery it never observed', () => {
		expect(SELF_REPORTED_SEND_BASIS).not.toMatch(DELIVERY_CLAIM);
	});

	it('does not borrow the server-accepted wording', () => {
		expect(SELF_REPORTED_SEND_BASIS).not.toContain('Your message has been sent.');
	});

	it('the server-accepted wording is preserved verbatim for the lane that earned it', () => {
		expect(SERVER_ACCEPTED_SEND_BASIS).toBe('Your message has been sent.');
	});
});

describe('the receipt registers — keyed on the whole evidence union', () => {
	const registers: Array<[string, Record<SendEvidence, string>]> = [
		['RECEIPT_HEADING', RECEIPT_HEADING],
		['RECEIPT_TIME_LABEL', RECEIPT_TIME_LABEL]
	];

	for (const [name, register] of registers) {
		it(`${name} has a row for each witness and nothing else`, () => {
			expect(Object.keys(register).sort()).toEqual([...EVIDENCE_KINDS].sort());
			for (const kind of EVIDENCE_KINDS) {
				expect(register[kind], `${name}.${kind} is empty`).toBeTruthy();
			}
		});
	}

	it('the two headings are distinguishable — one names a claim, one names an observation', () => {
		expect(RECEIPT_HEADING.self_reported).toBe('Marked sent');
		expect(RECEIPT_HEADING.server_accepted).toBe('Sent');
		expect(RECEIPT_HEADING.self_reported).not.toBe(RECEIPT_HEADING.server_accepted);
	});

	it('the timestamp label names which event it stamps', () => {
		expect(RECEIPT_TIME_LABEL.self_reported).toBe('Marked sent');
		expect(RECEIPT_TIME_LABEL.server_accepted).toBe('When');
	});
});

/**
 * A string the product owns is only honest if the surface a person reads is the
 * thing reading it. The basis register lives beside the receipt it prints, so
 * this asserts the wiring at its one live site — a dropped import or a re-typed
 * sentence is a red test here, not a receipt that quietly keeps the old wording.
 */
describe('the receipt surface reads the owned sentences — source pin', () => {
	const modal = readFileSync(
		resolve(process.cwd(), 'src/lib/components/template/TemplateModal.svelte'),
		'utf8'
	);

	it('names both owned basis identifiers rather than re-typing either sentence', () => {
		expect(modal).toContain('SELF_REPORTED_SEND_BASIS');
		expect(modal).toContain('SERVER_ACCEPTED_SEND_BASIS');
	});

	it('routes each witness to its own sentence in the component-local register', () => {
		expect(modal).toMatch(/self_reported:\s*SELF_REPORTED_SEND_BASIS/);
		expect(modal).toMatch(/server_accepted:\s*SERVER_ACCEPTED_SEND_BASIS/);
	});

	it('does not re-type the server-accepted sentence into the surface', () => {
		expect(modal).not.toContain('Your message has been sent.');
	});
});
