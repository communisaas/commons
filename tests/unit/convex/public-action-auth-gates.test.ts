/**
 * Public Convex action auth-gate contracts.
 *
 * Source-text pins for the explicit-auth-gate pattern applied to public
 * Convex actions. Each gated action calls
 * `ctx.runQuery(require<Name>AuthRef, {slug})` at its handler's top
 * BEFORE any expensive work (key unseal, hash computation, vector
 * search, token generation, etc.). The inner-mutation/inner-query gate
 * is defense-in-depth, but the action-level gate prevents amplification.
 *
 * A regression that drops the explicit gate would let:
 *   - segments.exportDecrypted: leak decrypted PII if the inner
 *     exportMatching query gets refactored
 *   - supporters.importWithEncryption: amplify 5000-row HMAC and
 *     key-unseal per call by a non-member
 *   - invites.create / invites.resend: 20-token generation and hashing
 *     by a non-member
 *   - legislation.rescoreBills: 200-bill vector-search loop (10,000
 *     ops) by any caller
 *   - debates.spawnDebate: unlimited debate-list spam by any
 *     authenticated user
 *
 * Each test asserts the gate's presence + the corresponding internal
 * query / rate-limit call. Behavioral testing of Convex actions
 * requires the Convex test harness which is out of scope here; the
 * source-text pin is the cheap defense.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('public Convex action auth gates', () => {
	it('segments.exportDecrypted has explicit editor gate before key unseal', () => {
		const svelte = source('convex/segments.ts');
		expect(svelte).toContain('export const requireExportAuth = internalQuery');
		expect(svelte).toMatch(/requireOrgRole\(ctx,\s*slug,\s*['"]editor['"]\)/);
		const action = svelte.slice(
			svelte.indexOf('export const exportDecrypted = action'),
			svelte.indexOf('export const exportDecrypted = action') + 2000
		);
		expect(action).toContain('runQuery(requireExportAuthRef');
		// Gate fires BEFORE org key unseal
		const gatePos = action.indexOf('runQuery(requireExportAuthRef');
		const unsealPos = action.indexOf('getOrgKeyForAction');
		expect(gatePos).toBeGreaterThan(0);
		expect(unsealPos).toBeGreaterThan(gatePos);
	});

	it('supporters.importWithEncryption has explicit editor gate before HMAC + unseal', () => {
		const svelte = source('convex/supporters.ts');
		expect(svelte).toContain('export const requireImportAuth = internalQuery');
		const action = svelte.slice(
			svelte.indexOf('export const importWithEncryption = action'),
			svelte.indexOf('export const importWithEncryption = action') + 3000
		);
		expect(action).toContain('runQuery(requireImportAuthRef');
		const gatePos = action.indexOf('runQuery(requireImportAuthRef');
		const hmacPos = action.indexOf('computeOrgScopedEmailHash');
		expect(gatePos).toBeGreaterThan(0);
		expect(hmacPos).toBeGreaterThan(gatePos);
	});

	it('invites.create and invites.resend share requireCreateInvitesAuth gate', () => {
		const svelte = source('convex/invites.ts');
		expect(svelte).toContain('export const requireCreateInvitesAuth = internalQuery');
		// Both create and resend call the same gate.
		const create = svelte.slice(
			svelte.indexOf('export const create = action'),
			svelte.indexOf('export const create = action') + 2000
		);
		expect(create).toContain('runQuery(requireCreateInvitesAuthRef');
		const resend = svelte.slice(
			svelte.indexOf('export const resend = action'),
			svelte.indexOf('export const resend = action') + 2000
		);
		expect(resend).toContain('runQuery(requireCreateInvitesAuthRef');
	});

	it('legislation.rescoreBills has explicit editor gate before vector-search loop', () => {
		const svelte = source('convex/legislation.ts');
		expect(svelte).toContain('export const requireRescoreBillsAuth = internalQuery');
		const action = svelte.slice(
			svelte.indexOf('export const rescoreBills = action'),
			svelte.indexOf('export const rescoreBills = action') + 2000
		);
		expect(action).toContain('runQuery(requireRescoreBillsAuthRef');
		const gatePos = action.indexOf('runQuery(requireRescoreBillsAuthRef');
		const loopPos = action.indexOf('for (const billId of billIds)');
		expect(gatePos).toBeGreaterThan(0);
		expect(loopPos).toBeGreaterThan(gatePos);
	});

	it('debates.spawnDebate rate-limits per user', () => {
		const svelte = source('convex/debates.ts');
		const action = svelte.slice(
			svelte.indexOf('export const spawnDebate = action'),
			svelte.indexOf('export const spawnDebate = action') + 3000
		);
		expect(action).toContain('rateLimitCheckRef');
		expect(action).toMatch(/debates\.spawnDebate:\$\{identity\.subject\}/);
		// 5 per hour is the documented cap
		expect(action).toContain('maxRequests: 5');
		expect(action).toContain('windowMs: 60 * 60 * 1000');
	});
});
