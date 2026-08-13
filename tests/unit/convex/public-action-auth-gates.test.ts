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
 *   - supporters.importWithEncryption: amplify batch HMAC and
 *     key-unseal per call by a non-member
 *   - invites.create / invites.resend: 20-token generation and hashing
 *     by a non-member
 *   - legislation.rescoreBills: vector-search fanout by any caller
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
	it('submissions.create rejects direct Convex callers before reading auth or scheduling delivery', () => {
		const submissions = source('convex/submissions.ts');
		const start = submissions.indexOf('export const create = action');
		expect(start).toBeGreaterThan(-1);
		const end = submissions.indexOf('\nexport const ', start + 1);
		const action = submissions.slice(start, end === -1 ? undefined : end);
		expect(action).toMatch(/args:\s*\{[\s\S]*?_secret:\s*v\.string\(\)/u);
		const secretGate = action.indexOf('requireInternalSecret(args._secret)');
		const identityRead = action.indexOf('ctx.auth.getUserIdentity()');
		const insert = action.indexOf('internal.submissions.insertSubmission');
		const schedule = action.indexOf('ctx.scheduler.runAfter');
		expect(secretGate).toBeGreaterThan(0);
		expect(identityRead).toBeGreaterThan(secretGate);
		expect(insert).toBeGreaterThan(identityRead);
		expect(schedule).toBeGreaterThan(insert);

		const route = source('src/routes/api/submissions/create/+server.ts');
		expect(route).toContain('readBoundedJsonRequest(request, 256 * 1024');
		expect(route).toMatch(/serverAction\(api\.submissions\.create,\s*\{\s*_secret:\s*getInternalSecret\(\)/u);
	});

	it('templates.search rejects direct callers before bounded keyword-index work', () => {
		const templates = source('convex/templates.ts');
		const start = templates.indexOf('export const search = action');
		expect(start).toBeGreaterThan(-1);
		const end = templates.indexOf('\nexport const ', start + 1);
		const action = templates.slice(start, end === -1 ? undefined : end);
		const secretGate = action.indexOf('requireInternalSecret(args._secret)');
		const readiness = action.indexOf('ctx.runQuery(publicDiscoverySearchReadinessRef');
		const rateLimit = action.indexOf('ctx.runMutation(rateLimitCheckRef');
		const textSearch = action.indexOf('ctx.runQuery(textSearchRef');
		expect(secretGate).toBeGreaterThan(0);
		expect(readiness).toBeGreaterThan(secretGate);
		expect(rateLimit).toBeGreaterThan(readiness);
		expect(textSearch).toBeGreaterThan(rateLimit);
		expect(action).toContain('`templates.search:burst:${args.actorKey}`');
		expect(action).toContain("method: 'keyword' as const");
		expect(action).not.toContain('GEMINI_API_KEY');
		expect(action).not.toContain('generativelanguage.googleapis.com');
		expect(action).not.toContain('vectorSearch');
		expect(action).not.toContain('templates.search:semantic');
		expect(action).not.toContain('args.query.slice');

		const route = source('src/routes/api/templates/search/+server.ts');
		expect(route).toContain('if (!locals.user)');
		expect(route).toContain('const internalSecret = getInternalSecret()');
		expect(route).toContain('_secret: internalSecret');
		expect(route.indexOf('if (!locals.user)')).toBeLessThan(
			route.indexOf('const internalSecret = getInternalSecret()')
		);
		expect(route).not.toContain('enforceLLMRateLimit');
		expect(route).not.toContain("'template-search'");
		expect(route).toContain("from '$lib/server/convex-work-budget'");
		expect(route).toContain('actorKey: locals.user.id');
	});

	it('segments bulk actions are server-secret gated before role checks and key work', () => {
		const svelte = source('convex/segments.ts');
		expect(svelte).toContain('export const requireExportAuth = internalQuery');
		expect(svelte).toMatch(/requireOrgRole\(ctx,\s*slug,\s*['"]editor['"]\)/);
		for (const name of [
			'countMatching',
			'bulkApplyTag',
			'bulkRemoveTag',
			'exportDecrypted'
		]) {
			const start = svelte.indexOf(`export const ${name} = action`);
			expect(start).toBeGreaterThan(-1);
			const end = svelte.indexOf('\nexport const ', start + 1);
			const action = svelte.slice(start, end === -1 ? undefined : end);
			const secret = action.indexOf('requireInternalSecret(');
			const firstCtx = action.search(/ctx\.(?:runQuery|runMutation|runAction|auth|vectorSearch)/u);
			expect(action).toMatch(/_secret:\s*v\.string\(\)/u);
			expect(secret).toBeGreaterThan(0);
			expect(firstCtx).toBeGreaterThan(secret);
		}
		expect(svelte).toContain('const SEGMENT_MAX_PAGES_PER_INVOCATION = 4');
		expect(svelte).toContain('export const exportMatching = internalAction');
		expect(svelte).not.toContain('export const exportMatching = action');

		const decryptedStart = svelte.indexOf('export const exportDecrypted = action');
		const decryptedEnd = svelte.indexOf('\nexport const ', decryptedStart + 1);
		const decrypted = svelte.slice(decryptedStart, decryptedEnd === -1 ? undefined : decryptedEnd);
		const roleGate = decrypted.indexOf('runQuery(requireExportAuthRef');
		const unseal = decrypted.indexOf('getOrgKeyForAction');
		expect(roleGate).toBeGreaterThan(decrypted.indexOf('requireInternalSecret('));
		expect(unseal).toBeGreaterThan(roleGate);

		const route = source('src/routes/api/org/[slug]/segments/+server.ts');
		expect(route.match(/_secret:\s*getInternalSecret\(\)/gu)).toHaveLength(4);
		expect(route).toContain('api.segments.exportDecrypted');
		expect(route).not.toContain('api.segments.exportMatching');
	});

	it('supporters.importWithEncryption is server-only and its write mutation is internal', () => {
		const svelte = source('convex/supporters.ts');
		expect(svelte).toContain('export const requireImportAuth = internalQuery');
		expect(svelte).toContain('export const importBatch = internalMutation');
		expect(svelte).not.toContain('export const importBatch = mutation');
		expect(svelte).toContain('const SUPPORTER_IMPORT_WRITE_BATCH = 24');
		// Slice the whole action body (bounded by the next top-level
		// export) rather than a fixed char window: the handler's
		// action-boundary length-cap block precedes the gate and grows
		// with the supporter schema.
		const start = svelte.indexOf('export const importWithEncryption = action');
		expect(start).toBeGreaterThan(-1);
		const end = svelte.indexOf('\nexport const ', start + 1);
		const action = svelte.slice(start, end === -1 ? undefined : end);
		expect(action).toContain('runQuery(requireImportAuthRef');
		const secretPos = action.indexOf('requireInternalSecret(args._secret)');
		const gatePos = action.indexOf('runQuery(requireImportAuthRef');
		const hmacPos = action.indexOf('computeOrgScopedEmailHash');
		const unsealPos = action.indexOf('getOrgKeyForAction');
		expect(secretPos).toBeGreaterThan(0);
		expect(gatePos).toBeGreaterThan(secretPos);
		expect(gatePos).toBeGreaterThan(0);
		expect(hmacPos).toBeGreaterThan(gatePos);
		expect(unsealPos).toBeGreaterThan(gatePos);
		expect(action).toContain("if (args.supporters.length > 100) throw new Error('SUPPORTERS_TOO_MANY')");
		for (const routePath of [
			'src/routes/org/[slug]/supporters/import/+page.server.ts',
			'src/routes/org/[slug]/supporters/import/platform-api/+page.server.ts'
		]) {
			const route = source(routePath);
			expect(route).toMatch(/api\.supporters\.importWithEncryption[\s\S]{0,120}?_secret:\s*getInternalSecret\(\)/u);
		}
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

	it('legislation.rescoreBills is server-only and deduplicates before vector-search fanout', () => {
		const svelte = source('convex/legislation.ts');
		expect(svelte).toContain('export const requireRescoreBillsAuth = internalQuery');
		const action = svelte.slice(
			svelte.indexOf('export const rescoreBills = action'),
			svelte.indexOf('export const rescoreBills = action') + 2000
		);
		expect(action).toContain('runQuery(requireRescoreBillsAuthRef');
		const secretPos = action.indexOf('requireInternalSecret(_secret)');
		const gatePos = action.indexOf('runQuery(requireRescoreBillsAuthRef');
		const orgScopePos = action.indexOf('const { orgId } =');
		const dedupePos = action.indexOf('const uniqueBillIds =');
		const loopPos = action.indexOf('for (const billId of uniqueBillIds)');
		expect(secretPos).toBeGreaterThan(0);
		expect(gatePos).toBeGreaterThan(secretPos);
		expect(orgScopePos).toBeGreaterThan(secretPos);
		expect(dedupePos).toBeGreaterThan(gatePos);
		expect(loopPos).toBeGreaterThan(gatePos);
		expect(loopPos).toBeGreaterThan(dedupePos);
		expect(action).toContain('if (billIds.length > 10)');
		expect(action).toContain('runAction(scoreBillRelevanceRef, { orgId, billId })');
		const scorer = svelte.slice(
			svelte.indexOf('export const scoreBillRelevance = internalAction'),
			svelte.indexOf('export const getBillInternal = internalQuery')
		);
		expect(scorer).toContain("filter: (q) => q.eq('orgId', orgId)");
		expect(scorer).toContain("throw new Error('LEGISLATION_RESCORE_DOMAIN_SCOPE_VIOLATION')");
		const route = source('src/routes/api/org/[slug]/issue-domains/rescore/+server.ts');
		expect(route).toMatch(/api\.legislation\.rescoreBills[\s\S]{0,120}?_secret:\s*getInternalSecret\(\)/u);
		expect(route).toContain('maxRequests: 1');
		expect(route).toContain('windowMs: 60 * 60 * 1000');
		expect(route).toContain('limit: 10');
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
