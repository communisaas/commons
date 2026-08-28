import { describe, expect, it, vi } from 'vitest';
import {
	assertPagesDeploymentId,
	captureProductionCanonical,
	pagesProjectApiUrl,
	pagesRollbackApiUrl,
	parseProductionControlArgs,
	rollbackProductionCanonical
} from '../../../scripts/cloudflare-pages-production-control.mjs';

const ACCOUNT_ID = '0'.repeat(32);
const PROJECT = 'communique-site';
const PREVIOUS_ID = '12345678-1234-1234-1234-123456789abc';
const NEW_ID = 'abcdefab-cdef-abcd-efab-cdefabcdefab';
const PREVIOUS_SHA = 'a'.repeat(40);
const NEW_SHA = 'b'.repeat(40);
const PREVIOUS_TRANSACTION = '123456788-1';
const FAILED_TRANSACTION = '123456789-2';
const GATE_SHA = 'c'.repeat(40);
const ARTIFACT_DIGEST = 'd'.repeat(64);

function deployment(id: string, sha: string, transactionId?: string) {
	return {
		id,
		environment: 'production',
		latest_stage: { status: 'success' },
		deployment_trigger: {
			metadata: {
				branch: 'production',
				commit_hash: sha,
				...(transactionId
					? {
							commit_message: `commons-release-v1 transaction=${transactionId} gate=${GATE_SHA} artifact=${ARTIFACT_DIGEST}`
						}
					: {})
			}
		},
		url: `https://${id.slice(0, 8)}.${PROJECT}.pages.dev`
	};
}

function project(canonical: ReturnType<typeof deployment>) {
	return {
		canonical_deployment: canonical,
		source: {
			config: { production_deployments_enabled: false, preview_deployment_setting: 'none' }
		}
	};
}

function envelope(result: unknown, status = 200) {
	return new Response(JSON.stringify({ success: status >= 200 && status < 300, result }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('Cloudflare Pages production control', () => {
	it('builds only the exact official project and rollback API paths', () => {
		expect(pagesProjectApiUrl(ACCOUNT_ID, PROJECT)).toBe(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}`
		);
		expect(pagesRollbackApiUrl(ACCOUNT_ID, PROJECT, PREVIOUS_ID)).toBe(
			`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${PROJECT}/deployments/${PREVIOUS_ID}/rollback`
		);
	});

	it.each([
		'',
		'previous',
		`${PREVIOUS_ID}/rollback`,
		`${PREVIOUS_ID}?force=true`,
		PREVIOUS_ID.toUpperCase(),
		'12345678-1234-1234-1234-123456789abz'
	])('rejects a non-exact deployment id %j before URL construction', (candidate) => {
		expect(() => assertPagesDeploymentId(candidate)).toThrow(/exact lowercase/i);
		expect(() => pagesRollbackApiUrl(ACCOUNT_ID, PROJECT, candidate)).toThrow(/exact lowercase/i);
	});

	it('captures and validates the exact successful production canonical before upload', async () => {
		const fetchFn = vi.fn().mockResolvedValue(envelope(project(deployment(PREVIOUS_ID, PREVIOUS_SHA))));

		await expect(
			captureProductionCanonical({
				token: 'token',
				accountId: ACCOUNT_ID,
				projectName: PROJECT,
				fetchFn
			})
		).resolves.toEqual({
			deploymentId: PREVIOUS_ID,
			releaseSha: PREVIOUS_SHA,
			releaseTransaction: null,
			trustedGateSha: null,
			artifactDigest: null,
			releaseComponent: null,
			releaseRealm: null,
			url: `https://${PREVIOUS_ID.slice(0, 8)}.${PROJECT}.pages.dev`
		});
		expect(fetchFn).toHaveBeenCalledOnce();
		expect(fetchFn.mock.calls[0][0]).toBe(pagesProjectApiUrl(ACCOUNT_ID, PROJECT));
		expect(fetchFn.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
	});

	it('uses POST rollback on the captured ID and verifies canonical ID plus SHA', async () => {
		const calls: Array<{ url: string; method: string }> = [];
		let canonicalReads = 0;
		const fetchFn: typeof fetch = vi.fn(async (input, init) => {
			const url = String(input);
			const method = init?.method ?? 'GET';
			calls.push({ url, method });
			if (method === 'POST')
				return envelope(deployment(PREVIOUS_ID, PREVIOUS_SHA, PREVIOUS_TRANSACTION));
			canonicalReads += 1;
			return envelope(
				project(
					canonicalReads <= 2
						? deployment(NEW_ID, NEW_SHA, FAILED_TRANSACTION)
						: deployment(PREVIOUS_ID, PREVIOUS_SHA, PREVIOUS_TRANSACTION)
				)
			);
		});
		const sleepFn = vi.fn().mockResolvedValue(undefined);

		await expect(
			rollbackProductionCanonical({
				token: 'token',
				accountId: ACCOUNT_ID,
				projectName: PROJECT,
				deploymentId: PREVIOUS_ID,
				expectedReleaseSha: PREVIOUS_SHA,
				failedReleaseSha: NEW_SHA,
				failedTransactionId: FAILED_TRANSACTION,
				fetchFn,
				sleepFn,
				verificationDelayMs: 0
			})
		).resolves.toMatchObject({ deploymentId: PREVIOUS_ID, releaseSha: PREVIOUS_SHA });
			expect(calls[0]).toEqual({
			url: pagesProjectApiUrl(ACCOUNT_ID, PROJECT),
			method: 'GET'
		});
		expect(calls[1]).toEqual({
			url: pagesRollbackApiUrl(ACCOUNT_ID, PROJECT, PREVIOUS_ID),
			method: 'POST'
		});
		expect(calls.slice(2).every((call) => call.url === pagesProjectApiUrl(ACCOUNT_ID, PROJECT))).toBe(
			true
		);
		expect(sleepFn).toHaveBeenCalledOnce();
	});

	it('fails closed when rollback returns a different deployment or canonical never converges', async () => {
		const wrongResultFetch = vi
			.fn()
			.mockResolvedValueOnce(envelope(project(deployment(NEW_ID, NEW_SHA, FAILED_TRANSACTION))))
			.mockResolvedValue(envelope(deployment(NEW_ID, NEW_SHA, FAILED_TRANSACTION)));
		await expect(
			rollbackProductionCanonical({
				token: 'token',
				accountId: ACCOUNT_ID,
				deploymentId: PREVIOUS_ID,
				expectedReleaseSha: PREVIOUS_SHA,
				failedReleaseSha: NEW_SHA,
				failedTransactionId: FAILED_TRANSACTION,
				fetchFn: wrongResultFetch,
				sleepFn: vi.fn(),
				verificationAttempts: 1
			})
		).rejects.toThrow(/exact captured deployment and SHA/i);
	});

	it('parses capture and rollback as mutually exact commands', () => {
		expect(parseProductionControlArgs(['capture'])).toEqual({
			command: 'capture',
			deploymentId: undefined,
			expectedReleaseSha: undefined
			, failedReleaseSha: undefined,
			failedTransactionId: undefined
		});
		expect(
			parseProductionControlArgs([
				'rollback',
				'--deployment-id',
				PREVIOUS_ID,
				'--expected-release-sha',
				PREVIOUS_SHA,
				'--failed-release-sha',
				NEW_SHA,
				'--failed-transaction-id',
				FAILED_TRANSACTION
			])
		).toEqual({
			command: 'rollback',
			deploymentId: PREVIOUS_ID,
			expectedReleaseSha: PREVIOUS_SHA,
			failedReleaseSha: NEW_SHA,
			failedTransactionId: FAILED_TRANSACTION
		});
		expect(() => parseProductionControlArgs(['capture', '--deployment-id', PREVIOUS_ID])).toThrow(
			/does not accept/i
		);
		expect(() => parseProductionControlArgs(['rollback', '--deployment-id', PREVIOUS_ID])).toThrow(
			/requires a value|exact lowercase/i
		);
	});
});
