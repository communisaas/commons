/**
 * Report Email Template — What the Decision-Maker Receives
 *
 * This is the most important email Commons sends. It must speak
 * the staffer's language at every line. No platform jargon, no
 * engagement tier labels, no coordination integrity scores.
 *
 * Design principle: the same DIMENSIONS the org sees in the dashboard
 * should be visible here — identity composition, authorship texture,
 * geographic spread, temporal rhythm. Simplified for email intake,
 * but dimensional, not just textual.
 *
 * Email client constraints: table-based layout, inline styles,
 * no external CSS. Simple table-cell ratio bars work everywhere.
 */

import type { VerificationPacket } from '$lib/types/verification-packet';

interface ReportContext {
	campaignTitle: string;
	orgName: string;
	packet: VerificationPacket;
	verificationUrl: string; // e.g. https://commons.email/v/{hash}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
	const d = new Date(iso + 'T00:00:00');
	return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Render an email-safe ratio bar using table cells.
 * Works in all email clients (Outlook, Gmail, Apple Mail).
 */
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

/**
 * Render the report email HTML.
 * Institutional tone. Table-based layout. Dimensional evidence.
 */
export function renderReportEmail(ctx: ReportContext): string {
	const { campaignTitle, orgName, packet, verificationUrl } = ctx;
	const { verified, districtCount, authorship, dateRange, identityBreakdown } = packet;

	// ── Identity dimension ──
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

	// ── Authorship dimension ──
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

	// ── Geographic dimension ──
	let geographyHtml = '';
	if (packet.geography && packet.geography.length > 1) {
		const geoTotal = packet.geography.reduce((s, d) => s + d.count, 0);
		const topDistricts = packet.geography.slice(0, 8); // Show top 8

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

	// ── Temporal dimension ──
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

          <!-- Header -->
          <tr>
            <td style="padding:0 0 32px 0;">
              <p style="margin:0;font-size:12px;font-weight:600;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.08em;">
                Verification Report
              </p>
            </td>
          </tr>

          <!-- Campaign + Org -->
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

          <!-- Hero Count -->
          <tr>
            <td style="padding:24px 0;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;">
              <p style="margin:0 0 4px 0;font-size:36px;font-weight:700;color:#171717;font-family:'Courier New',Courier,monospace;">
                ${verified.toLocaleString()}
              </p>
              <p style="margin:0;font-size:15px;color:#525252;">
                verified constituents across ${districtCount} ${districtCount === 1 ? 'community' : 'communities'}
              </p>
            </td>
          </tr>

          <!-- Dimensional Evidence -->
          <tr>
            <td style="padding:20px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${identityHtml}
                ${authorshipHtml}
                ${geographyHtml}
                ${temporalHtml}
                <tr>
                  <td style="padding:4px 0;">
                    <p style="margin:0;font-size:13px;color:#737373;">One submission per person · duplicates removed</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Verification Link -->
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

          <!-- Footer -->
          <tr>
            <td style="padding:40px 0 0 0;border-top:none;">
              <p style="margin:0;font-size:11px;color:#a3a3a3;line-height:1.6;">
                This report was generated by <a href="https://commons.email" style="color:#a3a3a3;text-decoration:underline;">commons.email</a>.
                Every claim is cryptographically attested and independently auditable.
                The platform cannot access constituent identities — only verification proofs.
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

/**
 * Generate the email subject line for a report delivery.
 */
export function reportSubject(campaignTitle: string, verified: number): string {
	return `${verified} verified constituents — ${campaignTitle}`;
}
