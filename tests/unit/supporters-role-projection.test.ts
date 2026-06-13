/**
 * C-20 — emailHash + consent evidence are editor-only in the Convex layer.
 *
 * `convex/supporters.ts` member-gated readers (`list`, `get`, `searchByEmail`,
 * `findByEmailHash`) ran `requireOrgRole(ctx, slug, 'member')` and then returned
 * `emailHash` (a stable cross-org join key) plus the six consent-evidence fields
 * to ANY member-role caller hitting the deployment URL directly. The route-level
 * mask in `+page.server.ts` is decorative — the Convex layer is the real
 * boundary. A shared `projectSupporterFields(doc, isEditor)` helper now nulls
 * those fields for non-editor members in every member-gated reader so the gate
 * cannot drift between them.
 *
 * convex-test isn't wired in this repo (see reconcile-skip-counter /
 * v1-supporters-truncation tests), so this mirrors the helper's exact logic
 * against in-memory rows and pins the source so each reader actually routes
 * through the shared projection.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CONSENT_FIELDS = [
	'emailConsentSource',
	'emailConsentedAt',
	'emailConsentText',
	'smsConsentSource',
	'smsConsentedAt',
	'smsConsentText'
] as const;

/**
 * Mirror of `projectSupporterFields` in convex/supporters.ts: editor+ callers
 * keep the real values; non-editor members get null for the join-key hash and
 * the six consent-evidence fields.
 */
function projectSupporterFields<T extends Record<string, unknown>>(doc: T, isEditor: boolean): T {
	if (isEditor) return doc;
	return {
		...doc,
		emailHash: null,
		emailConsentSource: null,
		emailConsentedAt: null,
		emailConsentText: null,
		smsConsentSource: null,
		smsConsentedAt: null,
		smsConsentText: null
	};
}

function makeListRow() {
	return {
		_id: 'sup_1',
		_creationTime: 100,
		encryptedEmail: '{"ct":"abc"}',
		emailHash: 'org_scoped_hash_deadbeef',
		encryptedName: '{"ct":"name"}',
		encryptedPhone: '{"ct":"phone"}',
		encryptedCustomFields: '{"ct":"cf"}',
		verified: true,
		emailStatus: 'subscribed',
		smsStatus: 'subscribed',
		source: 'csv',
		emailConsentSource: 'signup_form',
		emailConsentedAt: 1700000000000,
		emailConsentText: 'I agree to receive emails',
		smsConsentSource: 'text_keyword',
		smsConsentedAt: 1700000000001,
		smsConsentText: 'Reply STOP to opt out'
	};
}

describe('C-20 supporter role projection (Convex layer is the real boundary)', () => {
	it('nulls emailHash + all six consent fields for a member-role caller', () => {
		const projected = projectSupporterFields(makeListRow(), /* isEditor */ false);
		expect(projected.emailHash).toBeNull();
		for (const field of CONSENT_FIELDS) {
			expect(projected[field]).toBeNull();
		}
	});

	it('keeps emailHash + consent fields intact for an editor/owner caller', () => {
		const row = makeListRow();
		const projected = projectSupporterFields(row, /* isEditor */ true);
		expect(projected.emailHash).toBe('org_scoped_hash_deadbeef');
		expect(projected.emailConsentText).toBe('I agree to receive emails');
		expect(projected.smsConsentText).toBe('Reply STOP to opt out');
		for (const field of CONSENT_FIELDS) {
			expect(projected[field]).toBe(row[field]);
		}
	});

	it('leaves the org-key-encrypted PII blobs untouched for members (existing custody model)', () => {
		// encrypted* are decrypted client-side with the org key — they are NOT
		// part of the leak and must survive the projection so members who hold
		// the key can still read them.
		const projected = projectSupporterFields(makeListRow(), false);
		expect(projected.encryptedEmail).toBe('{"ct":"abc"}');
		expect(projected.encryptedName).toBe('{"ct":"name"}');
		expect(projected.encryptedPhone).toBe('{"ct":"phone"}');
		expect(projected.encryptedCustomFields).toBe('{"ct":"cf"}');
	});

	it('does not strip non-sensitive metadata for members', () => {
		const projected = projectSupporterFields(makeListRow(), false);
		expect(projected.verified).toBe(true);
		expect(projected.emailStatus).toBe('subscribed');
		expect(projected.smsStatus).toBe('subscribed');
		expect(projected.source).toBe('csv');
	});
});

describe('C-20 every member-gated reader routes through the shared projection', () => {
	const convexSource = readFileSync(
		path.resolve(process.cwd(), 'convex/supporters.ts'),
		'utf8'
	);

	function readerBody(start: string, end: string): string {
		const from = convexSource.indexOf(start);
		expect(from, `reader not found: ${start}`).toBeGreaterThan(-1);
		const to = convexSource.indexOf(end, from + start.length);
		return convexSource.slice(from, to === -1 ? undefined : to);
	}

	it('defines a single shared projection helper', () => {
		expect(convexSource).toContain('function projectSupporterFields<');
		expect(convexSource).toContain('function membershipIsEditor(');
	});

	it('list derives isEditor from membership.role and projects each row', () => {
		const body = readerBody('export const list = query', 'export const get = query');
		expect(body).toContain('membershipIsEditor(membership.role)');
		expect(body).toContain('return projectSupporterFields(');
	});

	it('get derives isEditor from membership.role and projects the row', () => {
		const body = readerBody('export const get = query', 'export const findByEmailHash = query');
		expect(body).toContain('membershipIsEditor(membership.role)');
		expect(body).toContain('return projectSupporterFields(');
	});

	it('findByEmailHash projects the raw .first() doc', () => {
		const body = readerBody('export const findByEmailHash = query', 'export const searchByEmail = query');
		expect(body).toContain('membershipIsEditor(membership.role)');
		expect(body).toContain('return projectSupporterFields(doc, isEditor);');
	});

	it('searchByEmail projects its mapped shape', () => {
		const body = readerBody('export const searchByEmail = query', 'export const getSummaryStats = query');
		expect(body).toContain('membershipIsEditor(membership.role)');
		expect(body).toContain('return projectSupporterFields(');
	});
});
