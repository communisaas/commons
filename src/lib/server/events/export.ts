export type EventExportRecord = {
	id: string;
	title: string;
	description?: string | null;
	eventType?: string | null;
	startAt: number | string;
	endAt?: number | string | null;
	timezone?: string | null;
	venue?: string | null;
	address?: string | null;
	city?: string | null;
	state?: string | null;
	virtualUrl?: string | null;
	status?: string | null;
};

export type EventRsvpExportRow = {
	id: string;
	status?: string | null;
	guestCount?: number | null;
	districtHash?: string | null;
	engagementTier?: number | null;
	checkedInAt?: number | string | null;
	attendanceVerified?: boolean | null;
	attendanceVerificationMethod?: string | null;
	attendanceDistrictHash?: string | null;
	walkIn?: boolean | null;
	createdAt?: number | string | null;
	updatedAt?: number | string | null;
};

function toMillis(value: number | string | null | undefined): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string') {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function icsDate(value: number | string | null | undefined): string {
	const ms = toMillis(value);
	if (ms === null) return '';
	const date = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function isoDate(value: number | string | null | undefined): string {
	const ms = toMillis(value);
	return ms === null ? '' : new Date(ms).toISOString();
}

function escapeIcs(value: string | null | undefined): string {
	return (value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/\r?\n/g, '\\n')
		.replace(/,/g, '\\,')
		.replace(/;/g, '\\;');
}

function eventLocation(event: EventExportRecord): string {
	return [event.venue, event.address, event.city, event.state].filter(Boolean).join(', ');
}

export function eventExportFilename(event: Pick<EventExportRecord, 'title'>, extension: string): string {
	const safeTitle = event.title
		.replace(/[^A-Za-z0-9._-]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 72);
	return `event-${safeTitle || 'record'}.${extension}`;
}

export function renderEventIcs(
	event: EventExportRecord,
	options: { generatedAt?: number; baseUrl?: string } = {}
): string {
	const generatedAt = options.generatedAt ?? Date.now();
	const starts = icsDate(event.startAt);
	const ends = icsDate(event.endAt);
	const descriptionParts = [event.description, event.virtualUrl ? `Virtual URL: ${event.virtualUrl}` : null]
		.filter(Boolean)
		.join('\n\n');
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Commons//Org Event Export//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:commons-event-${escapeIcs(event.id)}${options.baseUrl ? `@${escapeIcs(new URL(options.baseUrl).hostname)}` : ''}`,
		`DTSTAMP:${icsDate(generatedAt)}`,
		starts ? `DTSTART:${starts}` : null,
		ends ? `DTEND:${ends}` : null,
		`SUMMARY:${escapeIcs(event.title)}`,
		descriptionParts ? `DESCRIPTION:${escapeIcs(descriptionParts)}` : null,
		eventLocation(event) ? `LOCATION:${escapeIcs(eventLocation(event))}` : null,
		event.virtualUrl ? `URL:${escapeIcs(event.virtualUrl)}` : null,
		event.status ? `STATUS:${event.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}` : null,
		'END:VEVENT',
		'END:VCALENDAR'
	].filter((line): line is string => Boolean(line));
	return `${lines.join('\r\n')}\r\n`;
}

function escapeCsv(value: string | number | boolean | null | undefined): string {
	const text = value === null || value === undefined ? '' : String(value);
	if (/[",\r\n]/.test(text)) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

export function renderEventRosterCsv(rows: EventRsvpExportRow[]): string {
	const headers = [
		'rsvp_id',
		'kind',
		'status',
		'guest_count',
		'district_hash',
		'engagement_tier',
		'checked_in',
		'attendance_verified',
		'verification_method',
		'attendance_district_hash',
		'created_at',
		'checked_in_at',
		'updated_at'
	];
	const body = rows.map((row) =>
		[
			row.id,
			row.walkIn ? 'walk_in' : 'rsvp',
			row.status ?? '',
			row.guestCount ?? '',
			row.districtHash ?? '',
			row.engagementTier ?? '',
			row.checkedInAt ? 'true' : 'false',
			row.attendanceVerified ? 'true' : 'false',
			row.attendanceVerificationMethod ?? '',
			row.attendanceDistrictHash ?? '',
			isoDate(row.createdAt),
			isoDate(row.checkedInAt),
			isoDate(row.updatedAt)
		]
			.map(escapeCsv)
			.join(',')
	);
	return `${[headers.join(','), ...body].join('\r\n')}\r\n`;
}
