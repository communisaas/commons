import { describe, expect, it } from 'vitest';
import { decode } from 'cbor-web';
import {
	buildOpenId4VpDcApiSessionTranscript,
	normalizeDcApiOrigin,
	normalizeDcApiWebOrigin
} from '$lib/core/identity/oid4vp-dc-api-handover';

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

describe('OpenID4VP DC API handover SessionTranscript', () => {
	it('matches the OpenID4VP final spec CBOR vector', async () => {
		const jwkThumbprint = hexToBytes(
			'4283ec927ae0f208daaa2d026a814f2b22dca52cf85ffa8f3f8626c6bd669047'
		);

		const parts = await buildOpenId4VpDcApiSessionTranscript({
			origin: 'https://example.com',
			nonce: 'exc7gBkxjx1rdc9udRrveKvSsJIq80avlXeLHhGwqtA',
			jwkThumbprint
		});

		expect(bytesToHex(parts.handoverInfoBytes)).toBe(
			'837368747470733a2f2f6578616d706c652e636f6d782b6578633767426b786a7831726463397564527276654b7653734a4971383061766c58654c4868477771744158204283ec927ae0f208daaa2d026a814f2b22dca52cf85ffa8f3f8626c6bd669047'
		);
		expect(bytesToHex(parts.handoverInfoHash)).toBe(
			'fbece366f4212f9762c74cfdbf83b8c69e371d5d68cea09cb4c48ca6daab761a'
		);
		expect(bytesToHex(parts.sessionTranscriptBytes)).toBe(
			'83f6f682764f70656e4944345650444341504948616e646f7665725820fbece366f4212f9762c74cfdbf83b8c69e371d5d68cea09cb4c48ca6daab761a'
		);
	});

	it('builds the unsigned dc_api handover with a null JWK thumbprint', async () => {
		const parts = await buildOpenId4VpDcApiSessionTranscript({
			origin: 'https://verifier.example/',
			nonce: 'nonce-123'
		});

		expect(parts.handoverInfo).toEqual(['https://verifier.example', 'nonce-123', null]);
		expect(parts.handover[0]).toBe('OpenID4VPDCAPIHandover');
		expect(parts.handover[1]).toHaveLength(32);
		expect(parts.sessionTranscript).toEqual([null, null, parts.handover]);

		const decoded = decode(parts.sessionTranscriptBytes) as unknown[];
		expect(decoded[0]).toBeNull();
		expect(decoded[1]).toBeNull();
		const decodedHandover = decoded[2] as [string, Uint8Array];
		expect(decodedHandover[0]).toBe(parts.handover[0]);
		expect(bytesToHex(new Uint8Array(decodedHandover[1]))).toBe(
			bytesToHex(parts.handover[1])
		);
	});

	it('binds the handover hash to the origin and nonce', async () => {
		const first = await buildOpenId4VpDcApiSessionTranscript({
			origin: 'https://verifier.example',
			nonce: 'nonce-a'
		});
		const second = await buildOpenId4VpDcApiSessionTranscript({
			origin: 'https://verifier.example',
			nonce: 'nonce-b'
		});
		const third = await buildOpenId4VpDcApiSessionTranscript({
			origin: 'https://other.example',
			nonce: 'nonce-a'
		});

		expect(bytesToHex(first.handoverInfoHash)).not.toBe(bytesToHex(second.handoverInfoHash));
		expect(bytesToHex(first.handoverInfoHash)).not.toBe(bytesToHex(third.handoverInfoHash));
	});

	it('normalizes web origins and allows localhost development', () => {
		expect(normalizeDcApiOrigin('https://example.com/')).toBe('https://example.com');
		expect(normalizeDcApiOrigin('https://example.com:443')).toBe('https://example.com');
		expect(normalizeDcApiOrigin('http://localhost:5173')).toBe('http://localhost:5173');
		expect(() => normalizeDcApiWebOrigin('android:apk-key-hash:abc123')).toThrow(/web origin/);
		expect(() =>
			normalizeDcApiWebOrigin('http://localhost:5173', { allowLocalhostHttp: false })
		).toThrow(/https/);
	});

	it('rejects malformed or non-origin verifier strings', async () => {
		await expect(
			buildOpenId4VpDcApiSessionTranscript({
				origin: 'https://example.com/path',
				nonce: 'nonce-123'
			})
		).rejects.toThrow(/origin/);

		await expect(
			buildOpenId4VpDcApiSessionTranscript({
				origin: 'http://example.com',
				nonce: 'nonce-123'
			})
		).rejects.toThrow(/https/);

		await expect(
			buildOpenId4VpDcApiSessionTranscript({
				origin: 'origin:https://example.com',
				nonce: 'nonce-123'
			})
		).rejects.toThrow(/origin:/);
	});

	it('validates nonce and encrypted-response thumbprint inputs', async () => {
		await expect(
			buildOpenId4VpDcApiSessionTranscript({
				origin: 'https://example.com',
				nonce: ''
			})
		).rejects.toThrow(/nonce/);

		await expect(
			buildOpenId4VpDcApiSessionTranscript({
				origin: 'https://example.com',
				nonce: 'nonce-123',
				jwkThumbprint: new Uint8Array(31)
			})
		).rejects.toThrow(/32-byte/);
	});
});
