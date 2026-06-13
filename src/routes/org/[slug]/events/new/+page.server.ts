import { error, fail, redirect } from '@sveltejs/kit';
import { FEATURES } from '$lib/config/features';
import { api } from '$lib/convex';
import { serverMutation, serverQuery } from 'convex-sveltekit';
import type { Id } from '$convex/_generated/dataModel';
import type { Actions, PageServerLoad } from './$types';

type EventFormValues = {
	title: string;
	description: string;
	event_type: string;
	start_local: string;
	end_local: string;
	timezone: string;
	venue: string;
	address: string;
	city: string;
	state: string;
	postal_code: string;
	virtual_url: string;
	capacity: string;
	waitlist_enabled: boolean;
	require_verification: boolean;
	publish_now: boolean;
};

const EVENT_TYPES = new Set(['IN_PERSON', 'VIRTUAL', 'HYBRID']);

function stringValue(formData: FormData, key: keyof EventFormValues): string {
	return formData.get(key)?.toString().trim() ?? '';
}

function formValues(formData: FormData): EventFormValues {
	return {
		title: stringValue(formData, 'title'),
		description: stringValue(formData, 'description'),
		event_type: stringValue(formData, 'event_type') || 'IN_PERSON',
		start_local: stringValue(formData, 'start_local'),
		end_local: stringValue(formData, 'end_local'),
		timezone: stringValue(formData, 'timezone') || 'America/Los_Angeles',
		venue: stringValue(formData, 'venue'),
		address: stringValue(formData, 'address'),
		city: stringValue(formData, 'city'),
		state: stringValue(formData, 'state'),
		postal_code: stringValue(formData, 'postal_code'),
		virtual_url: stringValue(formData, 'virtual_url'),
		capacity: stringValue(formData, 'capacity'),
		waitlist_enabled: formData.get('waitlist_enabled') === 'on',
		require_verification: formData.get('require_verification') === 'on',
		publish_now: formData.get('publish_now') === 'on'
	};
}

function numberValue(formData: FormData, key: string): number | null {
	const raw = formData.get(key)?.toString() ?? '';
	if (!raw) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!FEATURES.EVENTS) throw error(404, 'Not found');
	if (!locals.user) throw redirect(302, '/auth/login');

	const convexOrg = await serverQuery(api.organizations.getBySlug, { slug: params.slug });

	return {
		org: { name: convexOrg?.name ?? params.slug, slug: params.slug }
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		if (!FEATURES.EVENTS) throw error(404, 'Not found');
		if (!locals.user) throw redirect(302, '/auth/login');

		const formData = await request.formData();
		const values = formValues(formData);
		const startAt = numberValue(formData, 'start_at_ms');
		const endAt = numberValue(formData, 'end_at_ms');
		const capacity = values.capacity ? Number(values.capacity) : null;

		if (values.title.length < 3 || values.title.length > 200) {
			return fail(400, { error: 'Event title must be 3-200 characters.', values });
		}
		if (!EVENT_TYPES.has(values.event_type)) {
			return fail(400, { error: 'Choose in-person, virtual, or hybrid.', values });
		}
		if (!startAt || startAt <= Date.now()) {
			return fail(400, { error: 'Choose a future start time.', values });
		}
		if (endAt && endAt <= startAt) {
			return fail(400, { error: 'End time must be after start time.', values });
		}
		if (
			capacity !== null &&
			(!Number.isInteger(capacity) || capacity < 1 || capacity > 1_000_000)
		) {
			return fail(400, {
				error: 'Capacity must be a whole number between 1 and 1,000,000.',
				values
			});
		}

		try {
			const created = (await serverMutation(api.events.create, {
				orgSlug: params.slug,
				title: values.title,
				description: values.description || undefined,
				eventType: values.event_type as 'IN_PERSON' | 'VIRTUAL' | 'HYBRID',
				startAt,
				endAt: endAt ?? undefined,
				timezone: values.timezone,
				venue: values.venue || undefined,
				address: values.address || undefined,
				city: values.city || undefined,
				state: values.state || undefined,
				postalCode: values.postal_code || undefined,
				virtualUrl: values.virtual_url || undefined,
				capacity: capacity ?? undefined,
				waitlistEnabled: values.waitlist_enabled,
				requireVerification: values.require_verification
			})) as { id: Id<'events'>; checkinCode: string };

			if (values.publish_now) {
				await serverMutation(api.events.update, {
					orgSlug: params.slug,
					eventId: created.id,
					status: 'PUBLISHED'
				});
			}

			throw redirect(303, `/org/${params.slug}/events/${created.id}`);
		} catch (e) {
			if (
				e &&
				typeof e === 'object' &&
				'status' in e &&
				(e as { status?: number }).status === 303
			) {
				throw e;
			}
			return fail(400, {
				error: e instanceof Error ? e.message : 'Event record could not be created.',
				values
			});
		}
	}
};
