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
		expect(svelte).toContain('if (!requireCongressionalDeliveryAddress()) return;');
		expect(svelte).toContain('showVerificationGate = true;');
		expect(svelte).not.toContain('attemptWalletVerification');
		expect(svelte).not.toContain('requestCredential');
	});

	it('keeps the mDL user flow device-agnostic and off deprecated paths', () => {
		const svelte = source('src/lib/components/auth/GovernmentCredentialVerification.svelte');

		expect(svelte).toContain('shouldUseDigitalCredentialsFlow');
		expect(svelte).toContain('Digital ID unavailable');
		expect(svelte).toContain('Your browser will ask your digital wallet');

		expect(svelte).not.toContain('isMdlDirectQrEnabled');
		expect(svelte).not.toContain('startDirectQr');
		expect(svelte).not.toContain('/api/identity/direct-mdl/start');
		expect(svelte).not.toContain('directQrSvg');
		expect(svelte).not.toContain("import QRCode from 'qrcode'");
		expect(svelte).not.toContain('platform');
		expect(svelte).not.toContain('detectPlatform');
		expect(svelte).not.toContain('Android required');
		expect(svelte).not.toContain('Android first');
		expect(svelte).not.toContain('Scan with Android Camera');
		expect(svelte).not.toContain('Chrome required');
		expect(svelte).not.toContain('Android Chrome');
		expect(svelte).not.toContain('Google Wallet will ask');
		expect(svelte).not.toContain('Waiting for {walletName}');
		expect(svelte).not.toContain('isMdlBridgeEnabled');
		expect(svelte).not.toContain('startBridge');
		expect(svelte).not.toContain('/api/identity/bridge/start');
		expect(svelte).not.toContain('guided phone scan');
		expect(svelte).not.toContain('verify-bridge');
	});

	it('keeps placeholder copy device-agnostic and off stale rollout dependencies', () => {
		const sources = [
			source('src/lib/components/auth/VerificationGate.svelte'),
			source('src/lib/components/auth/IdentityRecoveryFlow.svelte'),
			source('src/lib/components/modals/ModalRegistry.svelte'),
			source('src/routes/help/verification/+page.svelte'),
			source('src/lib/core/identity/digital-credentials-api.ts'),
			source('src/lib/types/digital-credentials.d.ts'),
			source('src/lib/config/features.ts'),
			source('docs/development/deployment.md')
		].join('\n');

		expect(sources).toContain('browser-mediated Digital Credentials');
		expect(sources).not.toContain('Android OpenID4VP');
		expect(sources).not.toContain('rolling out first on Android');
		expect(sources).not.toContain('Apple Business Connect');
		expect(sources).not.toContain('Business Connect');
		expect(sources).not.toContain('Safari 26+');
		expect(sources).not.toContain('Full support');
		expect(sources).not.toContain('unsupported browsers, use your phone');
		expect(sources).not.toContain('separate custom QR verifier');
		expect(sources).not.toContain('Android Camera');
	});

	it('routes recovery and post-mDL completion without stale trust-tier fallthrough', () => {
		const gate = source('src/lib/components/auth/VerificationGate.svelte');
		const modal = source('src/lib/components/template/TemplateModal.svelte');
		const checkVerification = gate.slice(
			gate.indexOf('export async function checkVerification'),
			gate.indexOf('function handleVerificationComplete')
		);
		const modalCompletion = modal.slice(
			modal.indexOf('function handleVerificationComplete'),
			modal.indexOf('function handleVerificationCancel')
		);

		expect(checkVerification.indexOf('needsCredentialRecovery')).toBeLessThan(
			checkVerification.indexOf('userTrustTier >= minimumTier')
		);
		expect(checkVerification).toContain('getUsableProofCredential(userId)');
		expect(checkVerification).toContain('credentialMeetsMinimumTier(proofCredential, minimumTier)');
		expect(checkVerification).toContain('showRecovery = true');
		expect(gate).toContain('recoveryCheckVersion');
		expect(modalCompletion).toContain("!data.method.startsWith('address:')");
		expect(modalCompletion).toContain('await continueCongressionalProofFlow();');
		expect(modalCompletion).not.toContain('user?.trust_tier');

		const sendConfirmation = modal.slice(
			modal.indexOf('async function handleSendConfirmation'),
			modal.indexOf('// Universal share handler')
		);
		const addressCompletion = modal.slice(
			modal.indexOf('async function handleAddressComplete'),
			modal.indexOf('/**\n\t * Submit Congressional message')
		);
		expect(sendConfirmation).toContain('await continueCongressionalProofFlow();');
		expect(sendConfirmation).toContain('requireCongressionalDeliveryAddress()');
		expect(sendConfirmation).not.toContain('trust_tier');
		expect(modal).toContain('credential.congressionalDistrict');
		expect(modal).toContain('clearTreeState(user.id)');
		expect(addressCompletion).not.toContain('possibly stale');
		expect(addressCompletion).toContain('data.verified !== true');
		expect(addressCompletion).not.toContain("?? 'AL'");
		expect(addressCompletion).toContain('data.districtCommitment');
		expect(addressCompletion).toContain('district_commitment: data.districtCommitment');
		expect(addressCompletion).toContain('coordinates: data.coordinates');
		expect(addressCompletion).toContain("modalActions.setState('error')");
		expect(addressCompletion).toContain('clearTreeState(user.id)');
		expect(addressCompletion).not.toContain('trust_tier');

		const errorStart = modal.indexOf("{:else if currentState === 'error'}");
		const errorState = modal.slice(
			errorStart,
			modal.indexOf('<!-- Verification Gate Modal -->', errorStart)
		);
		expect(errorState).toContain('await continueCongressionalProofFlow();');
		expect(errorState).not.toContain('submitCongressionalMessage();');
		expect(modal).toContain('proofSubmissionBlocked');
		expect(modal).toContain('verifiedAddress = null');
	});

	it('keeps identity verification from continuing without proof setup', () => {
		const svelte = source('src/lib/components/auth/IdentityVerificationFlow.svelte');
		const noDistrict = svelte.slice(
			svelte.indexOf("console.warn('[Verification] No district available"),
			svelte.indexOf('/**\n\t * Register in Shadow Atlas')
		);
		const failureBranch = svelte.slice(
			svelte.indexOf('{:else if registrationError}'),
			svelte.indexOf('{:else if registrationComplete}')
		);
		const continueButton = svelte.slice(
			svelte.indexOf('{#if registrationComplete}'),
			svelte.indexOf('<!-- Help Text -->')
		);

		expect(noDistrict).toContain('registrationError =');
		expect(noDistrict).not.toContain('oncomplete?.');
		expect(failureBranch).toContain('Retry before continuing');
		expect(continueButton).toContain('Continue to Message Submission');
		expect(continueButton).toContain('oncomplete?.');
	});
});
