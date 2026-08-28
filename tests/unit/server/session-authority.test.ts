import { describe, expect, it } from 'vitest';
import { evaluateSessionWindow } from '$lib/server/session-authority';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 19);

describe('session authority request-boundary expiry', () => {
	it('accepts a stable session without requesting renewal', () => {
		expect(
			evaluateSessionWindow(
				{ expiresAt: NOW + 20 * DAY, absoluteExpiresAt: NOW + 60 * DAY },
				NOW
			)
		).toEqual({
			valid: true,
			renewed: false,
			effectiveExpiresAt: NOW + 20 * DAY,
			renewTo: null
		});
	});

	it('renews near expiry but never crosses the immutable lifetime', () => {
		expect(
			evaluateSessionWindow(
				{ expiresAt: NOW + 10 * DAY, absoluteExpiresAt: NOW + 18 * DAY },
				NOW
			)
		).toEqual({
			valid: true,
			renewed: true,
			effectiveExpiresAt: NOW + 18 * DAY,
			renewTo: NOW + 18 * DAY
		});
	});

	it('rejects stored, absolute, and malformed expiry before token minting', () => {
		expect(
			evaluateSessionWindow({ expiresAt: NOW, absoluteExpiresAt: NOW + DAY }, NOW)
		).toEqual({ valid: false });
		expect(
			evaluateSessionWindow({ expiresAt: NOW + DAY, absoluteExpiresAt: NOW }, NOW)
		).toEqual({ valid: false });
		expect(
			evaluateSessionWindow(
				{ expiresAt: Number.NaN, absoluteExpiresAt: NOW + DAY },
				NOW
			)
		).toEqual({ valid: false });
	});
});
