import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	parseSessionCookieEnvelope,
	querySessionAuthorityFromCookie,
	resolveSessionCookieSigningSecrets,
	sealSessionCookie,
	verifySessionCookie
} from '../../../src/lib/server/auth/session-cookie';

const NOW = Date.UTC(2026, 6, 19);
const EXPIRES_AT = NOW + 30 * 24 * 60 * 60 * 1000;
const ACTIVE_SECRET = 'a'.repeat(64);
const PREVIOUS_SECRET = 'b'.repeat(64);
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('versioned session cookie envelope', () => {
	it('reveals the raw session id only after an active-key HMAC verifies', async () => {
		const value = await sealSessionCookie('session_abc-123', EXPIRES_AT, ACTIVE_SECRET);
		expect(value).toMatch(/^v1\.session_abc-123\.[0-9]{13}\.[A-Za-z0-9_-]{43}$/);
		await expect(
			verifySessionCookie(value, { activeSecret: ACTIVE_SECRET, now: NOW })
		).resolves.toEqual({
			valid: true,
			sessionId: 'session_abc-123',
			expiresAt: EXPIRES_AT,
			needsReseal: false
		});
	});

	it('accepts the bounded previous key only for rotation and requests active-key resealing', async () => {
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
			needsReseal: true
		});
	});

	it('keeps cookie rotation keys disjoint from active and previous creation-proof keys', () => {
		const activeCreationSecret = 'c'.repeat(64);
		const previousCreationSecret = 'd'.repeat(64);
		expect(
			resolveSessionCookieSigningSecrets({
				activeSecret: ACTIVE_SECRET,
				previousSecret: PREVIOUS_SECRET,
				sessionCreationSecret: activeCreationSecret,
				previousSessionCreationSecret: previousCreationSecret
			})
		).toEqual({ activeSecret: ACTIVE_SECRET, previousSecret: PREVIOUS_SECRET });

		for (const input of [
			{
				activeSecret: ACTIVE_SECRET,
				sessionCreationSecret: ACTIVE_SECRET
			},
			{
				activeSecret: previousCreationSecret,
				sessionCreationSecret: activeCreationSecret,
				previousSessionCreationSecret: previousCreationSecret
			},
			{
				activeSecret: ACTIVE_SECRET,
				previousSecret: activeCreationSecret,
				sessionCreationSecret: activeCreationSecret,
				previousSessionCreationSecret: previousCreationSecret
			},
			{
				activeSecret: ACTIVE_SECRET,
				previousSecret: previousCreationSecret,
				sessionCreationSecret: activeCreationSecret,
				previousSessionCreationSecret: previousCreationSecret
			},
			{
				activeSecret: ACTIVE_SECRET,
				previousSecret: ACTIVE_SECRET,
				sessionCreationSecret: activeCreationSecret
			}
		]) {
			expect(() => resolveSessionCookieSigningSecrets(input)).toThrow(/SESSION_COOKIE_SIGNING/);
		}
	});

	it('rejects legacy, malformed, oversized, expired, and implausibly-future shapes before crypto', () => {
		for (const value of [
			'session_legacy_raw_id',
			'',
			'v2.session.1780000000000.' + 'A'.repeat(43),
			'v1.bad.id.1780000000000.' + 'A'.repeat(43),
			'v1.session.not-a-clock.' + 'A'.repeat(43),
			`v1.session.${NOW}.${'A'.repeat(43)}`,
			`v1.session.${NOW + 92 * 24 * 60 * 60 * 1000}.${'A'.repeat(43)}`,
			'x'.repeat(193)
		]) {
			expect(parseSessionCookieEnvelope(value, NOW), value.slice(0, 40)).toBeNull();
		}
	});

	it('causes zero authority queries for a high-volume forged-cookie batch', async () => {
		const queryAuthority = vi.fn(async () => ({ status: 'should-not-run' }));
		const onInvalid = vi.fn();
		for (let index = 0; index < 1_000; index += 1) {
			const sessionId = `forged_${index}`;
			const forged = `v1.${sessionId}.${EXPIRES_AT}.${index % 2 ? 'A' : 'B'}${'A'.repeat(42)}`;
			const result = await querySessionAuthorityFromCookie({
				cookieValue: forged,
				activeSecret: ACTIVE_SECRET,
				now: NOW,
				onInvalid,
				queryAuthority
			});
			expect(result.status).toBe('invalid');
		}
		expect(queryAuthority).not.toHaveBeenCalled();
		expect(onInvalid).toHaveBeenCalledTimes(1_000);
	});

	it('queries once with the verified raw id and never with the envelope', async () => {
		const value = await sealSessionCookie('session_verified', EXPIRES_AT, ACTIVE_SECRET);
		const queryAuthority = vi.fn(async (sessionId: string) => ({ sessionId }));
		await expect(
			querySessionAuthorityFromCookie({
				cookieValue: value,
				activeSecret: ACTIVE_SECRET,
				now: NOW,
				onInvalid: vi.fn(),
				queryAuthority
			})
		).resolves.toMatchObject({
			status: 'verified',
			sessionId: 'session_verified',
			authority: { sessionId: 'session_verified' }
		});
		expect(queryAuthority).toHaveBeenCalledOnce();
		expect(queryAuthority).toHaveBeenCalledWith('session_verified');
	});
});

describe('session cookie source contracts', () => {
	it('signs every session setter and runs the local verifier before Convex authority', () => {
		const hooks = source('src/hooks.server.ts');
		const oauth = source('src/lib/core/auth/oauth-callback-handler.ts');
		const passkey = source('src/routes/api/auth/passkey/authenticate/+server.ts');
		const devLogin = source('src/routes/api/internal/dev-login/+server.ts');
		for (const setter of [oauth, passkey, devLogin]) {
			expect(setter).toContain('await sealSessionCookie(');
			expect(setter).not.toMatch(/cookies\.set\(['"]auth-session['"],\s*session\.sessionId/);
		}
		expect(hooks).toContain('querySessionAuthorityFromCookie({');
		expect(hooks).toContain('resolveSessionCookieSigningSecrets({');
		expect(hooks).toContain('queryAuthority: (verifiedSessionId) =>');
		expect(hooks).toContain('const signedCookie = await sealSessionCookie(');
		expect(hooks).not.toMatch(/cookies\.set\(SESSION_COOKIE,\s*session\.id/);
		for (const setter of [hooks, oauth, passkey, devLogin]) {
			expect(setter).toContain('SESSION_COOKIE_SIGNING_SECRET');
			expect(setter).toContain('SESSION_CREATION_SECRET_PREVIOUS');
			expect(setter).toContain('previousSessionCreationSecret:');
		}
		expect(source('convex/authOps.ts')).not.toContain('SESSION_COOKIE_SIGNING_SECRET');
	});

	it('exercises active and previous key domains with four distinct CI values', () => {
		const keys = [
			'SESSION_CREATION_SECRET',
			'SESSION_CREATION_SECRET_PREVIOUS',
			'SESSION_COOKIE_SIGNING_SECRET',
			'SESSION_COOKIE_SIGNING_SECRET_PREVIOUS'
		];
		for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']) {
			const workflow = source(workflowPath);
			const values = keys.map((key) => {
				const match = workflow.match(new RegExp(`^\\s+${key}:\\s+([^\\s#]+)`, 'm'));
				expect(match, `${workflowPath} must define ${key}`).not.toBeNull();
				return match?.[1] ?? '';
			});
			expect(values.every((value) => new TextEncoder().encode(value).byteLength >= 32)).toBe(
				true
			);
			expect(new Set(values).size).toBe(keys.length);
		}
	});
});
