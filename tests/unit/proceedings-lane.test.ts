import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePublicHttpUrl } from '$lib/core/security/public-external-url';
import { assertEndpointAllowed as manifestEndpointGuard } from '$lib/server/proceedings/manifest';

vi.mock('$lib/core/security/public-external-url', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/core/security/public-external-url')>();
	return { ...actual, parsePublicHttpUrl: vi.fn(actual.parsePublicHttpUrl) };
});

vi.mock('$lib/server/proceedings/manifest', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/proceedings/manifest')>();
	return { ...actual, assertEndpointAllowed: vi.fn(actual.assertEndpointAllowed) };
});
import {
	PROCEEDING_CLIENTS,
	assertEndpointAllowed,
	buildProceeding,
	extractChannelOfRecord,
	fetchLegistarJson,
	type ChannelOfRecord,
	type LegistarBody,
	type LegistarEvent,
	type LegistarEventItem,
	type LegistarFetch,
	type LegistarMatter,
	type Proceeding,
	type ProceedingResult
} from '$lib/server/proceedings';
import type { Fact } from '$lib/core/fact';

const client = PROCEEDING_CLIENTS.find(({ slug }) => slug === 'seattle')!;
type ForbiddenProceedingField = Extract<
	keyof Proceeding,
	'recordClosingDate' | 'filingFormat' | 'parties'
>;
const proceedingTypeHasNoDocketFields: ForbiddenProceedingField extends never ? true : false = true;

afterEach(() => {
	vi.clearAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function presentChannels(outcomes: readonly Fact<ChannelOfRecord>[]): ChannelOfRecord[] {
	return outcomes.flatMap((outcome) => (outcome.state === 'present' ? [outcome.value] : []));
}

function presentProceedings(outcome: ProceedingResult): readonly Proceeding[] {
	if (outcome.state !== 'present') throw new Error(`expected proceedings, got ${outcome.state}`);
	return outcome.value;
}

describe('proceeding clock', () => {
	const bodies: LegistarBody[] = [
		{ BodyId: 7, BodyName: 'City Council', BodyActiveFlag: 1, BodyContactEmail: null }
	];
	const events: LegistarEvent[] = [
		{
			EventId: 101,
			EventBodyId: 7,
			EventBodyName: 'City Council',
			EventDate: '2099-08-10T00:00:00',
			EventTime: '10:30 AM',
			EventAgendaStatusName: 'Final',
			EventAgendaFile: 'https://seattle.legistar.com/agenda/101.pdf',
			EventInSiteURL: 'https://seattle.legistar.com/MeetingDetail.aspx?ID=101'
		},
		{
			EventId: 102,
			EventBodyId: 7,
			EventBodyName: 'City Council',
			EventDate: '2099-08-11T00:00:00',
			EventTime: '2:00 PM',
			EventAgendaStatusName: 'Cancelled'
		},
		{
			EventId: 99,
			EventBodyId: 7,
			EventBodyName: 'City Council',
			EventDate: '2000-01-01T00:00:00',
			EventAgendaStatusName: 'Final'
		}
	];
	const eventItems: LegistarEventItem[] = [
		{
			EventItemId: 1,
			EventItemEventId: 101,
			EventItemMatterId: 501,
			EventItemTitle: 'Clean Buildings Ordinance'
		}
	];
	const matters: LegistarMatter[] = [
		{
			MatterId: 501,
			MatterFile: 'CB 118329',
			MatterTitle: 'Clean Buildings Ordinance',
			MatterStatusName: 'In Committee',
			MatterIntroDate: '2099-07-01T00:00:00',
			MatterAgendaDate: '2099-08-10T00:00:00'
		}
	];

	it('links a forward event to its matter and preserves the real meeting wall clock', () => {
		const result = presentProceedings(
			buildProceeding(client, bodies, events, eventItems, matters)
		);

		expect(result[0]).toMatchObject({
			jurisdiction: 'Seattle, WA',
			bodyId: 7,
			matterFile: 'CB 118329',
			matterStatus: 'In Committee',
			nextMeetingAt: '2099-08-10T10:30:00',
			agendaStatus: 'Final',
			agendaItemTitles: ['Clean Buildings Ordinance']
		});
		expect(result).toHaveLength(2);
	});

	it('surfaces a cancelled forward event instead of dropping it', () => {
		const result = presentProceedings(
			buildProceeding(client, bodies, events, eventItems, matters)
		);

		expect(result).toContainEqual(
			expect.objectContaining({
				nextMeetingAt: '2099-08-11T14:00:00',
				agendaStatus: 'Cancelled'
			})
		);
		expect(result.some(({ nextMeetingAt }) => nextMeetingAt.startsWith('2000-'))).toBe(false);
	});

	it('returns an absent Fact, never an empty list, when no forward proceeding exists', () => {
		const result = buildProceeding(client, bodies, [events[2]], [], []);

		expect(result).toEqual({ state: 'absent' });
	});

	it('preserves a real event when the bounded bodies page does not contain its body', () => {
		const result = buildProceeding(
			client,
			[],
			[
				{
					EventId: 103,
					EventBodyId: 81,
					EventBodyName: 'Budget Committee',
					EventDate: '2099-09-01T00:00:00',
					EventAgendaStatusName: 'Draft'
				}
			],
			[],
			[]
		);

		expect(presentProceedings(result)).toContainEqual(
			expect.objectContaining({
				bodyId: 81,
				bodyName: 'Budget Committee',
				agendaStatus: 'Draft'
			})
		);
	});

	it('blocks an incomplete forward event instead of inventing observed absence', () => {
		const result = buildProceeding(
			client,
			[],
			[
				{
					EventId: 104,
					EventDate: '2099-09-02T00:00:00',
					EventAgendaStatusName: 'Final'
				}
			],
			[],
			[]
		);

		expect(result).toEqual({
			state: 'blocked',
			why: 'Forward-dated Legistar event rows were incomplete and could not be mapped'
		});
	});

	it('does not import regulatory-docket fields into the Proceeding type', () => {
		expect(proceedingTypeHasNoDocketFields).toBe(true);
	});
});

describe('measured client manifest', () => {
	it('pins every live measurement that authorizes a slug', () => {
		expect(PROCEEDING_CLIENTS).toEqual([
			{
				slug: 'seattle',
				jurisdiction: 'Seattle, WA',
				jurisdictionLevel: 'municipal',
				measuredAt: '2026-08-04',
				measuredBodies: 83,
				measuredActiveBodies: 19,
				measuredContactEmails: 0
			},
			{
				slug: 'baltimore',
				jurisdiction: 'Baltimore, MD',
				jurisdictionLevel: 'municipal',
				measuredAt: '2026-08-04',
				measuredBodies: 257,
				measuredActiveBodies: 194,
				measuredContactEmails: 7
			},
			{
				slug: 'alexandria',
				jurisdiction: 'Alexandria, VA',
				jurisdictionLevel: 'municipal',
				measuredAt: '2026-08-04',
				measuredBodies: 10,
				measuredActiveBodies: 10,
				measuredContactEmails: 4
			},
			{
				slug: 'kingcounty',
				jurisdiction: 'King County, WA',
				jurisdictionLevel: 'county',
				measuredAt: '2026-08-04',
				measuredBodies: 151,
				measuredActiveBodies: 83,
				measuredContactEmails: 0
			},
			{
				slug: 'sanjose',
				jurisdiction: 'San José, CA',
				jurisdictionLevel: 'municipal',
				measuredAt: '2026-08-04',
				measuredBodies: 42,
				measuredActiveBodies: 38,
				measuredContactEmails: 5
			}
		]);
	});
});

describe('Fact-based retrieval and channel outcomes', () => {
	it('classifies an HTTP 403 as blocked', async () => {
		const fetchImpl: LegistarFetch = vi.fn(async () => new Response('', { status: 403 }));

		const result = await fetchLegistarJson('seattle', 'events', {}, fetchImpl);

		expect(result.outcome).toEqual({
			state: 'blocked',
			why: 'Legistar returned HTTP 403 before rows could be inspected'
		});
		expect(result).toMatchObject({ httpStatus: 403, signature: 'http-403' });
	});

	it('classifies the measured HTTP 500 connection-string body as absent', async () => {
		const fetchImpl: LegistarFetch = vi.fn(async () =>
			jsonResponse(
				{
					Message: 'An error has occurred.',
					ExceptionMessage:
						'LegistarConnectionString setting is not set up in InSite for client: chicago'
				},
				500
			)
		);

		const result = await fetchLegistarJson('seattle', 'events', {}, fetchImpl);

		expect(result.outcome).toEqual({ state: 'absent' });
		expect(result).toMatchObject({
			httpStatus: 500,
			signature: 'legistar-client-not-configured'
		});
	});

	it('classifies a completed empty row page as absent instead of present empty rows', async () => {
		const fetchImpl: LegistarFetch = vi.fn(async () => jsonResponse([]));

		const result = await fetchLegistarJson('seattle', 'events', {}, fetchImpl);

		expect(result.outcome).toEqual({ state: 'absent' });
		expect(result.signature).toBe('http-200-empty-rows');
	});

	it('carries a published active body with no contact as withheld, not empty output', async () => {
		const fetchImpl: LegistarFetch = vi.fn(async () =>
			jsonResponse([
				{ BodyId: 7, BodyName: 'City Council', BodyActiveFlag: 1, BodyContactEmail: null }
			])
		);
		const fetched = await fetchLegistarJson('seattle', 'bodies', {}, fetchImpl);
		expect(fetched.outcome.state).toBe('present');
		if (fetched.outcome.state !== 'present') throw new Error('fixture rows were not present');

		const outcomes = fetched.outcome.value.map((row) =>
			extractChannelOfRecord(row as LegistarBody)
		);

		expect(outcomes).toEqual([
			{
				state: 'withheld',
				why: 'The active body is published without a BodyContactEmail channel'
			}
		]);
		expect(presentChannels(outcomes)).toEqual([]);
	});

	it('emits exactly one declared channel for an active body with StandingClass intact', () => {
		const result = extractChannelOfRecord({
			BodyId: 42,
			BodyName: 'City Council',
			BodyActiveFlag: 1,
			BodyContactEmail: 'toni.taber@sanjoseca.gov'
		});

		expect(presentChannels([result])).toEqual([
			{
				bodyId: 42,
				bodyName: 'City Council',
				email: 'toni.taber@sanjoseca.gov',
				sourceField: 'BodyContactEmail',
				standing: 'channel-of-record'
			}
		]);
	});

	it('blocks a published but malformed BodyContactEmail instead of reporting absence', () => {
		const result = extractChannelOfRecord({
			BodyId: 42,
			BodyName: 'City Council',
			BodyActiveFlag: 1,
			BodyContactEmail: 'not-an-email'
		});

		expect(result).toEqual({
			state: 'blocked',
			why: 'BodyContactEmail was published but could not be parsed as an email address'
		});
	});

	it.each([
		{ BodyName: 'City Council' },
		{ BodyId: 42 }
	])('blocks a published email whose body identity is incomplete: %o', (identity) => {
		const result = extractChannelOfRecord({
			...identity,
			BodyActiveFlag: 1,
			BodyContactEmail: 'clerk@example.gov'
		});

		expect(result).toEqual({
			state: 'blocked',
			why: 'The published BodyContactEmail row is missing its body id or body name'
		});
	});

	it('refuses a populated contact on an inactive body', () => {
		const result = extractChannelOfRecord({
			BodyId: 42,
			BodyName: 'Former Committee',
			BodyActiveFlag: 0,
			BodyContactEmail: 'former-clerk@example.gov'
		});

		expect(result.state).toBe('withheld');
		expect(presentChannels([result])).toEqual([]);
	});
});

describe('hard contact-source refusals', () => {
	it('does not turn a real /persons-shaped PersonEmail row into a channel', () => {
		const personsRow = {
			BodyId: 9,
			BodyName: 'City Council',
			BodyActiveFlag: 1,
			PersonFullName: 'Daystar',
			PersonActiveFlag: 0,
			PersonEmail: 'Legistar@granicus.com'
		};

		const result = extractChannelOfRecord(personsRow as LegistarBody);

		expect(presentChannels([result])).toEqual([]);
		expect(JSON.stringify(result)).not.toContain('@');
	});

	it('does not carry MatterText, MatterEXText, or EventLocation addresses into output', () => {
		const bodies: LegistarBody[] = [{ BodyId: 7, BodyName: 'City Council' }];
		const events = [
			{
				EventId: 101,
				EventBodyId: 7,
				EventBodyName: 'City Council',
				EventDate: '2099-08-10T00:00:00',
				EventAgendaStatusName: 'Final',
				EventLocation: 'location@example.gov'
			}
		] as (LegistarEvent & { EventLocation: string })[];
		const eventItems: LegistarEventItem[] = [
			{ EventItemEventId: 101, EventItemMatterId: 501, EventItemTitle: 'Agenda item' }
		];
		const matters = [
			{
				MatterId: 501,
				MatterFile: 'CB 118329',
				MatterText1: 'first@example.gov',
				MatterText2: 'bob.hennessey@seattle.gov',
				MatterText3: 'third@example.gov',
				MatterText4: 'fourth@example.gov',
				MatterText5: 'fifth@example.gov',
				MatterEXText1: 'extended-one@example.gov',
				MatterEXText2: 'extended-two@example.gov',
				MatterEXText3: 'extended-three@example.gov',
				MatterEXText4: 'extended-four@example.gov',
				MatterEXText5: 'extended-five@example.gov',
				MatterEXText6: 'extended-six@example.gov',
				MatterEXText7: 'extended-seven@example.gov',
				MatterEXText8: 'extended-eight@example.gov',
				MatterEXText9: 'extended-nine@example.gov',
				MatterEXText10: 'extended-ten@example.gov'
			}
		] as (LegistarMatter & {
			MatterText1: string;
			MatterText2: string;
			MatterText3: string;
			MatterText4: string;
			MatterText5: string;
			MatterEXText1: string;
			MatterEXText2: string;
			MatterEXText3: string;
			MatterEXText4: string;
			MatterEXText5: string;
			MatterEXText6: string;
			MatterEXText7: string;
			MatterEXText8: string;
			MatterEXText9: string;
			MatterEXText10: string;
		})[];

		const outcome = buildProceeding(client, bodies, events, eventItems, matters);
		const result = presentProceedings(outcome);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ matterFile: 'CB 118329' });
		expect(JSON.stringify(outcome)).not.toContain('@');
	});
});

describe('closed endpoint and request boundary', () => {
	it.each([
		'/docket',
		'/docket/123',
		'/v1/seattle/docket',
		'/ex-parte',
		'/ex_parte',
		'/exParte',
		'/staff-assigned',
		'/staff_assigned',
		'/staffAssigned',
		'/service-list',
		'/service_list',
		'/serviceList'
	])(
		'refuses %s',
		(path) => {
			expect(() => assertEndpointAllowed(path)).toThrow(/refused by policy/u);
		}
	);

	it('does not refuse an unrelated path containing docket as part of a larger word', () => {
		expect(() => assertEndpointAllowed('/events/redocketed-item')).not.toThrow();
	});

	it('routes the assembled URL through the shared public-URL parser', async () => {
		const parser = vi.mocked(parsePublicHttpUrl);
		parser.mockReturnValueOnce(null);
		const fetchImpl: LegistarFetch = vi.fn(async () => jsonResponse([{ EventId: 1 }]));

		await expect(fetchLegistarJson('seattle', 'events', {}, fetchImpl)).rejects.toThrow(
			'exact public-host boundary'
		);
		expect(parser).toHaveBeenCalledOnce();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('rejects a parser result whose hostname is not exactly webapi.legistar.com', async () => {
		const parser = vi.mocked(parsePublicHttpUrl);
		parser.mockReturnValueOnce(new URL('https://off-host.example/v1/seattle/events'));
		const fetchImpl: LegistarFetch = vi.fn(async () => jsonResponse([{ EventId: 1 }]));

		await expect(fetchLegistarJson('seattle', 'events', {}, fetchImpl)).rejects.toThrow(
			'exact public-host boundary'
		);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('runs every assembled path through the refusal guard before fetch', async () => {
		const guard = vi.mocked(manifestEndpointGuard);
		guard.mockImplementationOnce(() => {
			throw new Error('endpoint guard probe');
		});
		const fetchImpl: LegistarFetch = vi.fn(async () => jsonResponse([{ EventId: 1 }]));

		await expect(fetchLegistarJson('seattle', 'events', {}, fetchImpl)).rejects.toThrow(
			'endpoint guard probe'
		);
		expect(guard).toHaveBeenCalledWith('/v1/seattle/events');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('sets redirect error so an off-host redirect cannot be followed', async () => {
		let requestInit: RequestInit | undefined;
		const fetchImpl: LegistarFetch = vi.fn(async (_input, init) => {
			requestInit = init;
			return init?.redirect === 'error'
				? Promise.reject(new TypeError('redirect mode refused the redirect'))
				: jsonResponse([{ LeakedOffHostRow: true }]);
		});

		const result = await fetchLegistarJson('seattle', 'events', {}, fetchImpl);

		expect(requestInit?.redirect).toBe('error');
		expect(result.outcome.state).toBe('blocked');
		expect(JSON.stringify(result)).not.toContain('LeakedOffHostRow');
	});

	it('passes a 15-second timeout signal and classifies its abort as blocked', async () => {
		const controller = new AbortController();
		controller.abort();
		const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
		let requestInit: RequestInit | undefined;
		const fetchImpl: LegistarFetch = vi.fn(async (_input, init) => {
			requestInit = init;
			if (init?.signal?.aborted) throw new DOMException('timed out', 'AbortError');
			return jsonResponse([{ EventId: 1 }]);
		});

		try {
			const result = await fetchLegistarJson('seattle', 'events', {}, fetchImpl);

			expect(timeout).toHaveBeenCalledWith(15_000);
			expect(requestInit?.signal).toBe(controller.signal);
			expect(result).toMatchObject({
				outcome: { state: 'blocked' },
				signature: 'timeout'
			});
		} finally {
			timeout.mockRestore();
		}
	});

	it('uses the bounded JSON reader for successful response bodies', async () => {
		const oversizedRow = { payload: 'x'.repeat(1_000_000) };
		const fetchImpl: LegistarFetch = vi.fn(async () => jsonResponse([oversizedRow]));

		const result = await fetchLegistarJson('seattle', 'events', {}, fetchImpl);

		expect(result).toMatchObject({
			outcome: { state: 'blocked' },
			signature: 'http-200-invalid-json'
		});
	});

	it('rejects an unmeasured slug before the injected fetch can run', async () => {
		const fetchImpl: LegistarFetch = vi.fn(async () => jsonResponse([{ EventId: 1 }]));

		await expect(
			fetchLegistarJson('chicago', 'events', {}, fetchImpl)
		).rejects.toThrow('Unknown Legistar client slug: chicago');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('always adds $top and clamps the producer request to 200', async () => {
		const requestedUrls: URL[] = [];
		const fetchImpl: LegistarFetch = vi.fn(async (input) => {
			requestedUrls.push(new URL(String(input)));
			return jsonResponse([{ EventId: 1 }]);
		});

		await fetchLegistarJson('seattle', 'events', { $orderby: 'EventDate', $top: 500 }, fetchImpl);
		await fetchLegistarJson('seattle', 'bodies', {}, fetchImpl);

		expect(requestedUrls).toHaveLength(2);
		expect(requestedUrls.map((url) => url.hostname)).toEqual([
			'webapi.legistar.com',
			'webapi.legistar.com'
		]);
		expect(requestedUrls.map((url) => url.searchParams.get('$top'))).toEqual(['200', '50']);
		expect(
			requestedUrls.every((url) => Number(url.searchParams.get('$top')) <= 200)
		).toBe(true);
	});
});
