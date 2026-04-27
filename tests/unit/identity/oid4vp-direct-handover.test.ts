import { describe, expect, it } from 'vitest';
import { decode } from 'cbor-web';
import { buildOpenId4VpDcApiSessionTranscript } from '$lib/core/identity/oid4vp-dc-api-handover';
import {
	buildOpenId4VpDirectSessionTranscript,
	normalizeOpenId4VpClientId,
	normalizeOpenId4VpResponseUri
} from '$lib/core/identity/oid4vp-direct-handover';

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
	}
	return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

describe('OpenID4VP direct-post handover SessionTranscript', () => {
	it('builds the OpenID4VPHandover structure with client_id, nonce, thumbprint, and response_uri', async () => {
		const jwkThumbprint = hexToBytes(
			'4283ec927ae0f208daaa2d026a814f2b22dca52cf85ffa8f3f8626c6bd669047'
		);

		const parts = await buildOpenId4VpDirectSessionTranscript({
			clientId: 'redirect_uri:https://client.example.org/cb',
			nonce: 'n-0S6_WzA2Mj',
			responseUri: 'https://client.example.org/cb',
			jwkThumbprint
		});

		expect(parts.handoverInfo).toEqual([
			'redirect_uri:https://client.example.org/cb',
			'n-0S6_WzA2Mj',
			jwkThumbprint,
			'https://client.example.org/cb'
		]);
		expect(parts.handover[0]).toBe('OpenID4VPHandover');
		expect(parts.handover[1]).toHaveLength(32);
		expect(parts.sessionTranscript).toEqual([null, null, parts.handover]);

		const decoded = decode(parts.sessionTranscriptBytes) as unknown[];
		expect(decoded[0]).toBeNull();
		expect(decoded[1]).toBeNull();
		const decodedHandover = decoded[2] as [string, Uint8Array];
		expect(decodedHandover[0]).toBe('OpenID4VPHandover');
		expect(bytesToHex(new Uint8Array(decodedHandover[1]))).toBe(
			bytesToHex(parts.handoverInfoHash)
		);
	});

	it('locks a golden direct-post CBOR vector', async () => {
		const parts = await buildOpenId4VpDirectSessionTranscript({
			clientId: 'redirect_uri:https://client.example.org/cb',
			nonce: 'n-0S6_WzA2Mj',
			responseUri: 'https://client.example.org/cb'
		});

		expect(bytesToHex(parts.handoverInfoBytes)).toBe(
			'84782a72656469726563745f7572693a68747470733a2f2f636c69656e742e6578616d706c652e6f72672f63626c6e2d3053365f577a41324d6af6781d68747470733a2f2f636c69656e742e6578616d706c652e6f72672f6362'
		);
		expect(bytesToHex(parts.handoverInfoHash)).toBe(
			'209488350e85751fb093206f2aa0943a5a6957807fab0c59920753527ab58b6b'
		);
		expect(bytesToHex(parts.sessionTranscriptBytes)).toBe(
			'83f6f682714f70656e494434565048616e646f7665725820209488350e85751fb093206f2aa0943a5a6957807fab0c59920753527ab58b6b'
		);
	});

	it('separates direct-post and DC API handover bytes for the same transaction nonce', async () => {
		const nonce = 'same-nonce';
		const direct = await buildOpenId4VpDirectSessionTranscript({
			clientId: 'redirect_uri:https://verifier.example/api/identity/direct-mdl/complete',
			nonce,
			responseUri: 'https://verifier.example/api/identity/direct-mdl/complete'
		});
		const dcApi = await buildOpenId4VpDcApiSessionTranscript({
			origin: 'https://verifier.example',
			nonce
		});

		expect(direct.handover[0]).toBe('OpenID4VPHandover');
		expect(dcApi.handover[0]).toBe('OpenID4VPDCAPIHandover');
		expect(bytesToHex(direct.handoverInfoHash)).not.toBe(bytesToHex(dcApi.handoverInfoHash));
		expect(bytesToHex(direct.sessionTranscriptBytes)).not.toBe(
			bytesToHex(dcApi.sessionTranscriptBytes)
		);
		expect(bytesToHex(direct.sessionTranscriptBytes)).not.toContain(
			bytesToHex(new TextEncoder().encode('OpenID4VPDCAPIHandover'))
		);
	});

	it('validates client_id, response_uri, nonce, and encrypted-response thumbprint inputs', async () => {
		expect(normalizeOpenId4VpClientId('redirect_uri:https://client.example/cb')).toBe(
			'redirect_uri:https://client.example/cb'
		);
		expect(normalizeOpenId4VpResponseUri('https://client.example/cb?x=1')).toBe(
			'https://client.example/cb?x=1'
		);
		expect(
			normalizeOpenId4VpResponseUri('http://localhost:5173/cb', {
				allowLocalhostHttp: true
			})
		).toBe('http://localhost:5173/cb');
		expect(normalizeOpenId4VpResponseUri('https://client.example:443/cb')).toBe(
			'https://client.example:443/cb'
		);
		expect(normalizeOpenId4VpClientId('redirect_uri:https://client.example:443/cb')).toBe(
			'redirect_uri:https://client.example:443/cb'
		);

		await expect(
			buildOpenId4VpDirectSessionTranscript({
				clientId: '',
				nonce: 'nonce-123',
				responseUri: 'https://client.example/cb'
			})
		).rejects.toThrow(/client_id/);

		await expect(
			buildOpenId4VpDirectSessionTranscript({
				clientId: 'redirect_uri:https://client.example/cb',
				nonce: ' nonce-123',
				responseUri: 'https://client.example/cb'
			})
		).rejects.toThrow(/nonce/);

		await expect(
			buildOpenId4VpDirectSessionTranscript({
				clientId: 'redirect_uri:https://client.example/cb',
				nonce: 'nonce-123',
				responseUri: 'https://client.example/cb#fragment'
			})
		).rejects.toThrow(/fragment/);

		await expect(
			buildOpenId4VpDirectSessionTranscript({
				clientId: 'redirect_uri:https://client.example/cb',
				nonce: 'nonce-123',
				responseUri: 'https://client.example/cb',
				jwkThumbprint: new Uint8Array(31)
			})
		).rejects.toThrow(/32-byte/);
	});
});
