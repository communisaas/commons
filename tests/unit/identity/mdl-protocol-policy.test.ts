import { describe, expect, it } from 'vitest';
import {
	FEATURES,
	OPENID4VP_DC_API_PROTOCOL,
	isAnyMdlProtocolEnabled,
	isMdlDirectQrEnabled,
	isOpenId4VpProtocol,
	isMdlProtocolEnabled,
	requireMdlDirectQrEnabled
} from '../../../src/lib/config/features';

describe('mDL Digital Credentials protocol policy', () => {
	it('opens OpenID4VP without opening raw mdoc', () => {
		expect(FEATURES.MDL_ANDROID_OID4VP).toBe(true);
		expect(FEATURES.MDL_MDOC).toBe(false);
		expect(OPENID4VP_DC_API_PROTOCOL).toBe('openid4vp-v1-signed');
		expect(isMdlProtocolEnabled(OPENID4VP_DC_API_PROTOCOL)).toBe(true);
		expect(isOpenId4VpProtocol('openid4vp-v1-unsigned')).toBe(true);
		expect(isOpenId4VpProtocol('openid4vp')).toBe(true);
		expect(isMdlProtocolEnabled('openid4vp-v1-unsigned')).toBe(false);
		expect(isMdlProtocolEnabled('openid4vp')).toBe(false);
		expect(isMdlProtocolEnabled('org-iso-mdoc')).toBe(false);
	});

	it('keeps the mDL protocol gate open only through enabled protocols', () => {
		expect(isAnyMdlProtocolEnabled()).toBe(true);
	});

	it('keeps direct desktop QR behind its explicit flag', () => {
		expect(FEATURES.MDL_DIRECT_QR).toBe(false);
		expect(isMdlDirectQrEnabled()).toBe(false);
		expect(() => requireMdlDirectQrEnabled()).toThrow('MDL_DIRECT_QR_DISABLED');
	});

	it('rejects unknown protocols', () => {
		expect(isMdlProtocolEnabled('org.example.unsupported')).toBe(false);
	});
});
