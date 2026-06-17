/**
 * /api/tee/resolve — the constituent-resolver service the congressional delivery
 * action depends on (B1). Locks: internal-secret auth, field validation, and
 * delegation to getConstituentResolver().resolve() with the result passed through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SECRET = 'test-internal-secret-0123456789ab'; // >= 32 bytes; kept in sync with the mock literal below

// vi.mock is hoisted above const declarations, so the factory must use a literal.
vi.mock('$env/dynamic/private', () => ({
	env: { INTERNAL_API_SECRET: 'test-internal-secret-0123456789ab' }
}));
vi.mock('$lib/server/internal/rate-limit', () => ({
	enforceInternalRateLimit: vi.fn(async () => {})
}));
const resolveMock = vi.fn();
vi.mock('$lib/server/tee', () => ({ getConstituentResolver: () => ({ resolve: resolveMock }) }));

import { POST } from '../../../src/routes/api/tee/resolve/+server';

const validBody = {
	ciphertext: 'c',
	nonce: 'n',
	ephemeralPublicKey: 'e',
	proof: 'p',
	publicInputs: {},
	expected: { actionDomain: 'a', templateId: 't', districtCommitment: 'd' }
};

function ev(headers: Record<string, string>, body: unknown) {
	return {
		request: new Request('http://x/api/tee/resolve', {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		})
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('/api/tee/resolve', () => {
	beforeEach(() => resolveMock.mockReset());

	it('rejects a missing/invalid internal secret with 403', async () => {
		await expect(POST(ev({ 'content-type': 'application/json' }, validBody))).rejects.toMatchObject(
			{ status: 403 }
		);
		await expect(POST(ev({ 'x-internal-secret': 'wrong' }, validBody))).rejects.toMatchObject({
			status: 403
		});
		expect(resolveMock).not.toHaveBeenCalled();
	});

	it('returns MISSING_FIELDS for a malformed body, without invoking the resolver', async () => {
		const res = await POST(ev({ 'x-internal-secret': SECRET }, { ciphertext: 'c' }));
		expect(await res.json()).toEqual({ success: false, errorCode: 'MISSING_FIELDS' });
		expect(resolveMock).not.toHaveBeenCalled();
	});

	it('delegates a valid request to the resolver and returns its result', async () => {
		resolveMock.mockResolvedValue({ success: true, constituent: { name: 'X' } });
		const res = await POST(ev({ 'x-internal-secret': SECRET }, validBody));
		expect(resolveMock).toHaveBeenCalledTimes(1);
		expect(resolveMock.mock.calls[0][0]).toMatchObject({
			ciphertext: 'c',
			expected: { actionDomain: 'a', templateId: 't', districtCommitment: 'd' }
		});
		expect(await res.json()).toEqual({ success: true, constituent: { name: 'X' } });
	});

	it('passes a resolver rejection through unchanged (no PII, typed errorCode)', async () => {
		resolveMock.mockResolvedValue({ success: false, errorCode: 'PROOF_INVALID' });
		const res = await POST(ev({ 'x-internal-secret': SECRET }, validBody));
		expect(await res.json()).toEqual({ success: false, errorCode: 'PROOF_INVALID' });
	});
});

describe('congressional delivery wiring (source pins)', () => {
	const submissions = readFileSync(join(process.cwd(), 'convex/submissions.ts'), 'utf8');

	it('the resolve fetch sends the internal secret header', () => {
		expect(submissions).toMatch(/x-internal-secret['"]?\s*:\s*process\.env\.INTERNAL_API_SECRET/);
	});

	it('the Senate sandbox guard refuses the live "messages" prefix without CWC_PRODUCTION', () => {
		expect(submissions).toContain('resolveSenatePathPrefix');
		const fn = submissions.slice(
			submissions.indexOf('function resolveSenatePathPrefix'),
			submissions.indexOf('function getCongressionalTransportConfig')
		);
		expect(fn).toMatch(/prefix === 'messages'/);
		expect(fn).toMatch(/CWC_PRODUCTION !== 'true'/);
		expect(fn).toMatch(/return 'testing-messages'/); // fail-safe to sandbox
	});
});
