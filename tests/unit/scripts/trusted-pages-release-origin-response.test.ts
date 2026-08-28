import { describe, expect, it } from 'vitest';

import { validateTrustedPagesReleaseOriginResponse } from '../../../scripts/verify-trusted-pages-release-origin-response.mjs';

const releaseSha = 'a'.repeat(40);
const transactionId = '123456789-7';

function fixture() {
	return {
		rawHeaders: [
			'HTTP/2 200',
			'content-type: application/json; charset=utf-8',
			'cache-control: private, no-store, max-age=0',
			'cdn-cache-control: no-store',
			'cloudflare-cdn-cache-control: no-store',
			`x-commons-origin-release-sha: ${releaseSha}`,
			`x-commons-origin-release-transaction: ${transactionId}`,
			'x-commons-origin-access-token: absent',
			'x-commons-origin-proof-secret: absent',
			'x-commons-origin-cache-api: unavailable',
			'x-commons-origin-external-io: 0',
			''
		].join('\r\n'),
		body: JSON.stringify({
			releaseSha,
			transactionId,
			originAccessToken: 'absent',
			originProofSecret: 'absent',
			cacheApi: 'unavailable',
			externalIo: 0
		}),
		status: '200',
		releaseSha,
		transactionId
	};
}

describe('trusted Pages release-origin response verifier', () => {
	it('accepts one exact capability-stripped origin proof', () => {
		expect(validateTrustedPagesReleaseOriginResponse(fixture())).toMatchObject({
			releaseSha,
			transactionId,
			originProofSecret: 'absent'
		});
	});

	it('accepts the capability-gated deterministic containment exception', () => {
		const value = fixture();
		value.status = '503';
		value.rawHeaders = [
			'HTTP/2 503',
			'content-type: application/json; charset=utf-8',
			'cache-control: no-store',
			'cdn-cache-control: no-store',
			'cloudflare-cdn-cache-control: no-store',
			''
		].join('\r\n');
		value.body = JSON.stringify({
			status: 'maintenance',
			mode: 'containment',
			code: 'SERVICE_CONTAINMENT'
		});
		expect(
			validateTrustedPagesReleaseOriginResponse({
				...value,
				component: 'pages-containment'
			})
		).toEqual({
			status: 'maintenance',
			mode: 'containment',
			code: 'SERVICE_CONTAINMENT'
		});
	});

	it.each([
		['missing origin absence marker', (value: ReturnType<typeof fixture>) => {
			value.rawHeaders = value.rawHeaders.replace(
				'x-commons-origin-proof-secret: absent\r\n',
				''
			);
		}],
		['duplicate release identity', (value: ReturnType<typeof fixture>) => {
			value.rawHeaders += `x-commons-origin-release-sha: ${releaseSha}\r\n`;
		}],
		['escaped request capability', (value: ReturnType<typeof fixture>) => {
			value.rawHeaders += 'x-commons-release-origin-proof-secret: leaked\r\n';
		}],
		['extra body field', (value: ReturnType<typeof fixture>) => {
			value.body = JSON.stringify({ ...JSON.parse(value.body), extra: true });
		}]
	] as const)('rejects %s', (_label, mutate) => {
		const value = fixture();
		mutate(value);
		expect(() => validateTrustedPagesReleaseOriginResponse(value)).toThrow(/proof failed/i);
	});
});
