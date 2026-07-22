import { describe, expect, it, vi } from 'vitest';
import {
	parseSessionCookieEnvelope,
	resolveSessionCookieSecrets,
	resolveSessionFromCookie,
	sealSessionCookie,
	verifySessionCookie
} from '../../../src/lib/server/auth/session-cookie';

const NOW = Date.UTC(2026, 6, 19);
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRES_AT = NOW + 30 * DAY_MS;
const ACTIVE_SECRET = 'a'.repeat(64);
const PREVIOUS_SECRET = 'b'.repeat(64);
const WRONG_SECRET = 'c'.repeat(64);
function flipSignatureChar(signature: string): string {
	return `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
}

describe('session cookie envelope', () => {
	it('round-trips an active-key cookie', async () => {
		const sessionId = 'session_abc-123';
		const value = await sealSessionCookie(sessionId, EXPIRES_AT, ACTIVE_SECRET);

		expect(value).toMatch(/^v1\.session_abc-123\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/);
		await expect(
			verifySessionCookie(value, { activeSecret: ACTIVE_SECRET, now: NOW })
		).resolves.toEqual({
			valid: true,
			sessionId,
			expiresAt: EXPIRES_AT,
			needsReseal: false
		});
	});

	it('verifies previous-key cookies only when the previous key is supplied', async () => {
		const value = await sealSessionCookie('session_rotation', EXPIRES_AT, PREVIOUS_SECRET);

		await expect(
			verifySessionCookie(value, {
				activeSecret: ACTIVE_SECRET,
				previousSecret: PREVIOUS_SECRET,
				now: NOW
			})
		).resolves.toMatchObject({
			valid: true,
			sessionId: 'session_rotation',
			expiresAt: EXPIRES_AT,
			needsReseal: true
		});

		const withoutPrevious = await verifySessionCookie(value, {
			activeSecret: ACTIVE_SECRET,
			now: NOW
		});
		expect(withoutPrevious.valid).toBe(false);
	});

	it('rejects tampered, malformed, oversized, expired, and implausibly-future cookies', async () => {
		const sealed = await sealSessionCookie('session_original', EXPIRES_AT, ACTIVE_SECRET);
		const [version, sessionId, expiresAt, signature] = sealed.split('.');
		const wrongSecret = await sealSessionCookie('session_wrong_secret', EXPIRES_AT, WRONG_SECRET);
		const expired = await sealSessionCookie('session_expired', NOW - 1, ACTIVE_SECRET);
		const farFuture = await sealSessionCookie('session_far_future', NOW + 92 * DAY_MS, ACTIVE_SECRET);

		const vectors = [
			{
				name: 'tampered session id',
				value: [version, 'session_tampered', expiresAt, signature].join('.')
			},
			{
				name: 'tampered expiry',
				value: [version, sessionId, String(EXPIRES_AT + 1000), signature].join('.')
			},
			{
				name: 'flipped signature character',
				value: [version, sessionId, expiresAt, flipSignatureChar(signature)].join('.')
			},
			{ name: 'stripped signature segment', value: [version, sessionId, expiresAt].join('.') },
			{ name: 'wrong-secret signature', value: wrongSecret },
			{ name: 'oversized cookie', value: 'x'.repeat(193), preCryptoNull: true },
			{ name: 'raw session id', value: 'session_legacy_raw_id', preCryptoNull: true },
			{ name: 'random junk', value: 'not-a-cookie', preCryptoNull: true },
			{ name: 'expired cookie', value: expired, preCryptoNull: true },
			{ name: 'far-future cookie', value: farFuture, preCryptoNull: true }
		];

		for (const vector of vectors) {
			const verification = await verifySessionCookie(vector.value, {
				activeSecret: ACTIVE_SECRET,
				now: NOW
			});
			expect(verification.valid, vector.name).toBe(false);
			if (vector.preCryptoNull) {
				expect(parseSessionCookieEnvelope(vector.value, NOW), vector.name).toBeNull();
			}

			const queryAuthority = vi.fn(async () => ({ ok: true }));
			const resolved = await resolveSessionFromCookie({
				cookieValue: vector.value,
				activeSecret: ACTIVE_SECRET,
				now: NOW,
				queryAuthority
			});
			expect(resolved.status, vector.name).toBe('invalid');
			expect(queryAuthority, vector.name).not.toHaveBeenCalled();
		}
	});

	it('causes zero authority queries for forged-cookie batches and missing cookies', async () => {
		const queryAuthority = vi.fn(async () => ({ ok: true }));

		for (let index = 0; index < 1_000; index += 1) {
			const forged = `v1.forged_${index}.${EXPIRES_AT}.${index % 2 === 0 ? 'A' : 'B'}${'A'.repeat(42)}`;
			const result = await resolveSessionFromCookie({
				cookieValue: forged,
				activeSecret: ACTIVE_SECRET,
				now: NOW,
				queryAuthority
			});
			expect(result.status).toBe('invalid');
		}

		const missing = await resolveSessionFromCookie({
			cookieValue: undefined,
			activeSecret: ACTIVE_SECRET,
			now: NOW,
			queryAuthority
		});
		expect(missing.status).toBe('missing');
		expect(queryAuthority).not.toHaveBeenCalled();
	});

	it('queries authority exactly once with the verified raw session id', async () => {
		const value = await sealSessionCookie('session_verified', EXPIRES_AT, ACTIVE_SECRET);
		const authority = { userId: 'user_123', renewed: false };
		const queryAuthority = vi.fn(async (sessionId: string) => ({ ...authority, sessionId }));

		const result = await resolveSessionFromCookie({
			cookieValue: value,
			activeSecret: ACTIVE_SECRET,
			now: NOW,
			queryAuthority
		});

		expect(result).toEqual({
			status: 'verified',
			sessionId: 'session_verified',
			cookieExpiresAt: EXPIRES_AT,
			needsReseal: false,
			authority: { ...authority, sessionId: 'session_verified' }
		});
		expect(queryAuthority).toHaveBeenCalledOnce();
		expect(queryAuthority).toHaveBeenCalledWith('session_verified');
	});

	it('enforces cookie signing secret hygiene', async () => {
		await expect(sealSessionCookie('session_abc', EXPIRES_AT, undefined)).rejects.toThrow(
			'SESSION_COOKIE_SIGNING_SECRET_NOT_CONFIGURED'
		);
		await expect(sealSessionCookie('session_abc', EXPIRES_AT, 'short')).rejects.toThrow(
			'SESSION_COOKIE_SIGNING_SECRET_TOO_SHORT'
		);
		await expect(sealSessionCookie('session_abc', EXPIRES_AT, 'x'.repeat(1025))).rejects.toThrow(
			'SESSION_COOKIE_SIGNING_SECRET_TOO_LARGE'
		);

		expect(() =>
			resolveSessionCookieSecrets({
				activeSecret: ACTIVE_SECRET,
				previousSecret: ACTIVE_SECRET
			})
		).toThrow('SESSION_COOKIE_SIGNING_SECRET_PREVIOUS_EQUALS_ACTIVE');
		expect(() =>
			resolveSessionCookieSecrets({
				activeSecret: 'short'
			})
		).toThrow('SESSION_COOKIE_SIGNING_SECRET_TOO_SHORT');
		expect(() =>
			resolveSessionCookieSecrets({
				activeSecret: ACTIVE_SECRET,
				previousSecret: 'short'
			})
		).toThrow('SESSION_COOKIE_SIGNING_SECRET_PREVIOUS_TOO_SHORT');
	});
});

