import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GovernmentalClass } from '$lib/core/agents/governmental-class';

vi.mock('$env/dynamic/private', () => ({
	env: { GROQ_API_KEY: 'test-groq-key' }
}));

import {
	BLOCKING_HAZARDS,
	NON_GOVERNMENTAL_BLOCKING_HAZARDS,
	blockingHazardsForTarget,
	classifySafety,
	moderatePersonalization,
	moderateTemplate
} from '$lib/core/server/moderation';

const GOVERNMENTAL_TARGET = {
	governmental: true,
	basis: 'us-federal-registry',
	registryDomain: 'gov'
} satisfies GovernmentalClass;

const NON_GOVERNMENTAL_TARGETS = [
	{ governmental: false, reason: 'not-a-government-registry' },
	{ governmental: false, reason: 'no-address' }
] satisfies GovernmentalClass[];

function completion(content: string): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

afterEach(() => vi.restoreAllMocks());

describe('target-class hazard policy', () => {
	it('keeps the calibrated S1/S4 set for a measured governmental registry target', () => {
		expect(blockingHazardsForTarget(GOVERNMENTAL_TARGET)).toEqual(['S1', 'S4']);
		expect(BLOCKING_HAZARDS).toEqual(['S1', 'S4']);
	});

	it.each(NON_GOVERNMENTAL_TARGETS)(
		'blocks S5, S7, and S10 for non-governmental class $reason',
		(targetClass) => {
			expect(blockingHazardsForTarget(targetClass)).toEqual(
				expect.arrayContaining(['S1', 'S4', 'S5', 'S7', 'S10'])
			);
		}
	);

	it('fails closed to S5, S7, and S10 when the target class is unknown', () => {
		expect(blockingHazardsForTarget(undefined)).toEqual(
			expect.arrayContaining(['S5', 'S7', 'S10'])
		);
		expect(NON_GOVERNMENTAL_BLOCKING_HAZARDS).toEqual(['S1', 'S4', 'S5', 'S7', 'S10']);
	});

	it('allows S5 only for a measured governmental target', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S5'));

		await expect(
			classifySafety('Criticism of public conduct', { targetClass: GOVERNMENTAL_TARGET })
		).resolves.toMatchObject({ safe: true, hazards: ['S5'], blocking_hazards: [] });
		await expect(classifySafety('Claim about a private employee')).resolves.toMatchObject({
			safe: false,
			hazards: ['S5'],
			blocking_hazards: ['S5']
		});
	});

	it('never loosens S1 for any target class', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S1'));

		for (const targetClass of [GOVERNMENTAL_TARGET, ...NON_GOVERNMENTAL_TARGETS, undefined]) {
			await expect(classifySafety('Threat', { targetClass })).resolves.toMatchObject({
				safe: false,
				blocking_hazards: ['S1']
			});
		}
	});

	it('threads the measured class through template moderation', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion('unsafe,S5'));

		const result = await moderateTemplate(
			{
				title: 'Public conduct',
				description: 'Criticism of official conduct',
				preview: 'Ask for an investigation',
				message_body: 'The official concealed the report'
			},
			{ skipPromptGuard: true, targetClass: GOVERNMENTAL_TARGET }
		);

		expect(result).toMatchObject({ approved: true, safety: { safe: true, hazards: ['S5'] } });
	});

	it('threads the measured class through personalization moderation', async () => {
		vi.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(completion('0.1'))
			.mockResolvedValueOnce(completion('unsafe,S5'));

		const result = await moderatePersonalization('The official concealed the report', {
			targetClass: GOVERNMENTAL_TARGET
		});

		expect(result).toMatchObject({ approved: true, safety: { safe: true, hazards: ['S5'] } });
	});
});
