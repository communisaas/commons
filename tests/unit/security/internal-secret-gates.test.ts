import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-text pins for the seven Convex public functions newly gated by
 * `requireInternalSecret(args._secret)` plus the SvelteKit callers that
 * pass `_secret: getInternalSecret()`. Pure source reads — no Convex
 * runtime, no mocks. The point is to lock the gates against regression:
 * if any of the assertions below fails, an anonymous public caller may
 * have regained access to a trust-bypass surface.
 *
 * SCOPE: this file pins the 7 functions newly gated in cycles 10-11
 * (2026-05-14..16). The earlier F-157 cure (commit 8e5ff3d0) converted
 * many additional internal-to-public-with-_secret functions across
 * convex/{resolvedContacts, revocations, submissions, subscriptions,
 * v1api}.ts; those are NOT pinned here — they predate this work and are
 * protected by the F-157 commit history. Trigger to extend coverage:
 * the next time we audit the trust boundary or add a new gated function.
 *
 * Reference counts as of 2026-05-16:
 *   - `requireInternalSecret(args._secret)` exact pattern: 20 call sites
 *   - `requireInternalSecret(` total (including v1api's per-arg shape
 *     where some files call the gate from helpers or repeat per
 *     endpoint): ~61 call sites; 40 in v1api.ts alone.
 * The pinned 7 are the ones added by cycles 10-11; the surface is wider.
 */
function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/**
 * Extract the body of a handler block for a given `export const NAME =`
 * declaration up to the first ctx.* call. Asserts that
 * `requireInternalSecret` appears in that window — i.e., it is the FIRST
 * guard before any DB / scheduler / runQuery / runMutation work.
 */
function assertFirstGuard(src: string, exportName: string): void {
	const exportIdx = src.indexOf(`export const ${exportName} =`);
	expect(exportIdx, `export const ${exportName} = ... must exist`).toBeGreaterThanOrEqual(0);
	const tail = src.slice(exportIdx);
	// Full Convex ctx surface: db, scheduler, runQuery, runMutation, runAction,
	// auth (ctx.auth.getUserIdentity), storage (ctx.storage.*), vectorSearch
	// (on action ctx). Plus the `authOpsDb(ctx)` wrapper used in convex/
	// authOps.ts (it returns ctx.db cast to a typed alias). A gate that runs
	// after ctx.auth.getUserIdentity() is still a post-trust-touch regression
	// even if no row has been read yet — auth identity carries trust signal.
	const ctxMatch = tail.match(
		/(ctx\.(db|scheduler|runQuery|runMutation|runAction|auth|storage|vectorSearch)|authOpsDb\(ctx\))/
	);
	expect(
		ctxMatch,
		`${exportName} must touch ctx.{db|scheduler|runQuery|runMutation|runAction|auth|storage|vectorSearch} or authOpsDb(ctx)`
	).toBeTruthy();
	const window = tail.slice(0, ctxMatch!.index!);
	expect(
		window.includes('requireInternalSecret('),
		`${exportName}: requireInternalSecret must be called BEFORE the first ctx.* call`
	).toBe(true);
}

describe('convex/authOps.ts — upsertFromOAuth', () => {
	const src = source('convex/authOps.ts');
	it('handler calls requireInternalSecret(args._secret)', () => {
		expect(src).toContain('export const upsertFromOAuth = mutation');
		expect(src).toContain('requireInternalSecret(args._secret)');
	});
	it('args schema declares _secret: v.string()', () => {
		expect(src).toMatch(/upsertFromOAuth\s*=\s*mutation\(\{[\s\S]*?_secret:\s*v\.string\(\)/);
	});
	it('requireInternalSecret runs before first ctx.* call', () => {
		assertFirstGuard(src, 'upsertFromOAuth');
	});
});

describe('convex/users.ts — verifyAddress', () => {
	const src = source('convex/users.ts');
	it('handler calls requireInternalSecret(args._secret)', () => {
		expect(src).toContain('export const verifyAddress = mutation');
		expect(src).toContain('requireInternalSecret(args._secret)');
	});
	it('args schema declares _secret: v.string()', () => {
		expect(src).toMatch(/verifyAddress\s*=\s*mutation\(\{[\s\S]*?_secret:\s*v\.string\(\)/);
	});
	it('requireInternalSecret runs before first ctx.* call', () => {
		assertFirstGuard(src, 'verifyAddress');
	});
});

describe('convex/supporters.ts — getEmailStatus + unsubscribe', () => {
	const src = source('convex/supporters.ts');

	it('getEmailStatus handler calls requireInternalSecret(_secret)', () => {
		expect(src).toContain('export const getEmailStatus = query');
		expect(src).toMatch(/getEmailStatus\s*=\s*query\(\{[\s\S]*?_secret:\s*v\.string\(\)/);
		// Destructured form: requireInternalSecret(_secret)
		expect(src).toMatch(/getEmailStatus\s*=\s*query\(\{[\s\S]*?requireInternalSecret\(_secret\)/);
	});

	it('unsubscribe handler calls requireInternalSecret(_secret)', () => {
		expect(src).toContain('export const unsubscribe = mutation');
		expect(src).toMatch(/unsubscribe\s*=\s*mutation\(\{[\s\S]*?_secret:\s*v\.string\(\)/);
		expect(src).toMatch(/unsubscribe\s*=\s*mutation\(\{[\s\S]*?requireInternalSecret\(_secret\)/);
	});

	it('both gates run before first ctx.* call', () => {
		assertFirstGuard(src, 'getEmailStatus');
		assertFirstGuard(src, 'unsubscribe');
	});
});

describe('convex/email.ts — findUnresolvedReport + createBounceReport + applyUnsubscribeByBlastEmail', () => {
	const src = source('convex/email.ts');

	it('findUnresolvedReport handler calls requireInternalSecret(_secret)', () => {
		expect(src).toContain('export const findUnresolvedReport = query');
		expect(src).toMatch(/findUnresolvedReport\s*=\s*query\(\{[\s\S]*?_secret:\s*v\.string\(\)/);
		expect(src).toMatch(/findUnresolvedReport\s*=\s*query\(\{[\s\S]*?requireInternalSecret\(_secret\)/);
	});

	it('createBounceReport handler calls requireInternalSecret(_secret)', () => {
		expect(src).toContain('export const createBounceReport = mutation');
		expect(src).toMatch(/createBounceReport\s*=\s*mutation\(\{[\s\S]*?_secret:\s*v\.string\(\)/);
		expect(src).toMatch(/createBounceReport\s*=\s*mutation\(\{[\s\S]*?requireInternalSecret\(_secret\)/);
	});

	it('applyUnsubscribeByBlastEmail handler calls requireInternalSecret(args._secret)', () => {
		expect(src).toContain('export const applyUnsubscribeByBlastEmail = mutation');
		expect(src).toMatch(/applyUnsubscribeByBlastEmail\s*=\s*mutation\(\{[\s\S]*?_secret:\s*v\.string\(\)/);
		expect(src).toMatch(/applyUnsubscribeByBlastEmail\s*=\s*mutation\(\{[\s\S]*?requireInternalSecret\(args\._secret\)/);
	});

	it('all three gates run before first ctx.* call', () => {
		assertFirstGuard(src, 'findUnresolvedReport');
		assertFirstGuard(src, 'createBounceReport');
		assertFirstGuard(src, 'applyUnsubscribeByBlastEmail');
	});
});

describe('SvelteKit callers pass getInternalSecret()', () => {
	it('oauth-callback-handler.ts wires _secret on upsertFromOAuth', () => {
		const src = source('src/lib/core/auth/oauth-callback-handler.ts');
		expect(src).toContain("import { getInternalSecret } from '$lib/server/internal/secret-auth'");
		expect(src).toContain('api.authOps.upsertFromOAuth');
		expect(src).toMatch(/api\.authOps\.upsertFromOAuth[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
	});

	it('ground-service.ts wires _secret on verifyAddress', () => {
		const src = source('src/lib/server/ground/ground-service.ts');
		expect(src).toContain("import { getInternalSecret } from '$lib/server/internal/secret-auth'");
		expect(src).toContain('api.users.verifyAddress');
		expect(src).toMatch(/api\.users\.verifyAddress[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
	});

	it('report-bounce/+server.ts wires _secret on findUnresolvedReport + createBounceReport', () => {
		const src = source('src/routes/api/emails/report-bounce/+server.ts');
		expect(src).toContain("import { getInternalSecret } from '$lib/server/internal/secret-auth'");
		expect(src).toContain('api.email.findUnresolvedReport');
		expect(src).toContain('api.email.createBounceReport');
		expect(src).toMatch(/api\.email\.findUnresolvedReport[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
		expect(src).toMatch(/api\.email\.createBounceReport[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
	});

	it('dev-login/+server.ts wires _secret on upsertFromOAuth', () => {
		const src = source('src/routes/api/internal/dev-login/+server.ts');
		expect(src).toContain("import { getInternalSecret } from '$lib/server/internal/secret-auth'");
		expect(src).toContain('api.authOps.upsertFromOAuth');
		expect(src).toMatch(/api\.authOps\.upsertFromOAuth[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
	});

	it('unsubscribe/+page.server.ts wires _secret on applyUnsubscribeByBlastEmail', () => {
		const src = source('src/routes/unsubscribe/+page.server.ts');
		expect(src).toContain("import { getInternalSecret } from '$lib/server/internal/secret-auth'");
		expect(src).toContain('api.email.applyUnsubscribeByBlastEmail');
		expect(src).toMatch(/api\.email\.applyUnsubscribeByBlastEmail[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
	});

	it('unsubscribe/[supporterId]/[orgId]/[token]/+page.server.ts wires _secret on getEmailStatus + unsubscribe', () => {
		const src = source('src/routes/unsubscribe/[supporterId]/[orgId]/[token]/+page.server.ts');
		expect(src).toContain("import { getInternalSecret } from '$lib/server/internal/secret-auth'");
		expect(src).toContain('api.supporters.getEmailStatus');
		expect(src).toContain('api.supporters.unsubscribe');
		expect(src).toMatch(/api\.supporters\.getEmailStatus[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
		expect(src).toMatch(/api\.supporters\.unsubscribe[\s\S]{0,200}?_secret:\s*getInternalSecret\(\)/);
	});
});
