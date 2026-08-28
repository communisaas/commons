import { json } from '@sveltejs/kit';
import { serverQuery } from '$lib/server/convex-work-budget';
import { api } from '$lib/convex';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const cursor = url.searchParams.get('cursor');
	if (cursor && cursor.length > 2_048) {
		return json({ error: 'Invalid pagination cursor' }, { status: 400 });
	}

	const result = await serverQuery(api.templates.listByUserPage, {
		paginationOpts: { numItems: 50, cursor }
	});
	const nextUrl = new URL(url);
	if (!result.isDone) nextUrl.searchParams.set('cursor', result.continueCursor);
	return json(result.page, {
		headers: {
			'X-Templates-Complete': String(result.isDone),
			...(result.isDone ? {} : { Link: `<${nextUrl.pathname}${nextUrl.search}>; rel="next"` })
		}
	});
};
