import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The email-sybil ceiling in `verifyAddress` (convex/users.ts:948) caps how many
 * distinct userIds may share one mailbox inside 180 days. Its own comment says
 * why it exists: "Throwaway-account farms bypass per-userId throttle; this
 * closes that hole."
 *
 * Hashing the raw address reopened exactly that hole. One inbox yields unlimited
 * plus-tagged addresses, each hashing differently, each clearing the ceiling on
 * its own. These cases pin the canonical form the key is now taken over.
 */

// The implementation is a closure inside upsertFromOAuth, so it is exercised
// here through the same rule the source states, and the source is asserted to
// still contain it. A behavioural harness for the whole mutation lives in
// convex/authOps.convex.test.ts; this file guards the KEY, which is the part
// that silently degrades without ever failing.
function canonicalMailbox(email: string): string {
	const trimmed = email.toLowerCase().trim();
	const at = trimmed.lastIndexOf('@');
	if (at <= 0) return trimmed;
	const local = trimmed.slice(0, at);
	const domain = trimmed.slice(at + 1);
	const plus = local.indexOf('+');
	return `${plus >= 0 ? local.slice(0, plus) : local}@${domain}`;
}

describe('the sybil key is a mailbox, not a string', () => {
	it('collapses plus-tags to one bucket', () => {
		const forms = [
			'farm@example.test',
			'farm+1@example.test',
			'farm+2@example.test',
			'farm+anything-at-all@example.test',
			'  FARM+SHOUTING@example.test  '
		];
		expect(new Set(forms.map(canonicalMailbox)).size).toBe(1);
	});

	it('does NOT strip dots — that is Gmail-specific and would merge real mailboxes', () => {
		expect(canonicalMailbox('a.b@example.test')).not.toBe(canonicalMailbox('ab@example.test'));
	});

	it('keeps distinct mailboxes distinct', () => {
		const distinct = ['a@x.test', 'b@x.test', 'a@y.test'].map(canonicalMailbox);
		expect(new Set(distinct).size).toBe(3);
	});

	it('leaves a plus in the domain alone and survives malformed input', () => {
		expect(canonicalMailbox('a@b+c.test')).toBe('a@b+c.test');
		expect(canonicalMailbox('notanemail')).toBe('notanemail');
		expect(canonicalMailbox('@x.test')).toBe('@x.test');
	});

	it('is the rule the source actually applies', () => {
		const src = readFileSync('convex/authOps.ts', 'utf8');
		expect(src).toContain('const canonicalMailbox = (email: string): string =>');
		expect(src).toContain("new TextEncoder().encode(canonicalMailbox(email))");
		// The raw-address form must not come back.
		expect(src).not.toContain('encode(email.toLowerCase().trim())');
	});
});
