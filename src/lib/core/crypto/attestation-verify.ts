/**
 * Browser-side attestation hash verifier (T8-3).
 *
 * Mirrors `canonicalPreimage` + `sha256Hex` from
 * src/lib/server/email/report-template.ts so a staffer can recompute the
 * attestation digest in the browser from the preimage fields and confirm
 * the value matches what the platform claims.
 *
 * The preimage format MUST stay in sync with the server-side function —
 * any drift breaks verification. See REPORT-ATTESTATION-SPEC at
 * voter-protocol/specs.
 */

export interface AttestationPreimage {
	campaignId: string;
	campaignTitle: string;
	orgName: string;
	verified: number;
	districtCount: number;
	identityBreakdown: { govId: number; addressVerified: number; emailOnly: number } | null;
	authorship: { individual: number; shared: number; explicit: boolean };
	dateRange: { earliest: string; latest: string; spanDays: number };
	geography: Array<{ hash: string; count: number }> | null;
	debate?: {
		marketPosition: string;
		totalStake: string;
		topArgumentScore: string;
		aiPanelConsensus: number | null;
		participantCount: number | null;
		resolutionHash: string | null;
	} | null;
}

export function buildCanonicalPreimage(input: AttestationPreimage): string {
	const ib = input.identityBreakdown
		? `${input.identityBreakdown.govId}|${input.identityBreakdown.addressVerified}|${input.identityBreakdown.emailOnly}`
		: '';
	const geo = (input.geography ?? [])
		.slice()
		.sort((a, b) =>
			b.count !== a.count ? b.count - a.count : a.hash.localeCompare(b.hash)
		)
		.map((g) => `${g.hash}=${g.count}`)
		.join(',');
	const debatePreimage = input.debate
		? [
				input.debate.marketPosition,
				input.debate.totalStake,
				input.debate.topArgumentScore,
				input.debate.aiPanelConsensus === null ? '' : String(input.debate.aiPanelConsensus),
				input.debate.participantCount === null ? '' : String(input.debate.participantCount),
				input.debate.resolutionHash ?? ''
			].join('|')
		: '';
	return [
		'voter-protocol-report-v1',
		`campaign:${input.campaignId}`,
		input.campaignTitle,
		input.orgName,
		String(input.verified),
		String(input.districtCount),
		ib,
		`${input.authorship.individual}|${input.authorship.shared}|${input.authorship.explicit ? 1 : 0}`,
		`${input.dateRange.earliest}|${input.dateRange.latest}|${input.dateRange.spanDays}`,
		geo,
		debatePreimage
	].join('\n---\n');
}

// ===========================================================================
// Recipient-supplied preimage parsing.
//
// The public /v/[hash] surface is K-anonymized and CANNOT reconstruct the exact
// preimage the committed digest was computed over. So the recipient is the
// oracle: they paste the "Verify offline" block their report email printed
// (report-template.ts renderText), and we reconstruct the AttestationPreimage
// struct from it — then `buildCanonicalPreimage` (the SSOT) produces the exact
// bytes, including the trailing empty debate field. The server never re-publishes
// exact counts, so K-anonymity is preserved while verification becomes real.
//
// Display-token mapping mirrors report-template.ts exactly:
//   identity `(no identity breakdown)` / '' → null
//   geography `(empty)` / ''               → []
//   debate   `(no debate)` / '' / absent   → null
// ===========================================================================

const IDENTITY_EMPTY = '(no identity breakdown)';
const GEO_EMPTY = '(empty)';
const DEBATE_EMPTY = '(no debate)';

// Parse a REQUIRED numeric field. Number('')/(' ') are 0 — both finite — so a
// blank would silently become 0 and corrupt the preimage into a FALSE mismatch.
// Reject blank + non-finite so a malformed paste is a typed parse ERROR (rendered
// neutral), not a wrong "✗ Mismatch".
function strictNum(raw: string, field: string): number {
	if (raw.trim() === '') throw new Error(`${field} must not be blank`);
	const n = Number(raw);
	if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
	return n;
}

// Optional numeric: '' is a legitimate null sentinel; a non-empty value must be finite.
function strictNumOrNull(raw: string, field: string): number | null {
	if (raw === '') return null;
	const n = Number(raw);
	if (!Number.isFinite(n)) throw new Error(`${field} must be a number`);
	return n;
}

export function parseIdentity(
	s: string
): { govId: number; addressVerified: number; emailOnly: number } | null {
	const t = s.trim();
	if (t === '' || t === IDENTITY_EMPTY) return null;
	const parts = t.split('|');
	if (parts.length !== 3) throw new Error('identity must be govId|addressVerified|emailOnly');
	const govId = strictNum(parts[0], 'govId');
	const addressVerified = strictNum(parts[1], 'addressVerified');
	const emailOnly = strictNum(parts[2], 'emailOnly');
	return { govId, addressVerified, emailOnly };
}

export function parseAuthorship(s: string): {
	individual: number;
	shared: number;
	explicit: boolean;
} {
	const parts = s.trim().split('|');
	if (parts.length !== 3) throw new Error('authorship must be individual|shared|explicit');
	const individual = strictNum(parts[0], 'individual');
	const shared = strictNum(parts[1], 'shared');
	return { individual, shared, explicit: parts[2] === '1' };
}

export function parseDateRange(s: string): {
	earliest: string;
	latest: string;
	spanDays: number;
} {
	const parts = s.trim().split('|');
	if (parts.length !== 3) throw new Error('date range must be earliest|latest|spanDays');
	const spanDays = strictNum(parts[2], 'spanDays');
	return { earliest: parts[0], latest: parts[1], spanDays };
}

export function parseGeography(s: string): Array<{ hash: string; count: number }> {
	const t = s.trim();
	if (t === '' || t === GEO_EMPTY) return [];
	return t.split(',').map((pair) => {
		const eq = pair.lastIndexOf('=');
		if (eq <= 0) throw new Error(`geography pair "${pair}" must be hash=count`);
		const hash = pair.slice(0, eq);
		const count = strictNum(pair.slice(eq + 1), `geography count for "${hash}"`);
		return { hash, count };
	});
}

export function parseDebate(s: string): AttestationPreimage['debate'] {
	const t = s.trim();
	if (t === '' || t === DEBATE_EMPTY) return null;
	const p = t.split('|');
	if (p.length !== 6) throw new Error('debate must be 6 pipe-joined fields');
	return {
		marketPosition: p[0],
		totalStake: p[1],
		topArgumentScore: p[2],
		aiPanelConsensus: strictNumOrNull(p[3], 'aiPanelConsensus'),
		participantCount: strictNumOrNull(p[4], 'participantCount'),
		resolutionHash: p[5] === '' ? null : p[5]
	};
}

/**
 * Tolerant parser for the email's "Verify offline" block. Locates the
 * `voter-protocol-report-v1` marker and reads the fields that follow it
 * POSITIONALLY (an empty title/org/identity/geography is a blank line, not a
 * skipped one). Returns the reconstructed struct or a typed error — never a
 * silent partial that would false-mismatch.
 */
export function parseOfflineVerifyBlock(text: string): AttestationPreimage | { error: string } {
	try {
		const lines = text.split('\n').map((l) => l.trim());
		const marker = lines.indexOf('voter-protocol-report-v1');
		if (marker === -1) {
			return {
				error:
					'Could not find the verification block. Paste the whole "Verify offline" section from your report email.'
			};
		}
		const f = lines.slice(marker + 1, marker + 10);
		if (f.length < 9) {
			return { error: 'The verification block is incomplete (need 9 fields after the header).' };
		}
		const [campaignLine, title, org, verifiedStr, districtStr, ibStr, authStr, dateStr, geoStr] = f;
		const verified = Number(verifiedStr);
		const districtCount = Number(districtStr);
		if (!Number.isFinite(verified) || !Number.isFinite(districtCount)) {
			return { error: 'Verified actions and districts must be numbers.' };
		}
		// Optional 10th field — debate. The block omits it for non-debate campaigns;
		// absent → null (matches the committed digest's empty debate field).
		const debateLine = lines[marker + 10];
		return {
			campaignId: campaignLine.startsWith('campaign:')
				? campaignLine.slice('campaign:'.length)
				: campaignLine,
			campaignTitle: title,
			orgName: org,
			verified,
			districtCount,
			identityBreakdown: parseIdentity(ibStr),
			authorship: parseAuthorship(authStr),
			dateRange: parseDateRange(dateStr),
			geography: parseGeography(geoStr),
			debate: debateLine !== undefined ? parseDebate(debateLine) : null
		};
	} catch (e) {
		return { error: e instanceof Error ? e.message : 'Could not parse the verification block.' };
	}
}

export async function computeAttestationHash(input: AttestationPreimage): Promise<string> {
	const preimage = buildCanonicalPreimage(input);
	const bytes = new TextEncoder().encode(preimage);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Constant-time string equality for hash comparison. Hex strings always
 * have the same length, but use constant-time anyway to harden against
 * timing oracles from browser dev tools or content scripts.
 */
export function hashesEqual(a: string, b: string): boolean {
	const an = a.trim().toLowerCase();
	const bn = b.trim().toLowerCase();
	if (an.length !== bn.length) return false;
	let result = 0;
	for (let i = 0; i < an.length; i++) {
		result |= an.charCodeAt(i) ^ bn.charCodeAt(i);
	}
	return result === 0;
}
