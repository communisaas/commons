import {
	PlatformSyncError,
	type NormalizedPlatformSupporter,
	type PlatformSyncAdapter,
	type PlatformSyncFetchOptions,
	type PlatformSyncPage
} from './types';

const API_BASE = 'https://actionnetwork.org/api/v2';

type OsdiEmailAddress = {
	address?: string;
	primary?: boolean;
	status?: string;
};

type OsdiPhoneNumber = {
	number?: string;
	primary?: boolean;
	status?: string;
};

type OsdiPostalAddress = {
	primary?: boolean;
	postal_code?: string;
	region?: string;
	country?: string;
};

type OsdiPerson = {
	given_name?: string;
	family_name?: string;
	email_addresses?: OsdiEmailAddress[];
	phone_numbers?: OsdiPhoneNumber[];
	postal_addresses?: OsdiPostalAddress[];
	custom_fields?: Record<string, unknown>;
};

type OsdiPeopleResponse = {
	page?: number;
	total_pages?: number;
	total_records?: number;
	_embedded?: { 'osdi:people'?: OsdiPerson[] };
};

function primaryOrFirst<T extends { primary?: boolean }>(items: T[] | undefined): T | undefined {
	if (!items?.length) return undefined;
	return items.find((item) => item.primary) ?? items[0];
}

/** Maps OSDI email subscription status onto the import pipeline's vocabulary. */
function mapEmailStatus(status: string | undefined): string {
	switch (status) {
		case 'subscribed':
			return 'subscribed';
		case 'bouncing':
		case 'previous bounce':
			return 'bounced';
		case 'spam complaint':
		case 'previous spam complaint':
			return 'complained';
		default:
			return 'unsubscribed';
	}
}

function mapSmsStatus(phone: OsdiPhoneNumber | undefined): string {
	if (!phone?.number) return 'none';
	return phone.status === 'subscribed' ? 'subscribed' : 'unsubscribed';
}

/**
 * Bounds vendor data to supporters.importWithEncryption's published caps so a
 * single oversized vendor row cannot abort an entire import chunk: at most 100
 * custom fields, 80-char keys, 2000-char values, 8 KiB serialized.
 */
function mapCustomFields(
	raw: Record<string, unknown> | undefined
): Record<string, string> | undefined {
	if (!raw) return undefined;
	const entries = Object.entries(raw)
		.filter(([key, value]) => value !== null && value !== undefined && key.length <= 80)
		.slice(0, 100)
		.map(([key, value]) => [key, String(value).slice(0, 2000)] as const);
	if (!entries.length) return undefined;
	const bounded: Record<string, string> = {};
	for (const [key, value] of entries) {
		bounded[key] = value;
		if (JSON.stringify(bounded).length > 8192) {
			delete bounded[key];
			break;
		}
	}
	return Object.keys(bounded).length ? bounded : undefined;
}

function truncate(value: string | undefined, max: number): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed.slice(0, max) : undefined;
}

export function mapOsdiPerson(person: OsdiPerson): NormalizedPlatformSupporter | null {
	const email = primaryOrFirst(person.email_addresses);
	const address = email?.address?.trim().toLowerCase();
	if (!address || address.length > 254) return null;

	const phone = primaryOrFirst(person.phone_numbers);
	const postal = primaryOrFirst(person.postal_addresses);
	const name = [person.given_name, person.family_name]
		.filter((part) => part?.trim())
		.join(' ')
		.trim();

	// Consent provenance is deliberately left unset: the Action Network API
	// exposes subscription status, not consent text or a consent timestamp.
	// emailStatus/smsStatus carry the real subscription state; fabricating
	// consent evidence here would overstate what the vendor attests.
	return {
		email: address,
		name: truncate(name, 200),
		phone: truncate(phone?.number, 32),
		postalCode: truncate(postal?.postal_code, 16),
		stateCode: truncate(postal?.region, 8),
		country: truncate(postal?.country, 8),
		emailStatus: mapEmailStatus(email?.status),
		smsStatus: mapSmsStatus(phone),
		tagIds: [],
		customFields: mapCustomFields(person.custom_fields),
		source: 'action_network'
	};
}

function parseCursor(cursor: string | null): number {
	if (cursor === null) return 1;
	const page = Number.parseInt(cursor, 10);
	if (!Number.isInteger(page) || page < 1) {
		throw new PlatformSyncError(
			`Continuation checkpoint '${cursor}' is not a valid Action Network page cursor.`,
			'malformed_response'
		);
	}
	return page;
}

export const actionNetworkAdapter: PlatformSyncAdapter = {
	source: 'action_network',

	async fetchPage(apiKey: string, options: PlatformSyncFetchOptions): Promise<PlatformSyncPage> {
		const fetchImpl = options.fetchImpl ?? fetch;
		const page = parseCursor(options.cursor);
		const url = new URL(`${API_BASE}/people`);
		url.searchParams.set('page', String(page));
		if (options.modifiedSince) {
			if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(options.modifiedSince)) {
				throw new PlatformSyncError(
					'modifiedSince must be a UTC ISO timestamp; refusing to interpolate it into the OSDI filter.',
					'malformed_response'
				);
			}
			url.searchParams.set('filter', `modified_date gt '${options.modifiedSince}'`);
		}

		const response = await fetchImpl(url.toString(), {
			headers: {
				'OSDI-API-Token': apiKey,
				Accept: 'application/json'
			}
		});

		if (response.status === 401 || response.status === 403) {
			throw new PlatformSyncError(
				'Action Network rejected the stored API key. Reconnect the credential before syncing.',
				'auth_failed'
			);
		}
		if (response.status === 429) {
			throw new PlatformSyncError(
				'Action Network rate limit reached. The checkpoint is preserved; continue the import shortly.',
				'rate_limited'
			);
		}
		if (!response.ok) {
			throw new PlatformSyncError(
				`Action Network people fetch failed with HTTP ${response.status}.`,
				'http_error'
			);
		}

		let body: OsdiPeopleResponse;
		try {
			body = (await response.json()) as OsdiPeopleResponse;
		} catch {
			throw new PlatformSyncError(
				'Action Network returned a non-JSON people response.',
				'malformed_response'
			);
		}

		const people = body._embedded?.['osdi:people'];
		if (!Array.isArray(people)) {
			throw new PlatformSyncError(
				'Action Network people response is missing the _embedded osdi:people collection.',
				'malformed_response'
			);
		}

		const records: NormalizedPlatformSupporter[] = [];
		let droppedNoEmail = 0;
		for (const person of people) {
			const mapped = mapOsdiPerson(person);
			if (mapped) records.push(mapped);
			else droppedNoEmail += 1;
		}

		const totalPages = typeof body.total_pages === 'number' ? body.total_pages : null;
		const reportedPage = typeof body.page === 'number' ? body.page : page;
		// A people page without pagination metadata is anomalous for this API;
		// treating it as the final page would silently truncate the sync and
		// advance the incremental watermark past unfetched records.
		if (totalPages === null && people.length > 0) {
			throw new PlatformSyncError(
				'Action Network people response is missing total_pages; the checkpoint is preserved instead of truncating the sync.',
				'malformed_response'
			);
		}
		const nextCursor =
			totalPages !== null && reportedPage < totalPages ? String(reportedPage + 1) : null;

		return {
			records,
			nextCursor,
			totalRecords: typeof body.total_records === 'number' ? body.total_records : null,
			droppedNoEmail
		};
	}
};
