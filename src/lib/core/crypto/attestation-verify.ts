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
