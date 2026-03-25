import { redirect } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	const user = await db.user.findUnique({
		where: { id: locals.user.id },
		select: {
			passkey_credential_id: true,
			passkey_created_at: true,
			passkey_last_used_at: true
		}
	});

	return {
		passkey: user?.passkey_credential_id
			? {
					createdAt: user.passkey_created_at?.toISOString() ?? null,
					lastUsedAt: user.passkey_last_used_at?.toISOString() ?? null
				}
			: null
	};
};
