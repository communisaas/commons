import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const guide = readFileSync(path.resolve('docs/development/deployment.md'), 'utf8');
const pagesExposureGuide = readFileSync(
	path.resolve('docs/ops/CLOUDFLARE-PAGES-EXPOSURE.md'),
	'utf8'
);
const deployWorkflow = readFileSync(path.resolve('.github/workflows/deploy.yml'), 'utf8');

const cutovers = [
	['sessionAuthority:migrateSessionAuthorities', 'sessionAuthority:activateSessionAuthorities'],
	['campaigns:migrateCampaignReadModels', 'campaigns:activateCampaignReadModels'],
	['organizations:migrateCampaignActiveCounters', 'organizations:activateCampaignActiveCounters'],
	['debates:migrateDebateReadModels', 'debates:activateDebateReadModels'],
	[
		'organizations:migratePublicOrganizationDirectory',
		'organizations:activatePublicOrganizationDirectory'
	],
	['networks:migrateNetworkCharters', 'networks:activateNetworkCharters'],
	['networks:migrateCoalitionMetrics', 'networks:activateCoalitionMetrics'],
	['supporters:migrateSupporterBrowse', 'supporters:activateSupporterBrowse'],
	['supporterAudience:migratePage', 'supporterAudience:activate'],
	['accountabilityReadModel:migrate', 'accountabilityReadModel:activate'],
	['planUsage:migrate', 'planUsage:activate'],
	[
		'workflows:migrateWorkflowExecutionCounts',
		'workflows:activateWorkflowExecutionCounts'
	],
	[
		'donations:migrateDonationConfirmationSummaries',
		'donations:activateDonationConfirmationSummaries'
	],
	['sms:migrateSmsReplySummaries', 'sms:activateSmsReplySummaries']
] as const;

describe('production compact-plane cutover runbook', () => {
	it.each(cutovers)('migrates %s before invoking %s', (migrate, activate) => {
		const migrationIndex = guide.indexOf(migrate);
		const activationIndex = guide.indexOf(activate);
		expect(migrationIndex, `${migrate} is absent`).toBeGreaterThan(-1);
		expect(activationIndex, `${activate} is absent`).toBeGreaterThan(migrationIndex);
	});

	it('polls the aggregate launch gate and unresolved plan-usage repairs', () => {
		expect(guide).toContain("observability:launchProjectionStatus '{}'");
		expect(guide).toContain("planUsage:repairPlaneStatus '{}'");
		expect(guide).toContain('launchProjectionsReady: true');
	});

	it('proves subscription and contact authority before delivery launch', () => {
		const graceSweep = guide.indexOf('subscriptions:sweepPastDueGrace');
		const subscriptionAudit = guide.indexOf('subscriptions:auditSubscriptionAuthority');
		const subscriptionStatus = guide.indexOf('subscriptions:subscriptionAuthorityStatus');
		const planActivation = guide.indexOf('planUsage:activate');
		const contactMigration = guide.indexOf('webhooks:startContactAuthorityMigration');

		expect(graceSweep).toBeGreaterThan(-1);
		expect(subscriptionAudit).toBeGreaterThan(graceSweep);
		expect(subscriptionStatus).toBeGreaterThan(subscriptionAudit);
		expect(planActivation).toBeGreaterThan(subscriptionStatus);
		expect(contactMigration).toBeGreaterThan(planActivation);
		expect(guide).toContain('launchProjectionPlanes.contactAuthority');
	});

	it('preserves one public-directory run token through activation', () => {
		expect(guide.match(/\$DIRECTORY_TOKEN/g)).toHaveLength(2);
		expect(guide).toContain('DIRECTORY_TOKEN="release-${RELEASE_SHA}"');
	});

	it('separates long-lived cookie rotation from short creation-proof rotation', () => {
		expect(guide).toContain('SESSION_COOKIE_SIGNING_SECRET');
		expect(guide).toContain('must not equal either active or previous session-creation key');
		expect(guide).toContain('only long enough for in-flight auth callbacks to drain');
		expect(guide).toContain('X-Internal-Secret: $INTERNAL_API_SECRET');
		expect(guide).toContain('.sessionCookieAuthority.keysIsolated == true');
	});

	it('binds immutable and custom-domain readiness to the exact serving artifact', () => {
		expect(guide).toContain('build-only `VITE_RELEASE_SHA`');
		expect(guide).toContain('release.sha == RELEASE_SHA');
		expect(pagesExposureGuide).toContain('--arg sha "$RELEASE_SHA"');
		expect(pagesExposureGuide).toContain('.release.sha == $sha');
		expect(pagesExposureGuide).toContain(
			'Do not infer custom-domain promotion from canonical deployment metadata alone.'
		);
	});

	it('quarantines historical Pages functions before Convex reactivation', () => {
		expect(guide).toContain('CLOUDFLARE-PAGES-EXPOSURE.md');
		expect(pagesExposureGuide).toContain('preview_deployment_setting=none');
		expect(pagesExposureGuide).toContain('--expected-production-sha "$RELEASE_SHA"');
		expect(pagesExposureGuide).toContain('stale=0');
	});

	it('activates and proves compact manifest authority before Pages publication', () => {
		const standardDeploy = guide.indexOf('# 1. Pin the release and deploy the backend producer');
		const schemaPush = guide.indexOf(
			'npx convex deploy --env-file .env.production --typecheck enable',
			standardDeploy
		);
		const migration = guide.indexOf(
			"templates:migratePublicDiscoveryManifestAuthority '{}'",
			schemaPush
		);
		const status = guide.indexOf(
			"templates:publicDiscoveryManifestAuthorityOperatorStatus '{}'",
			migration
		);
		const pagesPublish = guide.indexOf('git push origin "$RELEASE_SHA"', status);

		expect(standardDeploy).toBeGreaterThan(-1);
		expect(schemaPush).toBeGreaterThan(standardDeploy);
		expect(migration).toBeGreaterThan(schemaPush);
		expect(status).toBeGreaterThan(migration);
		expect(pagesPublish).toBeGreaterThan(status);
		expect(guide).toContain('ready:true`, `matches:true`, and `bytes <= maxBytes`');
	});

	it('keeps normal release seeding to one deadline-fenced proof request', () => {
		const seedStart = deployWorkflow.indexOf(
			'- name: Seed global public-discovery manifest control state'
		);
		const seedEnd = deployWorkflow.indexOf(
			'- name: Prove exact immutable bundled graph surface',
			seedStart
		);
		const seed = deployWorkflow.slice(seedStart, seedEnd);

		expect(seedStart).toBeGreaterThan(-1);
		expect(seedEnd).toBeGreaterThan(seedStart);
		expect(seed).toContain('timeout-minutes: 2');
		expect(seed).toContain('--receipt-verification-deadline "$receipt_deadline"');
		expect(seed).toContain('--qualification-reserve-milliseconds 900000');
		expect(seed).toContain('--maximum-attempts 1');
		expect(seed).toContain('.attempts == 1 and .continuationUsed == false');
		expect(seed).toContain('.qualificationReserveMilliseconds == 900000');
		expect(seed).toContain('fromdateiso8601');
		expect(seed).not.toContain('for attempt in {1..19}');
		expect(seed).not.toContain('sleep 121');
	});
});
