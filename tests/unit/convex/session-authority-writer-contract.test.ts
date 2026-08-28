import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authOps = readFileSync('convex/authOps.ts', 'utf8');
const users = readFileSync('convex/users.ts', 'utf8');
const seed = readFileSync('convex/seed.ts', 'utf8');
const hooks = readFileSync('src/hooks.server.ts', 'utf8');
const migration = readFileSync('convex/sessionAuthority.ts', 'utf8');
const projection = readFileSync('convex/lib/sessionAuthority.ts', 'utf8');

function exportedFunction(source: string, name: string, nextName?: string): string {
	const start = source.indexOf(`export const ${name} =`);
	if (start < 0) throw new Error(`missing exported function ${name}`);
	const end = nextName ? source.indexOf(`export const ${nextName} =`, start + 1) : source.length;
	if (nextName && end < 0) throw new Error(`missing boundary function ${nextName}`);
	return source.slice(start, end);
}

describe('session authority writer contract', () => {
	it('keeps every projected OAuth identity write in the same mutation as its authority sync', () => {
		const upsert = exportedFunction(authOps, 'upsertFromOAuth', 'createSession');
		expect(upsert.match(/syncSessionAuthority\(ctx,/g)).toHaveLength(3);
		expect(exportedFunction(authOps, 'backfillTokenIdentifier', 'renewSession')).toContain(
			'await syncSessionAuthority(ctx, user._id)'
		);
	});

	it.each([
		['connectWallet', 'disconnectWallet'],
		['disconnectWallet', 'getNearAccountId'],
		['storePasskey', 'clearPasskey'],
		['clearPasskey', 'updateMdlVerification'],
		['updateMdlVerification', 'finalizeMdlVerification'],
		['finalizeMdlVerification', 'verifyAddress'],
		['verifyAddress', 'getReverificationBudget'],
		['bindIdentityCommitment', 'getCredentialForRevocation']
	])('%s updates its compact authority transactionally', (name, nextName) => {
		expect(exportedFunction(users, name, nextName)).toContain('await syncSessionAuthority(ctx,');
	});

	it('dual-writes user creation and repairs pre-existing seed/dev identities', () => {
		expect(exportedFunction(seed, 'insertUsers', 'insertCredentials')).toContain(
			'await syncSessionAuthority(ctx, id)'
		);
		expect(exportedFunction(seed, 'grantDevAccount', 'grantDev')).toContain(
			'await syncSessionAuthority(ctx, devUser._id)'
		);
	});

	it('keeps unrelated profile and reputation churn outside the authority projection', () => {
		expect(exportedFunction(users, 'updateProfile', 'getWalletStatus')).not.toContain(
			'syncSessionAuthority'
		);
		expect(exportedFunction(users, 'recomputeAllReputationTiers')).not.toContain(
			'syncSessionAuthority'
		);
	});

	it('defers a user it cannot project yet instead of blocking the whole plane', () => {
		// A row with no plaintext email is self-healing, not corrupt: `authOps`
		// patches email/emailHash/custodyMode at the next sign-in. Blocking the
		// plane on one stopped production at 17/20 for a client-custody account
		// and three stale seed rows, none of which had a session to authorize.
		const run = exportedFunction(migration, 'migrateSessionAuthorities', 'activateSessionAuthorities');
		expect(run).toMatch(/if \(!user\.email \|\| user\.email\.trim\(\)\.length === 0\) \{\s*\n\s*deferredInPage \+= 1;\s*\n\s*continue;/);
		// Deferral must not become a way to skip a REAL corruption: every other
		// projection error still blocks.
		expect(run).toContain("status: 'blocked'");
		// And exactness still has to balance — a deferred row is counted, not lost.
		expect(run).toContain('written += page.page.length - deferredInPage;');
		expect(run).toContain('deferred += deferredInPage;');
	});

	it('keeps the empty-email refusal in the projection itself', () => {
		// The deferral above is the MIGRATION's tolerance. The projection must
		// keep refusing, because that refusal is the anti-sybil invariant.
		expect(projection).toContain("requiredBoundedString('email', user.email, 320)");
		const activate = exportedFunction(migration, 'activateSessionAuthorities');
		expect(activate).toContain('migration.scanned !== migration.written + (migration.deferred ?? 0)');
	});

	it('routes the request boundary through the compact query and an explicit request clock', () => {
		expect(hooks).toContain('serverQuery(api.sessionAuthority.get');
		expect(hooks).toContain('const requestNow = Date.now()');
		expect(hooks).toContain('querySessionAuthorityFromCookie({');
		expect(hooks).toContain('evaluateSessionWindow(session, requestNow)');
		expect(hooks).toContain('_secret: getInternalSecret()');
		expect(hooks).toContain('renewTo: renewTo ?? undefined');
		expect(hooks).not.toContain('serverQuery(api.authOps.validateSession');
	});
});
