import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('mDL verification finalization', () => {
	it('stores a short-lived credential-hash reuse ledger', () => {
		const schema = source('convex/schema.ts');

		expect(schema).toContain('mdlCredentialUses: defineTable');
		expect(schema).toContain('credentialHash: v.string()');
		expect(schema).toMatch(/\.index\(["']by_credentialHash["'], \[["']credentialHash["']\]\)/);
		expect(schema).toMatch(/\.index\(["']by_expiresAt["'], \[["']expiresAt["']\]\)/);
	});

	it('keeps mDL commitment binding and tier mutation behind an internal Convex finalizer', () => {
		const convexUsers = source('convex/users.ts');

		expect(convexUsers).toContain('export const finalizeMdlVerification = internalMutation');
		expect(convexUsers).toContain('export const updateMdlVerification = internalMutation');
		expect(convexUsers).not.toContain('export const updateMdlVerification = mutation');
		expect(convexUsers).toContain('identityCommitment: args.identityCommitment');
		expect(convexUsers).toMatch(/query\(["']mdlCredentialUses["']\)/);
		expect(convexUsers).toMatch(/withIndex\(["']by_credentialHash["']/);
		expect(convexUsers).toContain('MDL_CREDENTIAL_HASH_REUSED');
		expect(convexUsers).toMatch(/ctx\.db\.insert\(["']mdlCredentialUses["']/);
		expect(convexUsers).toMatch(/verificationMethod: ["']mdl["']/);
		expect(convexUsers).toContain('patch.trustTier = 5');
		expect(convexUsers).toContain('requireReauth: linkedToExisting');
	});

	it('uses the internal finalizer from same-device and bridge verification routes', () => {
		for (const path of [
			'src/routes/api/identity/verify-mdl/verify/+server.ts',
			'src/routes/api/identity/bridge/complete/+server.ts'
		]) {
			const route = source(path);

			expect(route).toContain("import { internal } from '$lib/convex'");
			expect(route).toContain('serverMutation(internal.users.finalizeMdlVerification');
			expect(route).toContain('credentialHash: result.credentialHash');
			expect(route).toContain("error: 'credential_reuse_detected'");
			expect(route).not.toContain('api.users.bindIdentityCommitment');
			expect(route).not.toContain('api.users.updateMdlVerification');
		}
	});
});
