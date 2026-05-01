const DB_NAME = 'commons-message-jobs';
const STORE_NAME = 'message-recovery-keys';
const ENCRYPTION_VERSION = 1;

export interface ActiveMessageJob {
	jobId: string;
	inputHash: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'expired';
	startedAt: number;
	recoveryKeyRef: string;
}

export interface EncryptedMessageJobResult {
	version: number;
	alg: string;
	ciphertext: string;
	iv: string;
	wrappedKey: string;
	createdAt: number;
}

interface StoredRecoveryKey {
	id: string;
	privateKey: CryptoKey;
	publicKeyJwk: JsonWebKey;
	createdAt: number;
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(',')}}`;
}

function bytesToHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function asUint8Array(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	return bytes as Uint8Array<ArrayBuffer>;
}

function asBufferSource(bytes: Uint8Array): BufferSource {
	return asUint8Array(bytes);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function aadFor(jobId: string, inputHash: string): Uint8Array {
	return new TextEncoder().encode(`message-job:v${ENCRYPTION_VERSION}:${jobId}:${inputHash}`);
}

async function openRecoveryDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME, { keyPath: 'id' });
			}
		};
	});
}

async function getStoredRecoveryKey(id: string): Promise<StoredRecoveryKey | null> {
	const db = await openRecoveryDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const request = tx.objectStore(STORE_NAME).get(id);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve(request.result ?? null);
	});
}

async function putStoredRecoveryKey(key: StoredRecoveryKey): Promise<void> {
	const db = await openRecoveryDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const request = tx.objectStore(STORE_NAME).put(key);
		request.onerror = () => reject(request.error);
		request.onsuccess = () => resolve();
	});
}

export async function computeMessageInputHash(input: unknown): Promise<string> {
	const encoded = new TextEncoder().encode(stableStringify(input));
	return bytesToHex(await crypto.subtle.digest('SHA-256', asBufferSource(encoded)));
}

export async function getOrCreateMessageRecoveryPublicKey(jobId: string): Promise<JsonWebKey> {
	const stored = await getStoredRecoveryKey(jobId);
	if (stored) return stored.publicKeyJwk;

	const keyPair = await crypto.subtle.generateKey(
		{
			name: 'RSA-OAEP',
			modulusLength: 2048,
			publicExponent: asUint8Array(new Uint8Array([1, 0, 1])),
			hash: 'SHA-256'
		},
		false,
		['encrypt', 'decrypt']
	);

	const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
	await putStoredRecoveryKey({
		id: jobId,
		privateKey: keyPair.privateKey,
		publicKeyJwk,
		createdAt: Date.now()
	});

	return publicKeyJwk;
}

export async function decryptMessageJobResult<T>(
	jobId: string,
	inputHash: string,
	encrypted: EncryptedMessageJobResult
): Promise<T> {
	if (encrypted.version !== ENCRYPTION_VERSION) {
		throw new Error('Unsupported message recovery version');
	}

	const stored = await getStoredRecoveryKey(jobId);
	if (!stored) {
		throw new Error('Recovery key unavailable on this device');
	}

	const rawAesKey = await crypto.subtle.decrypt(
		{ name: 'RSA-OAEP' },
		stored.privateKey,
		asBufferSource(base64ToBytes(encrypted.wrappedKey))
	);
	const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM' }, false, [
		'decrypt'
	]);
	const plaintext = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: asBufferSource(base64ToBytes(encrypted.iv)),
			additionalData: asBufferSource(aadFor(jobId, inputHash))
		},
		aesKey,
		asBufferSource(base64ToBytes(encrypted.ciphertext))
	);

	return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
