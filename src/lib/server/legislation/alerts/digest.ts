/**
 * Alert Digest: weekly email digest of pending legislative alerts per org.
 *
 * Groups alerts by urgency (critical first), sends via SES,
 * and marks alerts as "seen" after delivery.
 */

import { db } from '$lib/core/db';
import { sendEmail } from '$lib/server/email/ses';
import { env } from '$env/dynamic/private';

interface AlertRow {
	id: string;
	type: string;
	title: string;
	summary: string;
	urgency: string;
	createdAt: Date;
	bill: { externalId: string; status: string; sourceUrl: string };
}

interface OrgDigest {
	orgId: string;
	orgName: string;
	orgSlug: string;
	billingEmail: string | null;
	alerts: AlertRow[];
}

export interface DigestResult {
	orgId: string;
	orgSlug: string;
	alertCount: number;
	sent: boolean;
	error?: string;
}

const URGENCY_ORDER: Record<string, number> = {
	critical: 0,
	high: 1,
	normal: 2,
	low: 3
};

const URGENCY_LABELS: Record<string, string> = {
	critical: 'CRITICAL',
	high: 'HIGH',
	normal: 'NORMAL',
	low: 'LOW'
};

const URGENCY_COLORS: Record<string, string> = {
	critical: '#dc2626',
	high: '#ea580c',
	normal: '#2563eb',
	low: '#6b7280'
};

/**
 * Fetch all orgs that have pending alerts, with their alert data.
 */
async function getOrgsWithPendingAlerts(): Promise<OrgDigest[]> {
	const orgs = await db.organization.findMany({
		where: {
			alerts: { some: { status: 'pending' } }
		},
		select: {
			id: true,
			name: true,
			slug: true,
			billing_email: true,
			alerts: {
				where: { status: 'pending' },
				select: {
					id: true,
					type: true,
					title: true,
					summary: true,
					urgency: true,
					createdAt: true,
					bill: {
						select: {
							externalId: true,
							status: true,
							sourceUrl: true
						}
					}
				},
				orderBy: { createdAt: 'desc' }
			}
		}
	});

	return orgs
		.filter((org) => org.alerts.length > 0)
		.map((org) => ({
			orgId: org.id,
			orgName: org.name,
			orgSlug: org.slug,
			billingEmail: org.billing_email,
			alerts: org.alerts
		}));
}

/**
 * Render the digest HTML for a single org.
 */
function renderDigestHtml(digest: OrgDigest): string {
	const baseUrl = env.PUBLIC_BASE_URL || 'https://commons.email';
	const dashboardUrl = `${baseUrl}/org/${digest.orgSlug}#legislative-activity`;

	// Sort by urgency (critical first), then by date (newest first)
	const sorted = [...digest.alerts].sort((a, b) => {
		const urgDiff = (URGENCY_ORDER[a.urgency] ?? 3) - (URGENCY_ORDER[b.urgency] ?? 3);
		if (urgDiff !== 0) return urgDiff;
		return b.createdAt.getTime() - a.createdAt.getTime();
	});

	const alertRows = sorted
		.map((alert) => {
			const color = URGENCY_COLORS[alert.urgency] ?? '#6b7280';
			const label = URGENCY_LABELS[alert.urgency] ?? 'INFO';
			const date = alert.createdAt.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric'
			});

			return `
			<tr>
				<td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
					<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: white; background-color: ${color};">${label}</span>
				</td>
				<td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb;">
					<a href="${alert.bill.sourceUrl}" style="color: #1d4ed8; text-decoration: none; font-weight: 500;">${escapeHtml(alert.title)}</a>
					<br/>
					<span style="font-size: 13px; color: #6b7280;">${escapeHtml(alert.summary)}</span>
				</td>
				<td style="padding: 12px 16px; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 13px; white-space: nowrap;">
					${date}
				</td>
			</tr>`;
		})
		.join('');

	const criticalCount = sorted.filter((a) => a.urgency === 'critical').length;
	const highCount = sorted.filter((a) => a.urgency === 'high').length;
	const preheader =
		criticalCount > 0
			? `${criticalCount} critical alert${criticalCount > 1 ? 's' : ''} require attention`
			: highCount > 0
				? `${highCount} high-priority alert${highCount > 1 ? 's' : ''} this week`
				: `${sorted.length} legislative alert${sorted.length > 1 ? 's' : ''} this week`;

	return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb;">
	<span style="display: none; max-height: 0; overflow: hidden;">${preheader}</span>
	<table width="100%" cellpadding="0" cellspacing="0" style="max-width: 640px; margin: 0 auto; background: white;">
		<tr>
			<td style="padding: 32px 24px 16px;">
				<h1 style="margin: 0 0 4px; font-size: 20px; color: #111827;">Legislative Activity Digest</h1>
				<p style="margin: 0; font-size: 14px; color: #6b7280;">${escapeHtml(digest.orgName)} &middot; Week of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
			</td>
		</tr>
		<tr>
			<td style="padding: 0 24px;">
				<table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
					<tr style="background-color: #f9fafb;">
						<th style="padding: 10px 16px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500; text-transform: uppercase;">Urgency</th>
						<th style="padding: 10px 16px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500; text-transform: uppercase;">Bill</th>
						<th style="padding: 10px 16px; text-align: left; font-size: 12px; color: #6b7280; font-weight: 500; text-transform: uppercase;">Date</th>
					</tr>
					${alertRows}
				</table>
			</td>
		</tr>
		<tr>
			<td style="padding: 24px; text-align: center;">
				<a href="${dashboardUrl}" style="display: inline-block; padding: 10px 24px; background-color: #1d4ed8; color: white; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 14px;">View All Alerts</a>
			</td>
		</tr>
		<tr>
			<td style="padding: 16px 24px 32px; text-align: center; font-size: 12px; color: #9ca3af;">
				This is an automated digest from Commons. No persuasive content is included.
				<br/>Alerts are generated from public legislative data sources.
			</td>
		</tr>
	</table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Send digest emails for all orgs with pending alerts.
 * Marks sent alerts as "seen" after successful delivery.
 */
export async function sendAlertDigests(): Promise<{
	results: DigestResult[];
	totalSent: number;
	totalFailed: number;
}> {
	const orgs = await getOrgsWithPendingAlerts();
	const results: DigestResult[] = [];
	let totalSent = 0;
	let totalFailed = 0;

	const baseUrl = env.PUBLIC_BASE_URL || 'https://commons.email';
	const defaultFrom = `noreply@${new URL(baseUrl).hostname}`;

	for (const digest of orgs) {
		// Skip orgs without a billing email — no one to send to
		if (!digest.billingEmail) {
			results.push({
				orgId: digest.orgId,
				orgSlug: digest.orgSlug,
				alertCount: digest.alerts.length,
				sent: false,
				error: 'No billing email configured'
			});
			totalFailed++;
			continue;
		}

		try {
			const html = renderDigestHtml(digest);
			const subject = `Legislative Digest: ${digest.alerts.length} alert${digest.alerts.length > 1 ? 's' : ''} for ${digest.orgName}`;

			const sendResult = await sendEmail(
				digest.billingEmail,
				defaultFrom,
				'Commons Alerts',
				subject,
				html,
				`${baseUrl}/org/${digest.orgSlug}/settings#notifications`
			);

			if (!sendResult.success) {
				throw new Error(sendResult.error ?? 'SES send failed');
			}

			// Mark all alerts in this digest as "seen"
			await db.legislativeAlert.updateMany({
				where: {
					id: { in: digest.alerts.map((a) => a.id) }
				},
				data: {
					status: 'seen',
					seenAt: new Date()
				}
			});

			results.push({
				orgId: digest.orgId,
				orgSlug: digest.orgSlug,
				alertCount: digest.alerts.length,
				sent: true
			});
			totalSent++;
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Unknown digest error';
			console.error(`[digest] Failed to send digest for org ${digest.orgSlug}:`, message);
			results.push({
				orgId: digest.orgId,
				orgSlug: digest.orgSlug,
				alertCount: digest.alerts.length,
				sent: false,
				error: message
			});
			totalFailed++;
		}
	}

	return { results, totalSent, totalFailed };
}
