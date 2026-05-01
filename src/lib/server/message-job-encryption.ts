const ENCRYPTION_VERSION = 1;
const ALGORITHM = 'RSA-OAEP-256+A256GCM';

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = '';
	for (const byte of view) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function asBufferSource(bytes: Uint8Array): BufferSource {
	return bytes as Uint8Array<ArrayBuffer>;
}

function aadFor(jobId: string, inputHash: string): Uint8Array {
	return new TextEncoder().encode(`message-job:v${ENCRYPTION_VERSION}:${jobId}:${inputHash}`);
}

export interface EncryptedMessageJobResult {
	version: number;
	alg: string;
	ciphertext: string;
	iv: string;
	wrappedKey: string;
	createdAt: number;
}

export async function encryptMessageJobResult(
	result: unknown,
	publicKeyJwk: JsonWebKey,
	jobId: string,
	inputHash: string
): Promise<{
	encryptedResult: EncryptedMessageJobResult;
	encryptionMeta: Record<string, unknown>;
}> {
	const publicKey = await crypto.subtle.importKey(
		'jwk',
		publicKeyJwk,
		{ name: 'RSA-OAEP', hash: 'SHA-256' },
		false,
		['encrypt']
	);

	const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
		'encrypt'
	]);

	const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const plaintext = new TextEncoder().encode(JSON.stringify(result));
	const additionalData = aadFor(jobId, inputHash);

	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: asBufferSource(iv), additionalData: asBufferSource(additionalData) },
		aesKey,
		asBufferSource(plaintext)
	);
	const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawAesKey);

	return {
		encryptedResult: {
			version: ENCRYPTION_VERSION,
			alg: ALGORITHM,
			ciphertext: bytesToBase64(ciphertext),
			iv: bytesToBase64(iv),
			wrappedKey: bytesToBase64(wrappedKey),
			createdAt: Date.now()
		},
		encryptionMeta: {
			version: ENCRYPTION_VERSION,
			alg: ALGORITHM,
			aad: `message-job:v${ENCRYPTION_VERSION}:${jobId}:${inputHash}`
		}
	};
}
