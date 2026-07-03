/**
 * Atlas-native geocoder (SEAM-CONTRACT v1 — atlas-address-index).
 *
 * Resolves a structured US address to coordinates entirely from our own R2
 * artifacts: normalize the street line (§3), fetch the ZIP5 chunk (§1), then
 * run the deterministic match ladder (§2):
 *
 *   exact point → parity-matched range interpolation → ZIP centroid
 *
 * A raw address NEVER leaves infrastructure we control: no third-party
 * geocoding call, and even the match-outcome metric carries only a hash of
 * the normalized input, never the address itself.
 *
 * The normalization TABLES (directionals, suffixes, secondary units) are
 * shipped DATA fetched from the artifact (`addresses/normalization.json`) —
 * never vendored here. This module implements only the ALGORITHM; the
 * `normVersion === 1` handshake in the store fails loudly on skew.
 *
 * NO cross-repo import — the producer (shadow-atlas ingest pipeline) and this
 * consumer couple only through the published R2 artifact schema. Any
 * divergence is a correctness bug; any contract change is a schema-version
 * bump, never a silent edit.
 */

import {
	getAddressChunk,
	getNormalizationTable,
	type AddressChunkFile,
	type NormalizationTable,
} from './ipfs-store';

/**
 * EXACT geocode-miss message. API layers key their 404 GEOCODE_MISS mapping
 * on the 'Address not found' substring — change this string and every miss
 * becomes a 502. A miss is honest: no chunk for the ZIP (or no ZIP5 at all)
 * means no result — never a fabricated coordinate.
 */
export const ADDRESS_NOT_FOUND_MESSAGE =
	'Address not found. Please check your address and try again.';

/** §5 match classes: how precisely the ladder placed the address. */
export type GeocodeMatchClass = 'point' | 'range' | 'zip';

export interface GeocodeResult {
	lat: number;
	lng: number;
	matchClass: GeocodeMatchClass;
	/** Compact canonical form of what was actually matched (never fabricated parts). */
	matchedAddress: string;
}

// ============================================================================
// Match-outcome metric (day-one hard condition: the confidence fail-down
// must never mask misses)
// ============================================================================

/** Per-resolve match outcome. `zip_fallback` = honest 0.6 centroid, `miss` = no result. */
export type MatchOutcome = 'exact' | 'range' | 'zip_fallback' | 'miss';

export interface MatchOutcomeEvent {
	outcome: MatchOutcome;
	/** First 16 hex chars of SHA-256(`${normalizedStreet}|${zip5}`) — NEVER the raw address. */
	normHash: string;
	ts: string;
}

type MatchOutcomeSink = (event: MatchOutcomeEvent) => void;

/**
 * Default sink: one structured single-line log, visible in CF Pages log
 * streams. Zero new infrastructure.
 */
const defaultMatchOutcomeSink: MatchOutcomeSink = (event) => {
	console.info('[atlas-geocoder.match]', JSON.stringify(event));
};

let matchOutcomeSink: MatchOutcomeSink = defaultMatchOutcomeSink;

/** Swap the metric sink (tests / future structured-metrics rail). Pass nothing to restore the default. */
export function setMatchOutcomeSink(sink?: MatchOutcomeSink | null): void {
	matchOutcomeSink = sink ?? defaultMatchOutcomeSink;
}

/**
 * Emit one match-outcome event. The payload is outcome + hash only: the
 * normalized street|zip5 digest identifies repeat misses for triage without
 * ever writing an address to a log line. The metric is best-effort — it can
 * never break a resolution.
 */
export function emitMatchOutcome(outcome: MatchOutcome, normHash: string): void {
	try {
		matchOutcomeSink({ outcome, normHash, ts: new Date().toISOString() });
	} catch {
		// A metric sink failure must never fail the resolve.
	}
}

/** First 16 hex of SHA-256 over `${normalizedStreet}|${zip5}` via WebCrypto. */
async function hashNormalizedInput(normalizedStreet: string, zip5: string): Promise<string> {
	const bytes = new TextEncoder().encode(`${normalizedStreet}|${zip5}`);
	const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
	let hex = '';
	for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
	return hex.slice(0, 16);
}

// ============================================================================
// §3 street-line normalization (algorithm here, tables from the artifact)
// ============================================================================

/** House-number token: digits, hyphenated (112-10), or fractional (1/2). */
const HOUSE_NUMBER_TOKEN = /^\d+(-\d+)?$|^\d+\/\d+$/;

/**
 * A secondary-unit VALUE token: something that reads as a unit designation
 * (`5`, `200B`, `#4`, `B`), never a street word. Requiring a digit or a
 * single letter keeps `TRAILER LN` (street named Trailer Lane) from being
 * eaten as designator+value while still stripping `APT 5B` / `STE 200`.
 */
const UNIT_VALUE_TOKEN = /^#?\d[\dA-Z/-]*$|^[A-Z]$/;

/**
 * Normalize a street line to its §3 chunk key. Idempotent by contract:
 * `normalizeStreet(normalizeStreet(x), t) === normalizeStreet(x, t)`.
 *
 * Steps (normative, byte-identical on both sides of the seam):
 *   1. Unicode NFD → strip combining marks → ASCII uppercase.
 *   2. Strip punctuation (`.` `,` `'`) except intra-token hyphens; collapse
 *      whitespace to single spaces; trim.
 *   3. Tokenize on spaces. Strip the leading house-number token(s).
 *   4. Strip trailing secondary-unit designator + value (Pub 28 C2), plus any
 *      TRAILING bare value-less designator (the `unitsWithoutValue` set
 *      shipped in normalization.json).
 *   5. Map directional tokens in leading and trailing position (Pub 28 B).
 *   6. Map the final remaining token through the suffix table (Pub 28 C1);
 *      when the final token is a mapped trailing directional and more than
 *      two tokens remain, the lookup applies to the SECOND-TO-LAST token
 *      (Pub 28 keeps the directional last: PENNSYLVANIA AVENUE NW →
 *      PENNSYLVANIA AVE NW).
 *   7. Join with single spaces.
 */
export function normalizeStreet(input: string, table: NormalizationTable): string {
	const units = new Set(table.units);
	const unitsWithoutValue = new Set(table.unitsWithoutValue);

	// 1. NFD → strip combining marks → ASCII uppercase.
	let s = input
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toUpperCase();

	// 2. Strip `.` `,` `'`; collapse whitespace; trim. Hyphens survive only
	//    inside tokens (leading/trailing hyphens are trimmed per token below).
	s = s.replace(/[.,']/g, '').replace(/\s+/g, ' ').trim();

	// 3. Tokenize; trim token-edge hyphens; drop empties; strip leading
	//    house-number token(s).
	let tokens = s
		.split(' ')
		.map((t) => t.replace(/^-+|-+$/g, ''))
		.filter((t) => t.length > 0);

	while (tokens.length > 1 && HOUSE_NUMBER_TOKEN.test(tokens[0])) {
		tokens = tokens.slice(1);
	}

	// 4. Strip trailing secondary-unit designator + its value. Loop: an input
	//    like `MAIN ST APT 5 REAR` sheds `REAR`, then `APT 5`.
	let stripped = true;
	while (stripped && tokens.length > 1) {
		stripped = false;
		const last = tokens[tokens.length - 1];
		const prev = tokens.length >= 2 ? tokens[tokens.length - 2] : undefined;
		if (last.startsWith('#') && last.length > 1) {
			// `#5` — designator and value fused into one token.
			tokens = tokens.slice(0, -1);
			stripped = true;
		} else if (
			prev !== undefined &&
			tokens.length > 2 &&
			units.has(prev) &&
			UNIT_VALUE_TOKEN.test(last)
		) {
			tokens = tokens.slice(0, -2);
			stripped = true;
		} else if (unitsWithoutValue.has(last)) {
			tokens = tokens.slice(0, -1);
			stripped = true;
		}
	}

	// 5. Directionals in leading and trailing position.
	if (tokens.length > 1) {
		const lead = table.directionals[tokens[0]];
		if (lead !== undefined) tokens[0] = lead;
	}
	if (tokens.length > 1) {
		const trail = table.directionals[tokens[tokens.length - 1]];
		if (trail !== undefined) tokens[tokens.length - 1] = trail;
	}

	// 6. Final remaining token through the suffix table. When the final token
	//    is a mapped trailing directional (e.g. `BAY AVE N`), Pub 28 keeps the
	//    directional last — the suffix then sits second-to-last; map that one.
	if (tokens.length > 1) {
		const lastIdx = tokens.length - 1;
		const isTrailingDirectional = table.directionals[tokens[lastIdx]] !== undefined;
		const suffixIdx = isTrailingDirectional && tokens.length > 2 ? lastIdx - 1 : lastIdx;
		if (suffixIdx > 0) {
			const mapped = table.suffixes[tokens[suffixIdx]];
			if (mapped !== undefined) tokens[suffixIdx] = mapped;
		}
	}

	// 7. Join with single spaces.
	return tokens.join(' ');
}

/**
 * Extract the house-number key from a raw street line (§2): the leading
 * house-number token(s), leading zeros stripped from the leading integer
 * segment only; hyphenated (`112-10`) and fractional (`123 1/2`) forms kept
 * literally. Returns null when the line does not start with a house number.
 */
function houseNumberKeyOf(rawStreet: string): string | null {
	const tokens = rawStreet
		.toUpperCase()
		.replace(/[.,']/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ');

	const parts: string[] = [];
	for (const token of tokens) {
		if (HOUSE_NUMBER_TOKEN.test(token)) parts.push(token);
		else break;
	}
	if (parts.length === 0) return null;
	return parts.join(' ').replace(/^0+(?=\d)/, '');
}

/** Leading-integer parse for range comparison (§2). Null for non-numeric forms. */
function parseLeadingInteger(houseNumberKey: string): number | null {
	const m = houseNumberKey.match(/^(\d+)/);
	if (!m) return null;
	const n = Number.parseInt(m[1], 10);
	return Number.isSafeInteger(n) ? n : null;
}

// ============================================================================
// §2 match ladder
// ============================================================================

/** Round to the contract's pinned 5 decimal places (~1.1 m). */
function round5(v: number): number {
	return Math.round(v * 1e5) / 1e5;
}

/**
 * §5 precision → confidence factor. These are the same bands the resolver's
 * confidence maths always used (housenumber-grade 1.0, street-grade 0.85,
 * locality floor 0.6); the matchClass now names them honestly.
 */
export function matchClassPrecision(matchClass: GeocodeMatchClass): number {
	switch (matchClass) {
		case 'point':
			return 1.0;
		case 'range':
			return 0.85;
		case 'zip':
			return 0.6;
	}
}

/**
 * Run the §2 ladder inside a fetched chunk. Pure: no I/O, no metric.
 */
function runMatchLadder(
	chunk: AddressChunkFile,
	normalizedStreet: string,
	houseNumberKey: string | null,
): { lat: number; lng: number; matchClass: GeocodeMatchClass } {
	const record = chunk.streets[normalizedStreet];

	if (record && houseNumberKey !== null) {
		// Rung 1: exact point key (leading zeros stripped; hyphenated and
		// fractional forms kept literally).
		const point = record.p?.[houseNumberKey];
		if (point) {
			return { lat: point[0], lng: point[1], matchClass: 'point' };
		}

		// Rung 2: parity-matched range interpolation. Eligibility: `E`/`O` per
		// house-number parity, `B` always. Multiple hits → smallest span
		// (toHn − fromHn), tie → lowest fromHn.
		const hn = parseLeadingInteger(houseNumberKey);
		if (hn !== null && record.r) {
			const parityOfHn = hn % 2 === 0 ? 'E' : 'O';
			const hits = record.r.filter(
				([fromHn, toHn, parity]) =>
					hn >= fromHn && hn <= toHn && (parity === 'B' || parity === parityOfHn),
			);
			if (hits.length > 0) {
				hits.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]) || a[0] - b[0]);
				const [fromHn, toHn, , fromLat, fromLng, toLat, toLng] = hits[0];
				// Pinned interpolation: t = (hn − fromHn) / (toHn − fromHn);
				// t = 0.5 when toHn === fromHn; round to 5 dp.
				const t = toHn === fromHn ? 0.5 : (hn - fromHn) / (toHn - fromHn);
				return {
					lat: round5(fromLat + t * (toLat - fromLat)),
					lng: round5(fromLng + t * (toLng - fromLng)),
					matchClass: 'range',
				};
			}
		}
	}

	// Rung 3: ZIP centroid — an honest, real location at locality precision.
	return { lat: chunk.zipCentroid[0], lng: chunk.zipCentroid[1], matchClass: 'zip' };
}

// ============================================================================
// geocodeAddress — the atlas-native step 1
// ============================================================================

/**
 * Geocode a structured US address from the atlas address index.
 *
 * - ZIP5 is derived from the leading `\d{5}` of `zip`; underivable → miss.
 * - An empty street (the person-layer postal path) skips the ladder straight
 *   to the honest ZIP-grade centroid.
 * - City/state NEVER gate a ZIP-keyed match: a mismatch is logged (states
 *   only — no address egress, not even into our own logs) and the ZIP wins.
 * - A miss (no chunk / no ZIP5) throws the EXACT 'Address not found…'
 *   message — never a fabricated coordinate. Schema violations fail closed
 *   as AddressIndexSchemaError; network faults propagate for the caller to
 *   classify as infrastructure (never converted into a miss here).
 * - Every completed call emits one match-outcome metric (exact | range |
 *   zip_fallback | miss), hash-only payload, including before the miss throw.
 */
export async function geocodeAddress(address: {
	street: string;
	city: string;
	state: string;
	zip: string;
	country?: string;
}): Promise<GeocodeResult> {
	const { street, city, state, zip } = address;
	const country = address.country ?? 'US';

	const zip5 = zip.trim().match(/^(\d{5})/)?.[1] ?? null;

	// Normalize the street line. Empty street (person-layer path) normalizes
	// to '' without needing the tables; a table fetch failure is a real
	// fail-loud (schema) or infra fault, never silently skipped.
	const normalizedStreet =
		street.trim() === '' ? '' : normalizeStreet(street, await getNormalizationTable(country));

	if (zip5 === null) {
		emitMatchOutcome('miss', await hashNormalizedInput(normalizedStreet, ''));
		throw new Error(ADDRESS_NOT_FOUND_MESSAGE);
	}

	const normHash = await hashNormalizedInput(normalizedStreet, zip5);

	const chunk = await getAddressChunk(zip5, country);
	if (chunk === null) {
		// Clean 404: the index has no chunk for this ZIP — an honest miss
		// (MISS signal), categorically distinct from an infra fault.
		emitMatchOutcome('miss', normHash);
		throw new Error(ADDRESS_NOT_FOUND_MESSAGE);
	}

	// City/state mismatch never gates a ZIP-keyed match (§2). Log states only.
	if (state && chunk.state && state.trim().toUpperCase() !== chunk.state.toUpperCase()) {
		console.warn(
			`[atlas-geocoder] state mismatch for ZIP ${zip5}: input ${state.trim().toUpperCase()}, chunk ${chunk.state} — proceeding on ZIP`,
		);
	}

	if (normalizedStreet === '') {
		emitMatchOutcome('zip_fallback', normHash);
		return {
			lat: chunk.zipCentroid[0],
			lng: chunk.zipCentroid[1],
			matchClass: 'zip',
			matchedAddress: compactAddress(null, null, city, chunk.state, zip5),
		};
	}

	const houseNumberKey = houseNumberKeyOf(street);
	const match = runMatchLadder(chunk, normalizedStreet, houseNumberKey);

	emitMatchOutcome(match.matchClass === 'point' ? 'exact' : match.matchClass === 'range' ? 'range' : 'zip_fallback', normHash);

	return {
		lat: match.lat,
		lng: match.lng,
		matchClass: match.matchClass,
		matchedAddress:
			match.matchClass === 'zip'
				? compactAddress(null, null, city, chunk.state, zip5)
				: compactAddress(houseNumberKey, normalizedStreet, city, chunk.state, zip5),
	};
}

/**
 * Compact canonical matched-address string ("1600 PENNSYLVANIA AVE NW,
 * WASHINGTON, DC, 20500"). Only components the match actually used appear:
 * a ZIP-centroid match carries no street part (the street was NOT matched).
 * State comes from the chunk (authoritative for the ZIP), never the input.
 */
function compactAddress(
	houseNumberKey: string | null,
	normalizedStreet: string | null,
	city: string,
	chunkState: string,
	zip5: string,
): string {
	const streetPart =
		normalizedStreet && normalizedStreet.length > 0
			? `${houseNumberKey ? `${houseNumberKey} ` : ''}${normalizedStreet}`
			: null;
	const cityPart = city.trim().toUpperCase();
	const parts = [streetPart, cityPart || null, chunkState.toUpperCase(), zip5];
	return parts.filter((p): p is string => p !== null && p.length > 0).join(', ');
}
