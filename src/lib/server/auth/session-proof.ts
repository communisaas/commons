const PROOF_SEPARATOR = '\u001f';

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

export function serverProofMessage(parts: Array<string | number>): string {
	return parts.map((part) => String(part)).join(PROOF_SEPARATOR);
}

export async function createHmacProof(message: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
	return toHex(new Uint8Array(signature));
}

export async function createServerProof(
	parts: Array<string | number>,
	secret: string
): Promise<string> {
	return createHmacProof(serverProofMessage(parts), secret);
}

export async function createSessionCreationProof(
	userId: string,
	expiresAt: number,
	secret: string
): Promise<string> {
	return createHmacProof(`${userId}|${expiresAt}`, secret);
}
