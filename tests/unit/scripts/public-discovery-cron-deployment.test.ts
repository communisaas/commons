import { describe, expect, it } from 'vitest';
import cronConfigSource from '../../../wrangler.public-discovery-manifest.toml?raw';

import {
	PUBLIC_DISCOVERY_CRON_SCHEDULE,
	PUBLIC_DISCOVERY_NONPROD_REFRESH_URL,
	PUBLIC_DISCOVERY_PRODUCTION_REFRESH_URL,
	validatePublicDiscoveryCronDeployment,
	validatePublicDiscoveryCronSourceConfig
} from '../../../scripts/verify-public-discovery-cron-deployment.mjs';

function settings(overrides: Array<Record<string, unknown>> = []) {
	return {
		result: {
			bindings: [
				{
					name: 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL',
					text: PUBLIC_DISCOVERY_PRODUCTION_REFRESH_URL,
					type: 'plain_text'
				},
				{
					name: 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL_NONPROD',
					text: PUBLIC_DISCOVERY_NONPROD_REFRESH_URL,
					type: 'plain_text'
				},
				{ name: 'DISCOVERY_MANIFEST_REFRESH_SECRET', type: 'secret_text' },
				{ name: 'DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD', type: 'secret_text' },
				...overrides
			]
		}
	};
}

const schedules = { result: [{ cron: PUBLIC_DISCOVERY_CRON_SCHEDULE }] };
const subdomain = { result: { enabled: false, previews_enabled: false } };

describe('public-discovery cron deployment proof', () => {
	it('accepts the exact isolated endpoints, secrets, schedule, and private route', () => {
		expect(
			validatePublicDiscoveryCronDeployment({
				workerSettings: settings(),
				workerSchedules: schedules,
				workerSubdomain: subdomain
			})
		).toMatchObject({ schedule: '* * * * *', secretBindings: expect.arrayContaining([
			'DISCOVERY_MANIFEST_REFRESH_SECRET',
			'DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD'
		]) });
	});

	it('parses the source config and binds its custom authorities and poll cadence to the verifier', () => {
		expect(validatePublicDiscoveryCronSourceConfig(cronConfigSource)).toEqual({
			nonprodUrl: 'https://staging.commons.email/api/internal/public-discovery-manifest-refresh',
			productionUrl: 'https://commons.email/api/internal/public-discovery-manifest-refresh',
			schedule: '* * * * *'
		});
		expect(cronConfigSource).not.toContain('.pages.dev');
	});

	it('rejects a missing secret or an extra schedule', () => {
		const missingSecret = settings();
		missingSecret.result.bindings = missingSecret.result.bindings.filter(
			(binding) => binding.name !== 'DISCOVERY_MANIFEST_REFRESH_SECRET_NONPROD'
		);
		expect(() =>
			validatePublicDiscoveryCronDeployment({
				workerSettings: missingSecret,
				workerSchedules: schedules,
				workerSubdomain: subdomain
			})
		).toThrow(/SECRET_NONPROD/i);
		expect(() =>
			validatePublicDiscoveryCronDeployment({
				workerSettings: settings(),
				workerSchedules: { result: [{ cron: '*/2 * * * *' }, { cron: '0 * * * *' }] },
				workerSubdomain: subdomain
			})
		).toThrow(/exactly the committed one-minute polling schedule/i);
	});

	it('rejects source config phase or custom-authority drift', () => {
		expect(() =>
			validatePublicDiscoveryCronSourceConfig(
				cronConfigSource.replace('crons = ["* * * * *"]', 'crons = ["*/5 * * * *"]')
			)
		).toThrow(/source schedule drifted/i);
		expect(() =>
			validatePublicDiscoveryCronSourceConfig(
				cronConfigSource.replace('https://staging.commons.email', 'https://main.communique-site.pages.dev')
			)
		).toThrow(/source non-production URL drifted/i);
	});

	it('rejects every extra or wrong-type binding before candidate code can inherit it', () => {
		for (const binding of [
			{ name: 'LEGACY_SHARED_SECRET', type: 'secret_text' },
			{ name: 'UNREVIEWED_ENDPOINT', text: 'https://example.com', type: 'plain_text' },
			{
				name: 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL',
				type: 'secret_text'
			}
		]) {
			expect(() =>
				validatePublicDiscoveryCronDeployment({
					workerSettings: settings([binding]),
					workerSchedules: schedules,
					workerSubdomain: subdomain
				})
			).toThrow(/binding set must contain only/i);
		}
	});

	it('rejects a public route or crossed backend endpoint', () => {
		const crossed = settings();
		const production = crossed.result.bindings.find(
			(binding) => binding.name === 'PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL'
		);
		if (production) production.text = PUBLIC_DISCOVERY_NONPROD_REFRESH_URL;
		expect(() =>
			validatePublicDiscoveryCronDeployment({
				workerSettings: crossed,
				workerSchedules: schedules,
				workerSubdomain: subdomain
			})
		).toThrow(/production refresh endpoint/i);
		expect(() =>
			validatePublicDiscoveryCronDeployment({
				workerSettings: settings(),
				workerSchedules: schedules,
				workerSubdomain: { result: { enabled: true, previews_enabled: false } }
			})
		).toThrow(/disable workers\.dev/i);
	});
});
