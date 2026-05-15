import { fail } from '@sveltejs/kit';
import { api } from '$lib/convex';
import { serverMutation } from 'convex-sveltekit';
import { getInternalSecret } from '$lib/server/internal/secret-auth';
import type { Id } from '$convex/_generated/dataModel';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const blastId = url.searchParams.get('blast');
	return { blastId };
};

export const actions: Actions = {
	apply: async ({ request, url }) => {
		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();
		const blastId = url.searchParams.get('blast') ?? formData.get('blast')?.toString();

		if (!email || !email.includes('@')) {
			return fail(400, { error: 'A valid email is required.' });
		}
		// Bound at the form-action boundary. RFC 5321 limit is 254.
		if (email.length > 254) {
			return fail(400, { error: 'Email is too long.' });
		}
		if (!blastId) {
			return fail(400, { error: 'Missing blast reference.' });
		}
		// Convex doc ids are 32 chars; 64 is generous slack.
		if (blastId.length > 64) {
			return fail(400, { error: 'Invalid blast reference.' });
		}

		await serverMutation(api.email.applyUnsubscribeByBlastEmail, {
			_secret: getInternalSecret(),
			blastId: blastId as Id<'emailBlasts'>,
			email
		});
		// Single indistinguishable success flag — do NOT return the differential
		// `reason` ({ok | already-unsubscribed | not-on-list | blast-not-found})
		// to the client. SvelteKit surfaces form-action returns as JSON in the
		// POST response body (visible in DevTools / proxies), so any
		// discriminator becomes a supporter-list membership oracle for the org.
		// The page renders one collapsed "Request received" message regardless.
		return { received: true };
	}
};
