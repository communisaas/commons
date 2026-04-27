/**
 * Direct OpenID4VP mDL session model.
 *
 * This is the desktop QR direct-post lane. It is intentionally separate from
 * bridge sessions: no QR fragment secret, no phone web claim state, and a
 * direct-post transport binding that future request_uri/direct_post endpoints
 * must preserve.
 */

export const DIRECT_MDL_TRANSPORT = 'direct_post' as const;
export const DIRECT_MDL_SESSION_TTL_SECONDS = 300;

export type DirectMdlTransport = typeof DIRECT_MDL_TRANSPORT;
export type DirectMdlSessionStatus = 'created' | 'request_fetched' | 'completed' | 'failed';

export interface DirectMdlSession {
	id: string;
	desktopUserId: string;
	transport: DirectMdlTransport;
	clientId: string;
	responseUri: string;
	requestUri: string;
	nonce: string;
	state: string;
	transactionId: string;
	walletNonce?: string;
	requestObjectJwt?: string;
	result?: DirectMdlCompletionResult;
	status: DirectMdlSessionStatus;
	requestFetchedAt?: number;
	completedAt?: number;
	failedAt?: number;
	errorMessage?: string;
	createdAt: number;
	expiresAt: number;
}

export interface DirectMdlCompletionResult {
	district: string;
	state: string;
	credentialHash: string;
	cellId?: string;
	identityCommitmentBound: boolean;
}

export interface CreateDirectMdlSessionInput {
	desktopUserId: string;
	clientId: string;
	responseUri: string;
	requestUri: string;
	nonce?: string;
	state?: string;
	transactionId?: string;
	id?: string;
}

export interface DirectMdlSessionHandle {
	id: string;
	transactionId: string;
	nonce: string;
	state: string;
	requestUri: string;
	responseUri: string;
	clientId: string;
	transport: DirectMdlTransport;
	expiresAt: number;
}

type KV = {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
};
type Platform = { env?: { DIRECT_MDL_SESSION_KV?: KV; DC_SESSION_KV?: KV } };

const KV_PREFIX = 'direct-mdl:';
const STATE_KV_PREFIX = 'direct-mdl-state:';
const devDirectMdlStore = new Map<string, { data: string; expires: number }>();

if (typeof setInterval !== 'undefined') {
	setInterval(() => {
		const now = Date.now();
		for (const [key, value] of devDirectMdlStore) {
			if (value.expires < now) devDirectMdlStore.delete(key);
		}
	}, 60_000);
}

function getKv(platform?: Platform): KV | null {
	return platform?.env?.DIRECT_MDL_SESSION_KV ?? platform?.env?.DC_SESSION_KV ?? null;
}

function kvKey(sessionId: string): string {
	return `${KV_PREFIX}${sessionId}`;
}

function stateKvKey(state: string): string {
	return `${STATE_KV_PREFIX}${state}`;
}

async function putSession(session: DirectMdlSession, platform?: Platform): Promise<void> {
	const data = JSON.stringify(session);
	const kv = getKv(platform);
	if (kv) {
		await kv.put(kvKey(session.id), data, { expirationTtl: DIRECT_MDL_SESSION_TTL_SECONDS });
		return;
	}
	devDirectMdlStore.set(kvKey(session.id), {
		data,
		expires: session.expiresAt
	});
}

async function putStateIndex(session: DirectMdlSession, platform?: Platform): Promise<void> {
	const kv = getKv(platform);
	if (kv) {
		await kv.put(stateKvKey(session.state), session.id, {
			expirationTtl: DIRECT_MDL_SESSION_TTL_SECONDS
		});
		return;
	}
	devDirectMdlStore.set(stateKvKey(session.state), {
		data: session.id,
		expires: session.expiresAt
	});
}

async function getSession(
	sessionId: string,
	platform?: Platform
): Promise<DirectMdlSession | null> {
	const key = kvKey(sessionId);
	const kv = getKv(platform);
	let raw: string | null = null;
	if (kv) {
		raw = await kv.get(key);
	} else {
		const stored = devDirectMdlStore.get(key);
		if (stored && stored.expires > Date.now()) {
			raw = stored.data;
		} else if (stored) {
			devDirectMdlStore.delete(key);
		}
	}
	if (!raw) return null;
	try {
		const session = JSON.parse(raw) as DirectMdlSession;
		if (session.expiresAt <= Date.now()) {
			await deleteDirectMdlSession(sessionId, platform);
			return null;
		}
		if (session.transport !== DIRECT_MDL_TRANSPORT) return null;
		return session;
	} catch {
		return null;
	}
}

function assertNonEmpty(name: string, value: string): void {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`DIRECT_MDL_SESSION_INVALID_${name.toUpperCase()}`);
	}
}

function assertBase64UrlToken(name: string, value: string): void {
	if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(value)) {
		throw new Error(`DIRECT_MDL_SESSION_INVALID_${name.toUpperCase()}`);
	}
}

function assertSessionId(id: string): void {
	if (
		typeof id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
	) {
		throw new Error('DIRECT_MDL_SESSION_INVALID_ID');
	}
}

function assertTransport(transport: string): asserts transport is DirectMdlTransport {
	if (transport !== DIRECT_MDL_TRANSPORT) {
		throw new Error('DIRECT_MDL_TRANSPORT_MISMATCH');
	}
}

function sanitizeErrorMessage(message: string): string {
	// eslint-disable-next-line no-control-regex
	const sanitized = message
		.replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 256);
	return sanitized.length > 0 ? sanitized : 'Verification failed';
}

async function requireSession(sessionId: string, platform?: Platform): Promise<DirectMdlSession> {
	const session = await getSession(sessionId, platform);
	if (!session) throw new Error('DIRECT_MDL_SESSION_NOT_FOUND_OR_EXPIRED');
	return session;
}

function randomBase64Url(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createDirectMdlSession(
	input: CreateDirectMdlSessionInput,
	platform?: Platform
): Promise<DirectMdlSessionHandle> {
	assertNonEmpty('desktopUserId', input.desktopUserId);
	assertNonEmpty('clientId', input.clientId);
	assertNonEmpty('responseUri', input.responseUri);
	assertNonEmpty('requestUri', input.requestUri);
	if (input.id !== undefined) assertSessionId(input.id);
	if (input.nonce !== undefined) assertBase64UrlToken('nonce', input.nonce);
	if (input.state !== undefined) assertBase64UrlToken('state', input.state);
	if (input.transactionId !== undefined) {
		assertBase64UrlToken('transactionId', input.transactionId);
	}

	const now = Date.now();
	const session: DirectMdlSession = {
		id: input.id ?? crypto.randomUUID(),
		desktopUserId: input.desktopUserId,
		transport: DIRECT_MDL_TRANSPORT,
		clientId: input.clientId,
		responseUri: input.responseUri,
		requestUri: input.requestUri,
		nonce: input.nonce ?? randomBase64Url(24),
		state: input.state ?? randomBase64Url(24),
		transactionId: input.transactionId ?? randomBase64Url(16),
		status: 'created',
		createdAt: now,
		expiresAt: now + DIRECT_MDL_SESSION_TTL_SECONDS * 1000
	};

	await putSession(session, platform);
	await putStateIndex(session, platform);

	return {
		id: session.id,
		transactionId: session.transactionId,
		nonce: session.nonce,
		state: session.state,
		requestUri: session.requestUri,
		responseUri: session.responseUri,
		clientId: session.clientId,
		transport: session.transport,
		expiresAt: session.expiresAt
	};
}

export async function markDirectMdlRequestFetched(
	sessionId: string,
	input: { transport: string; walletNonce?: string; requestObjectJwt?: string },
	platform?: Platform
): Promise<DirectMdlSession> {
	assertTransport(input.transport);
	if (input.walletNonce !== undefined) assertBase64UrlToken('walletNonce', input.walletNonce);
	if (input.requestObjectJwt !== undefined)
		assertNonEmpty('requestObjectJwt', input.requestObjectJwt);
	const session = await requireSession(sessionId, platform);
	if (session.status === 'completed' || session.status === 'failed') {
		throw new Error('DIRECT_MDL_SESSION_TERMINAL');
	}
	if (session.status === 'request_fetched') {
		if ((session.walletNonce ?? null) !== (input.walletNonce ?? null)) {
			throw new Error('DIRECT_MDL_WALLET_NONCE_MISMATCH');
		}
		return session;
	}

	session.status = 'request_fetched';
	session.requestFetchedAt = Date.now();
	if (input.walletNonce) session.walletNonce = input.walletNonce;
	if (input.requestObjectJwt) session.requestObjectJwt = input.requestObjectJwt;
	await putSession(session, platform);
	return session;
}

export async function completeDirectMdlSession(
	sessionId: string,
	input: { transport: string; state: string; result?: DirectMdlCompletionResult },
	platform?: Platform
): Promise<DirectMdlSession> {
	assertTransport(input.transport);
	const session = await requireSession(sessionId, platform);
	if (session.status === 'completed' || session.status === 'failed') {
		throw new Error('DIRECT_MDL_SESSION_TERMINAL');
	}
	if (session.status !== 'request_fetched') {
		throw new Error('DIRECT_MDL_SESSION_REQUEST_NOT_FETCHED');
	}
	if (input.state !== session.state) {
		throw new Error('DIRECT_MDL_STATE_MISMATCH');
	}

	session.status = 'completed';
	session.completedAt = Date.now();
	if (input.result) session.result = input.result;
	await putSession(session, platform);
	return session;
}

export async function getDirectMdlSessionByState(
	state: string,
	platform?: Platform
): Promise<DirectMdlSession | null> {
	assertBase64UrlToken('state', state);
	const key = stateKvKey(state);
	const kv = getKv(platform);
	let sessionId: string | null = null;
	if (kv) {
		sessionId = await kv.get(key);
	} else {
		const stored = devDirectMdlStore.get(key);
		if (stored && stored.expires > Date.now()) {
			sessionId = stored.data;
		} else if (stored) {
			devDirectMdlStore.delete(key);
		}
	}
	if (!sessionId) return null;
	const session = await getSession(sessionId, platform);
	if (!session) {
		if (kv) await kv.delete(key);
		else devDirectMdlStore.delete(key);
	}
	return session;
}

export async function failDirectMdlSession(
	sessionId: string,
	errorMessage: string,
	platform?: Platform,
	transport: string = DIRECT_MDL_TRANSPORT
): Promise<void> {
	assertTransport(transport);
	const session = await getSession(sessionId, platform);
	if (!session || session.status === 'completed') return;

	session.status = 'failed';
	session.failedAt = Date.now();
	session.errorMessage = sanitizeErrorMessage(errorMessage);
	await putSession(session, platform);
}

export async function getDirectMdlSession(
	sessionId: string,
	platform?: Platform
): Promise<DirectMdlSession | null> {
	return getSession(sessionId, platform);
}

export async function deleteDirectMdlSession(
	sessionId: string,
	platform?: Platform
): Promise<void> {
	const kv = getKv(platform);
	if (kv) {
		await kv.delete(kvKey(sessionId));
		return;
	}
	devDirectMdlStore.delete(kvKey(sessionId));
}
