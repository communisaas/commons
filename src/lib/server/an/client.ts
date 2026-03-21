/**
 * Action Network OSDI API v2 Client
 *
 * Handles authentication, pagination, rate limiting, and OData filtering
 * for all AN resource types.
 *
 * Base URL: https://actionnetwork.org/api/v2
 * Auth: OSDI-API-Token header
 * Rate limit: 4 req/sec (250ms between requests)
 * Pagination: 25 records/page, follow _links.next.href
 */

const BASE_URL = 'https://actionnetwork.org/api/v2';
const RATE_LIMIT_MS = 250; // 4 req/sec

// ── Types ────────────────────────────────────────────────────

export interface ANLink {
	href: string;
}

export interface ANLinks {
	self?: ANLink;
	next?: ANLink;
	'osdi:taggings'?: ANLink;
	[key: string]: ANLink | undefined;
}

export interface ANPerson {
	identifiers: string[];
	given_name?: string;
	family_name?: string;
	email_addresses?: Array<{
		address: string;
		primary?: boolean;
		status?: string;
	}>;
	postal_addresses?: Array<{
		postal_code?: string;
		country?: string;
	}>;
	phone_numbers?: Array<{
		number?: string;
		primary?: boolean;
	}>;
	custom_fields?: Record<string, string>;
	created_date?: string;
	modified_date?: string;
	_links?: ANLinks;
}

export interface ANTag {
	name: string;
	identifiers?: string[];
	_links?: ANLinks;
}

export interface ANTagging {
	_links?: ANLinks;
	item_type?: string;
}

export interface ANPetition {
	title?: string;
	identifiers?: string[];
	created_date?: string;
	_links?: ANLinks;
}

export interface ANSignature {
	person_id?: string;
	created_date?: string;
	_links?: ANLinks;
}

export interface ANEvent {
	title?: string;
	identifiers?: string[];
	created_date?: string;
	start_date?: string;
	_links?: ANLinks;
}

export interface ANAttendance {
	person_id?: string;
	created_date?: string;
	status?: string;
	_links?: ANLinks;
}

export interface ANForm {
	title?: string;
	identifiers?: string[];
	created_date?: string;
	_links?: ANLinks;
}

export interface ANSubmission {
	person_id?: string;
	created_date?: string;
	_links?: ANLinks;
}

export interface ANAdvocacyCampaign {
	title?: string;
	identifiers?: string[];
	created_date?: string;
	_links?: ANLinks;
}

export interface ANOutreach {
	person_id?: string;
	created_date?: string;
	_links?: ANLinks;
}

export interface ANPageResponse<T> {
	total_pages: number;
	per_page: number;
	page: number;
	total_records: number;
	_links: ANLinks;
	_embedded: Record<string, T[]>;
}

// ── Rate limiter ─────────────────────────────────────────────

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
	const now = Date.now();
	const elapsed = now - lastRequestTime;
	if (elapsed < RATE_LIMIT_MS) {
		await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS - elapsed));
	}
	lastRequestTime = Date.now();
}

// ── Core fetch ───────────────────────────────────────────────

async function anFetch<T>(url: string, apiKey: string): Promise<ANPageResponse<T>> {
	// F-R6-05: Prevent SSRF — only send API key to Action Network domains
	const parsed = new URL(url);
	if (!parsed.hostname.endsWith('.actionnetwork.org') && parsed.hostname !== 'actionnetwork.org') {
		throw new Error(`AN client: refusing to fetch non-AN URL: ${parsed.hostname}`);
	}

	await rateLimit();

	const response = await fetch(url, {
		headers: {
			'OSDI-API-Token': apiKey,
			'Content-Type': 'application/hal+json'
		}
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`AN API ${response.status}: ${text.slice(0, 200)}`);
	}

	return response.json() as Promise<ANPageResponse<T>>;
}

/**
 * Validate an AN API key by making a test request to /api/v2.
 * Returns the response if valid, throws on error.
 */
export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
	try {
		await rateLimit();
		const response = await fetch(BASE_URL, {
			headers: {
				'OSDI-API-Token': apiKey,
				'Content-Type': 'application/hal+json'
			}
		});

		if (response.status === 403 || response.status === 401) {
			return { valid: false, error: 'Invalid API key' };
		}
		if (!response.ok) {
			return { valid: false, error: `AN API returned ${response.status}` };
		}
		return { valid: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { valid: false, error: `Connection failed: ${msg}` };
	}
}

// ── Generic paginator ────────────────────────────────────────

/**
 * Async generator that paginates through an AN OSDI endpoint.
 * Yields individual records, handling pagination and rate limiting internally.
 */
async function* paginate<T>(
	initialUrl: string,
	apiKey: string,
	embeddedKey: string
): AsyncGenerator<T, void, undefined> {
	let url: string | null = initialUrl;

	while (url) {
		const resp: ANPageResponse<T> = await anFetch<T>(url, apiKey);
		const records: T[] = resp._embedded?.[embeddedKey] ?? [];

		for (const record of records) {
			yield record;
		}

		url = resp._links?.next?.href ?? null;
	}
}

/**
 * Count total records for a resource without fetching all pages.
 * Makes a single request and reads total_records from the response.
 */
export async function countResource(apiKey: string, resourcePath: string): Promise<number> {
	const url = `${BASE_URL}/${resourcePath}?per_page=1`;
	const page = await anFetch<unknown>(url, apiKey);
	return page.total_records ?? 0;
}

// ── Resource-specific generators ─────────────────────────────

/**
 * Fetch all people, optionally filtered by modified_date for incremental sync.
 */
export async function* fetchPeople(
	apiKey: string,
	since?: Date
): AsyncGenerator<ANPerson, void, undefined> {
	let url = `${BASE_URL}/people`;
	if (since) {
		const isoDate = since.toISOString().replace('Z', '');
		url += `?filter=modified_date gt '${isoDate}'`;
	}
	yield* paginate<ANPerson>(url, apiKey, 'osdi:people');
}

/**
 * Fetch all tags.
 */
export async function* fetchTags(
	apiKey: string
): AsyncGenerator<ANTag, void, undefined> {
	yield* paginate<ANTag>(`${BASE_URL}/tags`, apiKey, 'osdi:tags');
}

/**
 * Fetch taggings for a specific person.
 * Uses the person's _links['osdi:taggings'] href.
 */
export async function* fetchTaggings(
	apiKey: string,
	taggingsUrl: string
): AsyncGenerator<ANTagging, void, undefined> {
	yield* paginate<ANTagging>(taggingsUrl, apiKey, 'osdi:taggings');
}

/**
 * Fetch all petitions.
 */
export async function* fetchPetitions(
	apiKey: string
): AsyncGenerator<ANPetition, void, undefined> {
	yield* paginate<ANPetition>(`${BASE_URL}/petitions`, apiKey, 'osdi:petitions');
}

/**
 * Fetch signatures for a specific petition.
 */
export async function* fetchSignatures(
	apiKey: string,
	petitionUrl: string
): AsyncGenerator<ANSignature, void, undefined> {
	const url = `${petitionUrl}/signatures`;
	yield* paginate<ANSignature>(url, apiKey, 'osdi:signatures');
}

/**
 * Fetch all events.
 */
export async function* fetchEvents(
	apiKey: string
): AsyncGenerator<ANEvent, void, undefined> {
	yield* paginate<ANEvent>(`${BASE_URL}/events`, apiKey, 'osdi:events');
}

/**
 * Fetch attendances for a specific event.
 */
export async function* fetchAttendances(
	apiKey: string,
	eventUrl: string
): AsyncGenerator<ANAttendance, void, undefined> {
	const url = `${eventUrl}/attendances`;
	yield* paginate<ANAttendance>(url, apiKey, 'osdi:attendances');
}

/**
 * Fetch all forms.
 */
export async function* fetchForms(
	apiKey: string
): AsyncGenerator<ANForm, void, undefined> {
	yield* paginate<ANForm>(`${BASE_URL}/forms`, apiKey, 'osdi:forms');
}

/**
 * Fetch submissions for a specific form.
 */
export async function* fetchSubmissions(
	apiKey: string,
	formUrl: string
): AsyncGenerator<ANSubmission, void, undefined> {
	const url = `${formUrl}/submissions`;
	yield* paginate<ANSubmission>(url, apiKey, 'osdi:submissions');
}

/**
 * Fetch all advocacy campaigns.
 */
export async function* fetchAdvocacyCampaigns(
	apiKey: string
): AsyncGenerator<ANAdvocacyCampaign, void, undefined> {
	yield* paginate<ANAdvocacyCampaign>(
		`${BASE_URL}/advocacy_campaigns`,
		apiKey,
		'osdi:advocacy_campaigns'
	);
}

/**
 * Fetch outreaches for a specific advocacy campaign.
 */
export async function* fetchOutreaches(
	apiKey: string,
	campaignUrl: string
): AsyncGenerator<ANOutreach, void, undefined> {
	const url = `${campaignUrl}/outreaches`;
	yield* paginate<ANOutreach>(url, apiKey, 'osdi:outreaches');
}
