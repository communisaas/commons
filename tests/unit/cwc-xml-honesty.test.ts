import { describe, expect, it } from 'vitest';
import { CWCXmlGenerator } from '../../convex/_cwcXml';

const baseRep = {
	bioguideId: 'W000825',
	name: 'Jane Wexton',
	party: 'Democratic',
	state: 'VA',
	district: '10',
	chamber: 'house' as const,
	officeCode: 'HVA10'
};

const baseUser = {
	id: 'user-1',
	name: 'Jane Doe',
	email: 'jane@example.com',
	address: { street: '123 Main St', city: 'Arlington', state: 'VA', zip: '22201' },
	representatives: { house: baseRep, senate: [] }
};

const baseTemplate = {
	id: 'tpl-1',
	title: 'Support Climate Action',
	description: 'desc',
	message_body: 'Dear Representative',
	delivery_config: {}
};

describe('CWC XML — honest defaults', () => {
	it('never emits AddressValidation: Y', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: baseUser,
			_targetRep: baseRep
		});
		expect(xml).toContain('<AddressValidation>N</AddressValidation>');
		expect(xml).not.toContain('<AddressValidation>Y</AddressValidation>');
	});

	it('omits <Prefix> when user has no prefix', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: baseUser,
			_targetRep: baseRep
		});
		expect(xml).not.toContain('<Prefix>');
	});

	it('emits <Prefix> only when user.prefix is set', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: { ...baseUser, prefix: 'Dr.' },
			_targetRep: baseRep
		});
		expect(xml).toContain('<Prefix>Dr.</Prefix>');
	});

	it('omits <Phone> when user has no phone', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: baseUser,
			_targetRep: baseRep
		});
		expect(xml).not.toContain('<Phone>');
	});

	it('never emits the 555-123-4567 placeholder', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: { ...baseUser, phone: 'invalid-input' },
			_targetRep: baseRep
		});
		expect(xml).not.toContain('555-123-4567');
	});

	it('omits <Phone> for malformed user phone', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: { ...baseUser, phone: 'not-a-phone' },
			_targetRep: baseRep
		});
		expect(xml).not.toContain('<Phone>');
	});

	it('formats valid 10-digit phone', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: { ...baseUser, phone: '2025551234' },
			_targetRep: baseRep
		});
		expect(xml).toContain('<Phone>202-555-1234</Phone>');
	});

	it('strips leading 1 from 11-digit phone', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: { ...baseUser, phone: '+1 (202) 555-1234' },
			_targetRep: baseRep
		});
		expect(xml).toContain('<Phone>202-555-1234</Phone>');
	});
});

describe('CWC XML — validator', () => {
	it('rejects empty DeliveryAgentContactPhone', () => {
		const xml = CWCXmlGenerator.generateHouseXML(
			{ template: baseTemplate, user: baseUser, _targetRep: baseRep },
			{
				name: 'Commons',
				email: 'a@b.com',
				contactName: 'Support',
				contactEmail: 'support@b.com',
				contactPhone: '',
				organization: 'Commons',
				organizationAbout: 'x'
			}
		);
		const result = CWCXmlGenerator.validateXML(xml);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes('DeliveryAgentContactPhone'))).toBe(true);
	});

	it('rejects empty constituent address fields', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: { ...baseUser, address: { street: '', city: '', state: '', zip: '' } },
			_targetRep: baseRep
		});
		const result = CWCXmlGenerator.validateXML(xml);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes('Address1'))).toBe(true);
	});

	it('accepts a fully populated honest payload', () => {
		const xml = CWCXmlGenerator.generateHouseXML(
			{
				template: baseTemplate,
				user: { ...baseUser, phone: '2025551234' },
				_targetRep: baseRep
			},
			{
				name: 'Commons',
				email: 'a@b.com',
				contactName: 'Support',
				contactEmail: 'support@b.com',
				contactPhone: '555-000-1111',
				organization: 'Commons',
				organizationAbout: 'x'
			}
		);
		const result = CWCXmlGenerator.validateXML(xml);
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
	});
});

describe('CWC XML — ProOrCon', () => {
	it('omits <ProOrCon> when no proOrCon supplied', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: baseUser,
			_targetRep: baseRep
		});
		expect(xml).not.toContain('<ProOrCon>');
	});

	it('emits <ProOrCon>Con</ProOrCon> when template position is opposition', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: baseTemplate,
			user: baseUser,
			_targetRep: baseRep,
			proOrCon: 'Con'
		});
		expect(xml).toContain('<ProOrCon>Con</ProOrCon>');
	});

	it('never defaults to Pro regardless of template content', () => {
		const xml = CWCXmlGenerator.generateHouseXML({
			template: { ...baseTemplate, title: 'Support Climate Action' },
			user: baseUser,
			_targetRep: baseRep
		});
		expect(xml).not.toContain('<ProOrCon>Pro</ProOrCon>');
	});
});

describe('CWC XML — Senate', () => {
	const senateRep = { ...baseRep, chamber: 'senate' as const, officeCode: 'SVA01' };

	it('never emits AddressValidation (Senate has no such element)', () => {
		const xml = CWCXmlGenerator.generateSenateXML({
			template: baseTemplate,
			user: baseUser,
			_targetRep: senateRep
		});
		expect(xml).not.toContain('AddressValidation');
	});

	it('routes to Senate XML via generateUserAdvocacyXML', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML({
			template: baseTemplate,
			user: baseUser,
			_targetRep: senateRep
		});
		expect(xml).toContain('<MemberOffice>SVA01</MemberOffice>');
	});
});
