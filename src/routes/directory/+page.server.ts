import { serverQuery } from '$lib/server/convex-work-budget';
import { error } from '@sveltejs/kit';
import { api } from '$lib/convex';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import {
	PUBLIC_ORGANIZATION_DIRECTORY_CURSOR_MAX_LENGTH,
	PUBLIC_ORGANIZATION_DIRECTORY_PAGE_SIZE,
	PublicOrganizationDirectoryNotReadyError,
	getCachedPublicOrganizationDirectoryFirstPage,
	projectPublicOrganizationDirectoryPage
} from '$lib/server/public-organization-directory';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, platform }) => {
	const rawCursor = url.searchParams.get('cursor');
	const cursor = rawCursor === null || rawCursor.length === 0 ? null : rawCursor;
	if (cursor !== null && cursor.length > PUBLIC_ORGANIZATION_DIRECTORY_CURSOR_MAX_LENGTH) {
		error(400, 'Invalid directory cursor');
	}

	const loadPage = () =>
		serverQuery(api.organizations.listPublic, {
			_secret: getInternalSecret(),
			paginationOpts: {
				numItems: PUBLIC_ORGANIZATION_DIRECTORY_PAGE_SIZE,
				cursor
			}
		});

	try {
		const page =
			cursor === null
				? await getCachedPublicOrganizationDirectoryFirstPage({ url, platform }, loadPage)
				: projectPublicOrganizationDirectoryPage(await loadPage());
		return { ...page, isFirstPage: cursor === null };
	} catch (cause) {
		if (cause instanceof PublicOrganizationDirectoryNotReadyError) {
			error(503, 'Organization directory is being prepared');
		}
		console.error(
			'[directory] public organization page failed:',
			cause instanceof Error ? cause.message : String(cause)
		);
		error(503, 'Organization directory is temporarily unavailable');
	}
};
