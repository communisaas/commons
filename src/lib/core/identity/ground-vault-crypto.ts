import { base64urlDecode, base64urlEncode } from '../encoding/base64url';

export const GROUND_VAULT_SCHEMA_VERSION = 1;
export const GROUND_VAULT_DEK_VERSION = 1;
export const GROUND_VAULT_ENCRYPTION_VERSION = 'aes-256-gcm:v1';
export const GROUND_VAULT_WRAP_ALG = 'prf-hkdf-sha256+aes-kw:v1';
export const GROUND_VAULT_HKDF_INFO = 'commons.ground-vault.dek-wrap.v1';
export const GROUND_VAULT_PRF_SALT_VERSION = 1;

const AES_GCM_NONCE_BYTES = 12;
const DEK_BYTES = 32;
const PRF_SALT_BYTES = 32;
const PRF_OUTPUT_BYTES = 32;
const HKDF_SALT = new TextEncoder().encode('commons-ground-vault-prf-wrap-v1');

export interface GroundVaultAddress {
	street: string;
	city: string;
	state: string;
	zip: string;
}

export interface GroundVaultPayload {
	address: GroundVaultAddress;
	district?: string;
	cellId?: string;
	h3Cell?: string;
	resolveResultHash?: string;
	resolveSigningKeyId?: string;
	normalizedAt: string;
}

export interface GroundVaultCiphertext {
	ciphertext: string;
	nonce: string;
	schemaVersion: number;
	encryptionVersion: string;
	dekVersion: number;
	aeadAssociatedData: string;
	associatedDataHash: string;
}

function cryptoProvider(): Crypto {
	const provider = globalThis.crypto;
	if (!provider?.subtle) {
		throw new Error('Web Crypto is not available');
	}
	return provider;
}

function toBytes(bytes: ArrayBuffer | ArrayBufferView): Uint8Array {
	if (ArrayBuffer.isView(bytes)) {
		return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}
	return new Uint8Array(bytes);
}

function cloneBytes(bytes: ArrayBuffer | ArrayBufferView): Uint8Array {
	const source = toBytes(bytes);
	const copy = new Uint8Array(source.byteLength);
	copy.set(source);
	return copy;
}

function cryptoSource(bytes: Uint8Array): BufferSource {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	const nodeBuffer = (globalThis as unknown as {
		Buffer?: { from(input: Uint8Array): Uint8Array };
	}).Buffer;
	if (nodeBuffer) {
		return nodeBuffer.from(copy) as unknown as BufferSource;
	}
	return copy.buffer as ArrayBuffer;
}

function assertByteLength(name: string, bytes: Uint8Array, expected: number): void {
	if (bytes.byteLength !== expected) {
		throw new Error(`${name} must be ${expected} bytes`);
	}
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	const digest = await cryptoProvider().subtle.digest('SHA-256', cryptoSource(bytes));
	return new Uint8Array(digest);
}

async function importDek(dek: Uint8Array, extractable = false): Promise<CryptoKey> {
	assertByteLength('Ground vault DEK', dek, DEK_BYTES);
	return cryptoProvider().subtle.importKey(
		'raw',
		cryptoSource(dek),
		{ name: 'AES-GCM', length: 256 },
		extractable,
		['encrypt', 'decrypt']
	);
}

async function deriveWrappingKey(
	prfOutput: Uint8Array,
	hkdfInfo = GROUND_VAULT_HKDF_INFO
): Promise<CryptoKey> {
	assertByteLength('WebAuthn PRF output', prfOutput, PRF_OUTPUT_BYTES);
	const keyMaterial = await cryptoProvider().subtle.importKey(
		'raw',
		cryptoSource(prfOutput),
		{ name: 'HKDF' },
		false,
		['deriveKey']
	);

	return cryptoProvider().subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: HKDF_SALT,
			info: new TextEncoder().encode(hkdfInfo)
		},
		keyMaterial,
		{ name: 'AES-KW', length: 256 },
		false,
		['wrapKey', 'unwrapKey']
	);
}

export function generateGroundVaultDEK(): Uint8Array {
	return cryptoProvider().getRandomValues(new Uint8Array(DEK_BYTES));
}

export function generateGroundVaultPRFSalt(): Uint8Array {
	return cryptoProvider().getRandomValues(new Uint8Array(PRF_SALT_BYTES));
}

export async function computePRFSaltId(salt: ArrayBuffer | ArrayBufferView): Promise<string> {
	const saltBytes = cloneBytes(salt);
	assertByteLength('PRF salt', saltBytes, PRF_SALT_BYTES);
	return base64urlEncode(await sha256(saltBytes));
}

export async function hashGroundVaultAAD(aeadAssociatedData: string): Promise<string> {
	return base64urlEncode(await sha256(new TextEncoder().encode(aeadAssociatedData)));
}

export function encodeGroundVaultAAD(input: {
	userId: string;
	schemaVersion?: number;
	dekVersion?: number;
}): string {
	return JSON.stringify({
		purpose: 'commons.ground-vault',
		version: input.schemaVersion ?? GROUND_VAULT_SCHEMA_VERSION,
		dekVersion: input.dekVersion ?? GROUND_VAULT_DEK_VERSION,
		userId: input.userId
	});
}

export async function encryptGroundVaultPayload(
	payload: GroundVaultPayload,
	dek: ArrayBuffer | ArrayBufferView,
	aeadAssociatedData: string
): Promise<GroundVaultCiphertext> {
	const dekBytes = cloneBytes(dek);
	const key = await importDek(dekBytes);
	const nonce = cryptoProvider().getRandomValues(new Uint8Array(AES_GCM_NONCE_BYTES));
	const encodedPayload = new TextEncoder().encode(JSON.stringify(payload));
	const aad = new TextEncoder().encode(aeadAssociatedData);

	const ciphertext = await cryptoProvider().subtle.encrypt(
		{ name: 'AES-GCM', iv: cryptoSource(nonce), additionalData: cryptoSource(aad) },
		key,
		cryptoSource(encodedPayload)
	);

	return {
		ciphertext: base64urlEncode(ciphertext),
		nonce: base64urlEncode(nonce),
		schemaVersion: GROUND_VAULT_SCHEMA_VERSION,
		encryptionVersion: GROUND_VAULT_ENCRYPTION_VERSION,
		dekVersion: GROUND_VAULT_DEK_VERSION,
		aeadAssociatedData,
		associatedDataHash: await hashGroundVaultAAD(aeadAssociatedData)
	};
}

export async function decryptGroundVaultPayload(
	vault: Pick<GroundVaultCiphertext, 'ciphertext' | 'nonce' | 'aeadAssociatedData'>,
	dek: ArrayBuffer | ArrayBufferView
): Promise<GroundVaultPayload> {
	const dekBytes = cloneBytes(dek);
	const key = await importDek(dekBytes);
	const plaintext = await cryptoProvider().subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: cryptoSource(base64urlDecode(vault.nonce)),
				additionalData: cryptoSource(new TextEncoder().encode(vault.aeadAssociatedData))
			},
		key,
		cryptoSource(base64urlDecode(vault.ciphertext))
	);

	return JSON.parse(new TextDecoder().decode(plaintext)) as GroundVaultPayload;
}

export async function wrapGroundVaultDEK(
	dek: ArrayBuffer | ArrayBufferView,
	prfOutput: ArrayBuffer | ArrayBufferView,
	hkdfInfo = GROUND_VAULT_HKDF_INFO
): Promise<string> {
	const dekBytes = cloneBytes(dek);
	const dekKey = await importDek(dekBytes, true);
	const wrappingKey = await deriveWrappingKey(cloneBytes(prfOutput), hkdfInfo);
	const wrapped = await cryptoProvider().subtle.wrapKey('raw', dekKey, wrappingKey, 'AES-KW');
	return base64urlEncode(wrapped);
}

export async function unwrapGroundVaultDEK(
	wrappedDek: string,
	prfOutput: ArrayBuffer | ArrayBufferView,
	hkdfInfo = GROUND_VAULT_HKDF_INFO
): Promise<Uint8Array> {
	const wrappingKey = await deriveWrappingKey(cloneBytes(prfOutput), hkdfInfo);
	const dekKey = await cryptoProvider().subtle.unwrapKey(
		'raw',
		cryptoSource(base64urlDecode(wrappedDek)),
		wrappingKey,
		'AES-KW',
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt']
	);
	const raw = await cryptoProvider().subtle.exportKey('raw', dekKey);
	return new Uint8Array(raw);
}
