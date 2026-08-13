import {
	classifySeatRoute,
	type SeatRouteVerdict,
	type StandingBasis,
	type StandingClass
} from '$lib/core/agents/seat-route';
import type { RegistryCorpus, RegistryCorpusClass } from './manifest';
import type { RegistryRow } from './fetch';

const textEncoder = new TextEncoder();

function closedReadonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
	const members = new Set(values);
	const readonlyView = new Proxy(members, {
		get(target, property) {
			if (property === 'add' || property === 'delete' || property === 'clear') return undefined;
			const value: unknown = Reflect.get(target, property, target);
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	return Object.freeze(readonlyView);
}

/**
 * 118 of 987 current-year WA PDC rows (12.0%) are consumer mailboxes. This
 * deny-set therefore removes real rows; it is a policy refusal, not decoration.
 */
export const CONSUMER_MAILBOX_DOMAINS: ReadonlySet<string> = closedReadonlySet([
	'gmail.com',
	'googlemail.com',
	'comcast.net',
	'yahoo.com',
	'ymail.com',
	'hotmail.com',
	'outlook.com',
	'live.com',
	'msn.com',
	'aol.com',
	'icloud.com',
	'me.com',
	'mac.com',
	'att.net',
	'verizon.net',
	'sbcglobal.net',
	'earthlink.net',
	'protonmail.com',
	'proton.me',
	'mail.com',
	'gmx.com',
	'hushmail.com',
	'zoho.com'
]);

export type RegistryRejectionReason =
	| 'consumer-mailbox'
	| 'malformed-email'
	| 'missing-name'
	| 'oversize-field';

export interface RegistryRejection {
	readonly reason: RegistryRejectionReason;
	readonly rowIndex: number;
}

export interface RegistryRecord {
	readonly name: string;
	readonly title: string;
	readonly organization: string;
	readonly affiliations: readonly string[];
	readonly emailAsPublished: string;
	readonly emailNormalized: string;
	readonly sourceUrl: string;
	readonly corpusId: string;
	readonly corpusClass: RegistryCorpusClass;
	readonly defaultSendTarget: false;
	readonly standing: StandingClass;
	readonly standingBasis: StandingBasis;
	readonly seatRoute: SeatRouteVerdict;
}

export interface RegistryTransformResult {
	readonly records: RegistryRecord[];
	readonly rejected: RegistryRejection[];
}

function mappedString(row: RegistryRow, field: string | undefined): string {
	if (!field) return '';
	const value = row[field];
	return typeof value === 'string' ? value : '';
}

function utf8Bytes(value: string): number {
	return textEncoder.encode(value).byteLength;
}

function isValidEmail(value: string): boolean {
	if (utf8Bytes(value) > 254) return false;
	if ((value.match(/@/gu) ?? []).length !== 1) return false;
	return /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/u.test(value);
}

function normalizedEmail(value: string): string {
	const separator = value.indexOf('@');
	return `${value.slice(0, separator)}@${value.slice(separator + 1).toLowerCase()}`;
}

function reject(rejected: RegistryRejection[], rowIndex: number, reason: RegistryRejectionReason) {
	rejected.push({ rowIndex, reason });
}

export function transformRegistryRows(
	corpus: RegistryCorpus,
	rows: readonly RegistryRow[],
	requestUrl: string
): RegistryTransformResult {
	const records: RegistryRecord[] = [];
	const rejected: RegistryRejection[] = [];

	rows.forEach((row, rowIndex) => {
		const rawName = mappedString(row, corpus.fieldMap.name);
		const rawEmail = mappedString(row, corpus.fieldMap.email);
		const rawOrganization = mappedString(row, corpus.fieldMap.organization);
		const rawAffiliations = mappedString(row, corpus.fieldMap.affiliations);

		if (
			utf8Bytes(rawName) > 200 ||
			utf8Bytes(rawOrganization) > 300 ||
			utf8Bytes(rawAffiliations) > 4_000
		) {
			reject(rejected, rowIndex, 'oversize-field');
			return;
		}

		const name = rawName.trim();
		if (!name) {
			reject(rejected, rowIndex, 'missing-name');
			return;
		}

		if (!isValidEmail(rawEmail)) {
			reject(rejected, rowIndex, 'malformed-email');
			return;
		}

		const emailNormalized = normalizedEmail(rawEmail);
		const domain = emailNormalized.slice(emailNormalized.indexOf('@') + 1);
		if (CONSUMER_MAILBOX_DOMAINS.has(domain)) {
			reject(rejected, rowIndex, 'consumer-mailbox');
			return;
		}

		const seatRoute = classifySeatRoute(rawEmail, { candidateName: name });
		if (!seatRoute) {
			reject(rejected, rowIndex, 'malformed-email');
			return;
		}

		records.push({
			name,
			title: corpus.recordTitle,
			organization: rawOrganization.trim(),
			affiliations: rawAffiliations
				.split(',')
				.map((affiliation) => affiliation.trim())
				.filter(Boolean)
				.slice(0, 25),
			emailAsPublished: rawEmail,
			emailNormalized,
			sourceUrl: requestUrl,
			corpusId: corpus.id,
			corpusClass: corpus.corpusClass,
			defaultSendTarget: false,
			standing: 'coalition',
			standingBasis: 'registry-field',
			seatRoute
		});
	});

	return { records, rejected };
}

function singleLine(value: string): string {
	return value.replace(/[\r\n]+/gu, ' ');
}

export function toRegistryPageContent(
	corpus: RegistryCorpus,
	records: readonly RegistryRecord[],
	requestUrl: string
): { url: string; title: string; text: string } {
	return {
		url: requestUrl,
		title: corpus.label,
		text: records
			.map((record) =>
				[
					singleLine(record.name),
					singleLine(record.title),
					singleLine(record.organization),
					record.emailAsPublished,
					...record.affiliations.map(singleLine)
				].join('\t')
			)
			.join('\n')
	};
}
