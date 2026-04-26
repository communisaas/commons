import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('issuer verification bypass removal', () => {
	it('does not expose an environment-variable issuer verification bypass', () => {
		const verifier = source('src/lib/core/identity/mdl-verification.ts');

		expect(verifier).not.toContain('SKIP_ISSUER_VERIFICATION');
		expect(verifier).not.toContain('shouldBypassIssuerVerification');
		expect(verifier).not.toContain('process.env.NODE_ENV');
	});
});
