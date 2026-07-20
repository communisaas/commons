import { getCachedPublicData } from '$lib/server/public-discovery-cache';

/** Public directory changes become visible at an edge location within one minute. */
export const PUBLIC_ORGANIZATION_DIRECTORY_FRESH_MS = 60_000;
export const PUBLIC_ORGANIZATION_DIRECTORY_PAGE_SIZE = 20;
export const PUBLIC_ORGANIZATION_DIRECTORY_CURSOR_MAX_LENGTH = 2_048;

export type PublicOrganizationDirectoryEntry = {
	name: string;
	slug: string;
	description: string | null;
	mission: string | null;
	logoUrl: string | null;
	memberCount: number;
};

export type PublicOrganizationDirectoryPage = {
	orgs: PublicOrganizationDirectoryEntry[];
	total: number;
	cursor: string | null;
	hasMore: boolean;
	revision: string;
	updatedAt: number;
};

export class PublicOrganizationDirectoryNotReadyError extends Error {
	constructor() {
		super('PUBLIC_ORGANIZATION_DIRECTORY_NOT_READY');
		this.name = 'PublicOrganizationDirectoryNotReadyError';
	}
}

function requiredString(value: unknown, maxLength: number): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
		throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	}
	return value;
}

function nullableString(value: unknown, maxLength: number): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string' || value.length > maxLength) {
		throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	}
	return value;
}

function nonnegativeInteger(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	}
	return value as number;
}

/**
 * Reconstruct only the directory fields consumed by the UI. This is also the
 * Cache API trust boundary, so a corrupt or older envelope cannot grow the
 * anonymous payload or smuggle full organization documents into SSR data.
 */
export function projectPublicOrganizationDirectoryPage(
	value: unknown
): PublicOrganizationDirectoryPage {
	if (!value || typeof value !== 'object') {
		throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.ready === false) throw new PublicOrganizationDirectoryNotReadyError();
	const entries = candidate.ready === true ? candidate.data : candidate.orgs;
	if (!Array.isArray(entries) || entries.length > PUBLIC_ORGANIZATION_DIRECTORY_PAGE_SIZE) {
		throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	}
	const cursor = candidate.cursor;
	if (
		cursor !== null &&
		(typeof cursor !== 'string' ||
			cursor.length === 0 ||
			cursor.length > PUBLIC_ORGANIZATION_DIRECTORY_CURSOR_MAX_LENGTH)
	) {
		throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	}
	if (typeof candidate.hasMore !== 'boolean' || candidate.hasMore !== (cursor !== null)) {
		throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
	}
	const revision = requiredString(candidate.revision, 128);
	const updatedAt = nonnegativeInteger(candidate.updatedAt);

	return {
		orgs: entries.map((raw) => {
			if (!raw || typeof raw !== 'object') {
				throw new Error('PUBLIC_ORGANIZATION_DIRECTORY_CACHE_INVALID');
			}
			const org = raw as Record<string, unknown>;
			return {
				name: requiredString(org.name, 160),
				slug: requiredString(org.slug, 48),
				description: nullableString(org.description, 2_000),
				mission: nullableString(org.mission, 2_000),
				logoUrl: nullableString(org.logoUrl, 2_048),
				memberCount: nonnegativeInteger(org.memberCount)
			};
		}),
		total: nonnegativeInteger(candidate.total),
		cursor: cursor as string | null,
		hasMore: candidate.hasMore,
		revision,
		updatedAt
	};
}

/**
 * Cache only the first page. Opaque continuation cursors remain direct,
 * bounded reads so attackers cannot create an unbounded edge-key space.
 */
export function getCachedPublicOrganizationDirectoryFirstPage(
	context: { url: URL; platform?: App.Platform },
	loader: () => Promise<unknown>
): Promise<PublicOrganizationDirectoryPage> {
	return getCachedPublicData(
		'public-organization-directory:first-page:v1',
		{
			...context,
			freshForMs: PUBLIC_ORGANIZATION_DIRECTORY_FRESH_MS,
			refreshMode: 'blocking',
			r2Policy: 'none',
			projectCachedValue: projectPublicOrganizationDirectoryPage,
			shouldFallbackToStale: (error) => !(error instanceof PublicOrganizationDirectoryNotReadyError)
		},
		async () => projectPublicOrganizationDirectoryPage(await loader())
	);
}
