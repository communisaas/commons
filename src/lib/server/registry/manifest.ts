/**
 * `select` is mandatory: the unprojected row carries `agent_photo_thumbnail`,
 * a base64 `data:image/webp` blob of roughly 4 KB per row, so an unprojected
 * 987-row fetch is multiple megabytes of useless bytes.
 *
 * Invented dataset ids return HTTP 404 `{"code":"dataset.missing"}`. This is
 * therefore a closed, hand-measured manifest. A new entry may be added only
 * together with its own measured row count and email coverage.
 */

export type RegistryCorpusClass = 'coalition-map';

export interface RegistryCorpus {
	readonly id: string;
	readonly label: string;
	readonly host: string;
	readonly datasetPath: string;
	readonly select: readonly string[];
	readonly whereYearField?: string;
	readonly fieldMap: {
		readonly name: string;
		readonly email: string;
		readonly organization?: string;
		readonly affiliations?: string;
	};
	readonly recordTitle: string;
	readonly corpusClass: RegistryCorpusClass;
	readonly jurisdiction: string;
	readonly personBoundBasis: 'statutory-public-record';
	readonly measuredAt: string;
	readonly measuredRows: number;
	readonly measuredEmailCoverage: number;
}

const WA_PDC_LOBBYIST_AGENTS = Object.freeze({
	id: 'wa-pdc-lobbyist-agents',
	label: 'Washington State Public Disclosure Commission — registered lobbyist agents',
	host: 'data.wa.gov',
	datasetPath: '/resource/bp5b-jrti.json',
	select: Object.freeze([
		'agent_name',
		'lobbyist_email',
		'employers',
		'lobbyist_firm_name',
		'employment_year',
		'agent_id'
	]),
	whereYearField: 'employment_year',
	fieldMap: Object.freeze({
		name: 'agent_name',
		email: 'lobbyist_email',
		organization: 'lobbyist_firm_name',
		affiliations: 'employers'
	}),
	recordTitle: 'Registered lobbyist agent',
	corpusClass: 'coalition-map',
	jurisdiction: 'US-WA',
	personBoundBasis: 'statutory-public-record',
	measuredAt: '2026-08-04',
	measuredRows: 11665,
	measuredEmailCoverage: 1.0
}) satisfies RegistryCorpus;

export const REGISTRY_CORPORA: readonly RegistryCorpus[] = Object.freeze([WA_PDC_LOBBYIST_AGENTS]);
