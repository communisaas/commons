import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { db } from '$lib/core/db';
import { encryptPii } from '$lib/core/crypto/user-pii-encryption';

// F-R8-02: Zod schema replaces unvalidated destructuring
const ProfileSchema = z.object({
	role: z.string().min(1).max(100),
	organization: z.string().max(200).optional(),
	location: z.string().max(200).optional(),
	connection: z.string().min(1).max(100)
});

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		// Ensure user is authenticated
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

		// C-4: Encrypt profile blob at rest (plaintext fields retained during transition)
		const profileBlob = JSON.stringify({ role, organization: organization || null, location: location || null, connection });
		const encProfile = await encryptPii(profileBlob, locals.user.id).catch(() => null);

		// Update user with profile information using proper fields
		// Note: connection_details removed - field does not exist in schema
		const updatedUser = await db.user.update({
			where: { id: locals.user.id },
			data: {
				role,
				organization: organization || null,
				location: location || null,
				connection,
				encrypted_profile: encProfile ? JSON.stringify(encProfile) : undefined,
				profile_completed_at: new Date(),
				updatedAt: new Date()
			}
		});

		return json({
			success: true,
			message: 'Profile saved successfully',
			user: {
				id: updatedUser.id,
				profileComplete: true
			}
		});
	} catch {
		return json(
			{
				error: 'Failed to save profile'
			},
			{ status: 500 }
		);
	}
};

export const GET: RequestHandler = async ({ locals }) => {
	try {
		// CVE-INTERNAL-004 FIX: Corrected parameter name from _locals to locals
		// Ensure user is authenticated
		if (!locals.user) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		// Get user's profile information
		// Note: PII fields (street, city, state, zip, phone) removed per privacy architecture
		// Address data is encrypted in EncryptedDeliveryData, not stored on User
		const user = await db.user.findUnique({
			where: { id: locals.user.id },
			select: {
				id: true,
				name: true,
				email: true,
				avatar: true,
				role: true,
				organization: true,
				location: true,
				connection: true,
				profile_completed_at: true,
				profile_visibility: true,
				is_verified: true,
				createdAt: true,
				updatedAt: true
			}
		});

		if (!user) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		return json({
			user: {
				id: user.id,
				name: user.name,
				email: user.email,
				avatar: user.avatar,
				// Note: address and phone removed per privacy architecture
				// PII is encrypted in EncryptedDeliveryData, not exposed via API
				profile: {
					role: user.role,
					organization: user.organization,
					location: user.location,
					connection: user.connection,
					completed_at: user.profile_completed_at,
					visibility: user.profile_visibility
				},
				verification: {
					is_verified: user.is_verified
				},
				timestamps: {
					created_at: user.createdAt,
					updated_at: user.updatedAt
				}
			}
		});
	} catch {
		return json(
			{
				error: 'Failed to fetch profile'
			},
			{ status: 500 }
		);
	}
};
