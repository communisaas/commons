import { describe, it, expect } from 'vitest';
import { canonicalizeOrRedirect } from '$lib/server/canonical-slug';

// SvelteKit's `redirect()` throws an object with status + location. We catch
// and inspect rather than mocking the throw mechanism.
function captureRedirect(fn: () => void): { status: number; location: string } | null {
	try {
		fn();
		return null;
	} catch (e: unknown) {
		const err = e as { status?: number; location?: string };
		if (err.status && err.location) {
			return { status: err.status, location: err.location };
		}
		throw e;
	}
}

describe('canonicalizeOrRedirect', () => {
	it('does nothing when canonical is null', () => {
		const out = captureRedirect(() =>
			canonicalizeOrRedirect(null, 'B001230', (s) => `/dm/${s}`)
		);
		expect(out).toBeNull();
	});

	it('does nothing when canonical equals requested', () => {
		const out = captureRedirect(() =>
			canonicalizeOrRedirect('B001230', 'B001230', (s) => `/dm/${s}`)
		);
		expect(out).toBeNull();
	});

	it('throws 302 redirect to the built path when canonical differs', () => {
		const out = captureRedirect(() =>
			canonicalizeOrRedirect('B001230', 'kt2abc123', (s) => `/dm/${s}`)
		);
		expect(out).not.toBeNull();
		expect(out!.status).toBe(302);
		expect(out!.location).toBe('/dm/B001230');
	});

	it('honors the buildPath callback for nested routes', () => {
		const out = captureRedirect(() =>
			canonicalizeOrRedirect('B001230', 'kt2abc123', (s) => `/dm/${s}/scorecard`)
		);
		expect(out).not.toBeNull();
		expect(out!.location).toBe('/dm/B001230/scorecard');
	});

	it('honors the buildPath callback for API surfaces', () => {
		const out = captureRedirect(() =>
			canonicalizeOrRedirect('B001230', 'kt2abc123', (s) => `/api/dm/${s}/scorecard`)
		);
		expect(out).not.toBeNull();
		expect(out!.location).toBe('/api/dm/B001230/scorecard');
	});

	it('URI-encodes canonical slugs that contain reserved characters', () => {
		// Realistic case: an openstates slug with `/` or `:` would otherwise be
		// interpreted as path segment separators.
		const out = captureRedirect(() =>
			canonicalizeOrRedirect('ocd-person/abc:123', 'kt2abc123', (s) => `/dm/${s}`)
		);
		expect(out).not.toBeNull();
		expect(out!.location).toBe('/dm/ocd-person%2Fabc%3A123');
	});
});
