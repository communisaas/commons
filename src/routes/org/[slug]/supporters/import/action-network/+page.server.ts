import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function platformApiBoundary(slug: string): string {
	return `/org/${slug}/supporters/import/platform-api`;
}

export const load: PageServerLoad = ({ params }) => {
	throw redirect(308, platformApiBoundary(params.slug));
};

export const actions: Actions = {
	connect: async ({ params }) => {
		throw redirect(303, platformApiBoundary(params.slug));
	},
	sync: async ({ params }) => {
		throw redirect(303, platformApiBoundary(params.slug));
	},
	disconnect: async ({ params }) => {
		throw redirect(303, platformApiBoundary(params.slug));
	},
	refresh: async ({ params }) => {
		throw redirect(303, platformApiBoundary(params.slug));
	}
};
