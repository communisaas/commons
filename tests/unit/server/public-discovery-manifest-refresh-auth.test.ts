import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { privateEnv } = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));

import {
	matchPublicDiscoveryManifestRefreshSecret,
	matchPublicDiscoveryManifestRefreshSecretValues
} from '$lib/server/public-discovery-manifest-refresh-auth';

describe('public-discovery manifest refresh capability', () => {
	beforeEach(() => {
		for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	});

	it('fails configured-closed without the dedicated capability', () => {
		expect(matchPublicDiscoveryManifestRefreshSecret('anything')).toEqual({
			ok: false,
			reason: 'not_configured'
		});
	});

	it('accepts the exact active secret and keeps the dynamic wrapper private', () => {
		const active = 'active-'.padEnd(64, 'a');
		privateEnv.DISCOVERY_MANIFEST_REFRESH_SECRET = active;

		expect(matchPublicDiscoveryManifestRefreshSecret(active)).toEqual({ ok: true });
		expect(matchPublicDiscoveryManifestRefreshSecret('x'.repeat(64))).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(matchPublicDiscoveryManifestRefreshSecret('short')).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it('accepts active and previous during a non-atomic sender rotation', () => {
		const oldSecret = 'old-'.padEnd(64, 'o');
		const newSecret = 'new-'.padEnd(64, 'n');

		// Before the receiver rollout, only the old outbound generation works.
		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(oldSecret, oldSecret, undefined)
		).toEqual({ ok: true });
		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(newSecret, oldSecret, undefined)
		).toEqual({ ok: false, reason: 'invalid' });

		// Pages rolls first: old Convex/Worker sends and newly rotated sends both work.
		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(oldSecret, newSecret, oldSecret)
		).toEqual({ ok: true });
		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(newSecret, newSecret, oldSecret)
		).toEqual({ ok: true });

		// Once both senders use active, retiring previous closes the old bearer.
		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(oldSecret, newSecret, undefined)
		).toEqual({ ok: false, reason: 'invalid' });
	});

	it('ignores a malformed previous value without bricking active verification', () => {
		const active = 'active-'.padEnd(64, 'a');
		const malformedPrevious = 'too-short';

		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(
				active,
				active,
				malformedPrevious
			)
		).toEqual({ ok: true });
		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(
				malformedPrevious,
				active,
				malformedPrevious
			)
		).toEqual({ ok: false, reason: 'invalid' });
	});

	it('enforces the minimum in UTF-8 bytes rather than JavaScript code units', () => {
		const exactlyThirtyTwoBytes = 'é'.repeat(16);
		expect(exactlyThirtyTwoBytes).toHaveLength(16);

		expect(
			matchPublicDiscoveryManifestRefreshSecretValues(
				exactlyThirtyTwoBytes,
				exactlyThirtyTwoBytes,
				undefined
			)
		).toEqual({ ok: true });
		expect(
			matchPublicDiscoveryManifestRefreshSecretValues('x', 'é'.repeat(15), undefined)
		).toEqual({ ok: false, reason: 'not_configured' });
	});

	it('pins both candidate comparisons to fixed-size SHA-256 digests', () => {
		const active = 'active-'.padEnd(64, 'a');
		const previous = 'previous-'.padEnd(64, 'p');

		expect(
			matchPublicDiscoveryManifestRefreshSecretValues('short', active, previous)
		).toEqual({ ok: false, reason: 'invalid' });

		const source = readFileSync(
			resolve(process.cwd(), 'src/lib/server/public-discovery-manifest-refresh-auth.ts'),
			'utf8'
		);
		const matcher = source.slice(
			source.indexOf('export function matchPublicDiscoveryManifestRefreshSecretValues'),
			source.indexOf('export function matchPublicDiscoveryManifestRefreshSecret(', 1)
		);
		expect(matcher.match(/timingSafeEqual\(/g)).toHaveLength(2);
		expect(source).toMatch(/function secretDigest[\s\S]*?createHash\('sha256'\)/);
		expect(matcher).not.toMatch(/presentedDigest\.length\s*!==/);
	});

	it('does not return or log either secret generation', () => {
		const active = 'active-'.padEnd(64, 'a');
		const previous = 'previous-'.padEnd(64, 'p');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const accepted = matchPublicDiscoveryManifestRefreshSecretValues(previous, active, previous);
		const rejected = matchPublicDiscoveryManifestRefreshSecretValues('attacker', active, previous);
		const observable = JSON.stringify({ accepted, rejected, warn: warn.mock.calls, error: error.mock.calls });

		expect(observable).not.toContain(active);
		expect(observable).not.toContain(previous);
		expect(accepted).toEqual({ ok: true });
		expect(rejected).toEqual({ ok: false, reason: 'invalid' });
		warn.mockRestore();
		error.mockRestore();
	});
});
