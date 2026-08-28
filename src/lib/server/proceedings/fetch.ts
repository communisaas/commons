import { absent, blocked, present, type Fact } from '$lib/core/fact';
import { parsePublicHttpUrl } from '$lib/core/security/public-external-url';
import { readBoundedResponseJson, readBoundedResponseText } from '$lib/server/bounded-response.mjs';
import { PROCEEDING_CLIENTS, assertEndpointAllowed, type ProceedingClient } from './manifest';

const LEGISTAR_ORIGIN = 'https://webapi.legistar.com';
const LEGISTAR_API_PREFIX = '/v1';
const DEFAULT_TOP = 50;
const MAX_TOP = 200;
const MAXIMUM_RESPONSE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const LEGISTAR_RESOURCES = Object.freeze(['events', 'bodies', 'matters', 'eventitems'] as const);

export type LegistarResource = (typeof LEGISTAR_RESOURCES)[number];
export type LegistarRow = Readonly<Record<string, unknown>>;
export type LegistarQuery = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type LegistarFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type PresentRows = Extract<Fact<readonly LegistarRow[]>, { state: 'present' }>;
type MissingRows = Exclude<Fact<readonly LegistarRow[]>, { state: 'present' }>;

type LegistarFetchTrace = Readonly<{
	httpStatus: number | null;
	signature: string;
	url: string;
}>;

export type ProceedingAbsence = LegistarFetchTrace &
	Readonly<{
		outcome: MissingRows;
	}>;

export type LegistarFetchResult =
	| (LegistarFetchTrace & Readonly<{ outcome: PresentRows }>)
	| ProceedingAbsence;

function resolveClient(slug: string): ProceedingClient {
	const client = PROCEEDING_CLIENTS.find((candidate) => candidate.slug === slug);
	if (!client) throw new Error(`Unknown Legistar client slug: ${slug}`);
	return client;
}

function assertResource(resource: LegistarResource): LegistarResource {
	if (!(LEGISTAR_RESOURCES as readonly string[]).includes(resource)) {
		throw new Error(`Unsupported Legistar resource: ${String(resource)}`);
	}
	return resource;
}

function boundedTop(value: LegistarQuery[string]): number {
	if (typeof value !== 'number' && typeof value !== 'string') return DEFAULT_TOP;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TOP;
	return Math.min(Math.floor(parsed), MAX_TOP);
}

function buildLegistarUrl(
	client: ProceedingClient,
	resource: LegistarResource,
	query: LegistarQuery
): URL {
	// Client and resource have already been selected by exact equality from closed sets.
	const assembled = new URL(`${LEGISTAR_API_PREFIX}/${client.slug}/${resource}`, LEGISTAR_ORIGIN);
	for (const [key, value] of Object.entries(query)) {
		if (key === '$top' || value === null || value === undefined) continue;
		assembled.searchParams.set(key, String(value));
	}
	assembled.searchParams.set('$top', String(boundedTop(query.$top)));

	const url = parsePublicHttpUrl(assembled.toString(), 4_096);
	if (!url || url.hostname !== 'webapi.legistar.com') {
		throw new Error('Legistar URL failed the exact public-host boundary');
	}
	assertEndpointAllowed(url.pathname);
	return url;
}

function blockedResult(
	url: URL,
	httpStatus: number | null,
	signature: string,
	why: string
): ProceedingAbsence {
	return {
		outcome: blocked(why),
		httpStatus,
		signature,
		url: url.toString()
	};
}

/**
 * Fetch one bounded page from the closed Legistar manifest. Retrieval state is
 * represented by the shared Fact contract; HTTP metadata stays a separate
 * trace and never becomes an ad-hoc absence encoding.
 */
export async function fetchLegistarJson(
	slug: string,
	resource: LegistarResource,
	query: LegistarQuery = {},
	fetchImpl: LegistarFetch = fetch
): Promise<LegistarFetchResult> {
	const client = resolveClient(slug);
	const allowedResource = assertResource(resource);
	const url = buildLegistarUrl(client, allowedResource, query);
	const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: 'GET',
			headers: { accept: 'application/json' },
			redirect: 'error',
			signal: timeoutSignal
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'unknown network failure';
		const signature = timeoutSignal.aborted ? 'timeout' : 'network-error';
		return blockedResult(url, null, signature, `Legistar request was blocked: ${message}`);
	}

	if (!response.ok) {
		let responseText: string;
		try {
			responseText = await readBoundedResponseText(response, 'legistar', MAXIMUM_RESPONSE_BYTES);
		} catch (error) {
			const message = error instanceof Error ? error.message : 'unreadable response body';
			return blockedResult(
				url,
				response.status,
				`http-${response.status}-unreadable`,
				`Legistar response could not be inspected: ${message}`
			);
		}

		if (
			response.status === 500 &&
			responseText.includes('LegistarConnectionString setting is not set up')
		) {
			return {
				outcome: absent(),
				httpStatus: response.status,
				signature: 'legistar-client-not-configured',
				url: url.toString()
			};
		}

		const signature = response.status === 403 ? 'http-403' : `http-${response.status}`;
		return blockedResult(
			url,
			response.status,
			signature,
			`Legistar returned HTTP ${response.status} before rows could be inspected`
		);
	}

	let body: unknown;
	try {
		body = await readBoundedResponseJson(response, 'legistar', MAXIMUM_RESPONSE_BYTES);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'invalid JSON response';
		return blockedResult(
			url,
			response.status,
			'http-200-invalid-json',
			`Legistar rows could not be parsed: ${message}`
		);
	}

	if (!Array.isArray(body)) {
		return blockedResult(
			url,
			response.status,
			'http-200-invalid-shape',
			'Legistar returned JSON that was not a row array'
		);
	}

	if (body.length === 0) {
		return {
			outcome: absent(),
			httpStatus: response.status,
			signature: 'http-200-empty-rows',
			url: url.toString()
		};
	}

	const rows = body.filter(
		(row): row is LegistarRow => row !== null && typeof row === 'object' && !Array.isArray(row)
	);
	if (rows.length !== body.length) {
		return blockedResult(
			url,
			response.status,
			'http-200-invalid-row',
			'Legistar returned a non-object row'
		);
	}

	return {
		outcome: present(rows),
		httpStatus: response.status,
		signature: 'http-200-json-rows',
		url: url.toString()
	};
}
