import { describe, expect, it, vi } from 'vitest';

import {
	PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_ENDPOINT,
	controlPublicDiscoveryBootstrapAuthority,
	parsePublicDiscoveryBootstrapAuthorityArgs,
	validatePublicDiscoveryBootstrapAuthorityResult
} from '../../../scripts/control-public-discovery-bootstrap-authority.mjs';

const NOW = Date.parse('2026-07-20T00:00:00.000Z');
const NOT_AFTER = '2026-07-20T01:00:00.000Z';
const SHA = 'a'.repeat(40);
const TRANSACTION = '123-4';
const LEASE = '123e4567-e89b-42d3-a456-426614174000';
const REFRESH_LEASE = '223e4567-e89b-42d3-a456-426614174000';
const SECRET = 's'.repeat(64);

function authorityResult(
	status: 'absent' | 'armed' | 'completed' | 'contained',
	overrides: Record<string, unknown> = {}
) {
	return {
		completedAt: status === 'completed' ? '2026-07-20T00:48:00.000Z' : null,
		expiresAt: status === 'armed' ? '2026-07-20T00:59:00.000Z' : null,
		generation: status === 'completed' ? 'list=5:500;relations=7:700' : null,
		leaseId: LEASE,
		notAfter: NOT_AFTER,
		purpose: 'public-discovery-corpus-bootstrap',
		refreshLeaseId: status === 'completed' ? REFRESH_LEASE : null,
		sourceSha: SHA,
		status,
		transactionId: TRANSACTION,
		...overrides
	};
}

function response(value: unknown, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/json',
			'x-public-discovery-refresh-gate-protocol': '3'
		}
	});
}

describe('public-discovery bootstrap authority control', () => {
	it('arms only the exact production tuple without exposing its control capability', async () => {
		const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
			expect(String(_url)).toBe(PUBLIC_DISCOVERY_BOOTSTRAP_CONTROL_ENDPOINT);
			expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
			expect(JSON.parse(String(init?.body))).toEqual({
				action: 'arm',
				leaseId: LEASE,
				notAfter: NOT_AFTER,
				purpose: 'public-discovery-corpus-bootstrap',
				sourceSha: SHA,
				transactionId: TRANSACTION
			});
			expect(new Headers(init?.headers).get('x-public-release-control-secret')).toBe(SECRET);
			return response(authorityResult('armed'));
		});
		const proof = await controlPublicDiscoveryBootstrapAuthority({
			action: 'arm',
			fetchFn,
			leaseId: LEASE,
			notAfter: NOT_AFTER,
			nowFn: () => NOW,
			releaseControlSecret: SECRET,
			sourceSha: SHA,
			transactionId: TRANSACTION
		});
		expect(proof.status).toBe('armed');
		expect(JSON.stringify(proof)).not.toContain(SECRET);
	});

	it.each(['absent', 'armed', 'completed', 'contained'] as const)(
		'accepts an exact inspect proof for %s',
		(status) => {
			expect(
				validatePublicDiscoveryBootstrapAuthorityResult(authorityResult(status), {
					action: 'inspect',
					leaseId: LEASE,
					notAfter: NOT_AFTER,
					now: NOW + 49 * 60 * 1_000,
					sourceSha: SHA,
					transactionId: TRANSACTION
				})
			).toMatchObject({ status });
		}
	);

	it('requires terminal containment and rejects a completed contain response', () => {
		expect(
			validatePublicDiscoveryBootstrapAuthorityResult(authorityResult('contained'), {
				action: 'contain',
				leaseId: LEASE,
				notAfter: NOT_AFTER,
				now: NOW,
				sourceSha: SHA,
				transactionId: TRANSACTION
			}).status
		).toBe('contained');
		expect(() =>
			validatePublicDiscoveryBootstrapAuthorityResult(authorityResult('completed'), {
				action: 'contain',
				leaseId: LEASE,
				notAfter: NOT_AFTER,
				now: NOW,
				sourceSha: SHA,
				transactionId: TRANSACTION
			})
		).toThrow(/invalid status/i);
	});

	it('rejects tuple, shape, generation, timing, and boundary drift', async () => {
		for (const value of [
			authorityResult('armed', { sourceSha: 'b'.repeat(40) }),
			authorityResult('armed', { extra: true }),
			authorityResult('armed', { expiresAt: '2026-07-20T01:00:00.001Z' }),
			authorityResult('completed', { generation: 'bad' }),
			authorityResult('contained', { refreshLeaseId: REFRESH_LEASE })
		]) {
			expect(() =>
				validatePublicDiscoveryBootstrapAuthorityResult(value, {
					action: 'inspect',
					leaseId: LEASE,
					notAfter: NOT_AFTER,
					now: NOW,
					sourceSha: SHA,
					transactionId: TRANSACTION
				})
			).toThrow();
		}
		await expect(
			controlPublicDiscoveryBootstrapAuthority({
				action: 'inspect',
				fetchFn: vi.fn(async () => response(authorityResult('armed'), 202)),
				leaseId: LEASE,
				notAfter: NOT_AFTER,
				nowFn: () => NOW,
				releaseControlSecret: SECRET,
				sourceSha: SHA,
				transactionId: TRANSACTION
			})
		).rejects.toThrow(/request failed/i);
	});

	it('fails before fetch for malformed authority or secret input', async () => {
		for (const overrides of [
			{ action: 'delete' },
			{ sourceSha: 'A'.repeat(40) },
			{ transactionId: '0-1' },
			{ leaseId: 'not-a-uuid' },
			{ notAfter: '2026-07-20T01:00:00Z' },
			{ notAfter: '2026-07-20T01:00:00.001Z' },
			{ releaseControlSecret: 'short' }
		]) {
			const fetchFn = vi.fn();
			await expect(
				controlPublicDiscoveryBootstrapAuthority({
					action: 'arm',
					fetchFn,
					leaseId: LEASE,
					notAfter: NOT_AFTER,
					nowFn: () => NOW,
					releaseControlSecret: SECRET,
					sourceSha: SHA,
					transactionId: TRANSACTION,
					...overrides
				} as never)
			).rejects.toThrow();
			expect(fetchFn).not.toHaveBeenCalled();
		}
	});

	it('parses only the four exact non-secret tuple arguments', () => {
		expect(
			parsePublicDiscoveryBootstrapAuthorityArgs([
				'arm',
				'--source-sha',
				SHA,
				'--transaction-id',
				TRANSACTION,
				'--lease-id',
				LEASE,
				'--not-after',
				NOT_AFTER
			])
		).toEqual({
			action: 'arm',
			leaseId: LEASE,
			notAfter: NOT_AFTER,
			sourceSha: SHA,
			transactionId: TRANSACTION
		});
		for (const args of [
			['delete'],
			['arm', '--source-sha', SHA],
			[
				'arm',
				'--source-sha',
				SHA,
				'--source-sha',
				SHA,
				'--transaction-id',
				TRANSACTION,
				'--lease-id',
				LEASE,
				'--not-after',
				NOT_AFTER
			]
		]) {
			expect(() => parsePublicDiscoveryBootstrapAuthorityArgs(args)).toThrow();
		}
	});
});
