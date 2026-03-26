import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { serverQuery, serverMutation } from 'convex-sveltekit';
import { api } from '$lib/convex';

// F-R8-02: Zod schema replaces unvalidated destructuring
const ProfileSchema = z.object({
	role: z.string().min(1).max(100),
	organization: z.string().max(200).optional(),
	location: z.string().max(200).optional(),
	connection: z.string().min(1).max(100)
});

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let parsed: z.infer<typeof ProfileSchema>;
	try {
		const body = await request.json();
		parsed = ProfileSchema.parse(body);
	} catch (e) {
		if (e instanceof z.ZodError) {
			return json({ error: e.errors.map((err) => err.message).join(', ') }, { status: 400 });
		}
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const { role, organization, location, connection } = parsed;

	await serverMutation(api.users.updateProfile, {
		role,
		organization: organization || undefined,
		location: location || undefined,
		connection
	});
	return json({
		success: true,
		message: 'Profile saved successfully',
		user: {
			id: locals.user.id,
			profileComplete: true
		}
	});
};

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const profile = await serverQuery(api.users.getProfile, {});
	return json({
		user: {
			id: profile._id,
			name: profile.name,
			email: profile.email,
			avatar: profile.avatar,
			profile: {
				role: profile.role,
				organization: profile.organization,
				location: profile.location,
				connection: profile.connection,
				completed_at: profile.profileCompletedAt,
				visibility: profile.profileVisibility
			},
			verification: {
				is_verified: profile.isVerified
			},
			timestamps: {
				created_at: null,
				updated_at: null
			}
		}
	});
};
