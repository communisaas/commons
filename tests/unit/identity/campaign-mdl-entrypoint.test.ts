import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('public campaign mDL entrypoint', () => {
	it('does not expose the legacy direct-wallet path', () => {
		const svelte = source('src/routes/c/[slug]/+page.svelte');

		expect(svelte).not.toContain('$lib/core/identity/digital-credentials-api');
		expect(svelte).not.toContain('requestCredential');
		expect(svelte).not.toContain('getSupportedProtocols');
		expect(svelte).not.toContain('startMdlVerification');
		expect(svelte).not.toContain('mdlSupported');
		expect(svelte).not.toContain('mdlVerified');
		expect(svelte).not.toContain('Verify with Digital ID');
	});
});
