/// <reference types="vite/client" />

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const SECRET = 'test-internal-secret-0123456789abcdef-pad';
const NOW = Date.parse('2026-07-19T12:00:00.000Z');
type Harness = TestConvex<typeof schema>;

async function seedEvent(
	t: Harness,
	options: { status?: 'DRAFT' | 'PUBLISHED'; legacyCounters?: boolean } = {}
): Promise<Id<'events'>> {
	return await t.run(async (ctx) => {
		const orgId = await ctx.db.insert('organizations', {
			name: 'Event Stats Org',
			slug: `event-stats-${options.status ?? 'published'}-${options.legacyCounters ?? false}`,
			maxSeats: 5,
			maxTemplatesMonth: 10,
			dmCacheTtlDays: 30,
			countryCode: 'US',
			isPublic: true,
			updatedAt: NOW
		});
		return await ctx.db.insert('events', {
			orgId,
			title: 'Public Town Hall',
			eventType: 'IN_PERSON',
			startAt: NOW + 86_400_000,
			timezone: 'UTC',
			waitlistEnabled: false,
			rsvpCount: 0,
			...(options.legacyCounters ? {} : { goingCount: 0, maybeCount: 0 }),
			attendeeCount: 0,
			verifiedAttendees: 0,
			requireVerification: false,
			status: options.status ?? 'PUBLISHED',
			updatedAt: NOW
		});
	});
}

async function insertRsvp(
	t: Harness,
	eventId: Id<'events'>,
	index: number,
	status: 'GOING' | 'MAYBE'
): Promise<void> {
	await t.mutation(internal.events.insertRsvp, {
		eventId,
		encryptedEmail: `encrypted-${index}`,
		emailHash: `hash-${index}`,
		status,
		guestCount: 1,
		engagementTier: 0
	});
}

describe('event live stats counters', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		vi.stubEnv('INTERNAL_API_SECRET', SECRET);
		vi.stubEnv('INTERNAL_API_SECRET_PREVIOUS', '');
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
	});

	it('reads transactionally maintained counters and K-floors every cohort', async () => {
		const t = convexTest(schema, modules);
		const eventId = await seedEvent(t);
		for (let index = 0; index < 5; index += 1) await insertRsvp(t, eventId, index, 'GOING');
		for (let index = 5; index < 9; index += 1) await insertRsvp(t, eventId, index, 'MAYBE');

		await expect(t.query(api.v1api.getEventStats, { _secret: SECRET, eventId })).resolves.toEqual({
			rsvpCount: 9,
			attendeeCount: null,
			verifiedAttendees: null,
			goingCount: 5,
			maybeCount: null,
			kAnonymityThreshold: 5
		});
	});

	it('adjusts status counters exactly once when an existing RSVP changes', async () => {
		const t = convexTest(schema, modules);
		const eventId = await seedEvent(t);
		await insertRsvp(t, eventId, 1, 'GOING');
		await insertRsvp(t, eventId, 1, 'MAYBE');
		await insertRsvp(t, eventId, 1, 'MAYBE');

		await t.run(async (ctx) => {
			const event = await ctx.db.get(eventId);
			expect(event).toMatchObject({ rsvpCount: 1, goingCount: 0, maybeCount: 1 });
			expect(
				await ctx.db
					.query('eventRsvps')
					.withIndex('by_eventId', (q) => q.eq('eventId', eventId))
					.collect()
			).toHaveLength(1);
		});
	});

	it('never fabricates partial status counts for a legacy event', async () => {
		const t = convexTest(schema, modules);
		const eventId = await seedEvent(t, { legacyCounters: true });
		await insertRsvp(t, eventId, 1, 'GOING');

		await expect(
			t.query(api.v1api.getEventStats, { _secret: SECRET, eventId })
		).resolves.toMatchObject({ rsvpCount: null, goingCount: null, maybeCount: null });
		await t.run(async (ctx) => {
			const event = await ctx.db.get(eventId);
			expect(event?.goingCount).toBeUndefined();
			expect(event?.maybeCount).toBeUndefined();
		});
	});

	it('does not expose draft event statistics', async () => {
		const t = convexTest(schema, modules);
		const eventId = await seedEvent(t, { status: 'DRAFT' });
		await expect(
			t.query(api.v1api.getEventStats, { _secret: SECRET, eventId })
		).resolves.toBeNull();
	});

	it('normalizes invalid public IDs before db.get', async () => {
		const t = convexTest(schema, modules);
		await expect(
			t.query(api.v1api.getEventStats, { _secret: SECRET, eventId: 'not-a-convex-id' })
		).resolves.toBeNull();
	});
});
