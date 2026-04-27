import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
	return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('mDL launch gates', () => {
	it('keeps VerificationGate on the placeholder branch when no mDL protocol is enabled', () => {
		const svelte = source('src/lib/components/auth/VerificationGate.svelte');
		const placeholder = svelte.indexOf('data-testid="mdl-gated-panel"');
		const contentGate = svelte.lastIndexOf('{#if mdlGated}', placeholder);
		const nextBranch = svelte.indexOf('{:else if showRecovery}', placeholder);
		const gatedBranch = svelte.slice(
			contentGate,
			nextBranch
		);

		expect(svelte).toContain('!isAnyMdlProtocolEnabled() && !needsTier2 && !forceAddressFlow');
		expect(contentGate).toBeGreaterThan(-1);
		expect(placeholder).toBeGreaterThan(contentGate);
		expect(nextBranch).toBeGreaterThan(placeholder);
		expect(gatedBranch).toContain('data-testid="mdl-gated-panel"');
		expect(gatedBranch).toContain('Government-ID verification');
		expect(svelte).toContain('Coming soon.');
		expect(gatedBranch).not.toContain('<IdentityVerificationFlow');
	});

	it('keeps credential recovery on the placeholder branch when no mDL protocol is enabled', () => {
		const svelte = source('src/lib/components/auth/IdentityRecoveryFlow.svelte');
		const gatedBranch = svelte.slice(
			svelte.indexOf('{#if mdlGated}'),
			svelte.indexOf('{:else}')
		);

		expect(svelte).toContain('const mdlGated = !isAnyMdlProtocolEnabled()');
		expect(gatedBranch).toContain('data-testid="recovery-mdl-gated"');
		expect(gatedBranch).toContain("Recovery isn't available yet.");
		expect(gatedBranch).not.toContain('<GovernmentCredentialVerification');
	});

	it('keeps the central identity modal on its placeholder branch when no mDL protocol is enabled', () => {
		const svelte = source('src/lib/components/modals/ModalRegistry.svelte');
		const gate = svelte.indexOf('{#if !isAnyMdlProtocolEnabled()}');
		const placeholder = svelte.indexOf('data-testid="modal-mdl-gated"');
		const verifier = svelte.indexOf('<GovernmentCredentialVerification');

		expect(gate).toBeGreaterThan(-1);
		expect(placeholder).toBeGreaterThan(gate);
		expect(verifier).toBeGreaterThan(placeholder);
	});

	it('keeps the trust-upgrade digital-ID button behind the mDL protocol gate', () => {
		const svelte = source('src/lib/components/template/TemplateModal.svelte');
		const button = svelte.indexOf('Verify with Digital ID');
		const gate = svelte.lastIndexOf('{#if isAnyMdlProtocolEnabled()}', button);
		const address = svelte.indexOf('Verify your address', button);

		expect(gate).toBeGreaterThan(-1);
		expect(button).toBeGreaterThan(gate);
		expect(address).toBeGreaterThan(button);
	});

	it('auto-starts direct QR on desktop before falling back to the bridge', () => {
		const svelte = source('src/lib/components/auth/GovernmentCredentialVerification.svelte');

		expect(svelte).toContain("if (verificationState !== 'unsupported' || platform !== 'desktop') return;");
		expect(svelte).toMatch(/if \(isMdlDirectQrEnabled\(\)\) \{\s*startDirectQr\(\);/);
		expect(svelte).toMatch(/} else if \(isMdlBridgeEnabled\(\)\) \{\s*startBridge\(\);/);
	});
});
