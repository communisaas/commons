import { applyEmailMergeFields } from '$lib/core/email/merge-fields';
import { escapeHtml } from './escape';

export interface MergeContext {
	firstName: string;
	lastName: string;
	email: string;
	postalCode: string | null;
	verificationStatus: 'verified' | 'postal-resolved' | 'imported';
	tierLabel: string | null;
	tierContext: string;
}

export interface VerificationBlock {
	totalRecipients: number;
	verifiedCount: number;
	verifiedPct: number;
	districtCount: number;
}

// Replace merge fields in a template string. Supported tokens: {{firstName}},
// {{lastName}}, {{email}}, {{postalCode}}, {{verificationStatus}}, {{tierLabel}},
// {{tierContext}}. Each accepts an optional fallback — {{firstName|Friend}} —
// used when the recipient value is blank; a blank token with no fallback
// collapses along with one preceding space so punctuation is not orphaned.
// Delegates to the shared grammar in $lib/core/email/merge-fields so the
// server and browser-direct paths cannot drift.
export function compileMergeFields(template: string, ctx: MergeContext): string {
	return applyEmailMergeFields(template, ctx, 'html');
}

// Render the structural verification context block. Appended to every email
// the platform compiles. Plain English; states facts, no marketing register.
// Single sentence: counts and district breadth. Recipients add themselves to
// the count by verifying residency; no thresholded copy.
export function renderVerificationBlock(block: VerificationBlock): string {
	const { totalRecipients, verifiedCount, districtCount } = block;
	const headline = `${verifiedCount.toLocaleString()} of ${totalRecipients.toLocaleString()} ${totalRecipients === 1 ? 'recipient is' : 'recipients are'} verified${districtCount > 0 ? ` across ${districtCount} ${districtCount === 1 ? 'district' : 'districts'}` : ''}.`;
	const detail =
		verifiedCount === totalRecipients && totalRecipients > 0
			? ''
			: 'Verifying your residency adds your contact to this count.';

	return `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #3f3f46;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #3f3f46;border-radius:8px;background-color:#18181b;">
    <tr>
      <td style="padding:16px 20px;">
        <p style="margin:0 0 4px 0;font-size:12px;font-weight:600;color:#a1a1aa;text-transform:uppercase;letter-spacing:0.05em;">
          Verification Context
        </p>
        <p style="margin:0 0 4px 0;font-size:14px;color:#e4e4e7;">
          ${escapeHtml(headline)}
        </p>
        ${detail ? `<p style="margin:0;font-size:13px;color:#71717a;">${escapeHtml(detail)}</p>` : ''}
      </td>
    </tr>
  </table>
</div>`.trim();
}

// Compile a complete email: apply merge fields, append verification block,
// wrap in email-safe HTML.
export function compileEmail(
	body: string,
	merge: MergeContext,
	verification: VerificationBlock,
	unsubscribeUrl?: string,
	platformUrl: string = 'https://commons.email'
): string {
	const mergedBody = compileMergeFields(body, merge);
	const verificationHtml = renderVerificationBlock(verification);
	const platformHost = (() => {
		try {
			return new URL(platformUrl).host;
		} catch {
			return 'commons.email';
		}
	})();

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title></title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#09090b;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:24px;background-color:#18181b;border-radius:12px;border:1px solid #27272a;">
              <div style="font-size:15px;line-height:1.6;color:#d4d4d8;">
                ${mergedBody}
              </div>
              ${verificationHtml}
              ${
								unsubscribeUrl
									? `
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #27272a;text-align:center;">
                <p style="margin:0;font-size:11px;color:#52525b;">
                  <a href="${escapeHtml(unsubscribeUrl)}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a>
                  &nbsp;&middot;&nbsp;
                  Sent via <a href="${escapeHtml(platformUrl)}" style="color:#71717a;text-decoration:underline;">${escapeHtml(platformHost)}</a>
                </p>
              </div>`
									: ''
							}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Tier context string for a supporter, derived from their verification
// status. Plain status language only; no "weight" / "carries" / "strengthen"
// register.
export function buildTierContext(
	verificationStatus: 'verified' | 'postal-resolved' | 'imported'
): string {
	switch (verificationStatus) {
		case 'verified':
			return 'Your identity is verified. You appear as a verified contact in this campaign.';
		case 'postal-resolved':
			return 'Your postal code is on file. Verification is pending.';
		case 'imported':
			return 'You were added by an organization. Verification is pending.';
	}
}

// Bulk-send variant of `compileEmail`: wraps the author's body in the email
// shell + (optional) verification context block + footer, but deliberately
// leaves per-recipient merge fields unresolved. Dispatch paths own the actual
// recipient context: the Convex batch path resolves tokens after PII decrypt,
// and the browser-direct path switches to singleton Lambda sends when
// personalization is present. Pass `verification: null` when filter-scoped
// verification truth is unavailable; the shell omits the verification block
// rather than rendering an approximated claim that may diverge from cohort
// reality.
export function compileEmailShell(
	body: string,
	verification: VerificationBlock | null,
	opts: { unsubscribeUrl?: string; platformUrl?: string } = {}
): string {
	const platformUrl = opts.platformUrl ?? 'https://commons.email';
	const platformHost = (() => {
		try {
			return new URL(platformUrl).host;
		} catch {
			return 'commons.email';
		}
	})();
	const verificationHtml = verification ? renderVerificationBlock(verification) : '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title></title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#09090b;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="padding:24px;background-color:#18181b;border-radius:12px;border:1px solid #27272a;">
              <div style="font-size:15px;line-height:1.6;color:#d4d4d8;">
                ${body}
              </div>
              ${verificationHtml}
              ${
								opts.unsubscribeUrl
									? `
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #27272a;text-align:center;">
                <p style="margin:0;font-size:11px;color:#52525b;">
                  <a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#71717a;text-decoration:underline;">Unsubscribe</a>
                  &nbsp;&middot;&nbsp;
                  Sent via <a href="${escapeHtml(platformUrl)}" style="color:#71717a;text-decoration:underline;">${escapeHtml(platformHost)}</a>
                </p>
              </div>`
									: ''
							}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
