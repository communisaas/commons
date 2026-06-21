import { describe, it, expect } from 'vitest';
import {
	tokenize,
	scoreTemplateAgainstText,
	matchExistingCampaigns,
	MIN_QUERY_LENGTH
} from '$lib/core/topic/template-text-match';
import type { Template } from '$lib/types/template';

/**
 * Minimal Template factory — only the fields the matcher reads
 * (title, description, domain, topics, slug, send_count).
 */
function makeTemplate(over: Partial<Template> & { title: string }): Template {
	return {
		id: over.slug ?? over.title.toLowerCase().replace(/\s+/g, '-'),
		slug: over.slug ?? over.title.toLowerCase().replace(/\s+/g, '-'),
		description: '',
		domain: '',
		type: 'campaign',
		deliveryMethod: 'email',
		message_body: '',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: false,
		status: 'published',
		is_public: true,
		send_count: 0,
		preview: '',
		createdAt: new Date('2020-01-01T00:00:00Z'),
		updatedAt: new Date('2020-01-01T00:00:00Z'),
		...over
	} as Template;
}

/**
 * REAL launch corpus — copied verbatim (slug/title/domain/topics/description) from
 * convex/seedData.ts so the matcher is validated against the data it actually ships
 * with, not invented topic slugs. If seedData.ts changes, these fixtures must too.
 *
 * Earlier fixtures used fabricated topics ('rent-control', 'affordable-housing')
 * that do NOT exist in the seed corpus; the central assertion only passed because of
 * the fiction. These triples are the genuine article.
 */
const housing = makeTemplate({
	slug: 'portland-affordable-home-bans',
	title: 'Stop blocking the homes we can actually afford',
	description:
		'The City of Portland must remove the regulatory barriers to 3D-printed housing and community land trusts to provide homes at a fraction of traditional construction costs.',
	domain: 'Housing & Zoning Reform',
	topics: ['3d-printed-housing', 'zoning', 'community-land-trusts']
});

const veterans = makeTemplate({
	slug: 'va-rural-telehealth-expansion',
	title: 'Bring the telehealth that works to rural clinics',
	description:
		'The Department of Veterans Affairs must fund the expansion of its proven telehealth program to every rural clinic in the country.',
	domain: 'Veterans Healthcare Access',
	topics: ['telehealth', 'veterans', 'rural-access', 'clinic-funding'],
	send_count: 200
});

const bikes = makeTemplate({
	slug: 'montreal-bixi-savings',
	title: "Montreal's BIXI program saves more in health than it costs",
	description:
		"Montreal's BIXI bike-share program cut downtown car trips by 12% and saves $14 million per year in healthcare costs from reduced pollution.",
	domain: 'Bike Infrastructure & Public Health',
	topics: ['bike-share', 'pollution-reduction', 'active-transport', 'municipal-investment']
});

const childcare = makeTemplate({
	slug: 'preschool-success-model',
	title: 'Preschool for every child pays for itself and our future',
	description:
		"Our state must adopt the model of Colorado's universal preschool program to deliver immediate savings for families and lasting economic benefits.",
	domain: 'Universal Preschool',
	topics: ['early-childhood', 'childcare-costs', 'economic-returns', 'family-support']
});

const kidsPrivacy = makeTemplate({
	slug: 'modernize-coppa-protections',
	title: "Our children's privacy is still stuck in 1998",
	description:
		"Kids spend 7 hours a day online. Companies harvest 72 million data points per child per year. Federal privacy law hasn't updated since 1998 — COPPA is older than the kids it's supposed to protect.",
	domain: "Children's Digital Privacy",
	topics: ['privacy', 'internet-safety', 'consumer-protection', 'coppa']
});

const ceoPay = makeTemplate({
	slug: 'apple-fifteen-minutes',
	title: 'Our year of work is just fifteen minutes of interest',
	description: "Apple must raise retail wages to reflect the company's vast wealth and interest income.",
	domain: 'Retail Wages & Corporate Pay Disparity',
	topics: ['wage-inequality', 'ceo-pay-ratio', 'corporate-accountability']
});

const corpus = [housing, veterans, bikes, childcare, kidsPrivacy, ceoPay];

describe('tokenize', () => {
	it('lowercases, drops short tokens and stopwords, de-dupes', () => {
		expect(tokenize('The rent keeps going up but rent rent')).toEqual(['rent']);
	});

	it('folds dashes so "rural-access" matches "rural access"', () => {
		expect(tokenize('rural-access')).toEqual(['rural', 'access']);
	});

	it('returns [] for empty input', () => {
		expect(tokenize('')).toEqual([]);
	});
});

describe('scoreTemplateAgainstText', () => {
	it('scores a title-overlapping query above zero', () => {
		// "afford" is in the real housing title.
		const score = scoreTemplateAgainstText(housing, tokenize('homes we can afford'));
		expect(score).toBeGreaterThan(0);
	});

	it('scores an unrelated query at zero', () => {
		const score = scoreTemplateAgainstText(housing, tokenize('protected bike lanes downtown'));
		expect(score).toBe(0);
	});

	it('does not penalize a long natural sentence for its length', () => {
		// Sum-not-average: a single strong topic/title hit clears the floor regardless
		// of how many words surround it. A 0.4 title hit in a 6-token sentence must not
		// be diluted to 0.4/6 ≈ 0.07 (the old averaging bug that made the matcher inert).
		const short = scoreTemplateAgainstText(housing, tokenize('homes afford'));
		const long = scoreTemplateAgainstText(
			housing,
			tokenize('the only homes around here that families can actually afford')
		);
		expect(long).toBeGreaterThanOrEqual(short);
		expect(long).toBeGreaterThanOrEqual(0.25);
	});

	it('clamps the score at 1', () => {
		// "ceo" + "pay" both land on the ceo-pay-ratio topic (0.5 each = 1.0).
		const score = scoreTemplateAgainstText(ceoPay, tokenize('ceo pay ratio is obscene'));
		expect(score).toBeLessThanOrEqual(1);
	});
});

describe('matchExistingCampaigns', () => {
	it('matches a housing grievance to the housing template via title', () => {
		const matches = matchExistingCampaigns(corpus, 'the homes around here we can actually afford');
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches[0].template.slug).toBe('portland-affordable-home-bans');
	});

	/**
	 * Lay-vocabulary recall: the realistic case the front door must serve. A person
	 * types their grievance in plain words ("my rent keeps going up, can't afford my
	 * apartment"); they rarely echo a curated topic slug. The OLD averaging matcher
	 * returned [] here (a single 0.4 title hit on "afford" diluted across the whole
	 * sentence). With summed credit, the title hit alone clears the floor.
	 */
	it('surfaces the housing campaign for a plain-language rent grievance', () => {
		const matches = matchExistingCampaigns(corpus, "my rent keeps going up, can't afford my apartment");
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches[0].template.slug).toBe('portland-affordable-home-bans');
	});

	it('surfaces the childcare campaign for "child care is too expensive"', () => {
		const matches = matchExistingCampaigns(corpus, 'child care is too expensive for working families');
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches[0].template.slug).toBe('preschool-success-model');
	});

	it('surfaces the kids-privacy campaign for "kids privacy online"', () => {
		const matches = matchExistingCampaigns(corpus, "kids' privacy is not protected online");
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches[0].template.slug).toBe('modernize-coppa-protections');
	});

	it('surfaces the CEO-pay campaign for a plain-language pay grievance', () => {
		const matches = matchExistingCampaigns(corpus, 'ceo pay is out of control while workers struggle');
		expect(matches.length).toBeGreaterThanOrEqual(1);
		expect(matches[0].template.slug).toBe('apple-fifteen-minutes');
	});

	it('returns [] for an unrelated grievance (honest empty — no fabricated match)', () => {
		const matches = matchExistingCampaigns(corpus, 'climate emissions carbon tax credits');
		expect(matches).toEqual([]);
	});

	it('does not false-match an unrelated infrastructure grievance', () => {
		// Precision guard: a grievance with no genuine facet overlap must stay empty
		// even though the corpus contains transportation/infrastructure campaigns.
		expect(matchExistingCampaigns(corpus, 'please fix the potholes on my street')).toEqual([]);
	});

	it('returns [] when text is shorter than the minimum query length', () => {
		const short = 'rent up'; // < MIN_QUERY_LENGTH
		expect(short.length).toBeLessThan(MIN_QUERY_LENGTH);
		expect(matchExistingCampaigns(corpus, short)).toEqual([]);
	});

	it('returns [] over an empty corpus', () => {
		expect(matchExistingCampaigns([], 'the rent keeps going up and up')).toEqual([]);
	});

	it('respects the limit and sorts by score then send_count', () => {
		const matches = matchExistingCampaigns(corpus, 'veterans need telehealth at the rural clinic', {
			limit: 1
		});
		expect(matches.length).toBe(1);
		expect(matches[0].template.slug).toBe('va-rural-telehealth-expansion');
	});

	it('is deterministic across input ordering', () => {
		const a = matchExistingCampaigns(corpus, 'children privacy online safety');
		const b = matchExistingCampaigns([...corpus].reverse(), 'children privacy online safety');
		expect(a.map((m) => m.template.slug)).toEqual(b.map((m) => m.template.slug));
	});
});
