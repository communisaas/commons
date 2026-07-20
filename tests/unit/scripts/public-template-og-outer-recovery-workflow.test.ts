import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
const recovery = readFileSync(
	'.github/workflows/public-template-og-release-recovery.yml',
	'utf8'
);
const phase = readFileSync('scripts/run-public-template-og-release-phase.mjs', 'utf8');

describe('independent production coordination recovery workflow', () => {
	it('seals edge and scheduler custody into R2 before the first release mutation', () => {
		const capture = deploy.indexOf(
			'- name: Capture production coordination rollback custody before receipt'
		);
		const phaseRun = deploy.indexOf(
			'- name: Execute fresh-receipt production activation transaction',
			capture
		);
		expect(capture).toBeGreaterThan(-1);
		expect(phaseRun).toBeGreaterThan(capture);
		expect(deploy.slice(capture, phaseRun)).toContain('commons-trusted-pages-edge');
		expect(deploy.slice(capture, phaseRun)).toContain(
			'commons-public-discovery-manifest-cron'
		);
		expect(deploy.slice(capture, phaseRun)).toContain(
			'verify-trusted-pages-release-origin-response.mjs'
		);
		expect(deploy.slice(phaseRun, phaseRun + 5000)).toContain(
			'--coordination-capture "$RUNNER_TEMP/production-coordination-rollback-capture.json"'
		);
		expect(phase).toContain('const RELEASE_JOURNAL_SCHEMA_VERSION = 4;');
		expect(phase).toContain("'coordinationCapture'");
		expect(phase.indexOf('coordinationCapture,')).toBeLessThan(
			phase.indexOf("await appendRecoveryStage('baseline')")
		);
	});

	it('proves the retained pair while it is still canonical, then rechecks only immutable version custody before Q', () => {
		const capture = deploy.indexOf(
			'- name: Capture production coordination rollback custody before receipt'
		);
		const phaseRun = deploy.indexOf(
			'- name: Execute fresh-receipt production activation transaction',
			capture
		);
		const retained = deploy.indexOf(
			'- name: Prove retained production edge rollback capability before Q'
		);
		const seed = deploy.indexOf(
			'- name: Seed global public-discovery manifest control state',
			retained
		);
		expect(deploy.slice(capture, phaseRun)).toContain(
			"'https://commons.email/api/release-origin'"
		);
		expect(deploy.slice(retained, seed)).toContain(
			'.coordinationCapture.trustedEdge.versionId'
		);
		expect(deploy.slice(retained, seed)).not.toContain(
			"'https://commons.email/api/release-origin'"
		);
		expect(deploy.slice(retained, seed)).not.toContain(
			'PROTECTED_RELEASE_ORIGIN_PROOF_SECRET_PRODUCTION'
		);
	});

	it('runs custody recovery from a separate workflow after core recovery settles', () => {
		const core = recovery.indexOf('- name: Recover only the exact live transaction');
		const coordination = recovery.indexOf(
			'- name: Recover production scheduler edge and exposure from immutable custody'
		);
		expect(core).toBeGreaterThan(-1);
		expect(coordination).toBeGreaterThan(core);
		expect(recovery.slice(core, coordination)).toContain('> "$core_result"');
		expect(recovery.slice(coordination)).toContain(
			'recover-public-template-og-production-coordination.mjs'
		);
		expect(recovery.slice(coordination)).toContain(
			'--core-recovery-result "${{ steps.recover_core.outputs.result }}"'
		);
		expect(recovery).toContain(
			'prepare-public-template-og-release-recovery.mjs'
		);
		expect(recovery).toContain('PROTECTED_RELEASE_RECOVERY_R2_ACCESS_KEY_ID');
		expect(recovery).not.toContain('actions/download-artifact@');
	});

	it('uses exact transaction ownership for manifest-cron recovery', () => {
		expect(deploy).toContain(
			'--message "Exact-SHA two-realm public-discovery cron transaction ${RELEASE_TRANSACTION_ID} before Q"'
		);
		expect(deploy).toContain(
			'[ "$current_release_message" = "Exact-SHA two-realm public-discovery cron transaction ${RELEASE_TRANSACTION_ID} before Q" ]'
		);
	});
});
