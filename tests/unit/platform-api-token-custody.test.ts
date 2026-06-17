import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	hasPlatformApiCredentialKey,
	openPlatformApiCredential,
	sealPlatformApiCredential
} from '$lib/server/platform-api-token-custody';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('platform API token custody', () => {
	let originalPlatformKey: string | undefined;
	let originalOauthKey: string | undefined;

	beforeEach(() => {
		originalPlatformKey = process.env.PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY;
		originalOauthKey = process.env.OAUTH_ENCRYPTION_KEY;
		process.env.PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
		delete process.env.OAUTH_ENCRYPTION_KEY;
	});

	afterEach(() => {
		if (originalPlatformKey === undefined) {
			delete process.env.PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY;
		} else {
			process.env.PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY = originalPlatformKey;
		}
		if (originalOauthKey === undefined) {
			delete process.env.OAUTH_ENCRYPTION_KEY;
		} else {
			process.env.OAUTH_ENCRYPTION_KEY = originalOauthKey;
		}
	});

	it('seals and opens a selected platform credential', async () => {
		const sealed = await sealPlatformApiCredential('token-secret', {
			orgSlug: 'local-first-sf',
			source: 'everyaction',
			storedAt: 123
		});

		expect(sealed.version).toBe('platform-api-token-v1');
		expect(sealed.source).toBe('everyaction');
		expect(sealed.storedAt).toBe(123);
		expect(sealed.ciphertext).not.toContain('token-secret');
		expect(await openPlatformApiCredential(sealed, { orgSlug: 'local-first-sf' })).toBe(
			'token-secret'
		);
	});

	it('binds ciphertext to org and platform source', async () => {
		const sealed = await sealPlatformApiCredential('same-token', {
			orgSlug: 'local-first-sf',
			source: 'mailchimp'
		});

		await expect(openPlatformApiCredential(sealed, { orgSlug: 'other-org' })).rejects.toThrow();

		const otherSource = await sealPlatformApiCredential('same-token', {
			orgSlug: 'local-first-sf',
			source: 'nationbuilder'
		});
		expect(otherSource.ciphertext).not.toBe(sealed.ciphertext);
	});

	it('requires a configured custody key', async () => {
		delete process.env.PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY;
		delete process.env.OAUTH_ENCRYPTION_KEY;

		expect(hasPlatformApiCredentialKey()).toBe(false);
		await expect(
			sealPlatformApiCredential('token-secret', {
				orgSlug: 'local-first-sf',
				source: 'action_network'
			})
		).rejects.toThrow('PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY is not configured');
	});

	it('accepts the OAuth encryption key as a transitional fallback', async () => {
		delete process.env.PLATFORM_API_CREDENTIAL_ENCRYPTION_KEY;
		process.env.OAUTH_ENCRYPTION_KEY = TEST_KEY;

		expect(hasPlatformApiCredentialKey()).toBe(true);
		const sealed = await sealPlatformApiCredential('fallback-token', {
			orgSlug: 'local-first-sf',
			source: 'salesforce'
		});

		expect(sealed.keySource).toBe('OAUTH_ENCRYPTION_KEY');
		expect(await openPlatformApiCredential(sealed, { orgSlug: 'local-first-sf' })).toBe(
			'fallback-token'
		);
	});
});
