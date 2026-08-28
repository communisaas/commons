import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudienceForm, AudienceVerdict } from '$lib/core/server/moderation/audience';

vi.mock('$env/dynamic/private', () => ({
	env: { GROQ_API_KEY: 'test-groq-key' }
}));

import {
	BLOCKING_HAZARDS,
	PERSON_BLOCKING_HAZARDS,
	blockingHazardsForAudience,
	classifySafety,
	moderatePersonalization,
	moderateTemplate
} from '$lib/core/server/moderation';

const INSTITUTIONAL_AUDIENCE = {
	form: 'institutional',
	basis: 'government-registry',
	routes: 1
} satisfies AudienceVerdict;

const STRICT_AUDIENCES = [
	{ form: 'person-form', basis: 'name-token-match', routes: 1 },
	{ form: 'unevaluable', reason: 'indeterminate-route', routes: 1 },
	{ form: 'unevaluable', reason: 'no-roster', routes: 0 }
] satisfies AudienceVerdict[];

/** Every branch of the union, so a new form cannot skip the S1 floor. */
const ALL_FORMS = ['institutional', 'person-form', 'unevaluable'] as const;

function verdictFor(form: AudienceForm): AudienceVerdict {
	switch (form) {
		case 'institutional':
			return INSTITUTIONAL_AUDIENCE;
		case 'person-form':
			return { form, basis: 'name-token-match', routes: 1 };
		case 'unevaluable':
			return { form, reason: 'no-roster', routes: 0 };
		default: {
			const unreachable: never = form;
			throw new Error(`unhandled audience form ${String(unreachable)}`);
		}
	}
}

function completion(content: string): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => vi.restoreAllMocks());

describe('audience hazard policy', () => {
	it('keeps the calibrated S1/S4 set for a measured institutional audience', () => {
		expect(blockingHazardsForAudience(INSTITUTIONAL_AUDIENCE)).toEqual(['S1', 'S4']);
		expect(BLOCKING_HAZARDS).toEqual(['S1', 'S4']);
	});

	it.each(STRICT_AUDIENCES)('blocks S5, S7, and S10 for audience form $form', (audience) => {
		expect(blockingHazardsForAudience(audience)).toEqual(
			expect.arrayContaining(['S1', 'S4', 'S5', 'S7', 'S10'])
		);
	});

	it('fails closed to S5, S7, and S10 when no audience was resolved', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S5'));

		await expect(classifySafety('Claim about a private employee')).resolves.toMatchObject({
			safe: false,
			blocking_hazards: ['S5']
		});
		expect(PERSON_BLOCKING_HAZARDS).toEqual(['S1', 'S4', 'S5', 'S7', 'S10']);
	});

	it('allows S5 only for a measured institutional audience', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S5'));

		await expect(
			classifySafety('Criticism of public conduct', { audience: INSTITUTIONAL_AUDIENCE })
		).resolves.toMatchObject({ safe: true, hazards: ['S5'], blocking_hazards: [] });
		await expect(
			classifySafety('Claim about a private employee', { audience: STRICT_AUDIENCES[0] })
		).resolves.toMatchObject({
			safe: false,
			hazards: ['S5'],
			blocking_hazards: ['S5']
		});
	});

	it('never loosens S1 for any audience form', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S1'));

		for (const audience of [...ALL_FORMS.map(verdictFor), undefined]) {
			await expect(classifySafety('Threat', { audience })).resolves.toMatchObject({
				safe: false,
				blocking_hazards: ['S1']
			});
		}
	});

	it('threads the measured audience through template moderation', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S5'));

		const result = await moderateTemplate(
			{
				title: 'Public conduct',
				description: 'Criticism of official conduct',
				preview: 'Ask for an investigation',
				message_body: 'The official concealed the report'
			},
			{ skipPromptGuard: true, audience: INSTITUTIONAL_AUDIENCE }
		);

		expect(result).toMatchObject({ approved: true, safety: { safe: true, hazards: ['S5'] } });
	});

	it('keeps template moderation strict when no caller supplies an audience', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S5'));

		const result = await moderateTemplate(
			{
				title: 'Public conduct',
				description: 'Criticism of a private employee',
				preview: 'Ask for an investigation',
				message_body: 'The nurse concealed the report'
			},
			{ skipPromptGuard: true }
		);

		expect(result).toMatchObject({ approved: false, rejection_reason: 'safety_violation' });
	});

	it('threads the measured audience through personalization moderation', async () => {
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(completion('0.1'))
			.mockResolvedValueOnce(completion('unsafe,S5'));

		const result = await moderatePersonalization('The official concealed the report', {
			audience: INSTITUTIONAL_AUDIENCE
		});

		expect(result).toMatchObject({ approved: true, safety: { safe: true, hazards: ['S5'] } });
	});
});
