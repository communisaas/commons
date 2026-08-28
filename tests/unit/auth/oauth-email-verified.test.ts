import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Email is the anti-sybil control, and it was being asserted rather than
 * checked: both live providers send a verified flag, neither mapper read it,
 * and the callback treated an absent claim as an affirmative one. Every Google
 * and LinkedIn signup was recorded verified regardless of what the provider
 * said — and would have been even if a provider explicitly said otherwise.
 *
 * These cases fail against that code and pass against the fix.
 */
describe('OAuth mappers carry the provider’s own verified claim', () => {
	let mod: typeof import('$lib/core/auth/oauth-providers');
	let google: ReturnType<typeof mod.getGoogleConfig>;
	let linkedin: ReturnType<typeof mod.getLinkedInConfig>;

	beforeEach(async () => {
		vi.resetModules();
		process.env.OAUTH_REDIRECT_BASE_URL = 'http://localhost:5173';
		process.env.GOOGLE_CLIENT_ID = 'google-test-id';
		process.env.GOOGLE_CLIENT_SECRET = 'google-test-secret';
		process.env.LINKEDIN_CLIENT_ID = 'linkedin-test-id';
		process.env.LINKEDIN_CLIENT_SECRET = 'linkedin-test-secret';
		mod = await import('$lib/core/auth/oauth-providers');
		google = mod.getGoogleConfig();
		linkedin = mod.getLinkedInConfig();
	});

	const googleUser = (extra: Record<string, unknown>) => ({
		id: '1',
		email: 'a@example.test',
		name: 'A',
		picture: 'https://example.test/a.png',
		...extra
	});
	const linkedinUser = (extra: Record<string, unknown>) => ({
		sub: '1',
		email: 'a@example.test',
		name: 'A',
		picture: 'https://example.test/a.png',
		...extra
	});

	it('reads Google’s OIDC email_verified', () => {
		expect(google.mapUserData(googleUser({ email_verified: true })).emailVerified).toBe(true);
		expect(google.mapUserData(googleUser({ email_verified: false })).emailVerified).toBe(false);
	});

	it('reads Google’s v2 verified_email', () => {
		expect(google.mapUserData(googleUser({ verified_email: true })).emailVerified).toBe(true);
		expect(google.mapUserData(googleUser({ verified_email: false })).emailVerified).toBe(false);
	});

	it('reads LinkedIn’s email_verified', () => {
		expect(linkedin.mapUserData(linkedinUser({ email_verified: true })).emailVerified).toBe(true);
		expect(linkedin.mapUserData(linkedinUser({ email_verified: false })).emailVerified).toBe(false);
	});

	it('keeps an absent claim absent rather than inventing one', () => {
		// The whole defect in one assertion: this used to become `true` one layer
		// up. It must stay undefined so the caller can refuse it.
		expect(google.mapUserData(googleUser({})).emailVerified).toBeUndefined();
		expect(linkedin.mapUserData(linkedinUser({})).emailVerified).toBeUndefined();
	});

	it('accepts a string-serialised flag', () => {
		expect(google.mapUserData(googleUser({ email_verified: 'false' })).emailVerified).toBe(false);
		expect(google.mapUserData(googleUser({ email_verified: 'true' })).emailVerified).toBe(true);
	});
});
