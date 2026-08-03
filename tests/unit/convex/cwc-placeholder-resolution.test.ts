/**
 * No bracket string reaches a congressional office.
 *
 * A seeded campaign letter carries author placeholders — `[Personal Connection]`
 * for the sender's own words, `[Name]` for their signature — and, in the same
 * text, footnote markers `[1]`, `[2]`, `[3]` that are part of the argument and
 * must survive to the recipient. The CWC lane resolves the first kind and leaves
 * the second alone; when resolution has not happened, the XML is invalid and the
 * message takes the existing failure path instead of being delivered.
 *
 * These tests own their letter as a literal rather than asking product code what
 * it expects, and they bind to the send path by source so a future edit that
 * drops the resolution call fails here.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CWCXmlGenerator } from '../../../convex/_cwcXml';
import {
	DELIVERABLE_PLACEHOLDER_DENYLIST,
	manualFillReplacements,
	resolvePlaceholders
} from '../../../convex/lib/messagePlaceholders';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Read the recipient-visible message back out of the assembled XML. */
function constituentMessage(xml: string): string {
	return xml.match(/<ConstituentMessage>([\s\S]*?)<\/ConstituentMessage>/)![1];
}

// A seedData-shaped letter: a sender slot, a signature slot, and cited sources.
const AUTHORED_BODY = [
	'It is frustrating to know that a solution to the rural healthcare crisis already exists.',
	'',
	'[Personal Connection]',
	'',
	'In rural Texas, hands-on telehealth already lets physicians hear heart sounds from miles away [3].',
	'Two days ago the committee passed bipartisan legislation requiring these agreements [2].',
	'',
	'I am asking you to fully implement the proposed telehealth grant program [1].',
	'',
	'[Name]'
].join('\n');

const FOOTNOTES = ['[1]', '[2]', '[3]'];

const houseRep = {
	bioguideId: 'W000825',
	name: 'Jane Wexton',
	party: 'Democratic',
	state: 'VA',
	district: '10',
	chamber: 'house' as const,
	officeCode: 'HVA10'
};

const senator = {
	bioguideId: 'K000384',
	name: 'Tim Kaine',
	party: 'Democratic',
	state: 'VA',
	district: '',
	chamber: 'senate' as const,
	officeCode: 'SVA'
};

const constituent = {
	id: 'submission-1',
	name: 'Ada Lovelace',
	email: 'ada@example.test',
	address: { street: '1 Main St', city: 'Arlington', state: 'VA', zip: '22201' },
	representatives: { house: houseRep, senate: [] }
};

const template = {
	id: 'rural-telehealth',
	title: 'Fund rural VA telehealth',
	description: 'desc',
	message_body: AUTHORED_BODY,
	delivery_config: {}
};

const agent = {
	name: 'Commons',
	email: 'ack@example.test',
	contactName: 'Support',
	contactEmail: 'support@example.test',
	contactPhone: '555-000-1111',
	organization: 'Commons',
	organizationAbout: 'Civic engagement platform'
};

/**
 * The resolution the send path performs: no sender text exists server-side, so
 * every manual-fill slot erases and the identity slots carry what is known.
 */
function resolvedBody(): string {
	return resolvePlaceholders(AUTHORED_BODY, {
		...manualFillReplacements(),
		'[Name]': constituent.name,
		'[Representative Name]': houseRep.name,
		'[Rep Name]': houseRep.name,
		'[Representative]': `Rep. ${houseRep.name}`
	});
}

describe('the letter Congress receives carries no authoring placeholder', () => {
	it('the House message is free of every denylisted placeholder', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML(
			{
				template,
				user: constituent,
				_targetRep: houseRep,
				personalizedMessage: resolvedBody()
			},
			agent
		);

		const message = constituentMessage(xml);
		for (const placeholder of DELIVERABLE_PLACEHOLDER_DENYLIST) {
			expect(message).not.toContain(placeholder);
		}
		expect(message).toContain('Ada Lovelace');
	});

	it('the Senate message is free of every denylisted placeholder', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML(
			{
				template,
				user: { ...constituent, representatives: { house: houseRep, senate: [senator] } },
				_targetRep: senator,
				personalizedMessage: resolvedBody()
			},
			agent
		);

		const message = constituentMessage(xml);
		for (const placeholder of DELIVERABLE_PLACEHOLDER_DENYLIST) {
			expect(message).not.toContain(placeholder);
		}
		expect(message).toContain('Ada Lovelace');
	});

	it('the footnote markers the letter cites survive to the recipient', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML(
			{
				template,
				user: constituent,
				_targetRep: houseRep,
				personalizedMessage: resolvedBody()
			},
			agent
		);

		const message = constituentMessage(xml);
		for (const marker of FOOTNOTES) {
			expect(message).toContain(marker);
		}
	});
});

describe('an unresolved letter is refused, not delivered', () => {
	it('the House validator rejects a message still carrying the sender slot', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML(
			{
				template,
				user: constituent,
				_targetRep: houseRep,
				personalizedMessage: AUTHORED_BODY
			},
			agent
		);

		const result = CWCXmlGenerator.validateXML(xml);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes('[Personal Connection]'))).toBe(true);
	});

	it('the Senate validator rejects a message still carrying the sender slot', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML(
			{
				template,
				user: { ...constituent, representatives: { house: houseRep, senate: [senator] } },
				_targetRep: senator,
				personalizedMessage: AUTHORED_BODY
			},
			agent
		);

		const result = CWCXmlGenerator.validateXML(xml);
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.includes('[Personal Connection]'))).toBe(true);
	});

	it('an empty resolution does not fall through to the raw authored body', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML(
			{
				template,
				user: constituent,
				_targetRep: houseRep,
				personalizedMessage: ''
			},
			agent
		);

		// The `||` fallback still reaches for message_body — the boundary is what
		// stops that text, unresolved, from being deliverable.
		expect(constituentMessage(xml)).toContain('[Personal Connection]');
		expect(CWCXmlGenerator.validateXML(xml).valid).toBe(false);
	});

	it('a resolved letter passes the same validator', () => {
		const xml = CWCXmlGenerator.generateUserAdvocacyXML(
			{
				template,
				user: constituent,
				_targetRep: houseRep,
				personalizedMessage: resolvedBody()
			},
			agent
		);

		expect(CWCXmlGenerator.validateXML(xml)).toEqual({ valid: true, errors: [] });
	});
});

describe('one placeholder decision, read by both runtimes', () => {
	it('the send path resolves the body before generating XML', () => {
		const submissions = src('convex/submissions.ts');
		const call = submissions.slice(
			submissions.indexOf('CWCXmlGenerator.generateUserAdvocacyXML('),
			submissions.indexOf('CWCXmlGenerator.validateXML(')
		);

		expect(call).toContain('personalizedMessage');
		expect(submissions).toContain("from './lib/messagePlaceholders'");
		expect(submissions).toContain('resolvePlaceholders(');
	});

	it('the SvelteKit resolver reads the shared table rather than its own', () => {
		const resolver = src('src/lib/utils/templateResolver.ts');

		expect(resolver).toContain("from '$convex/lib/messagePlaceholders'");
		expect(resolver).not.toContain('MANUAL_FILL_PLACEHOLDERS');
		expect(src('convex/lib/messagePlaceholders.ts')).toContain('MANUAL_FILL_PLACEHOLDERS = [');
	});

	it('the validator matches literal placeholders, never a generic bracket', () => {
		const generator = src('convex/_cwcXml.ts');

		expect(generator).toContain('DELIVERABLE_PLACEHOLDER_DENYLIST');
		expect(generator).not.toMatch(/\\\[\.\*\?\\\]/);
	});
});
