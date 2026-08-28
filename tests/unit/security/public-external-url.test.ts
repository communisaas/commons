import { describe, expect, it } from 'vitest';

import { parsePublicHttpUrl } from '$lib/core/security/public-external-url';

describe('public external URL boundary', () => {
	it.each([
		'https://example.com/path',
		'http://news.example.org/article',
		'https://8.8.8.8/dns-query',
		'https://[2606:4700:4700::1111]/dns-query'
	])('accepts structurally public HTTP(S) destination %s', (value) => {
		expect(parsePublicHttpUrl(value)?.protocol).toMatch(/^https?:$/u);
	});

	it.each([
		'http://localhost/admin',
		'http://service.local/admin',
		'http://service.internal/admin',
		'http://metadata.google.internal/computeMetadata/v1',
		'http://127.0.0.1/admin',
		'http://2130706433/admin',
		'http://0x7f000001/admin',
		'http://017700000001/admin',
		'http://0.0.0.0/admin',
		'http://10.0.0.1/admin',
		'http://100.64.0.1/admin',
		'http://169.254.169.254/latest/meta-data',
		'http://172.16.0.1/admin',
		'http://192.168.0.1/admin',
		'http://192.0.2.1/admin',
		'http://198.18.0.1/admin',
		'http://198.51.100.1/admin',
		'http://203.0.113.1/admin',
		'http://224.0.0.1/admin',
		'http://127.0.0.1.nip.io/admin',
		'http://10.0.0.1.sslip.io/admin',
		'http://[::]/admin',
		'http://[::1]/admin',
		'http://[fc00::1]/admin',
		'http://[fe80::1]/admin',
		'http://[fec0::1]/admin',
		'http://[ff02::1]/admin',
		'http://[2001:db8::1]/admin',
		'http://[100::1]/admin',
		'http://[2001::1]/admin',
		'http://[2002:0a00:0001::1]/admin',
		'http://[::ffff:127.0.0.1]/admin',
		'http://[64:ff9b::7f00:1]/admin',
		'http://[2001:4860:4860:0:0:5efe:7f00:1]/admin',
		'file:///etc/passwd',
		'https://user:password@example.com/private'
	])('rejects non-public or credential-bearing destination %s', (value) => {
		expect(parsePublicHttpUrl(value)).toBeNull();
	});

	it('enforces its input byte ceiling before parsing', () => {
		expect(parsePublicHttpUrl(`https://example.com/${'x'.repeat(100)}`, 32)).toBeNull();
	});
});
