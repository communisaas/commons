import { fail } from '@sveltejs/kit';
import { serverInternalMutation } from '$lib/server/convex-internal';
import { internal } from '$lib/convex';
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

		const result = await serverInternalMutation(
			internal.email.applyUnsubscribeByBlastEmail,
			{
				blastId: blastId as Id<'emailBlasts'>,
				email
			}
		);
		return { applied: result.applied, reason: result.reason };
	}
};
