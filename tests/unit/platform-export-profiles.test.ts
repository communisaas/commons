import { describe, expect, it } from 'vitest';

import {
	PEOPLE_IMPORT_FIELD_ALIASES,
	PEOPLE_SOURCE_FILTER_OPTIONS,
	PEOPLE_SOURCE_SEGMENT_OPTIONS,
	PLATFORM_EXPORT_PROFILES,
	detectPlatformExportProfile,
	formatPeopleSourceLabel
} from '$lib/data/platform-export-profiles';

describe('platform export profiles', () => {
	it('keeps the live CSV export profile set broad and platform-neutral', () => {
		expect(PLATFORM_EXPORT_PROFILES.map((profile) => profile.label)).toEqual([
			'Action Network',
			'EveryAction / NGP VAN',
			'NationBuilder',
			'Mailchimp',
			'Salsa Engage',
			'Mobilize',
			'ActBlue',
			'Engaging Networks',
			'CiviCRM',
			'Salesforce / Nonprofit Cloud'
		]);
	});

	it('detects known export dialects from normalized headers', () => {
		expect(
			detectPlatformExportProfile(['Email Address', 'First Name', 'Last Name', 'Zip Code'])
				?.source
		).toBe('action_network');

		expect(
			detectPlatformExportProfile(['VANID', 'Can Receive Email', 'Activist Codes'])
				?.source
		).toBe('everyaction');

		expect(
			detectPlatformExportProfile([
				'Donor Email',
				'Donor First Name',
				'Contribution Amount',
				'Recipient Committee'
			])?.source
		).toBe('actblue');
	});

	it('requires profile-specific discriminator headers before matching generic columns', () => {
		expect(
			detectPlatformExportProfile(['Email', 'First Name', 'Last Name', 'Groups'])?.source
		).not.toBe('salsa');

		expect(
			detectPlatformExportProfile([
				'Salsa Supporter ID',
				'Email',
				'First Name',
				'Last Name',
				'Groups'
			])?.source
		).toBe('salsa');
	});

	it('does not label unknown CSV exports as platform-sourced', () => {
		expect(detectPlatformExportProfile(['email', 'name', 'postal_code'])).toBeNull();
	});

	it('keeps People source labels and segment options on the shared profile registry', () => {
		expect(PEOPLE_SOURCE_FILTER_OPTIONS.map((option) => option.value)).toEqual([
			'csv',
			'action_network',
			'everyaction',
			'nationbuilder',
			'mailchimp',
			'salsa',
			'mobilize',
			'actblue',
			'engaging_networks',
			'civicrm',
			'salesforce',
			'api',
			'organic',
			'widget',
			'unknown'
		]);
		expect(PEOPLE_SOURCE_SEGMENT_OPTIONS[0]).toEqual({ value: 'csv', label: 'CSV Import' });
		expect(formatPeopleSourceLabel('api')).toBe('Public API');
		expect(formatPeopleSourceLabel('unknown')).toBe('Unknown source');
		expect(formatPeopleSourceLabel('salesforce')).toBe('Salesforce / Nonprofit Cloud');
		expect(formatPeopleSourceLabel('salesforce', { style: 'record' })).toBe(
			'Salesforce / Nonprofit Cloud export'
		);
		expect(formatPeopleSourceLabel('widget', { style: 'record' })).toBe('Reader action');
		expect(formatPeopleSourceLabel('partner_form')).toBe('partner form');
		expect(formatPeopleSourceLabel(null)).toBe('\u2014');
	});

	it('maps imported state/province code as bounded People ground', () => {
		expect(PEOPLE_IMPORT_FIELD_ALIASES.state).toBe('stateCode');
		expect(PEOPLE_IMPORT_FIELD_ALIASES.state_code).toBe('stateCode');
		expect(PEOPLE_IMPORT_FIELD_ALIASES['mailing state']).toBe('stateCode');
		expect(PEOPLE_IMPORT_FIELD_ALIASES.province).toBe('stateCode');
		expect(PEOPLE_IMPORT_FIELD_ALIASES['congressional district']).toBe(
			'congressionalDistrict'
		);
		expect(PEOPLE_IMPORT_FIELD_ALIASES.congressional_district).toBe('congressionalDistrict');
		expect(PEOPLE_IMPORT_FIELD_ALIASES['cd code']).toBe('congressionalDistrict');
	});
});
