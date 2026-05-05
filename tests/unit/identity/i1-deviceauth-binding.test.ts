/**
 * I1 — DeviceAuth SessionTranscript binding
 *
 * Pre-I1: the raw `org-iso-mdoc` lane (`processMdocResponse`) had a
 * presence-only F-1.3 gate; capture-replay was undefended within the
 * OID4VP nonce lifetime. The encrypted `dc_api.jwt` lane
 * (`processOpenId4VpMsoMdocPresentation`) already did full verification.
 *
 * I1 extracts the verification into a shared `verifyMdocDeviceAuth` helper
 * and wires the raw lane to call it after MSO digest validation. Both
 * lanes now reach the same security floor.
 *
 * Constructing a valid signed mdoc fixture in unit tests requires real
 * keys + COSE_Sign1 generation, which the project's existing mdoc tests
 * sidestep with synthetic issuerAuth (rejected at issuer-auth before
 * reaching DeviceAuth). Static-source assertions are therefore the
 * lowest-friction floor for pinning the wiring.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('I1 — verifyMdocDeviceAuth shared helper', () => {
	const sourcePath = path.resolve(
		process.cwd(),
		'src/lib/core/identity/mdl-verification.ts',
	);

	it('exports a shared verifyMdocDeviceAuth helper that builds DeviceAuthenticationBytes', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		expect(source).toMatch(/async function verifyMdocDeviceAuth\(/);
		// The helper MUST construct the canonical DeviceAuthentication CBOR
		// per ISO 18013-5 §9.1.3.6: ['DeviceAuthentication', SessionTranscript,
		// docType, DeviceNameSpacesBytes].
		expect(source).toMatch(/'DeviceAuthentication'/);
		expect(source).toMatch(/buildOpenId4VpMdocSessionTranscript/);
	});

	it('the helper requires verifierOrigin (refuses to verify without SessionTranscript context)', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		// Locate the helper body and assert the verifierOrigin guard exists.
		const helperStart = source.indexOf('async function verifyMdocDeviceAuth');
		expect(helperStart).toBeGreaterThan(0);
		const helperEnd = source.indexOf('\n}\n', helperStart);
		const helperBody = source.slice(helperStart, helperEnd);
		expect(helperBody).toMatch(/if \(!options\.verifierOrigin\)/);
		expect(helperBody).toMatch(/replay_protection_missing/);
	});

	it('the helper calls verifyDeviceSignature against deviceAuthenticationBytes', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		const helperStart = source.indexOf('async function verifyMdocDeviceAuth');
		const helperEnd = source.indexOf('\n}\n', helperStart);
		const helperBody = source.slice(helperStart, helperEnd);
		// Wires through to the COSE deviceSignature verifier from cose-verify.
		expect(helperBody).toMatch(/verifyDeviceSignature\(/);
		expect(helperBody).toMatch(/deviceAuthenticationBytes/);
	});
});

describe('I1 — raw mdoc lane (processMdocResponse) parity', () => {
	const sourcePath = path.resolve(
		process.cwd(),
		'src/lib/core/identity/mdl-verification.ts',
	);

	it('processMdocResponse calls verifyMdocDeviceAuth after MSO validation', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		const fnStart = source.indexOf('async function processMdocResponse');
		expect(fnStart).toBeGreaterThan(0);
		// Find the function body up to the next top-level `^async function` or
		// `^function`. Heuristic: scan ~12 KB.
		const fnBody = source.slice(fnStart, fnStart + 12_000);
		// The verifyMdocDeviceAuth call lives inside the `if (coseResult.mso)`
		// block — i.e., AFTER MSO digests are validated. We assert presence
		// here; ordering is documented in the inline comment.
		expect(fnBody).toMatch(/verifyMdocDeviceAuth\(\{/);
		expect(fnBody).toMatch(/deviceKey: coseResult\.mso\.deviceKeyInfo\.deviceKey/);
	});

	it('processMdocResponse accepts MdlVerificationOptions (not just vicalKv)', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		const fnStart = source.indexOf('async function processMdocResponse');
		const fnSig = source.slice(fnStart, fnStart + 400);
		// Pre-I1: `vicalKv?: KVNamespace`. Post-I1: full options so verifierOrigin
		// can flow through to the DeviceAuth verifier.
		expect(fnSig).toMatch(/options\?: MdlVerificationOptions/);
	});

	it('processMdocResponse no longer logs "deferred to T3"', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		// The pre-I1 partial gate logged a "deferred to T3" telemetry line.
		// Post-I1 that comment is gone — verification is no longer deferred.
		expect(source).not.toMatch(/deferred to T3/);
		expect(source).not.toMatch(/HPKE verification deferred/);
	});

	it('processMdocResponse no longer carries the F-1.3 "ZERO defense" warning', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		// The honest H-phase pattern was: when the gate becomes real, drop the
		// "I am theatre" disclaimer. The full verification IS the defense now.
		expect(source).not.toMatch(/ZERO defense against/);
		expect(source).not.toMatch(/F-1\.3, partial/);
	});
});

describe('I1 — DC API lane parity (processOpenId4VpMsoMdocPresentation)', () => {
	const sourcePath = path.resolve(
		process.cwd(),
		'src/lib/core/identity/mdl-verification.ts',
	);

	it('DC API lane delegates to the shared verifyMdocDeviceAuth helper', async () => {
		const source = await fs.readFile(sourcePath, 'utf8');
		const fnStart = source.indexOf('async function processOpenId4VpMsoMdocPresentation');
		expect(fnStart).toBeGreaterThan(0);
		const fnBody = source.slice(fnStart, fnStart + 10_000);
		expect(fnBody).toMatch(/verifyMdocDeviceAuth\(\{/);
		// The inline DeviceAuth verification block was replaced by the shared
		// helper. The previous implementation's distinguishing strings are gone
		// from this function body (they live in the helper instead).
		expect(fnBody).not.toMatch(/encodeMdocAuthCbor\(\s*\n\s*taggedCborBytes/);
	});
});
