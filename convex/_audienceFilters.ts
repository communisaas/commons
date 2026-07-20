import type { Id } from './_generated/dataModel';

export const MAX_AUDIENCE_TAG_FILTERS = 20;
export const MAX_AUDIENCE_SEGMENT_FILTERS = 10;
export const MAX_AUDIENCE_HASH_FILTERS = 10_000;
export const MAX_AUDIENCE_ID_BYTES = 64;
// Includes JSON structure and every string before de-duplication. 512 KiB is
// 1/2,048 (0.0488%) of the team's shared 1 GiB free monthly I/O allowance and
// leaves Convex argument/document headroom for the rest of a blast payload.
export const MAX_AUDIENCE_FILTER_BYTES = 512 * 1024;
export const EMAIL_HASH_RE = /^[a-f0-9]{64}$/;

export type EmailAudienceFilter = {
	tagIds?: Id<'tags'>[];
	segmentIds?: Id<'segments'>[];
	verified?: 'any' | 'verified' | 'unverified';
	includeEmailHashes?: string[];
	excludeEmailHashes?: string[];
};

export type SmsAudienceFilter = {
	tags?: Id<'tags'>[];
	segments?: Id<'segments'>[];
	excludeTags?: Id<'tags'>[];
};

const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
	return encoder.encode(value).byteLength;
}

function assertSerializedFilterBytes(raw: unknown, label: string): void {
	let serialized: string;
	try {
		serialized = JSON.stringify(raw);
	} catch {
		throw new Error(`${label}_INVALID`);
	}
	if (utf8Bytes(serialized) > MAX_AUDIENCE_FILTER_BYTES) {
		throw new Error(`${label}_TOO_LARGE (max ${MAX_AUDIENCE_FILTER_BYTES} bytes)`);
	}
}

function boundedUniqueStrings(
	value: unknown,
	label: string,
	max: number,
	predicate: (value: string) => boolean
): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error(`${label}_INVALID`);
	if (value.length > max) throw new Error(`${label}_TOO_MANY (max ${max})`);
	const values: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== 'string' || !predicate(item)) throw new Error(`${label}_INVALID`);
		if (seen.has(item)) continue;
		seen.add(item);
		values.push(item);
	}
	return values.length > 0 ? values : undefined;
}

function boundedIds(value: unknown, label: string, max: number): string[] | undefined {
	return boundedUniqueStrings(
		value,
		label,
		max,
		(item) => utf8Bytes(item) > 0 && utf8Bytes(item) <= MAX_AUDIENCE_ID_BYTES
	);
}

/**
 * Fail-closed normalization for persisted and caller-supplied email filters.
 * Invalid legacy shapes are errors, never permission to widen to the full
 * subscribed roster. Array bounds are enforced here inside Convex, independent
 * of any SvelteKit/Zod boundary.
 */
export function normalizeEmailAudienceFilter(raw: unknown): EmailAudienceFilter {
	if (raw === undefined || raw === null) return {};
	assertSerializedFilterBytes(raw, 'EMAIL_AUDIENCE_FILTER');
	if (typeof raw !== 'object' || Array.isArray(raw))
		throw new Error('EMAIL_AUDIENCE_FILTER_INVALID');
	const candidate = raw as Record<string, unknown>;
	const filter: EmailAudienceFilter = {};
	const tagIds = boundedIds(
		candidate.tagIds,
		'EMAIL_AUDIENCE_TAG_FILTERS',
		MAX_AUDIENCE_TAG_FILTERS
	);
	if (tagIds) filter.tagIds = tagIds as Id<'tags'>[];
	const segmentIds = boundedIds(
		candidate.segmentIds,
		'EMAIL_AUDIENCE_SEGMENT_FILTERS',
		MAX_AUDIENCE_SEGMENT_FILTERS
	);
	if (segmentIds) filter.segmentIds = segmentIds as Id<'segments'>[];
	if (candidate.verified !== undefined) {
		if (
			candidate.verified !== 'any' &&
			candidate.verified !== 'verified' &&
			candidate.verified !== 'unverified'
		) {
			throw new Error('EMAIL_AUDIENCE_VERIFICATION_FILTER_INVALID');
		}
		filter.verified = candidate.verified;
	}
	const includeEmailHashes = boundedUniqueStrings(
		candidate.includeEmailHashes,
		'EMAIL_AUDIENCE_INCLUDE_HASHES',
		MAX_AUDIENCE_HASH_FILTERS,
		(value) => EMAIL_HASH_RE.test(value)
	);
	if (includeEmailHashes) filter.includeEmailHashes = includeEmailHashes;
	const excludeEmailHashes = boundedUniqueStrings(
		candidate.excludeEmailHashes,
		'EMAIL_AUDIENCE_EXCLUDE_HASHES',
		MAX_AUDIENCE_HASH_FILTERS,
		(value) => EMAIL_HASH_RE.test(value)
	);
	if (excludeEmailHashes) filter.excludeEmailHashes = excludeEmailHashes;
	return filter;
}

export function normalizeSmsAudienceFilter(raw: unknown): SmsAudienceFilter {
	if (raw === undefined || raw === null) return {};
	assertSerializedFilterBytes(raw, 'SMS_AUDIENCE_FILTER');
	if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('SMS_AUDIENCE_FILTER_INVALID');
	const candidate = raw as Record<string, unknown>;
	const filter: SmsAudienceFilter = {};
	const tags = boundedIds(candidate.tags, 'SMS_AUDIENCE_TAG_FILTERS', MAX_AUDIENCE_TAG_FILTERS);
	if (tags) filter.tags = tags as Id<'tags'>[];
	const segments = boundedIds(
		candidate.segments,
		'SMS_AUDIENCE_SEGMENT_FILTERS',
		MAX_AUDIENCE_SEGMENT_FILTERS
	);
	if (segments) filter.segments = segments as Id<'segments'>[];
	const excludeTags = boundedIds(
		candidate.excludeTags,
		'SMS_AUDIENCE_EXCLUDE_TAG_FILTERS',
		MAX_AUDIENCE_TAG_FILTERS
	);
	if (excludeTags) filter.excludeTags = excludeTags as Id<'tags'>[];
	return filter;
}
