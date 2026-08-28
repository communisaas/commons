import { absent, blocked, present, withheld, type Fact } from '$lib/core/fact';
import type { StandingClass } from '$lib/core/agents/seat-route';
import type { ProceedingClient } from './manifest';

export type LegistarId = string | number;

export type LegistarBody = Readonly<{
	BodyId?: LegistarId;
	BodyName?: string;
	BodyActiveFlag?: number;
	BodyContactEmail?: string | null;
}>;

export type LegistarEvent = Readonly<{
	EventId?: LegistarId;
	EventBodyId?: LegistarId;
	EventBodyName?: string;
	EventDate?: string;
	EventTime?: string;
	EventAgendaStatusName?: string;
	EventAgendaFile?: string | null;
	EventInSiteURL?: string | null;
}>;

export type LegistarEventItem = Readonly<{
	EventItemId?: LegistarId;
	EventItemEventId?: LegistarId;
	EventItemMatterId?: LegistarId | null;
	EventItemTitle?: string | null;
}>;

export type LegistarMatter = Readonly<{
	MatterId?: LegistarId;
	MatterFile?: string | null;
	MatterTitle?: string | null;
	MatterStatusName?: string | null;
	MatterIntroDate?: string | null;
	MatterAgendaDate?: string | null;
}>;

export type ProceedingClock = Readonly<{
	nextMeetingAt: string;
	agendaStatus: string;
	agendaFileUrl?: string;
	inSiteUrl?: string;
}>;

export type Proceeding = ProceedingClock &
	Readonly<{
		jurisdiction: string;
		clientSlug: string;
		bodyId: LegistarId;
		bodyName: string;
		matterFile?: string;
		matterTitle?: string;
		matterStatus?: string;
		matterIntroDate?: string;
		matterAgendaDate?: string;
		agendaItemTitles: readonly string[];
	}>;

export type ProceedingResult = Fact<readonly Proceeding[]>;

export type ChannelOfRecord = Readonly<{
	bodyId: LegistarId;
	bodyName: string;
	email: string;
	sourceField: 'BodyContactEmail';
	standing: StandingClass;
}>;

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function sameId(
	left: LegistarId | null | undefined,
	right: LegistarId | null | undefined
): boolean {
	return left !== null && left !== undefined && right !== null && right !== undefined
		? String(left) === String(right)
		: false;
}

function nonEmpty(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function eventWallClock(
	eventDate: string | undefined,
	eventTime: string | undefined
): string | null {
	const date = nonEmpty(eventDate);
	if (!date) return null;
	const day = /^(\d{4}-\d{2}-\d{2})/u.exec(date)?.[1];
	const time = nonEmpty(eventTime);
	if (!day || !time) return Number.isFinite(Date.parse(date)) ? date : null;

	const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/iu.exec(time);
	if (!match) return Number.isFinite(Date.parse(date)) ? date : null;
	let hour = Number(match[1]);
	const minute = Number(match[2]);
	const meridiem = match[3]?.toUpperCase();
	if (minute > 59 || hour > (meridiem ? 12 : 23) || hour < 0) return null;
	if (meridiem === 'AM' && hour === 12) hour = 0;
	if (meridiem === 'PM' && hour < 12) hour += 12;

	const wallClock = `${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
	return Number.isFinite(Date.parse(`${wallClock}Z`)) ? wallClock : null;
}

function isForwardDate(value: string): boolean {
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && parsed > Date.now();
}

/**
 * Extract only the institution-declared office channel. `/persons` is a hard
 * refusal: its 627-row surface for a nine-seat council begins with the vendor's
 * own inactive address, so PersonEmail is directory/dossier evidence, not an
 * office route. MatterText1-5 and MatterEXText1-10 are likewise never read:
 * MatterText2 carried an address in one deployment, but these are untyped
 * client-specific slots. EventLocation is display metadata, never a channel.
 */
export function extractChannelOfRecord(body: LegistarBody): Fact<ChannelOfRecord> {
	if (body.BodyActiveFlag !== 1) {
		return withheld('BodyContactEmail is not emitted for an inactive body');
	}

	const email = nonEmpty(body.BodyContactEmail);
	if (!email) {
		return withheld('The active body is published without a BodyContactEmail channel');
	}
	if (!EMAIL_ADDRESS.test(email)) {
		return blocked('BodyContactEmail was published but could not be parsed as an email address');
	}
	if (body.BodyId === null || body.BodyId === undefined || !nonEmpty(body.BodyName)) {
		return blocked('The published BodyContactEmail row is missing its body id or body name');
	}

	return present({
		bodyId: body.BodyId,
		bodyName: body.BodyName!.trim(),
		email,
		sourceField: 'BodyContactEmail',
		standing: 'channel-of-record'
	});
}

function bodyForEvent(
	event: LegistarEvent,
	bodies: readonly LegistarBody[]
): LegistarBody | undefined {
	return (
		bodies.find((body) => sameId(body.BodyId, event.EventBodyId)) ??
		bodies.find(
			(body) =>
				nonEmpty(body.BodyName) !== undefined &&
				nonEmpty(body.BodyName) === nonEmpty(event.EventBodyName)
		)
	);
}

function matterFields(matter: LegistarMatter | undefined): Partial<Proceeding> {
	if (!matter) return {};
	return {
		...(nonEmpty(matter.MatterFile) ? { matterFile: matter.MatterFile!.trim() } : {}),
		...(nonEmpty(matter.MatterTitle) ? { matterTitle: matter.MatterTitle!.trim() } : {}),
		...(nonEmpty(matter.MatterStatusName) ? { matterStatus: matter.MatterStatusName!.trim() } : {}),
		...(nonEmpty(matter.MatterIntroDate)
			? { matterIntroDate: matter.MatterIntroDate!.trim() }
			: {}),
		...(nonEmpty(matter.MatterAgendaDate)
			? { matterAgendaDate: matter.MatterAgendaDate!.trim() }
			: {})
	};
}

function proceedingFor(
	client: ProceedingClient,
	event: LegistarEvent,
	body: LegistarBody | undefined,
	nextMeetingAt: string,
	items: readonly LegistarEventItem[],
	matter?: LegistarMatter
): Proceeding {
	const bodyId = event.EventBodyId ?? body?.BodyId;
	const bodyName = nonEmpty(event.EventBodyName) ?? nonEmpty(body?.BodyName);
	const agendaStatus = nonEmpty(event.EventAgendaStatusName);
	if (bodyId === null || bodyId === undefined || !bodyName) {
		throw new Error('A proceeding requires a declared body id and body name');
	}
	if (!agendaStatus) {
		throw new Error('A proceeding requires EventAgendaStatusName');
	}

	return {
		jurisdiction: client.jurisdiction,
		clientSlug: client.slug,
		bodyId,
		bodyName,
		nextMeetingAt,
		agendaStatus,
		...(nonEmpty(event.EventAgendaFile) ? { agendaFileUrl: event.EventAgendaFile!.trim() } : {}),
		...(nonEmpty(event.EventInSiteURL) ? { inSiteUrl: event.EventInSiteURL!.trim() } : {}),
		...matterFields(matter),
		agendaItemTitles: items
			.map((item) => nonEmpty(item.EventItemTitle))
			.filter((title): title is string => title !== undefined)
	};
}

/** Build matter-linked proceedings from forward-dated events only. */
export function buildProceeding(
	client: ProceedingClient,
	bodies: readonly LegistarBody[],
	events: readonly LegistarEvent[],
	eventItems: readonly LegistarEventItem[],
	matters: readonly LegistarMatter[]
): ProceedingResult {
	const proceedings: Proceeding[] = [];
	let sawIncompleteForwardEvent = false;

	for (const event of events) {
		const nextMeetingAt = eventWallClock(event.EventDate, event.EventTime);
		if (!nextMeetingAt) {
			sawIncompleteForwardEvent = true;
			continue;
		}
		if (!isForwardDate(nextMeetingAt)) continue;
		const body = bodyForEvent(event, bodies);
		const bodyId = event.EventBodyId ?? body?.BodyId;
		const bodyName = nonEmpty(event.EventBodyName) ?? nonEmpty(body?.BodyName);
		if (
			bodyId === null ||
			bodyId === undefined ||
			!bodyName ||
			!nonEmpty(event.EventAgendaStatusName)
		) {
			sawIncompleteForwardEvent = true;
			continue;
		}

		const items = eventItems.filter((item) => sameId(item.EventItemEventId, event.EventId));
		const linkedMatterIds = [
			...new Set(
				items
					.map((item) => item.EventItemMatterId)
					.filter((id): id is LegistarId => id !== null && id !== undefined)
					.map(String)
			)
		];

		if (linkedMatterIds.length === 0) {
			proceedings.push(proceedingFor(client, event, body, nextMeetingAt, items));
			continue;
		}

		for (const matterId of linkedMatterIds) {
			const matter = matters.find((candidate) => sameId(candidate.MatterId, matterId));
			const matterItems = items.filter((item) => sameId(item.EventItemMatterId, matterId));
			proceedings.push(proceedingFor(client, event, body, nextMeetingAt, matterItems, matter));
		}
	}

	if (proceedings.length === 0) {
		return sawIncompleteForwardEvent
			? blocked('Forward-dated Legistar event rows were incomplete and could not be mapped')
			: absent();
	}
	return present(
		proceedings.sort((left, right) => left.nextMeetingAt.localeCompare(right.nextMeetingAt))
	);
}
