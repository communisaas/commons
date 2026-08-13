import { absent, blocked, present, withheld, type Fact } from '$lib/core/fact';
import { parsePublicHttpUrl } from '$lib/core/security/public-external-url';
import { readBoundedResponseText } from '$lib/server/bounded-response.mjs';
import type { RegistryCorpus } from './manifest';

const RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

export type RegistryRow = Readonly<Record<string, unknown>>;

export type RegistryBlockedReason =
	| 'http-status'
	| 'not-json'
	| 'not-array'
	| 'api-error'
	| 'oversize'
	| 'transport'
	| 'timeout';

export interface RegistryFetchValue {
	readonly rows: readonly RegistryRow[];
}

interface RegistryFetchMetadata {
	readonly requestUrl: string;
	readonly fetchedAt: string;
}

type FactState<T, State extends Fact<T>['state']> = Extract<Fact<T>, { state: State }>;

export type RegistryFetchOutcome =
	| (FactState<RegistryFetchValue, 'present'> & RegistryFetchMetadata)
	| (FactState<RegistryFetchValue, 'withheld'> &
			RegistryFetchMetadata & {
				readonly why: 'mapped-email-withheld';
				readonly rowCount: number;
			})
	| (FactState<RegistryFetchValue, 'absent'> & RegistryFetchMetadata)
	| (FactState<RegistryFetchValue, 'blocked'> &
			RegistryFetchMetadata & {
				readonly why: RegistryBlockedReason;
				readonly status?: number;
			});

export interface FetchRegistryCorpusOptions {
	readonly year?: string;
	readonly limit?: number;
	readonly signal?: AbortSignal;
}

function metadata(requestUrl: string): RegistryFetchMetadata {
	return { requestUrl, fetchedAt: new Date().toISOString() };
}

function blockedOutcome(
	why: RegistryBlockedReason,
	requestUrl: string,
	status?: number
): RegistryFetchOutcome {
	return {
		...blocked(why),
		why,
		...metadata(requestUrl),
		...(status === undefined ? {} : { status })
	};
}

function normalizedLimit(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 1000;
	return Math.min(1000, Math.max(1, Math.trunc(value)));
}

function buildRequestUrl(corpus: RegistryCorpus, opts: FetchRegistryCorpusOptions): string | null {
	try {
		const request = new URL(corpus.datasetPath, `https://${corpus.host}`);
		request.searchParams.set('$select', corpus.select.join(','));
		request.searchParams.set('$limit', String(normalizedLimit(opts.limit)));

		if (corpus.whereYearField && opts.year && /^\d{4}$/u.test(opts.year)) {
			request.searchParams.set('$where', `${corpus.whereYearField}='${opts.year}'`);
		}

		return request.toString();
	} catch {
		return null;
	}
}

function isRegistryRow(value: unknown): value is RegistryRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isApiError(value: unknown): boolean {
	return (
		isRegistryRow(value) &&
		(value.error === true || typeof value.code === 'string' || typeof value.errorCode === 'string')
	);
}

function hasMappedEmail(row: RegistryRow, emailField: string): boolean {
	const email = row[emailField];
	return typeof email === 'string' && email.trim().length > 0;
}

/**
 * A measured regulatory service-list URL returned HTTP 200 with a body reading
 * `Sorry, this page isn't available`. A 200 response is therefore not evidence
 * of absence: only a successfully parsed empty array is `absent`.
 */
export async function fetchRegistryCorpus(
	corpus: RegistryCorpus,
	opts: FetchRegistryCorpusOptions = {}
): Promise<RegistryFetchOutcome> {
	const built = buildRequestUrl(corpus, opts);
	if (built === null) return blockedOutcome('transport', '');

	const parsed = parsePublicHttpUrl(built);
	if (parsed === null || parsed.hostname !== corpus.host) {
		return blockedOutcome('transport', built);
	}

	const requestUrl = parsed.toString();
	const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;

	let response: Response;
	try {
		response = await fetch(requestUrl, {
			headers: { Accept: 'application/json' },
			signal,
			redirect: 'error'
		});
	} catch {
		return blockedOutcome(timeoutSignal.aborted ? 'timeout' : 'transport', requestUrl);
	}

	if (!response.ok) {
		return blockedOutcome('http-status', requestUrl, response.status);
	}

	let body: string;
	try {
		body = await readBoundedResponseText(response, corpus.id, RESPONSE_LIMIT_BYTES);
	} catch {
		return blockedOutcome('oversize', requestUrl);
	}

	let parsedBody: unknown;
	try {
		parsedBody = JSON.parse(body);
	} catch {
		return blockedOutcome('not-json', requestUrl);
	}

	if (isApiError(parsedBody)) return blockedOutcome('api-error', requestUrl);
	if (!Array.isArray(parsedBody) || !parsedBody.every(isRegistryRow)) {
		return blockedOutcome('not-array', requestUrl);
	}

	if (parsedBody.length === 0) {
		return { ...absent(), ...metadata(requestUrl) };
	}

	if (!parsedBody.some((row) => hasMappedEmail(row, corpus.fieldMap.email))) {
		const why = 'mapped-email-withheld' as const;
		return {
			...withheld(why),
			why,
			...metadata(requestUrl),
			rowCount: parsedBody.length
		};
	}

	return {
		...present({ rows: parsedBody }),
		...metadata(requestUrl)
	};
}
