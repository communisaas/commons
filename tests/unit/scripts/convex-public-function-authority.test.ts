import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
	AUTHORITY_CLASSES,
	deriveAuthorityInventory,
	expectedManifest,
	scanBrowserDirectResiduals,
	scanServerSecretCallers,
	validateManifest
} from '../../../scripts/verify-convex-public-function-authority.mjs';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'convex-authority-'));

function fixture(name: string, source: string): string {
	const filePath = path.join(temporaryRoot, name);
	fs.writeFileSync(filePath, source);
	return filePath;
}

afterAll(() => {
	fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('Convex public-function authority ratchet', () => {
	it('classifies every real public runtime export exactly once', () => {
		const inventory = deriveAuthorityInventory();
		expect(inventory.errors).toEqual([]);
		expect(inventory.entries.length).toBeGreaterThan(400);
		expect(new Set(inventory.entries.map((entry) => entry.runtimeName)).size).toBe(
			inventory.entries.length
		);
		expect(new Set(inventory.entries.map((entry) => entry.authority))).toEqual(
			new Set(AUTHORITY_CLASSES.filter((authority) => authority !== 'explicitly-io-free'))
		);
		expect(scanServerSecretCallers(inventory.entries).errors).toEqual([]);
	});

	it('rejects secret and authenticated handlers that touch storage before authority', () => {
		const secretAfterRead = fixture(
			'secret-after-read.ts',
			`import { query } from './_generated/server';
			 import { v } from 'convex/values';
			 export const unsafe = query({
			   args: { _secret: v.string(), id: v.string() },
			   handler: async (ctx, args) => {
			     await ctx.db.get(args.id);
			     requireInternalSecret(args._secret);
			   }
			 });`
		);
		const roleAfterRead = fixture(
			'role-after-read.ts',
			`import { mutation } from './_generated/server';
			 import { requireAuth } from './_authHelpers';
			 export const unsafe = mutation({
			   args: {},
			   handler: async (ctx) => {
			     await ctx.db.query('organizations').first();
			     await requireAuth(ctx);
			   }
			 });`
		);

		expect(deriveAuthorityInventory([secretAfterRead]).errors.join('\n')).toMatch(
			/does not call requireInternalSecret as handler statement one/
		);
		expect(deriveAuthorityInventory([roleAfterRead]).errors.join('\n')).toMatch(
			/performs material\/unknown work before call:requireAuth/
		);
	});

	it('accepts a pre-I/O tombstone and detects stale manifest authority', () => {
		const retired = fixture(
			'retired.ts',
			`import { query } from './_generated/server';
			 import { v } from 'convex/values';
			 export const retired = query({
			   args: { _secret: v.string() },
			   handler: async () => { throw new Error('RETIRED'); }
			 });`
		);
		const inventory = deriveAuthorityInventory([retired]);
		expect(inventory.errors).toEqual([]);
		expect(inventory.entries[0]).toMatchObject({
			authority: 'pre-io-tombstone',
			guard: 'throw:first-statement'
		});

		const expected = expectedManifest(inventory.entries);
		const stale = structuredClone(expected);
		stale.entries[0].guard = 'reviewed-by-comment';
		expect(validateManifest(stale, expected)).toEqual([
			expect.stringContaining('authority, kind, source, guard, count, or ordering drifted')
		]);
	});

	it('rejects missing and untrusted server-secret caller arguments', () => {
		const entry: Parameters<typeof scanServerSecretCallers>[0][number] = {
			runtimeName: 'demo:read',
			source: 'convex/demo.ts',
			exportName: 'read',
			kind: 'query',
			authority: 'server-secret',
			guard: 'requireInternalSecret:first-statement'
		};
		const missing = fixture(
			'missing-caller.ts',
			`serverQuery(api.demo.read, { id: 'one' });`
		);
		const untrusted = fixture(
			'untrusted-caller.ts',
			`serverQuery(api.demo.read, { _secret: request.headers.get('x-secret') });`
		);
		const lookalike = fixture(
			'lookalike-secret-caller.ts',
			`import { getInternalSecret } from './lookalike-secret-auth';
			 serverQuery(api.demo.read, { _secret: getInternalSecret() });`
		);
		const trusted = fixture(
			'trusted-caller.ts',
			`import { getInternalSecret } from '$lib/server/internal/secret-auth';
			 const internalSecret = getInternalSecret();
			 serverQuery(api.demo.read, { _secret: internalSecret });`
		);

		expect(scanServerSecretCallers([entry], [missing]).errors.join('\n')).toMatch(
			/missing an explicit _secret/
		);
		expect(scanServerSecretCallers([entry], [untrusted]).errors.join('\n')).toMatch(
			/does not use the trusted server secret source/
		);
		expect(scanServerSecretCallers([entry], [lookalike]).errors.join('\n')).toMatch(
			/does not use the trusted server secret source/
		);
		expect(scanServerSecretCallers([entry], [trusted]).errors).toEqual([]);
	});

	it('rejects spoofed secret guards and secret values not derived from handler args', () => {
		const localSpoof = fixture(
			'local-secret-spoof.ts',
			`import { query } from './_generated/server';
			 import { v } from 'convex/values';
			 function requireInternalSecret(_secret: string) {}
			 export const unsafe = query({
			   args: { _secret: v.string() },
			   handler: async (ctx, args) => {
			     requireInternalSecret(args._secret);
			     await ctx.db.query('organizations').first();
			   }
			 });`
		);
		const literalSecret = fixture(
			'literal-secret.ts',
			`import { query } from './_generated/server';
			 import { requireInternalSecret } from './_internalAuth';
			 import { v } from 'convex/values';
			 export const unsafe = query({
			   args: { _secret: v.string() },
			   handler: async (ctx, args) => {
			     requireInternalSecret('trusted');
			     await ctx.db.query('organizations').first();
			   }
			 });`
		);

		for (const filePath of [localSpoof, literalSecret]) {
			expect(deriveAuthorityInventory([filePath]).errors.join('\n')).toMatch(
				/does not verify the exact handler args\._secret value/
			);
		}
	});

	it('rejects unawaited, local-spoofed, and conditionally fallthrough auth', () => {
		const unawaited = fixture(
			'unawaited-auth.ts',
			`import { mutation } from './_generated/server';
			 import { requireAuth } from './_authHelpers';
			 export const unsafe = mutation({
			   args: {},
			   handler: async (ctx) => {
			     requireAuth(ctx);
			     await ctx.db.query('organizations').first();
			   }
			 });`
		);
		const localSpoof = fixture(
			'local-auth-spoof.ts',
			`import { mutation } from './_generated/server';
			 async function requireOrgRole() { return { org: {} }; }
			 export const unsafe = mutation({
			   args: {},
			   handler: async (ctx) => {
			     await requireOrgRole();
			     await ctx.db.query('organizations').first();
			   }
			 });`
		);
		const conditionalFallthrough = fixture(
			'conditional-auth-fallthrough.ts',
			`import { query } from './_generated/server';
			 export const unsafe = query({
			   args: {},
			   handler: async (ctx, args) => {
			     const identity = await ctx.auth.getUserIdentity();
			     if (!identity) { if (args.debug) throw new Error('UNAUTHORIZED'); }
			     return await ctx.db.query('organizations').first();
			   }
			 });`
		);

		for (const filePath of [unawaited, localSpoof, conditionalFallthrough]) {
			expect(deriveAuthorityInventory([filePath]).errors.join('\n')).toMatch(/unclassified/);
		}
	});

	it('rejects all unknown arg-derived helper work before role authority', () => {
		const helperBeforeRole = fixture(
			'helper-before-role.ts',
			`import { mutation } from './_generated/server';
			 import { requireOrgRole } from './_authHelpers';
			 import { normalizeCampaignInput } from './campaign-input';
			 export const unsafe = mutation({
			   args: {},
			   handler: async (ctx, args) => {
			     const normalized = normalizeCampaignInput(args);
			     await requireOrgRole(ctx, normalized.slug, 'admin');
			     return await ctx.db.query('campaigns').first();
			   }
			 });`
		);

		expect(deriveAuthorityInventory([helperBeforeRole]).errors.join('\n')).toMatch(
			/performs material\/unknown work before call:requireOrgRole/
		);
	});

	it('rejects aliased factories, dynamic factory aliases, and registered re-exports', () => {
		const defaultImport = fixture(
			'default-factory.ts',
			`import server from './_generated/server';
			 export const unsafe = server.query({ args: {}, handler: async () => null });`
		);
		const namespaceImport = fixture(
			'namespace-factory.ts',
			`import * as server from './_generated/server';
			 export const unsafe = server.query({ args: {}, handler: async () => null });`
		);
		const aliasedImport = fixture(
			'aliased-factory.ts',
			`import { query as publicQuery } from './_generated/server';
			 export const unsafe = publicQuery({ args: {}, handler: async () => null });`
		);
		const dynamicAlias = fixture(
			'dynamic-factory.ts',
			`import { query } from './_generated/server';
			 const publicQuery = query;
			 export const unsafe = publicQuery({ args: {}, handler: async () => null });`
		);
		fixture(
			'registered-source.ts',
			`import { query } from './_generated/server';
			 export const unsafe = query({ args: {}, handler: async () => null });`
		);
		const namedReexport = fixture(
			'registered-reexport.ts',
			`export { unsafe } from './registered-source';`
		);
		const starReexport = fixture(
			'registered-star-reexport.ts',
			`export * from './registered-source';`
		);

		expect(deriveAuthorityInventory([defaultImport]).errors.join('\n')).toMatch(
			/forbids a default generated-server import/
		);
		expect(deriveAuthorityInventory([namespaceImport]).errors.join('\n')).toMatch(
			/forbids a namespace generated-server import/
		);
		expect(deriveAuthorityInventory([aliasedImport]).errors.join('\n')).toMatch(
			/forbids aliased generated-server factory import/
		);
		expect(deriveAuthorityInventory([dynamicAlias]).errors.join('\n')).toMatch(
			/forbids dynamic factory alias/
		);
		expect(deriveAuthorityInventory([namedReexport]).errors.join('\n')).toMatch(
			/forbids re-exported registered function unsafe/
		);
		expect(deriveAuthorityInventory([starReexport]).errors.join('\n')).toMatch(
			/forbids star re-exports of registered functions/
		);
	});

	it('rejects dynamic and aliased Convex references in browser and server callers', () => {
		const browser = fixture(
			'dynamic-browser.svelte',
			`<script lang="ts">
			 const client = getConvexClient();
			 const alias = client;
			 const operation = api.demo.read;
			 client.query(operation, {});
			 alias.query(api.demo.read, {});
			 </script>`
		);
		const server = fixture(
			'dynamic-server.ts',
			`import { serverQuery } from '$lib/server/convex-work-budget';
			 const alias = serverQuery;
			 const operation = api.demo.read;
			 alias(operation, {});
			 serverQuery(operation, {});`
		);
		const entry: Parameters<typeof scanServerSecretCallers>[0][number] = {
			runtimeName: 'demo:read',
			source: 'convex/demo.ts',
			exportName: 'read',
			kind: 'query',
			authority: 'authenticated-role',
			guard: 'call:requireAuth'
		};

		const browserErrors = scanBrowserDirectResiduals([entry], [browser]).errors.join('\n');
		expect(browserErrors).toMatch(/forbids browser Convex client alias alias/);
		expect(browserErrors).toMatch(/forbids a dynamic browser Convex function reference/);
		const serverErrors = scanServerSecretCallers([entry], [server]).errors.join('\n');
		expect(serverErrors).toMatch(/forbids dynamic server Convex helper alias alias/);
		expect(serverErrors).toMatch(/forbids a dynamic server Convex function reference/);
	});

	it('rejects spoofed or ignored HMAC proof helpers', () => {
		const ignoredProof = fixture(
			'ignored-proof.ts',
			`import { action } from './_generated/server';
			 async function verifyServerProof() { return true; }
			 export const unsafe = action({
			   args: {},
			   handler: async (ctx, args) => {
			     verifyServerProof(args.proof);
			     return await ctx.runQuery(args.ref, {});
			   }
			 });`
		);

		expect(deriveAuthorityInventory([ignoredProof]).errors.join('\n')).toMatch(
			/verifyServerProof is not the awaited reviewed passkey proof gate/
		);
	});

	it('detects both missing and stale manifest exports', () => {
		const retired = fixture(
			'manifest-retired.ts',
			`import { query } from './_generated/server';
			 export const retired = query({ args: {}, handler: async () => { throw new Error('RETIRED'); } });`
		);
		const expected = expectedManifest(deriveAuthorityInventory([retired]).entries);
		const missing = structuredClone(expected);
		missing.entries = [];
		const stale = structuredClone(expected);
		const existing = stale.entries[0];
		if (!existing) throw new Error('Expected one manifest fixture entry');
		stale.entries.push({ ...existing, runtimeName: 'stale:removedExport' });

		expect(validateManifest(missing, expected).join('\n')).toMatch(
			/Manifest is missing public export .*manifest-retired:retired\./
		);
		expect(validateManifest(stale, expected)).toContain(
			'Manifest contains stale public export stale:removedExport.'
		);
	});
});
