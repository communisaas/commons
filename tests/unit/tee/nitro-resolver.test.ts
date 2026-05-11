/**
 * NitroEnclaveResolver stub behavior (G4).
 *
 * Tests the contract of the not-yet-deployed enclave resolver: it MUST
 * fail loud rather than silently fall back, and MUST distinguish
 * "configured but not deployed" from "configured but unreachable" so
 * operators can act.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// `getConstituentResolver` reads `TEE_PUBLIC_KEY_URL` from `$env/dynamic/private`
// because `process.env` is empty on CF Pages. Use a hoisted mutable mock so
// vi.mock's factory can capture it and individual tests can flip the value
// before invoking the factory.
const { envMock } = vi.hoisted(() => ({
	envMock: {} as Record<string, string | undefined>
}));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

import { NitroEnclaveResolver } from '$lib/server/tee/nitro-resolver';
import {
	getConstituentResolver,
	_resetConstituentResolverForTest,
} from '$lib/server/tee/index';
import { LocalConstituentResolver } from '$lib/server/tee/local-resolver';

const FAKE_REQUEST = {
	ciphertext: 'base64-x',
	nonce: 'base64-n',
	ephemeralPublicKey: '0xeph',
	proof: '0xproof',
	publicInputs: {},
	expected: { actionDomain: '0xa', templateId: 't', districtCommitment: '0xc' },
};

afterEach(() => {
	_resetConstituentResolverForTest();
	delete envMock.TEE_PUBLIC_KEY_URL;
});

describe('NitroEnclaveResolver — stub fails loud', () => {
	it('rejects empty endpoint at construction', () => {
		expect(() => new NitroEnclaveResolver('')).toThrow();
		expect(() => new NitroEnclaveResolver('   ')).toThrow();
	});

	it('rejects non-HTTPS endpoint (attestation requires TLS)', () => {
		expect(() => new NitroEnclaveResolver('http://tee.example.com')).toThrow(
			/HTTPS/,
		);
	});

	it('rejects malformed endpoint URL', () => {
		expect(() => new NitroEnclaveResolver('not-a-url')).toThrow();
	});

	it('returns ResolverResult with NITRO_ENCLAVE_NOT_DEPLOYED on resolve(), does not throw', async () => {
		// G4r CRITICAL fix: interface contract says resolve() returns
		// ResolverResult; throwing breaks Convex's errorCode persistence path.
		const r = new NitroEnclaveResolver('https://tee.example.com/resolve');
		const result = await r.resolve(FAKE_REQUEST as never);
		expect(result.success).toBe(false);
		expect(result.errorCode).toBe('NITRO_ENCLAVE_NOT_DEPLOYED');
		expect(result.constituent).toBeUndefined();
	});

	it('does NOT silently fall back to LocalConstituentResolver', async () => {
		// The whole point: TEE_PUBLIC_KEY_URL set means trust the attestation
		// chain. Falling back to in-process plaintext defeats the contract.
		const r = new NitroEnclaveResolver('https://tee.example.com/resolve');
		const result = await r.resolve(FAKE_REQUEST as never);
		expect(result.success).toBe(false);
		// errorCode reflects the Nitro path failed, not a Local-style gate failure.
		expect(['NITRO_ENCLAVE_NOT_DEPLOYED', 'NITRO_ENCLAVE_UNREACHABLE']).toContain(
			result.errorCode,
		);
	});
});

describe('getConstituentResolver — env-based selection', () => {
	it('returns LocalConstituentResolver when TEE_PUBLIC_KEY_URL is unset', () => {
		const r = getConstituentResolver();
		expect(r).toBeInstanceOf(LocalConstituentResolver);
	});

	it('returns LocalConstituentResolver when TEE_PUBLIC_KEY_URL is empty string', () => {
		envMock.TEE_PUBLIC_KEY_URL = '';
		const r = getConstituentResolver();
		expect(r).toBeInstanceOf(LocalConstituentResolver);
	});

	it('returns LocalConstituentResolver when TEE_PUBLIC_KEY_URL is whitespace', () => {
		envMock.TEE_PUBLIC_KEY_URL = '   ';
		const r = getConstituentResolver();
		expect(r).toBeInstanceOf(LocalConstituentResolver);
	});

	it('returns NitroEnclaveResolver when TEE_PUBLIC_KEY_URL is set to https URL', () => {
		envMock.TEE_PUBLIC_KEY_URL = 'https://tee.example.com/resolve';
		const r = getConstituentResolver();
		expect(r).toBeInstanceOf(NitroEnclaveResolver);
	});

	it('returns a fresh instance per call (no module-scope memoization)', () => {
		// Per-call factory contract: CF Worker isolates reuse across requests, so
		// any module-scope memoization invites cross-request state bleed if a
		// resolver implementation ever adds instance state. Both calls must be
		// the same TYPE (env-driven selection still applies) but distinct
		// INSTANCES.
		envMock.TEE_PUBLIC_KEY_URL = 'https://tee.example.com/resolve';
		const r1 = getConstituentResolver();
		const r2 = getConstituentResolver();
		expect(r1).not.toBe(r2);
		expect(r1).toBeInstanceOf(NitroEnclaveResolver);
		expect(r2).toBeInstanceOf(NitroEnclaveResolver);
	});
});
