import { base64urlDecode, base64urlEncode } from '../encoding/base64url';
import { decryptGroundVaultPayload, unwrapGroundVaultDEK } from './ground-vault-crypto';
import {
	buildPRFAuthenticationExtension,
	extractPRFAssertionResults,
	stripPRFResultsFromAuthenticationResponse
} from './webauthn-prf';

interface GroundVaultStateForUnlock {
	vault?: {
		ciphertext?: string;
		nonce?: string;
		aeadAssociatedData?: string;
	} | null;
	wrappers?: Array<{
		status?: string | null;
		passkeyCredentialId?: string | null;
		prfSalt?: string | null;
		wrappedDek?: string | null;
		hkdfInfo?: string | null;
	}> | null;
}

interface PublicKeyCredentialRequestOptionsJSON {
	challenge: string;
	timeout?: number;
	rpId?: string;
	userVerification?: UserVerificationRequirement;
	allowCredentials?: Array<{
		id: string;
		type: PublicKeyCredentialType;
		transports?: AuthenticatorTransport[];
	}>;
}

function toRequestOptions(
	options: PublicKeyCredentialRequestOptionsJSON,
	credentialId: string,
	prfSalt: string
): PublicKeyCredentialRequestOptions {
	return {
		challenge: base64urlDecode(options.challenge),
		timeout: options.timeout,
		rpId: options.rpId,
		userVerification: options.userVerification,
		allowCredentials: options.allowCredentials?.map((credential) => ({
			...credential,
			id: base64urlDecode(credential.id)
		})),
		extensions: {
			...buildPRFAuthenticationExtension(credentialId, base64urlDecode(prfSalt))
		}
	};
}

function serializeAssertion(credential: PublicKeyCredential) {
	const response = credential.response as AuthenticatorAssertionResponse;
	const serialized = {
		id: credential.id,
		rawId: base64urlEncode(credential.rawId),
		type: credential.type,
		response: {
			authenticatorData: base64urlEncode(response.authenticatorData),
			clientDataJSON: base64urlEncode(response.clientDataJSON),
			signature: base64urlEncode(response.signature),
			userHandle: response.userHandle ? base64urlEncode(response.userHandle) : undefined
		},
		clientExtensionResults: credential.getClientExtensionResults()
	};

	return stripPRFResultsFromAuthenticationResponse(
		serialized as typeof serialized & { clientExtensionResults?: Record<string, unknown> }
	);
}

export async function requestCurrentPasskeyPRF(input: {
	credentialId?: string;
	prfSalt: string;
}): Promise<{ prfOutput: ArrayBuffer; credentialId: string }> {
	const optionsResponse = await fetch('/api/auth/passkey/current', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action: 'options' })
	});
	if (!optionsResponse.ok) {
		const body = await optionsResponse.json().catch(() => ({}));
		throw new Error(body?.message || body?.error || 'Could not start passkey unlock.');
	}
	const { options, sessionId } = (await optionsResponse.json()) as {
		options: PublicKeyCredentialRequestOptionsJSON;
		sessionId: string;
	};
	const credentialId = input.credentialId ?? options.allowCredentials?.[0]?.id;
	if (!credentialId) {
		throw new Error('No passkey credential is available for unlock.');
	}

	const credential = (await navigator.credentials.get({
		publicKey: toRequestOptions(options, credentialId, input.prfSalt)
	})) as PublicKeyCredential | null;
	if (!credential) {
		throw new Error('Passkey unlock was cancelled.');
	}

	const prf = extractPRFAssertionResults(
		credential as unknown as Parameters<typeof extractPRFAssertionResults>[0]
	);
	if (prf.status !== 'available' || !prf.first) {
		throw new Error(prf.reason || 'This browser or passkey did not return PRF key material.');
	}

	const verifyResponse = await fetch('/api/auth/passkey/current', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			action: 'verify',
			sessionId,
			response: serializeAssertion(credential)
		})
	});
	if (!verifyResponse.ok) {
		const body = await verifyResponse.json().catch(() => ({}));
		throw new Error(body?.message || body?.error || 'Passkey verification failed.');
	}

	return { prfOutput: prf.first, credentialId };
}

export async function unlockGroundVaultWithPasskey(groundState: GroundVaultStateForUnlock) {
	const vault = groundState.vault;
	if (!vault?.ciphertext || !vault.nonce || !vault.aeadAssociatedData) {
		throw new Error('No encrypted address vault is available.');
	}
	const encryptedVault = {
		ciphertext: vault.ciphertext,
		nonce: vault.nonce,
		aeadAssociatedData: vault.aeadAssociatedData
	};

	const wrapper = groundState.wrappers?.find(
		(candidate) =>
			candidate.status === 'active' &&
			candidate.passkeyCredentialId &&
			candidate.prfSalt &&
			candidate.wrappedDek
	);
	if (!wrapper?.passkeyCredentialId || !wrapper.prfSalt || !wrapper.wrappedDek) {
		throw new Error('No passkey unlock record is available for this address.');
	}

	const { prfOutput } = await requestCurrentPasskeyPRF({
		credentialId: wrapper.passkeyCredentialId,
		prfSalt: wrapper.prfSalt
	});
	const dek = await unwrapGroundVaultDEK(wrapper.wrappedDek, prfOutput, wrapper.hkdfInfo ?? undefined);
	return decryptGroundVaultPayload(encryptedVault, dek);
}
