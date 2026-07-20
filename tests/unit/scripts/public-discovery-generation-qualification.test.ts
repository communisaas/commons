import { describe, expect, it, vi } from 'vitest';

import {
	finalizePublicDiscoveryReleaseAuthority,
	qualifyPreviewReleaseAuthority,
	qualifyProductionReleaseAuthority,
	qualifyPublicDiscoveryGeneration
} from '../../../scripts/qualify-public-discovery-generation.mjs';

const sha = 'a'.repeat(40);
const releaseProbeSecret = 'p'.repeat(32);
const releaseControlSecret = 'c'.repeat(32);
const releaseLeaseId = '00000000-0000-4000-8000-000000000001';
const transactionId = '123456789-2';
const receiptVerificationDeadlineAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

function json(body: unknown, init: ResponseInit = {}) {
	const headers = new Headers(init.headers);
	headers.set('content-type', 'application/json');
	return new Response(JSON.stringify(body), { ...init, headers });
}

function candidateProof(overrides: Record<string, unknown> = {}) {
	return json(
		{
			proof: 'candidate-fetch-completed',
			release: { sha, transactionId },
			status: 'ok',
			...overrides
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
}

function authority(status: 'committed' | 'qualified', phase: 'activate-preview' | 'activate-production') {
	return json({
		expiresAt: status === 'committed' ? null : receiptVerificationDeadlineAt,
		leaseId: releaseLeaseId,
		notAfter: receiptVerificationDeadlineAt,
		phase,
		sourceSha: sha,
		status,
		transactionId
	});
}

const releaseOptions = {
	releaseControlSecret,
	releaseLeaseId,
	receiptVerificationDeadlineAt,
	transactionId
};

describe('inert release-candidate qualification', () => {
	it('proves the exact staging candidate fetch with no control capability in the process', async () => {
		const responses = [candidateProof()];
		const requests: Array<{ init?: RequestInit; url: string }> = [];
		const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			requests.push({ init, url: String(input) });
			return responses.shift()!;
		}) as typeof fetch;

		await expect(
			qualifyPublicDiscoveryGeneration({
				environment: 'preview',
				sourceSha: sha,
				transactionId,
				releaseProbeSecret,
				fetchFn,
				sleepFn: vi.fn()
			})
		).resolves.toMatchObject({
			environment: 'preview',
			proof: 'candidate-fetch-completed',
			candidateFetchProved: true,
			releaseSha: sha,
			transactionId
		});

		expect(requests.map(({ url }) => url)).toEqual([
			'https://staging.commons.email/api/release-candidate'
		]);
		const probeHeaders = new Headers(requests[0]?.init?.headers);
		expect(probeHeaders.get('x-release-probe-secret')).toBe(releaseProbeSecret);
		expect(probeHeaders.get('x-expected-release-sha')).toBe(sha);
		expect(probeHeaders.get('x-expected-release-transaction')).toBe(transactionId);
		expect(probeHeaders.has('x-internal-secret')).toBe(false);
		expect(probeHeaders.has('x-public-discovery-manifest-refresh-secret')).toBe(false);
		expect(probeHeaders.has('x-public-release-control-secret')).toBe(false);
	});

	it('fails closed on an inexact or cacheable wrapper proof', async () => {
		const fetchFn = vi.fn(async () =>
			json({
				proof: 'candidate-fetch-completed',
				release: { sha, transactionId },
				status: 'ok'
			})
		) as typeof fetch;

		await expect(
			qualifyPublicDiscoveryGeneration({
				environment: 'preview',
				sourceSha: sha,
				transactionId,
				releaseProbeSecret,
				fetchFn,
				probeAttempts: 1
			})
		).rejects.toThrow('never completed the exact inert candidate fetch');
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it('forbids candidate runtime qualification on production before commit', async () => {
		const fetchFn = vi.fn();
		await expect(
			qualifyPublicDiscoveryGeneration({
				environment: 'production' as never,
				sourceSha: sha,
				transactionId,
				releaseProbeSecret,
				fetchFn: fetchFn as typeof fetch
			})
		).rejects.toThrow('permitted only on the staging authority');
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('qualifies preview authority in a separate process that has no probe bearer', async () => {
		const fetchFn = vi.fn(async () => authority('qualified', 'activate-preview')) as typeof fetch;
		await expect(
			qualifyPreviewReleaseAuthority({
				sourceSha: sha,
				...releaseOptions,
				authorizeQualifyFn: vi.fn(async () => undefined),
				fetchFn
			})
		).resolves.toMatchObject({
			environment: 'preview',
			releaseAuthorityQualified: true
		});
		const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
		expect(String(url)).toBe(
			'https://release-control-staging.commons.email/control-og-release-authority'
		);
		const headers = new Headers(init?.headers);
		expect(headers.get('x-public-release-control-secret')).toBe(releaseControlSecret);
		expect(headers.has('x-release-probe-secret')).toBe(false);
	});

	it('qualifies production through the trusted custom-domain control endpoint only', async () => {
		const authorizeQualifyFn = vi.fn(async () => undefined);
		const fetchFn = vi.fn(async () => authority('qualified', 'activate-production')) as typeof fetch;

		await expect(
			qualifyProductionReleaseAuthority({
				sourceSha: sha,
				...releaseOptions,
				authorizeQualifyFn,
				fetchFn
			})
		).resolves.toMatchObject({
			environment: 'production',
			releaseAuthorityQualified: true,
			candidateRuntimeInitialized: false,
			trustedProductionProofs: true
		});
		expect(authorizeQualifyFn).toHaveBeenCalledOnce();
		const [url, init] = vi.mocked(fetchFn).mock.calls[0]!;
		expect(String(url)).toBe(
			'https://release-control.commons.email/control-og-release-authority'
		);
		expect(JSON.parse(String(init?.body))).toMatchObject({ action: 'qualify' });
	});

	it('finalizes through the same realm-isolated control host', async () => {
		const fetchFn = vi.fn(async () => authority('committed', 'activate-preview')) as typeof fetch;
		await expect(
			finalizePublicDiscoveryReleaseAuthority({
				environment: 'preview',
				sourceSha: sha,
				...releaseOptions,
				authorizeFinalizeFn: vi.fn(async () => undefined),
				fetchFn
			})
		).resolves.toMatchObject({ releaseAuthorityFinalized: true });
		expect(String(vi.mocked(fetchFn).mock.calls[0]![0])).toBe(
			'https://release-control-staging.commons.email/control-og-release-authority'
		);
	});
});
