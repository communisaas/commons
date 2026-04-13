/**
 * Report Email Template — What the Decision-Maker Receives
 *
 * This is the most important email Commons sends. It must speak
 * the staffer's language at every line. No platform jargon, no
 * engagement tier labels, no coordination integrity scores.
 *
 * What it shows:
 * - Verified constituent count
 * - Identity verification method (when available)
 * - Authorship breakdown
 * - Geographic spread
 * - Date range
 * - Verification link
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
 * Render the report email HTML.
 * Light theme, institutional tone. Table-based layout for email client compatibility.
 */
export function renderReportEmail(ctx: ReportContext): string {
	const { campaignTitle, orgName, packet, verificationUrl } = ctx;
	const { verified, districtCount, authorship, dateRange, identityBreakdown } = packet;

	// Build evidence lines
	const lines: string[] = [];

	// Identity breakdown (Cycle 2+)
	if (identityBreakdown) {
		const parts: string[] = [];
		if (identityBreakdown.govId > 0) parts.push(`${identityBreakdown.govId} government ID verified`);
		if (identityBreakdown.addressVerified > 0) parts.push(`${identityBreakdown.addressVerified} address verified`);
		if (parts.length > 0) lines.push(parts.join(' · '));
	}

	// Authorship
	const authorParts: string[] = [];
	if (authorship.individual > 0) {
		authorParts.push(`${authorship.individual} ${authorship.explicit ? 'individually composed' : 'distinct messages'}`);
	}
	if (authorship.shared > 0) {
		authorParts.push(`${authorship.shared} shared ${authorship.shared === 1 ? 'statement' : 'statements'}`);
	}
	if (authorParts.length > 0) lines.push(authorParts.join(' · '));

	// Date range
	if (dateRange.spanDays > 0) {
		lines.push(`Submissions ${fmtDate(dateRange.earliest)} – ${fmtDate(dateRange.latest)}`);
	}

	// Dedup
	lines.push('One submission per person · duplicates removed');

	const evidenceHtml = lines
		.map((line) => `<tr><td style="padding:3px 0;font-size:13px;color:#525252;">${escapeHtml(line)}</td></tr>`)
		.join('\n');

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

          <!-- Evidence Lines -->
          <tr>
            <td style="padding:20px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${evidenceHtml}
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
