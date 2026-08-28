import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	parseRuntimeNeutralClientRealmArgs,
	verifyRuntimeNeutralClientRealm
} from '../../../scripts/verify-runtime-neutral-client-realm.mjs';

const productionOrigin = 'https://quirky-chinchilla-352.convex.cloud';
const roots: string[] = [];

function artifact(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'commons-client-realm-'));
	roots.push(root);
	for (const [path, contents] of Object.entries(files)) {
		const destination = join(root, path);
		mkdirSync(join(destination, '..'), { recursive: true });
		writeFileSync(destination, contents);
	}
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runtime-neutral Pages client realm', () => {
	it('allows the server allowlist while keeping browser files runtime-neutral', () => {
		const pagesDirectory = artifact({
			'_worker.js': `const approved = '${productionOrigin}';`,
			'_app/immutable/entry/start.js': 'const runtime = globalThis.__sveltekit.env;',
			'favicon.png': 'not-really-a-png'
		});
		expect(verifyRuntimeNeutralClientRealm({ pagesDirectory, forbiddenOrigin: productionOrigin })).toMatchObject({
			scannedFiles: 2,
			browserJavaScriptFiles: 1
		});
	});

	it.each([
		['_app/immutable/chunks/layout.js', 'browser chunk'],
		['index.html', 'prerendered HTML'],
		['service-worker.js', 'service worker']
	])('rejects the production realm in %s (%s)', (leakedPath) => {
		const pagesDirectory = artifact({
			'_app/immutable/entry/start.js': 'const runtime = globalThis.__sveltekit.env;',
			[leakedPath]: productionOrigin
		});
		expect(() =>
			verifyRuntimeNeutralClientRealm({ pagesDirectory, forbiddenOrigin: productionOrigin })
		).toThrow(new RegExp(leakedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	});

	it('fails closed when no browser JavaScript exists', () => {
		const pagesDirectory = artifact({ 'index.html': '<html></html>' });
		expect(() =>
			verifyRuntimeNeutralClientRealm({ pagesDirectory, forbiddenOrigin: productionOrigin })
		).toThrow(/no browser JavaScript/i);
	});

	it('parses only the exact CLI contract', () => {
		expect(
			parseRuntimeNeutralClientRealmArgs([
				'--pages-directory',
				'/artifact',
				'--forbidden-origin',
				productionOrigin
			])
		).toEqual({ pagesDirectory: '/artifact', forbiddenOrigin: productionOrigin });
		expect(() =>
			parseRuntimeNeutralClientRealmArgs(['--pages-directory', '/artifact'])
		).toThrow(/both/i);
	});
});
