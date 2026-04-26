import { describe, expect, it } from 'vitest';
import {
	FEATURES,
	isAnyMdlProtocolEnabled,
	isMdlBridgeEnabled,
	isMdlProtocolEnabled
} from '../../../src/lib/config/features';

describe('mDL Android-first protocol policy', () => {
	it('opens OpenID4VP without opening raw mdoc', () => {
		expect(FEATURES.MDL_ANDROID_OID4VP).toBe(true);
		expect(FEATURES.MDL_MDOC).toBe(false);
		expect(isMdlProtocolEnabled('openid4vp')).toBe(true);
		expect(isMdlProtocolEnabled('org-iso-mdoc')).toBe(false);
	});

	it('keeps the bridge open only through enabled protocols', () => {
		expect(isAnyMdlProtocolEnabled()).toBe(true);
		expect(isMdlBridgeEnabled()).toBe(true);
	});

	it('rejects unknown protocols', () => {
		expect(isMdlProtocolEnabled('org.example.unsupported')).toBe(false);
	});
});
