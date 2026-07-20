import { describe, expect, it } from 'vitest';

import {
	classifyPublicTemplateOgProductionCoordination,
	recoverPublicTemplateOgProductionCoordination
} from '../../../scripts/recover-public-template-og-production-coordination.mjs';
import { validatePublicTemplateOgProductionCoordinationCapture } from '../../../scripts/run-public-template-og-release-phase.mjs';

const BASELINE_SHA = 'a'.repeat(40);
const BASELINE_TRANSACTION = '123456789-1';
const VERSION_ID = 'b'.repeat(32);

const pagesCapture = {
	deploymentId: 'c'.repeat(32),
	deploymentUrl: 'https://baseline.communique-site.pages.dev',
	releaseSha: BASELINE_SHA,
	releaseTransaction: BASELINE_TRANSACTION,
	trustedGateSha: 'd'.repeat(40),
	artifactDigest: 'e'.repeat(64),
	releaseComponent: 'pages',
	releaseRealm: null
};

function capture() {
	return {
		schemaVersion: 1,
		manifestCron: {
			state: 'present',
			versionId: 'f'.repeat(32),
			releaseSha: BASELINE_SHA
		},
		trustedEdge: {
			state: 'present',
			versionId: VERSION_ID,
			releaseSha: BASELINE_SHA,
			releaseTransaction: BASELINE_TRANSACTION
		}
	};
}

describe('production coordination recovery custody', () => {
	it('accepts only an exact scheduler and retained edge paired with canonical Pages', () => {
		expect(
			validatePublicTemplateOgProductionCoordinationCapture(capture(), pagesCapture)
		).toEqual(capture());

		const wrongTransaction = capture();
		wrongTransaction.trustedEdge.releaseTransaction = '123456789-2';
		expect(() =>
			validatePublicTemplateOgProductionCoordinationCapture(wrongTransaction, pagesCapture)
		).toThrow(/not paired with canonical Pages/i);

		const wrongCron = capture();
		wrongCron.manifestCron.releaseSha = '0'.repeat(40);
		expect(() =>
			validatePublicTemplateOgProductionCoordinationCapture(wrongCron, pagesCapture)
		).toThrow(/Manifest cron.*not paired/i);
	});

	it('rejects a normal release without a retained trusted-edge rollback version', () => {
		const missingEdge = capture() as Record<string, unknown>;
		missingEdge.trustedEdge = { state: 'absent' };
		expect(() =>
			validatePublicTemplateOgProductionCoordinationCapture(missingEdge, pagesCapture)
		).toThrow(/Trusted production edge rollback capture/i);
	});

	it('grants mutation only to the immutable baseline or the exact transaction', () => {
		expect(
			classifyPublicTemplateOgProductionCoordination({
				coreReason: 'committed-terminal',
				pagesState: 'candidate',
				edgeState: 'candidate',
				manifestState: 'candidate'
			})
		).toBe('prove-candidate');
		expect(
			classifyPublicTemplateOgProductionCoordination({
				coreReason: 'recovered',
				pagesState: 'baseline',
				edgeState: 'candidate',
				manifestState: 'candidate'
			})
		).toBe('restore-baseline');
		expect(
			classifyPublicTemplateOgProductionCoordination({
				coreReason: 'committed-terminal',
				pagesState: 'candidate',
				edgeState: 'superseded',
				manifestState: 'candidate'
			})
		).toBe('superseded-noop');
	});

	it('rejects reused recovery capabilities before reading or mutating custody', async () => {
		const reused = 'A'.repeat(40);
		await expect(
			recoverPublicTemplateOgProductionCoordination({
				journalPath: '/does/not/exist',
				coreRecoveryResultPath: '/does/not/exist',
				trustedRoot: '/does/not/exist',
				wranglerPath: '/does/not/exist',
				accountId: '019d1184e655db74b7589794a2a2a533',
				zoneId: 'f'.repeat(32),
				apiToken: reused,
				proofSecret: reused,
				internalSecret: 'B'.repeat(40)
			})
		).rejects.toThrow(/capabilities are absent or reused/i);
	});
});
