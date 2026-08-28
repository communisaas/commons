import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	CONSUMER_MAILBOX_DOMAINS,
	REGISTRY_CORPORA,
	fetchRegistryCorpus,
	toRegistryPageContent,
	transformRegistryRows,
	type RegistryCorpus
} from '$lib/server/registry';

const corpus = REGISTRY_CORPORA[0];
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function publishedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		agent_name: 'Morgan Rivera',
		lobbyist_email: 'Morgan.Rivera@CIVICFIRM.GOV',
		lobbyist_firm_name: 'Civic Firm',
		employers: 'Clean Air Coalition, Transit Alliance',
		...overrides
	};
}

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('closed registry manifest', () => {
	it('ships only the measured WA PDC corpus', () => {
		expect(REGISTRY_CORPORA).toHaveLength(1);
		expect(corpus).toMatchObject({
			id: 'wa-pdc-lobbyist-agents',
			measuredRows: 11665,
			measuredEmailCoverage: 1.0,
			corpusClass: 'coalition-map'
		});
	});

	it('refuses docket, staff, and service-list capabilities', () => {
		// Contacting commission staff mid-proceeding is prohibited in adjudicatory matters
		// and can create a 3-working-day ex parte filing obligation in ratesetting. P3 owns it.
		for (const entry of REGISTRY_CORPORA) {
			expect(`${entry.id} ${entry.datasetPath}`).not.toMatch(
				/docket|staff|service[-_ ]?list/iu
			);
		}
	});

	it('admits only projected JSON corpora on exact hosts', () => {
		for (const entry of REGISTRY_CORPORA) {
			expect(entry.datasetPath.endsWith('.json')).toBe(true);
			expect(entry.select.length).toBeGreaterThan(0);
			expect(entry.corpusClass).toBe('coalition-map');
			expect(entry.host).not.toMatch(/[*/:]/u);
		}
	});

	it('refuses CivicEngage HTML directories', () => {
		// Directory.aspx?did=N returned 403 on 4/6 sampled hosts (Cloudflare "Just a
		// moment..." and Akamai "Access Denied") and 404 on a fifth. Its HTML fields
		// are not separated and belong to the HTMLRewriter association lane.
		for (const entry of REGISTRY_CORPORA) {
			expect(`${entry.id} ${entry.datasetPath}`).not.toMatch(/Directory\.aspx|\.html?$/iu);
		}
	});
});

describe('fetchRegistryCorpus', () => {
	it('treats a 200 WAF interstitial as blocked, never absent', async () => {
		fetchMock.mockResolvedValueOnce(new Response('<title>Just a moment...</title>'));

		const outcome = await fetchRegistryCorpus(corpus);

		expect(outcome).toMatchObject({ state: 'blocked', why: 'not-json' });
		expect(outcome.state).not.toBe('absent');
	});

	it('treats a 200 Socrata error object as blocked', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse({ error: true, code: 'dataset.missing' }));

		await expect(fetchRegistryCorpus(corpus)).resolves.toMatchObject({
			state: 'blocked',
			why: 'api-error'
		});
	});

	it('distinguishes observed absence from a published row with no mapped email', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([]));
		await expect(fetchRegistryCorpus(corpus)).resolves.toMatchObject({ state: 'absent' });

		fetchMock.mockResolvedValueOnce(jsonResponse([{ agent_name: 'No public route' }]));
		await expect(fetchRegistryCorpus(corpus)).resolves.toMatchObject({
			state: 'withheld',
			why: 'mapped-email-withheld',
			rowCount: 1
		});
	});

	it('preserves an HTTP refusal as blocked with its status', async () => {
		fetchMock.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));

		await expect(fetchRegistryCorpus(corpus)).resolves.toMatchObject({
			state: 'blocked',
			why: 'http-status',
			status: 403
		});
	});

	it('refuses a non-manifest host before fetch', async () => {
		const hostileCorpus: RegistryCorpus = {
			...corpus,
			datasetPath: 'https://example.org/resource/bp5b-jrti.json'
		};

		await expect(fetchRegistryCorpus(hostileCorpus)).resolves.toMatchObject({
			state: 'blocked'
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('bounds runtime query inputs and always projects the manifest fields', async () => {
		fetchMock.mockImplementation(async () => jsonResponse([publishedRow()]));

		await fetchRegistryCorpus(corpus, { year: '2026', limit: 99999 });
		await fetchRegistryCorpus(corpus, { year: "2026' OR 1=1" });

		const acceptedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
		expect(acceptedUrl.searchParams.get('$where')).toBe("employment_year='2026'");
		expect(acceptedUrl.searchParams.get('$limit')).toBe('1000');
		expect(acceptedUrl.searchParams.get('$select')).toBe(corpus.select.join(','));

		const rejectedUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
		expect(rejectedUrl.searchParams.has('$where')).toBe(false);
	});

	it('sends no credential header', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse([publishedRow()]));

		await fetchRegistryCorpus(corpus);

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.has('authorization')).toBe(false);
		expect(headers.has('x-app-token')).toBe(false);
		expect(headers.get('accept')).toBe('application/json');
	});

	it('maps a body over 2 MiB to blocked oversize', async () => {
		fetchMock.mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)));

		await expect(fetchRegistryCorpus(corpus)).resolves.toMatchObject({
			state: 'blocked',
			why: 'oversize'
		});
	});
});

describe('transformRegistryRows', () => {
	it('rejects a measured consumer mailbox row', () => {
		const result = transformRegistryRows(
			corpus,
			[publishedRow({ lobbyist_email: 'EHRENFLYGARE@GMAIL.COM' })],
			'https://data.wa.gov/example'
		);

		expect(CONSUMER_MAILBOX_DOMAINS.has('gmail.com')).toBe(true);
		expect(result.records).toEqual([]);
		expect(result.rejected).toEqual([{ rowIndex: 0, reason: 'consumer-mailbox' }]);
	});

	it('emits a categorical coalition record that can never be a default target', () => {
		const requestUrl = 'https://data.wa.gov/resource/bp5b-jrti.json?$limit=1';
		const result = transformRegistryRows(corpus, [publishedRow()], requestUrl);

		expect(result.records).toHaveLength(1);
		expect(result.records[0]).toMatchObject({
			title: corpus.recordTitle,
			corpusClass: 'coalition-map',
			defaultSendTarget: false,
			standing: 'coalition',
			standingBasis: 'registry-field',
			sourceUrl: requestUrl
		});
		expect(result.records[0]?.seatRoute.form).toMatch(/person-form|indeterminate/u);
	});

	it('itemises one result or rejection for every input and never emits true', () => {
		const rows = [
			publishedRow(),
			publishedRow({
				agent_name: 'Taylor Kim',
				lobbyist_email: 'taylor@policy.example.org'
			}),
			publishedRow({ lobbyist_email: 'person@yahoo.com' }),
			publishedRow({ lobbyist_email: 'not-an-email' }),
			publishedRow({ agent_name: '   ' })
		];
		const result = transformRegistryRows(corpus, rows, 'https://data.wa.gov/example');

		expect(result.records.length + result.rejected.length).toBe(rows.length);
		expect(result.records.every((record) => record.defaultSendTarget === false)).toBe(true);
		expect(result.rejected.map(({ reason }) => reason)).toEqual([
			'consumer-mailbox',
			'malformed-email',
			'missing-name'
		]);
	});

	it('preserves published address bytes while lowercasing only the domain', () => {
		const result = transformRegistryRows(
			corpus,
			[publishedRow({ lobbyist_email: 'Policy.Team@EXAMPLE.GOV' })],
			'https://data.wa.gov/example'
		);

		expect(result.records[0]?.emailAsPublished).toBe('Policy.Team@EXAMPLE.GOV');
		expect(result.records[0]?.emailNormalized).toBe('Policy.Team@example.gov');
	});

	it('enforces mapped-field byte caps and caps affiliations at 25', () => {
		const affiliations = Array.from({ length: 30 }, (_, index) => `Group ${index}`).join(',');
		const result = transformRegistryRows(
			corpus,
			[
				publishedRow({ agent_name: 'x'.repeat(201) }),
				publishedRow({ employers: affiliations })
			],
			'https://data.wa.gov/example'
		);

		expect(result.rejected).toContainEqual({ rowIndex: 0, reason: 'oversize-field' });
		expect(result.records[0]?.affiliations).toHaveLength(25);
	});

	it('renders every emitted published address into the grounding text', () => {
		const requestUrl = 'https://data.wa.gov/resource/bp5b-jrti.json?$limit=2';
		const transformed = transformRegistryRows(
			corpus,
			[
				publishedRow(),
				publishedRow({
					agent_name: 'Taylor Kim',
					lobbyist_email: 'Taylor.Kim@Policy.Example.ORG'
				})
			],
			requestUrl
		);
		const page = toRegistryPageContent(corpus, transformed.records, requestUrl);

		expect(page.url).toBe(requestUrl);
		expect(page.text.split('\n')).toHaveLength(transformed.records.length);
		for (const record of transformed.records) {
			expect(page.text.toLowerCase()).toContain(record.emailAsPublished.toLowerCase());
		}
	});
});
