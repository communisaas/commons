import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	eventExportFilename,
	renderEventIcs,
	renderEventRosterCsv
} from '../../../src/lib/server/events/export';

function source(path: string): string {
	return readFileSync(path, 'utf8');
}

describe('event export artifacts', () => {
	it('renders an org-side ICS record without attendance-proof claims', () => {
		const ics = renderEventIcs(
			{
				id: 'evt_123',
				title: 'Town hall, District 7',
				description: 'Bring questions; keep RSVP private.',
				startAt: Date.UTC(2026, 0, 2, 18, 30),
				endAt: Date.UTC(2026, 0, 2, 20, 0),
				venue: 'Civic Hall',
				address: '1 Main St',
				city: 'San Francisco',
				state: 'CA',
				virtualUrl: 'https://example.org/live',
				status: 'PUBLISHED'
			},
			{ generatedAt: Date.UTC(2026, 0, 1, 0, 0), baseUrl: 'https://commons.email' }
		);

		expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0');
		expect(ics).toContain('UID:commons-event-evt_123@commons.email');
		expect(ics).toContain('DTSTAMP:20260101T000000Z');
		expect(ics).toContain('DTSTART:20260102T183000Z');
		expect(ics).toContain('DTEND:20260102T200000Z');
		expect(ics).toContain('SUMMARY:Town hall\\, District 7');
		expect(ics).toContain('LOCATION:Civic Hall\\, 1 Main St\\, San Francisco\\, CA');
		expect(ics).toContain('URL:https://example.org/live');
		expect(ics).not.toMatch(/proof|verified attendance|decrypted/i);
	});

	it('renders a bounded RSVP and attendance CSV without decrypted PII columns', () => {
		const csv = renderEventRosterCsv([
			{
				id: 'r1',
				status: 'GOING',
				guestCount: 2,
				districtHash: 'district-hash',
				engagementTier: 3,
				checkedInAt: Date.UTC(2026, 0, 2, 19, 0),
				attendanceVerified: true,
				attendanceVerificationMethod: 'checkin_code',
				attendanceDistrictHash: 'attendance-district',
				createdAt: Date.UTC(2026, 0, 1, 1, 0),
				updatedAt: Date.UTC(2026, 0, 2, 19, 0)
			},
			{
				id: 'walk-in',
				status: 'GOING',
				guestCount: 1,
				walkIn: true,
				createdAt: Date.UTC(2026, 0, 2, 19, 5)
			}
		]);

		expect(csv.split('\r\n')[0]).toBe(
			'rsvp_id,kind,status,guest_count,district_hash,engagement_tier,checked_in,attendance_verified,verification_method,attendance_district_hash,created_at,checked_in_at,updated_at'
		);
		expect(csv).toContain(
			'r1,rsvp,GOING,2,district-hash,3,true,true,checkin_code,attendance-district,2026-01-01T01:00:00.000Z,2026-01-02T19:00:00.000Z,2026-01-02T19:00:00.000Z'
		);
		expect(csv).toContain('walk-in,walk_in,GOING,1,,,false,false,,');
		expect(csv).not.toMatch(/email|name|encrypted/i);
	});

	it('wires the event detail page to live export endpoints', () => {
		const detailPage = source('src/routes/org/[slug]/events/[id]/+page.svelte');
		const icsRoute = source('src/routes/org/[slug]/events/[id]/calendar.ics/+server.ts');
		const csvRoute = source('src/routes/org/[slug]/events/[id]/attendees.csv/+server.ts');

		expect(detailPage).toContain('calendar.ics');
		expect(detailPage).toContain('attendees.csv');

		expect(icsRoute).toContain('renderEventIcs');
		expect(icsRoute).toContain('X-Event-Export-Boundary');
		expect(csvRoute).toContain('includeWalkIns: true');
		expect(csvRoute).toContain('renderEventRosterCsv');
		expect(csvRoute).toContain('rsvp-attendance-evidence-no-decrypted-pii');
	});

	it('sanitizes export filenames', () => {
		expect(eventExportFilename({ title: 'Town Hall: District 7 / RSVP?' }, 'csv')).toBe(
			'event-Town_Hall_District_7_RSVP.csv'
		);
	});
});
