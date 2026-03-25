/**
 * Public API v1 — JSON envelope and cursor pagination helpers.
 *
 * All responses follow: { data, meta?, error? }
 */

export interface ApiEnvelope<T = unknown> {
	data: T;
	meta?: {
		cursor?: string | null;
		hasMore?: boolean;
		total?: number;
		decryptionFailures?: number;
	};
	error?: undefined;
}

export interface ApiError {
	data: null;
	error: {
		code: string;
		message: string;
	};
}

/** Successful response with data + optional pagination meta. */
export function apiOk<T>(
	data: T,
	meta?: ApiEnvelope['meta'],
	status = 200
): Response {
	const body: ApiEnvelope<T> = { data };
	if (meta) body.meta = meta;

	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** Error response matching the envelope shape. */
export function apiError(
	code: string,
	message: string,
	status: number
): Response {
	const body: ApiError = {
		data: null,
		error: { code, message }
	};

	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** Standard page size for cursor pagination. */
export const API_PAGE_SIZE = 50;

/** Parse cursor and limit from URLSearchParams. */
export function parsePagination(url: URL): { cursor: string | null; limit: number } {
	const cursor = url.searchParams.get('cursor') || null;
	const rawLimit = parseInt(url.searchParams.get('limit') || '', 10);
	const limit = rawLimit > 0 && rawLimit <= API_PAGE_SIZE ? rawLimit : API_PAGE_SIZE;
	return { cursor, limit };
}
