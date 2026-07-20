import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const authOps = readFileSync('convex/authOps.ts', 'utf8');
const users = readFileSync('convex/users.ts', 'utf8');
const seed = readFileSync('convex/seed.ts', 'utf8');
const hooks = readFileSync('src/hooks.server.ts', 'utf8');

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
		['bindIdentityCommitment', 'upsertRegistration']
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
