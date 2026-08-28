/**
 * geo-scope-inference — the single heuristic that turns decision-maker
 * organizations into a `GeoScope`.
 *
 * Every authoring surface calls this so the same set of organizations always
 * yields the same scope, and therefore the same source-discovery queries.
 * Evidence precedence, strongest first:
 *
 *   1. A locality shared by every resolved organization
 *   2. A state shared by every resolved organization
 *   3. Uniformly federal/national organizations
 *   4. A locality or state named in operator audience guidance
 *   5. The explicit nationwide US fallback
 *
 * Two-letter locality abbreviations are ambiguous by construction, so they are
 * only read as evidence when the surrounding text corroborates them; see
 * `AMBIGUOUS_ABBREVIATION_LENGTH`.
 *
 * Subdivisions are emitted in ISO 3166-2 form (`US-CA`), which is what the
 * display and search paths read. The result carries its own `basis` and
 * `source` so callers can present it as the heuristic it is, never as a hard
 * jurisdiction resolution.
 *
 * This module is imported by browser components, so it must stay free of
 * server-only modules and private environment access.
 */

import type { GeoScope } from '$lib/core/agents/types';
import { displayGeoScope } from '$lib/core/location/location-resolver';
import { getStateName, US_STATES } from '$lib/core/location/state-codes';

/** Which evidence produced a scope, strongest to weakest. */
export type ScopeEvidenceSource = 'resolved-targets' | 'audience-guidance' | 'fallback';

export type ScopeEvidence = {
	scope: GeoScope;
	label: string;
	basis: string;
	source: ScopeEvidenceSource;
};

type LocalityHint = {
	patterns: string[];
	locality: string;
	state: string;
};

const STATE_CODES = new Set(Object.values(US_STATES));
const US_LOCALITY_HINTS: LocalityHint[] = [
	{ patterns: ['san francisco', 'sf'], locality: 'San Francisco', state: 'CA' },
	{ patterns: ['new york city', 'nyc'], locality: 'New York', state: 'NY' },
	{ patterns: ['los angeles', 'la'], locality: 'Los Angeles', state: 'CA' },
	{ patterns: ['chicago'], locality: 'Chicago', state: 'IL' },
	{ patterns: ['washington dc', 'washington, dc', 'dc'], locality: 'Washington DC', state: 'DC' },
	{ patterns: ['seattle'], locality: 'Seattle', state: 'WA' },
	{ patterns: ['portland'], locality: 'Portland', state: 'OR' },
	{ patterns: ['boston'], locality: 'Boston', state: 'MA' },
	{ patterns: ['philadelphia', 'philly'], locality: 'Philadelphia', state: 'PA' },
	{ patterns: ['atlanta'], locality: 'Atlanta', state: 'GA' }
];

/**
 * Hints this short are also ordinary words, place-name prefixes and state
 * codes: 'LA' is Louisiana and the first word of 'La Crosse', 'la' is a Spanish
 * article, 'DC' is direct current, 'SF' heads a federal grant form. Matching
 * one bare would rewrite what the agent researches, so a hint of this length
 * has to be corroborated. Longer patterns carry their own evidence and keep
 * matching case-insensitively.
 */
const AMBIGUOUS_ABBREVIATION_LENGTH = 2;

/**
 * Municipal vocabulary that marks the text as naming a jurisdiction rather than
 * using the abbreviation as a word. One of these, or the hint's own state, has
 * to be present before a two-letter abbreviation counts as locality evidence.
 */
const LOCALITY_CORROBORATION = [
	'city',
	'county',
	'council',
	'mayor',
	'supervisors',
	'alderman',
	'aldermen',
	'commissioners',
	'borough',
	'township',
	'municipal',
	'metro',
	'metropolitan',
	'neighborhood',
	'school district',
	'board of education'
];

function escapeForPattern(phrase: string): string {
	return phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase: string): RegExp {
	return new RegExp(`(^|[^a-z0-9])${escapeForPattern(phrase)}([^a-z0-9]|$)`, 'i');
}

function textContainsPhrase(text: string, phrase: string): boolean {
	return phrasePattern(phrase).test(text);
}

/**
 * An abbreviation only counts in its uppercase form, so the title-case prefix
 * of 'La Crosse' and the lowercase Spanish article never read as 'LA'.
 */
function textContainsAbbreviation(text: string, abbreviation: string): boolean {
	const escaped = escapeForPattern(abbreviation.toUpperCase());
	return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`).test(text);
}

/**
 * A state signal that is itself the abbreviation cannot corroborate it — 'DC'
 * and its display name would otherwise vouch for every bare 'DC'.
 */
function textNamesState(text: string, state: string, abbreviation: string): boolean {
	if (!textContainsPhrase(state, abbreviation) && textContainsAbbreviation(text, state))
		return true;
	const stateName = getStateName(state);
	return !textContainsPhrase(stateName, abbreviation) && textContainsPhrase(text, stateName);
}

function hintMatchesText(text: string, hint: LocalityHint): boolean {
	return hint.patterns.some((pattern) => {
		if (pattern.length > AMBIGUOUS_ABBREVIATION_LENGTH) return textContainsPhrase(text, pattern);
		if (!textContainsAbbreviation(text, pattern)) return false;
		return (
			LOCALITY_CORROBORATION.some((word) => textContainsPhrase(text, word)) ||
			textNamesState(text, hint.state, pattern)
		);
	});
}

function stateScope(state: string): GeoScope {
	const display = getStateName(state);
	return {
		type: 'subnational',
		country: 'US',
		subdivision: `US-${state}`,
		displayName: `${display}, United States`
	};
}

function localityScope(locality: string, state?: string): GeoScope {
	const stateName = state ? getStateName(state) : null;
	return {
		type: 'subnational',
		country: 'US',
		subdivision: state ? `US-${state}` : undefined,
		locality,
		displayName: stateName
			? `${locality}, ${stateName}, United States`
			: `${locality}, United States`
	};
}

/** The US state code named in `text`, matched on word boundaries. */
export function extractUsState(text: string): string | null {
	for (const [name, code] of Object.entries(US_STATES)) {
		if (textContainsPhrase(text, name)) return code;
	}
	const uppercaseMatches = text.match(/\b[A-Z]{2}\b/g) ?? [];
	for (const code of uppercaseMatches) {
		if (STATE_CODES.has(code)) return code;
	}
	return null;
}

/** The US locality named in `text`, with its state when one is inferable. */
export function extractUsLocality(text: string): { locality: string; state?: string } | null {
	for (const hint of US_LOCALITY_HINTS) {
		if (hintMatchesText(text, hint)) {
			return { locality: hint.locality, state: hint.state };
		}
	}

	const patterns = [
		/City of ([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/,
		/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:City Council|Board of Supervisors|Town Council|Village Board|Borough Council)/,
		/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+County/
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match?.[1]) return { locality: match[1], state: extractUsState(text) ?? undefined };
	}

	return null;
}

function evidence(scope: GeoScope, basis: string, source: ScopeEvidenceSource): ScopeEvidence {
	return {
		scope,
		label: displayGeoScope(scope),
		basis,
		source
	};
}

/** Heuristic geographic scope. The UI marks this as partial, never as a hard jurisdiction resolver. */
export function inferGeoScope(input: {
	decisionMakers: Array<{ organization?: string | null }>;
	audienceGuidance?: string;
}): ScopeEvidence {
	const { decisionMakers, audienceGuidance } = input;

	if (decisionMakers.length > 0) {
		const orgs = decisionMakers.map((dm) => dm.organization || '').filter(Boolean);
		const localities = orgs
			.map(extractUsLocality)
			.filter((l): l is { locality: string; state?: string } => l !== null);
		if (localities.length === orgs.length) {
			const localKeys = new Set(localities.map((l) => `${l.locality}:${l.state ?? ''}`));
			if (localKeys.size === 1) {
				const local = localities[0];
				return evidence(
					localityScope(local.locality, local.state),
					'Inferred from the common locality across resolved decision-maker organizations.',
					'resolved-targets'
				);
			}
		}

		const states = orgs.map(extractUsState).filter((state): state is string => state !== null);
		if (states.length === orgs.length) {
			const uniqueStates = [...new Set(states)];
			if (uniqueStates.length === 1) {
				return evidence(
					stateScope(uniqueStates[0]),
					'Inferred from the common state across resolved decision-maker organizations.',
					'resolved-targets'
				);
			}
		}

		const federalPatterns =
			/\b(U\.?S\.?|United States|Congress|Senate|House of Representatives|Federal)\b/i;
		if (orgs.length > 0 && orgs.every((org) => federalPatterns.test(org))) {
			return evidence(
				{ type: 'nationwide', country: 'US', displayName: 'United States' },
				'Inferred from federal/national decision-maker organizations.',
				'resolved-targets'
			);
		}
	}

	const guidance = (audienceGuidance ?? '').trim();
	if (guidance) {
		const guidedLocality = extractUsLocality(guidance);
		if (guidedLocality) {
			return evidence(
				localityScope(guidedLocality.locality, guidedLocality.state),
				'Inferred from operator audience guidance; resolved targets remain the stronger evidence.',
				'audience-guidance'
			);
		}
		const guidedState = extractUsState(guidance);
		if (guidedState) {
			return evidence(
				stateScope(guidedState),
				'Inferred from operator audience guidance; resolved targets remain the stronger evidence.',
				'audience-guidance'
			);
		}
	}

	return evidence(
		{ type: 'nationwide', country: 'US', displayName: 'United States' },
		'No common local/state scope was inferable; source discovery used the explicit nationwide US fallback.',
		'fallback'
	);
}
