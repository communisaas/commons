/**
 * "We could not check" and "we checked and declined" mean opposite things about
 * a citizen's speech, so they must not arrive as the same sentence.
 *
 * The endpoint already reports how the audience resolved. These tests drive the
 * send-time gate with byte-identical hazard summaries and vary only that
 * resolution, then read the reason a person would actually see. Every expected
 * sentence is a literal this file owns: importing the wording from the module
 * under test would pass no matter which way the two drifted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { moderatePersonalConnection } from '$lib/utils/personal-connection';

const TYPED = 'The clinic on Third Street turned my mother away twice.';
const SLUG = 'fix-the-clinic';

/** The hazard sentence the provider produced. Identical on every case below. */
const HAZARD_SUMMARY = 'Blocked: Defamation';

/** The sentence a person should see when the recipient list could not be read. */
const ROSTER_UNREADABLE =
	"We couldn't read this campaign's recipient list, so your words were checked against the stricter rules that apply when a private person may be reading.";

function stubFetch(body: unknown, status: number) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(body), { status }))
	);
}

async function refusalReason(body: unknown, status: number): Promise<string> {
	stubFetch(body, status);
	const result = await moderatePersonalConnection(TYPED, SLUG, ['clerk@example.gov']);
	expect(result.approved).toBe(false);
	return result.approved === false ? result.reason : '';
}

describe('the send-time gate tells an infrastructure miss from a content refusal', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('says so when the recipient list could not be read, without losing the hazard', async () => {
		const measured = await refusalReason(
			{
				approved: false,
				summary: HAZARD_SUMMARY,
				policy: 'institutional',
				basis: 'seat-lexicon'
			},
			400
		);
		const unreadable = await refusalReason(
			{
				approved: false,
				summary: HAZARD_SUMMARY,
				policy: 'unevaluable',
				reason: 'artifact-unavailable'
			},
			400
		);

		expect(unreadable).not.toBe(measured);
		expect(unreadable).toContain(ROSTER_UNREADABLE);
		expect(unreadable).toContain(HAZARD_SUMMARY);

		// A roster that WAS read keeps today's wording, exactly.
		expect(measured).toBe(HAZARD_SUMMARY);
		expect(measured).not.toContain(ROSTER_UNREADABLE);
	});

	it('never dresses a lane that names no addressed set as an infrastructure failure', async () => {
		const measured = await refusalReason(
			{
				approved: false,
				summary: HAZARD_SUMMARY,
				policy: 'institutional',
				basis: 'seat-lexicon'
			},
			400
		);
		// A lane that hands off before recipients resolve omits them on purpose.
		// That is a deliberate silence somebody chose, not a system that broke.
		const noAddressed = await refusalReason(
			{
				approved: false,
				summary: HAZARD_SUMMARY,
				policy: 'unevaluable',
				reason: 'no-addressed-recipients'
			},
			400
		);

		expect(noAddressed).toBe(measured);
		expect(noAddressed).not.toContain(ROSTER_UNREADABLE);
	});

	it('refuses no send it would have allowed: an approval stays an approval, unexplained', async () => {
		stubFetch(
			{
				approved: true,
				summary: 'Approved',
				policy: 'unevaluable',
				reason: 'artifact-unavailable'
			},
			200
		);

		const result = await moderatePersonalConnection(TYPED, SLUG, ['clerk@example.gov']);

		expect(result.approved).toBe(true);
		expect(result).not.toHaveProperty('reason');
	});
});
