import { afterEach, describe, expect, it, vi } from 'vitest';

import { OPENID4VP_DC_API_PROTOCOL } from '../../../src/lib/config/features';
import {
	getSupportedProtocols,
	shouldUseDigitalCredentialsFlow
} from '../../../src/lib/core/identity/digital-credentials-api';

describe('Digital Credentials browser capability gate', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('does not require a mobile user agent when OpenID4VP is supported and enabled', () => {
		vi.stubGlobal('DigitalCredential', {
			userAgentAllowsProtocol: (protocol: string) => protocol === OPENID4VP_DC_API_PROTOCOL
		});

		expect(getSupportedProtocols()).toEqual({ mdoc: false, openid4vp: true });
		expect(shouldUseDigitalCredentialsFlow()).toBe(true);
	});

	it('does not infer a protocol when the browser exposes DigitalCredential without protocol probing', () => {
		vi.stubGlobal('DigitalCredential', {});

		expect(getSupportedProtocols()).toEqual({ mdoc: false, openid4vp: false });
		expect(shouldUseDigitalCredentialsFlow()).toBe(false);
	});

	it('rejects legacy OpenID4VP-only browser experiments for the launch gate', () => {
		vi.stubGlobal('DigitalCredential', {
			userAgentAllowsProtocol: (protocol: string) => protocol === 'openid4vp'
		});

		expect(getSupportedProtocols()).toEqual({ mdoc: false, openid4vp: false });
		expect(shouldUseDigitalCredentialsFlow()).toBe(false);
	});
});
