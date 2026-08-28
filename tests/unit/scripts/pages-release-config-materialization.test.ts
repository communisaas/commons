import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { materializePublicTemplateOgReleaseTransactionConfig } from '../../../scripts/run-public-template-og-release-phase.mjs';

const roots: string[] = [];

function fixture(extra = ''): string {
	const root = mkdtempSync(join(tmpdir(), 'commons-pages-config-'));
	roots.push(root);
	writeFileSync(
		join(root, 'wrangler.toml'),
		`name = "communique-site"\n[vars]\nPUBLIC_CONVEX_URL = "https://prod.convex.cloud"\n[env.preview.vars]\nPUBLIC_CONVEX_URL = "https://preview.convex.cloud"\n${extra}`
	);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('trusted Pages release config materialization', () => {
	it('injects one transaction coordinate into production and inert preview vars', () => {
		const root = fixture();
		materializePublicTemplateOgReleaseTransactionConfig(root, '123456789-2');
		const source = readFileSync(join(root, 'wrangler.toml'), 'utf8');

		expect(source.match(/PUBLIC_RELEASE_TRANSACTION_ID = "123456789-2"/g)).toHaveLength(2);
		expect(source).not.toMatch(/^\[{1,2}env\.preview\.(?!vars\]).+$/mu);
	});

	it.each([
		'[[env.preview.durable_objects.bindings]]\nname = "CONVEX_WORK_BUDGET"\n',
		'[[env.preview.kv_namespaces]]\nbinding = "SESSION"\n',
		'[env.preview.ai]\nbinding = "AI"\n'
	])('rejects a preview capability table before mutating deployment config', (extra) => {
		const root = fixture(extra);
		expect(() =>
			materializePublicTemplateOgReleaseTransactionConfig(root, '123456789-2')
		).toThrow(/only the inert preview vars table/i);
		expect(readFileSync(join(root, 'wrangler.toml'), 'utf8')).not.toContain(
			'PUBLIC_RELEASE_TRANSACTION_ID'
		);
	});

	it('keeps the committed source config capability-free for staging', () => {
		const source = readFileSync('wrangler.toml', 'utf8');
		const previewTables = [...source.matchAll(/^\[{1,2}env\.preview\.[^\r\n]+$/gmu)].map(
			([table]) => table
		);
		expect(previewTables).toEqual(['[env.preview.vars]']);
	});
});
