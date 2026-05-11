import type { VerificationPacket } from '$lib/types/verification-packet';
import { escapeHtml } from './escape';

interface ReportContext {
	campaignId: string;
	campaignTitle: string;
	orgName: string;
	packet: VerificationPacket;
	verificationUrl: string;
}

export interface RenderedReport {
	html: string;
	text: string;
	attestationHash: string;
	subject: string;
}

function fmtDate(iso: string): string {
	// Anchor to UTC explicitly so a worker rotating regions does not shift the
	// rendered date by ±1 day.
	const d = new Date(iso + 'T00:00:00Z');
	return d.toLocaleDateString('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

// Email-safe ratio bar via table cells. Outlook/Gmail/Apple Mail compatible.
function ratioBar(
	segments: Array<{ pct: number; color: string }>,
	height: number = 4
): string {
	const cells = segments
		.filter((s) => s.pct > 0)
		.map(
			(s) =>
				`<td style="width:${s.pct}%;height:${height}px;background-color:${s.color};font-size:0;line-height:0;">&nbsp;</td>`
		)
		.join('');

	return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:2px;overflow:hidden;"><tr>${cells}</tr></table>`;
}

// Canonical preimage for the attestation hash. Includes the substrate fields a
// staffer reads in the email so any silent change shifts the hash. Domain-
// prefixed (`voter-protocol-report-v1`) so future preimage changes cut a clean
// version line. The verificationUrl is intentionally NOT in the preimage —
// it is environment-coupled (PUBLIC_BASE_URL differs per deployment) and
// would make staging vs prod hashes diverge for the same data; we use the
// deployment-agnostic `campaignId` instead.
export function canonicalPreimage(ctx: ReportContext): string {
	const { campaignId, campaignTitle, orgName, packet } = ctx;
	const { verified, districtCount, authorship, dateRange, identityBreakdown, geography } = packet;
	const ib = identityBreakdown
		? `${identityBreakdown.govId}|${identityBreakdown.addressVerified}|${identityBreakdown.emailOnly}`
		: '';
	// Sort by count desc (matches the visible bar-chart ordering) with hash
	// ascending as tiebreaker (deterministic when counts tie). Without this
	// alignment a malicious input could permute the visible chart away from
	// the hashed ordering while the hash held  — see hash-ordering note.
	const geo = (geography ?? [])
		.slice()
		.sort((a, b) =>
			b.count !== a.count ? b.count - a.count : a.hash.localeCompare(b.hash),
		)
		.map((g) => `${g.hash}=${g.count}`)
		.join(',');
	return [
		'voter-protocol-report-v1',
		`campaign:${campaignId}`,
		campaignTitle,
		orgName,
		String(verified),
		String(districtCount),
		ib,
		`${authorship.individual}|${authorship.shared}|${authorship.explicit ? 1 : 0}`,
		`${dateRange.earliest}|${dateRange.latest}|${dateRange.spanDays}`,
		geo
	].join('\n---\n');
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function renderHtml(ctx: ReportContext, attestationHash: string): string {
	const { campaignTitle, orgName, packet, verificationUrl } = ctx;
	const { verified, districtCount, authorship, dateRange, identityBreakdown } = packet;

	let identityHtml = '';
	if (identityBreakdown) {
		const total = identityBreakdown.govId + identityBreakdown.addressVerified + identityBreakdown.emailOnly;
		if (total > 0) {
			const parts: string[] = [];
			if (identityBreakdown.govId > 0) parts.push(`${identityBreakdown.govId} government ID`);
			if (identityBreakdown.addressVerified > 0) parts.push(`${identityBreakdown.addressVerified} address verified`);
			if (identityBreakdown.emailOnly > 0) parts.push(`${identityBreakdown.emailOnly} email`);

			const bar = ratioBar([
				{ pct: Math.round((identityBreakdown.govId / total) * 100), color: '#10b981' },
				{ pct: Math.round((identityBreakdown.addressVerified / total) * 100), color: '#3bc4b8' },
				{ pct: Math.round((identityBreakdown.emailOnly / total) * 100), color: '#d4d4d4' }
			]);

			identityHtml = `
          <tr>
            <td style="padding:12px 0 4px 0;">
              <p style="margin:0;font-size:13px;color:#525252;">${escapeHtml(parts.join(' · '))}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 8px 0;">${bar}</td>
          </tr>`;
		}
	}

	let authorshipHtml = '';
	const authorTotal = authorship.individual + authorship.shared;
	if (authorTotal > 0) {
		const parts: string[] = [];
		if (authorship.individual > 0) {
			parts.push(`${authorship.individual} ${authorship.explicit ? 'individually composed' : 'distinct messages'}`);
		}
		if (authorship.shared > 0) {
			parts.push(`${authorship.shared} shared ${authorship.shared === 1 ? 'statement' : 'statements'}`);
		}

		const bar = ratioBar([
			{ pct: Math.round((authorship.individual / authorTotal) * 100), color: '#10b981' },
			{ pct: Math.round((authorship.shared / authorTotal) * 100), color: '#d4d4d4' }
		]);

		authorshipHtml = `
          <tr>
            <td style="padding:4px 0 4px 0;">
              <p style="margin:0;font-size:13px;color:#525252;">${escapeHtml(parts.join(' · '))}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 8px 0;">${bar}</td>
          </tr>`;
	}

	let geographyHtml = '';
	if (packet.geography && packet.geography.length > 1) {
		const geoTotal = packet.geography.reduce((s, d) => s + d.count, 0);
		// Same sort as the canonical preimage so what the staffer sees in the
		// bar chart is the same ordering bound by the attestation hash.
		const sortedGeography = packet.geography
			.slice()
			.sort((a, b) =>
				b.count !== a.count ? b.count - a.count : a.hash.localeCompare(b.hash),
			);
		const topDistricts = sortedGeography.slice(0, 8);

		const bar = ratioBar(
			topDistricts.map((d, i) => ({
				pct: Math.round((d.count / geoTotal) * 100),
				color: i === 0 ? '#3bc4b8' : `rgba(59,196,184,${Math.max(0.25, 0.8 - i * 0.08)})`
			}))
		);

		geographyHtml = `
          <tr>
            <td style="padding:4px 0 4px 0;">
              <p style="margin:0;font-size:13px;color:#525252;">${districtCount} ${districtCount === 1 ? 'community' : 'communities'} represented</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 8px 0;">${bar}</td>
          </tr>`;
	} else {
		geographyHtml = `
          <tr>
            <td style="padding:4px 0 8px 0;">
              <p style="margin:0;font-size:13px;color:#525252;">${districtCount} ${districtCount === 1 ? 'community' : 'communities'} represented</p>
            </td>
          </tr>`;
	}

	let temporalHtml = '';
	if (dateRange.spanDays > 0) {
		temporalHtml = `
          <tr>
            <td style="padding:4px 0 8px 0;">
              <p style="margin:0;font-size:13px;color:#525252;">Submissions ${escapeHtml(fmtDate(dateRange.earliest))} – ${escapeHtml(fmtDate(dateRange.latest))}</p>
            </td>
          </tr>`;
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Report — ${escapeHtml(campaignTitle)}</title>
</head>
<body style="margin:0;padding:0;background-color:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafaf9;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <tr>
            <td style="padding:0 0 32px 0;">
              <p style="margin:0;font-size:12px;font-weight:600;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.08em;">
                Verification Report
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 0 8px 0;">
              <p style="margin:0;font-size:18px;font-weight:600;color:#171717;line-height:1.4;">
                ${escapeHtml(campaignTitle)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 28px 0;">
              <p style="margin:0;font-size:13px;color:#737373;">
                from ${escapeHtml(orgName)}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 0;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">
              <p style="margin:0 0 4px 0;font-size:36px;font-weight:700;color:#171717;font-family:'Courier New',Courier,monospace;">
                ${verified.toLocaleString()}
              </p>
              <p style="margin:0;font-size:15px;color:#525252;">
                verified contacts across ${districtCount} ${districtCount === 1 ? 'community' : 'communities'}
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${identityHtml}
                ${authorshipHtml}
                ${geographyHtml}
                ${temporalHtml}
                <tr>
                  <td style="padding:4px 0;">
                    <p style="margin:0;font-size:13px;color:#737373;">One submission per person. Duplicates removed.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 0 0 0;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#f5f5f4;border:1px solid #e5e5e5;border-radius:6px;padding:12px 20px;">
                    <a href="${escapeHtml(verificationUrl)}" style="font-size:13px;color:#525252;text-decoration:none;">
                      Verify these claims independently &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 0 0 0;">
              <p style="margin:0;font-size:11px;color:#a3a3a3;line-height:1.6;">
                Attestation hash · recompute the canonical preimage from the verification page to confirm this report.
              </p>
              <p style="margin:4px 0 0 0;font-size:11px;color:#525252;line-height:1.6;font-family:'Courier New',Courier,monospace;letter-spacing:0.02em;word-break:break-all;">
                sha256:${escapeHtml(attestationHash)}
              </p>
              <p style="margin:4px 0 0 0;font-size:11px;color:#a3a3a3;line-height:1.6;">
                Spec: <a href="https://github.com/communisaas/voter-protocol/blob/main/specs/REPORT-ATTESTATION-SPEC.md" style="color:#525252;text-decoration:underline;">REPORT-ATTESTATION-SPEC v1</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 0 0 0;">
              <p style="margin:0;font-size:11px;color:#a3a3a3;line-height:1.6;">
                Generated by Commons. Constituent emails are encrypted under a
                per-organization key; the platform decrypts them only at send
                time and does not retain plaintext.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderText(ctx: ReportContext, attestationHash: string): string {
	const { campaignTitle, orgName, packet, verificationUrl } = ctx;
	const { verified, districtCount, authorship, dateRange, identityBreakdown, geography } = packet;
	const rule = '─'.repeat(48);
	const lines: string[] = [];

	lines.push('VERIFICATION REPORT');
	lines.push('');
	lines.push(campaignTitle);
	lines.push(`from ${orgName}`);
	lines.push('');
	lines.push(rule);
	lines.push(
		`${verified.toLocaleString()} verified contacts across ${districtCount} ${districtCount === 1 ? 'community' : 'communities'}`
	);
	lines.push(rule);

	if (identityBreakdown) {
		const total =
			identityBreakdown.govId + identityBreakdown.addressVerified + identityBreakdown.emailOnly;
		if (total > 0) {
			lines.push('');
			lines.push('Identity composition:');
			if (identityBreakdown.govId > 0) lines.push(`  - ${identityBreakdown.govId} government ID`);
			if (identityBreakdown.addressVerified > 0)
				lines.push(`  - ${identityBreakdown.addressVerified} address verified`);
			if (identityBreakdown.emailOnly > 0) lines.push(`  - ${identityBreakdown.emailOnly} email`);
		}
	}

	const authorTotal = authorship.individual + authorship.shared;
	if (authorTotal > 0) {
		lines.push('');
		lines.push('Authorship:');
		if (authorship.individual > 0) {
			lines.push(
				`  - ${authorship.individual} ${authorship.explicit ? 'individually composed' : 'distinct messages'}`
			);
		}
		if (authorship.shared > 0) {
			lines.push(
				`  - ${authorship.shared} shared ${authorship.shared === 1 ? 'statement' : 'statements'}`
			);
		}
	}

	if (geography && geography.length > 0) {
		const geoTotal = geography.reduce((s, d) => s + d.count, 0);
		const sorted = geography
			.slice()
			.sort((a, b) =>
				b.count !== a.count ? b.count - a.count : a.hash.localeCompare(b.hash),
			);
		const top = sorted.slice(0, 8);
		const topShare = geoTotal > 0
			? Math.round((top.reduce((s, d) => s + d.count, 0) / geoTotal) * 100)
			: 0;
		lines.push('');
		lines.push('Geography:');
		lines.push(
			`  ${districtCount} ${districtCount === 1 ? 'community' : 'communities'} represented; top ${top.length} carry ${topShare}% of contacts.`
		);
		lines.push(
			'  District identifiers are hashed at the platform layer; aggregate-only.'
		);
	}

	if (dateRange.spanDays > 0) {
		lines.push('');
		lines.push(`Submissions: ${fmtDate(dateRange.earliest)} – ${fmtDate(dateRange.latest)}`);
	}

	lines.push('');
	lines.push('One submission per person. Duplicates removed.');
	lines.push('');
	lines.push(rule);
	lines.push('');
	lines.push('Verify these claims independently:');
	lines.push(`  ${verificationUrl}`);
	lines.push('');
	lines.push(`Attestation: sha256:${attestationHash}`);
	lines.push(
		'  Recompute via REPORT-ATTESTATION-SPEC v1 at:'
	);
	lines.push(
		'  https://github.com/communisaas/voter-protocol/blob/main/specs/REPORT-ATTESTATION-SPEC.md'
	);
	lines.push('');
	lines.push(rule);
	lines.push('');
	lines.push('Generated by Commons. Every claim is cryptographically attested.');
	lines.push('Constituent emails are encrypted under a per-organization key;');
	lines.push('the platform decrypts them only at send time and does not retain');
	lines.push('plaintext.');

	return lines.join('\n');
}

export function reportSubject(campaignTitle: string, verified: number): string {
	return `${verified.toLocaleString()} verified contacts — ${campaignTitle}`;
}

export async function renderReport(ctx: ReportContext): Promise<RenderedReport> {
	const attestationHash = await sha256Hex(canonicalPreimage(ctx));
	return {
		html: renderHtml(ctx, attestationHash),
		text: renderText(ctx, attestationHash),
		attestationHash,
		subject: reportSubject(ctx.campaignTitle, ctx.packet.verified)
	};
}
