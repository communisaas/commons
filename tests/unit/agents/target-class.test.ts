import { describe, expect, it } from 'vitest';
import {
	deriveDeliveryTier,
	type DeliveryDerivation,
	type StandingEvidence
} from '$lib/core/agents/target-class';

describe('delivery tier derivation', () => {
	const cases: Array<{
		name: string;
		evidence: StandingEvidence;
		expected: DeliveryDerivation;
	}> = [
		{
			name: 'uses C when no address was found',
			evidence: { groundedThisRun: true },
			expected: { deliveryTier: 'C', reason: 'no_address' }
		},
		{
			name: 'uses A for a grounded self-published officeholder seat',
			evidence: {
				email: 'mayor@cityofx.gov',
				title: 'Mayor',
				groundedThisRun: true,
				groundingSourceUrl: 'https://www.cityofx.gov/mayor'
			},
			expected: { deliveryTier: 'A', reason: 'officeholder_self_published' }
		},
		{
			name: 'uses B and carries the R3 seat verdict for an institutional channel',
			evidence: {
				email: 'planning@county.gov',
				title: 'Senior Planner',
				groundedThisRun: true,
				groundingSourceUrl: 'https://county.gov/planning'
			},
			expected: {
				deliveryTier: 'B',
				reason: 'seat_channel_self_published',
				seatRoute: {
					form: 'seat',
					localPart: 'planning',
					nameTokenMatch: false,
					lexiconHit: 'planning'
				}
			}
		},
		{
			name: 'uses C for an ordinary staff title with a personal local part',
			evidence: {
				email: 'jane.doe@dept.edu',
				title: 'Program Coordinator',
				groundedThisRun: true,
				groundingSourceUrl: 'https://dept.edu/directory'
			},
			expected: { deliveryTier: 'C', reason: 'personal_local_part_no_seat' }
		},
		{
			name: 'uses C for a grounded address published off-domain',
			evidence: {
				email: 'press@utility.com',
				title: 'Press Office',
				groundedThisRun: true,
				groundingSourceUrl: 'https://news-aggregator.example/x'
			},
			expected: { deliveryTier: 'C', reason: 'off_domain_publication' }
		},
		{
			name: 'caps a cached self-published role address at B',
			evidence: {
				email: 'press@utility.com',
				title: 'President',
				groundedThisRun: false,
				groundingSourceUrl: 'https://utility.com/news'
			},
			expected: {
				deliveryTier: 'B',
				reason: 'seat_channel_self_published',
				seatRoute: {
					form: 'seat',
					localPart: 'press',
					nameTokenMatch: false,
					lexiconHit: 'press'
				}
			}
		},
		{
			name: 'does not admit a cached role address published off-domain',
			evidence: {
				email: 'planning@county.gov',
				title: 'Senior Planner',
				groundedThisRun: false,
				groundingSourceUrl: 'https://directory.example/planning'
			},
			expected: { deliveryTier: 'C', reason: 'not_grounded_this_run' }
		},
		{
			name: 'does not admit a cached role address without a publication source',
			evidence: {
				email: 'planning@county.gov',
				title: 'Senior Planner',
				groundedThisRun: false
			},
			expected: { deliveryTier: 'C', reason: 'not_grounded_this_run' }
		},
		{
			name: 'uses C for a cached personal address',
			evidence: {
				email: 'jane.doe@utility.com',
				title: 'President',
				groundedThisRun: false,
				groundingSourceUrl: 'https://utility.com/leadership'
			},
			expected: { deliveryTier: 'C', reason: 'not_grounded_this_run' }
		},
		{
			name: 'rejects a public-suffix collision',
			evidence: {
				email: 'x@gov.uk',
				title: 'Clerk',
				groundedThisRun: true,
				groundingSourceUrl: 'https://hmrc.gov.uk/contact'
			},
			expected: { deliveryTier: 'C', reason: 'off_domain_publication' }
		},
		{
			name: 'accepts a self-published institutional president on a www host',
			evidence: {
				email: 'president@osu.edu',
				title: 'President',
				groundedThisRun: true,
				groundingSourceUrl: 'https://www.osu.edu/contact'
			},
			expected: { deliveryTier: 'A', reason: 'officeholder_self_published' }
		},
		{
			name: 'does not mistake an assistant to an officeholder for the officeholder',
			evidence: {
				email: 'mayor@cityofx.gov',
				title: 'Assistant to the Mayor',
				groundedThisRun: true,
				groundingSourceUrl: 'https://cityofx.gov/mayor'
			},
			expected: {
				deliveryTier: 'B',
				reason: 'seat_channel_self_published',
				seatRoute: {
					form: 'seat',
					localPart: 'mayor',
					nameTokenMatch: false,
					lexiconHit: 'mayor'
				}
			}
		}
	];

	it.each(cases)('$name', ({ evidence, expected }) => {
		expect(deriveDeliveryTier(evidence)).toEqual(expected);
	});

	it('ignores a forged incoming delivery tier', () => {
		const forged = {
			email: 'jane.doe@dept.edu',
			title: 'Program Coordinator',
			groundedThisRun: true,
			groundingSourceUrl: 'https://dept.edu/directory',
			deliveryTier: 'A'
		} as const;

		expect(deriveDeliveryTier(forged)).toEqual({
			deliveryTier: 'C',
			reason: 'personal_local_part_no_seat'
		});
	});

	it('treats a name-matching lexicon local part as a person mailbox', () => {
		expect(
			deriveDeliveryTier({
				email: 'press@utility.com',
				candidateName: 'Sarah Press',
				title: 'President',
				groundedThisRun: true,
				groundingSourceUrl: 'https://utility.com/leadership'
			})
		).toEqual({ deliveryTier: 'C', reason: 'personal_local_part_no_seat' });
	});

	it.each([
		['a.chan@corp.com', 'Customer Service Representative'],
		['intern.smith@cityofx.gov', 'Council Member for District 4'],
		['j.doe@osu.edu', 'President of the Student Body'],
		['a.chan@corp.com', 'Intern\nMayor']
	])('does not let a model title rescue personal mailbox %s', (email, title) => {
		expect(
			deriveDeliveryTier({
				email,
				title,
				groundedThisRun: true,
				groundingSourceUrl: `https://${email.split('@')[1]}/directory`
			})
		).toEqual({ deliveryTier: 'C', reason: 'personal_local_part_no_seat' });
	});

	it('matches a publishing subdomain to the address domain', () => {
		expect(
			deriveDeliveryTier({
				email: 'mayor@city.gov',
				title: 'Mayor',
				groundedThisRun: true,
				groundingSourceUrl: 'https://contact.city.gov/mayor'
			})
		).toEqual({ deliveryTier: 'A', reason: 'officeholder_self_published' });
	});

	it('matches an address subdomain to the publishing domain', () => {
		expect(
			deriveDeliveryTier({
				email: 'mayor@office.city.gov',
				title: 'Mayor',
				groundedThisRun: true,
				groundingSourceUrl: 'https://city.gov/mayor'
			})
		).toEqual({ deliveryTier: 'A', reason: 'officeholder_self_published' });
	});

	it('rejects an exact single-label host and address domain', () => {
		expect(
			deriveDeliveryTier({
				email: 'clerk@city',
				title: 'Clerk',
				groundedThisRun: true,
				groundingSourceUrl: 'https://city/contact'
			})
		).toEqual({ deliveryTier: 'C', reason: 'off_domain_publication' });
	});

	it('strips leading www before applying the public-suffix safety check', () => {
		expect(
			deriveDeliveryTier({
				email: 'president@www.gov.uk',
				title: 'President',
				groundedThisRun: true,
				groundingSourceUrl: 'https://www.gov.uk/contact'
			})
		).toEqual({ deliveryTier: 'C', reason: 'off_domain_publication' });
	});

	it('requires both designation and block binding to grant a personal address tier A', () => {
		const evidence = {
			email: 'jane.doe@dept.edu',
			title: 'Program Coordinator',
			groundedThisRun: true,
			groundingSourceUrl: 'https://dept.edu/directory'
		} satisfies StandingEvidence;

		expect(deriveDeliveryTier({ ...evidence, designatedContactForSubject: true })).toEqual({
			deliveryTier: 'C',
			reason: 'personal_local_part_no_seat'
		});
		expect(deriveDeliveryTier({ ...evidence, nameBoundInBlock: true })).toEqual({
			deliveryTier: 'C',
			reason: 'personal_local_part_no_seat'
		});
		expect(
			deriveDeliveryTier({
				...evidence,
				designatedContactForSubject: true,
				nameBoundInBlock: true
			})
		).toEqual({ deliveryTier: 'A', reason: 'designated_contact_self_published' });
	});
});
