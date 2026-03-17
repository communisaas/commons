import { db } from '$lib/core/db';
import { computeVerificationPacket, type VerificationPacket } from './verification';
import { sendEmail } from '$lib/server/email/ses';

export interface DeliveryTarget {
	email: string;
	name: string | null;
	title: string | null;
	district: string | null;
}

export interface ReportPreview {
	campaign: { id: string; title: string; type: string; body: string | null };
	targets: DeliveryTarget[];
	packet: VerificationPacket;
	renderedHtml: string;
}

interface PastDelivery {
	id: string;
	targetEmail: string;
	targetName: string | null;
	targetTitle: string | null;
	targetDistrict: string | null;
	status: string;
	sentAt: string | null;
	createdAt: string;
	proofStrength: { verified: number; districtCount: number } | null;
}

// --- HTML Rendering ---

const SCORE_LABELS: Record<string, string> = {
	gds: 'Geo Spread',
	ald: 'Msg Unique',
	temporalEntropy: 'Time Spread',
	burstVelocity: 'Burst',
	cai: 'Depth'
};

/** Human-readable interpretation of each score for decision-makers. */
function interpretScore(key: string, val: number | null): string {
	if (val === null) return 'Insufficient data';
	switch (key) {
		case 'gds':
			return val >= 0.9 ? 'Broad geographic spread' : val >= 0.5 ? 'Moderate spread' : 'Geographically concentrated';
		case 'ald':
			return val >= 0.9 ? 'Nearly all unique messages' : val >= 0.5 ? 'Mix of personalized and template' : 'Mostly identical messages';
		case 'temporalEntropy': {
			const norm = Math.min(val / 4.58, 1);
			return norm >= 0.65 ? 'Sustained over time' : norm >= 0.33 ? 'Some temporal bursts' : 'Narrow time window';
		}
		case 'burstVelocity':
			return val <= 2.0 ? 'Steady organic pace' : val <= 5.0 ? 'Some activity spikes' : 'Extreme spike detected';
		case 'cai':
			return val >= 0.5 ? 'Deep engagement core' : val >= 0.1 ? 'Mix of new and established' : 'Mostly new participants';
		default:
			return '';
	}
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function formatScore(val: number | null): string {
	if (val === null) return '\u2014';
	return val.toFixed(2);
}

function tierBarHtml(tiers: VerificationPacket['tiers']): string {
	const maxCount = Math.max(...tiers.map((t) => t.count), 1);

	return tiers
		.slice()
		.reverse()
		.map((tier) => {
			const pct = tier.count > 0 ? Math.max((tier.count / maxCount) * 100, 4) : 2;
			const countLabel = tier.count === -1 ? '&lt;5' : String(tier.count);
			const barColor =
				tier.tier >= 4
					? '#10b981'
					: tier.tier === 3
						? 'rgba(16,185,129,0.7)'
						: tier.tier === 2
							? 'rgba(20,184,166,0.6)'
							: tier.tier === 1
								? 'rgba(20,184,166,0.4)'
								: '#52525b';

			return `
			<tr>
				<td style="padding: 2px 8px 2px 0; text-align: right; font-size: 11px; font-family: monospace; color: #a1a1aa; width: 80px;">
					${escapeHtml(tier.label)} <span style="color: #71717a;">T${tier.tier}</span>
				</td>
				<td style="padding: 2px 0; width: 100%;">
					<div style="background: #27272a; border-radius: 4px; height: 16px; overflow: hidden;">
						<div style="background: ${barColor}; height: 16px; border-radius: 4px; width: ${pct}%;"></div>
					</div>
				</td>
				<td style="padding: 2px 0 2px 8px; text-align: right; font-size: 12px; font-family: monospace; color: #a1a1aa; width: 40px;">
					${countLabel}
				</td>
			</tr>`;
		})
		.join('\n');
}

function scoreRow(key: string, val: number | null): string {
	const label = SCORE_LABELS[key] ?? key;
	const hint = interpretScore(key, val);
	const color =
		val === null
			? '#52525b'
			: val >= 0.8
				? '#34d399'
				: val >= 0.5
					? '#2dd4bf'
					: '#a1a1aa';

	return `
	<td style="text-align: center; padding: 4px 8px;">
		<div style="font-family: monospace; font-size: 16px; font-weight: 600; color: ${color};">
			${formatScore(val)}
		</div>
		<div style="font-size: 10px; color: #71717a; margin-top: 2px;">${escapeHtml(label)}</div>
		<div style="font-size: 9px; color: #52525b; margin-top: 1px;">${escapeHtml(hint)}</div>
	</td>`;
}

/**
 * Render the report email HTML for a specific target.
 * Personalizes the campaign body with merge fields:
 *   {{name}}, {{title}}, {{district}}
 */
export function renderReportHtml(
	campaign: { id: string; title: string; body: string | null },
	packet: VerificationPacket,
	target: DeliveryTarget
): string {
	// Personalize campaign body with merge fields
	let body = campaign.body ?? '';
	body = body.replace(/\{\{name\}\}/gi, target.name ?? 'Honorable Representative');
	body = body.replace(/\{\{title\}\}/gi, target.title ?? '');
	body = body.replace(/\{\{district\}\}/gi, target.district ?? '');

	// Convert newlines to <br> for email
	const bodyHtml = escapeHtml(body).replace(/\n/g, '<br />');

	const verifyUrl = `https://commons.email/verify/${campaign.id}`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>${escapeHtml(campaign.title)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; color: #e4e4e7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
	<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #09090b;">
		<tr>
			<td align="center" style="padding: 32px 16px;">
				<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">

					<!-- Section 1: Campaign Letter -->
					<tr>
						<td style="padding: 32px; background-color: #18181b; border: 1px solid rgba(63,63,70,0.6); border-radius: 12px;">
							<h1 style="margin: 0 0 24px 0; font-size: 22px; font-weight: 700; color: #f4f4f5;">
								${escapeHtml(campaign.title)}
							</h1>
							<div style="font-size: 15px; line-height: 1.6; color: #d4d4d8;">
								${bodyHtml}
							</div>
						</td>
					</tr>

					<tr><td style="height: 16px;"></td></tr>

					<!-- Section 2: Verification Packet Footer -->
					<tr>
						<td style="padding: 24px; background-color: rgba(24,24,27,0.8); border: 1px solid rgba(63,63,70,0.4); border-radius: 12px;">
							<table width="100%" cellpadding="0" cellspacing="0" border="0">
								<tr>
									<td style="padding-bottom: 16px; border-bottom: 1px solid rgba(63,63,70,0.3);">
										<span style="font-size: 10px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; color: #71717a;">
											Verification Packet
										</span>
									</td>
								</tr>

								<!-- Verified count headline -->
								<tr>
									<td style="padding: 20px 0 16px 0;">
										<span style="font-family: monospace; font-size: 32px; font-weight: 700; color: #34d399;">
											${packet.verified}
										</span>
										<span style="font-size: 14px; color: #a1a1aa; margin-left: 8px;">
											verified constituents
										</span>
										<span style="font-size: 13px; color: #71717a;">
											out of ${packet.total} total (${packet.verifiedPct}%)
										</span>
									</td>
								</tr>

								<!-- Coordination Integrity Scores -->
								<tr>
									<td style="padding-bottom: 16px;">
										<div style="font-size: 10px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; color: #52525b; margin-bottom: 12px;">
											Coordination Integrity
										</div>
										<table width="100%" cellpadding="0" cellspacing="0" border="0">
											<tr>
												${scoreRow('gds', packet.gds)}
												${scoreRow('ald', packet.ald)}
												${scoreRow('temporalEntropy', packet.temporalEntropy)}
												${scoreRow('burstVelocity', packet.burstVelocity)}
												${scoreRow('cai', packet.cai)}
											</tr>
										</table>
									</td>
								</tr>

								<!-- Tier Distribution -->
								<tr>
									<td style="padding-bottom: 16px;">
										<div style="font-size: 10px; font-family: monospace; text-transform: uppercase; letter-spacing: 0.1em; color: #52525b; margin-bottom: 12px;">
											Engagement Tiers
										</div>
										<table width="100%" cellpadding="0" cellspacing="0" border="0">
											${tierBarHtml(packet.tiers)}
										</table>
									</td>
								</tr>

								<!-- Geographic Spread -->
								${packet.districtCount > 0 ? `
								<tr>
									<td style="padding: 12px 16px; background-color: rgba(9,9,11,0.5); border: 1px solid rgba(63,63,70,0.3); border-radius: 8px;">
										<span style="font-size: 12px; color: #a1a1aa;">Districts reached:</span>
										<span style="font-family: monospace; font-size: 16px; font-weight: 600; color: #2dd4bf; margin-left: 8px;">
											${packet.districtCount}
										</span>
									</td>
								</tr>` : ''}
							</table>
						</td>
					</tr>

					<tr><td style="height: 16px;"></td></tr>

					<!-- Section 3: Verify Link -->
					<tr>
						<td align="center" style="padding: 24px;">
							<a href="${verifyUrl}" style="display: inline-block; padding: 12px 32px; background-color: #0d9488; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; border-radius: 8px;">
								Verify This Report
							</a>
							<div style="margin-top: 12px;">
								<a href="${verifyUrl}" style="font-size: 11px; font-family: monospace; color: #71717a; text-decoration: none;">
									${escapeHtml(verifyUrl)}
								</a>
							</div>
						</td>
					</tr>

					<!-- Footer -->
					<tr>
						<td align="center" style="padding: 24px 0; border-top: 1px solid rgba(63,63,70,0.3);">
							<p style="margin: 0 0 8px 0; font-size: 11px; color: #52525b;">
								This report was generated by commons.email with cryptographic verification.
							</p>
							<a href="https://commons.email/about/integrity" style="font-size: 11px; color: #71717a; text-decoration: underline;">
								What do these scores mean?
							</a>
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
 * Load report preview: campaign, targets, live packet, rendered HTML.
 */
export async function loadReportPreview(
	campaignId: string,
	orgId: string
): Promise<ReportPreview | null> {
	const campaign = await db.campaign.findFirst({
		where: { id: campaignId, orgId }
	});

	if (!campaign) return null;

	// Compute live packet
	const packet = await computeVerificationPacket(campaignId, orgId);

	// Resolve targets from campaign.targets JSON
	const rawTargets = campaign.targets as unknown;
	const targets: DeliveryTarget[] = [];

	if (Array.isArray(rawTargets)) {
		for (const t of rawTargets) {
			if (t && typeof t === 'object' && 'email' in t && typeof t.email === 'string') {
				targets.push({
					email: t.email,
					name: typeof t.name === 'string' ? t.name : null,
					title: typeof t.title === 'string' ? t.title : null,
					district: typeof t.district === 'string' ? t.district : null
				});
			}
		}
	}

	// Render preview HTML for first target (or generic placeholder)
	const previewTarget: DeliveryTarget = targets[0] ?? {
		email: 'preview@example.com',
		name: 'Honorable Representative',
		title: null,
		district: null
	};

	const renderedHtml = renderReportHtml(
		{ id: campaign.id, title: campaign.title, body: campaign.body },
		packet,
		previewTarget
	);

	return {
		campaign: {
			id: campaign.id,
			title: campaign.title,
			type: campaign.type,
			body: campaign.body
		},
		targets,
		packet,
		renderedHtml
	};
}

/**
 * Send report to selected targets.
 * Freezes the packet snapshot, creates CampaignDelivery rows.
 * Actual email dispatch is a stub (Task #8 = SES integration).
 */
export async function sendReport(
	campaignId: string,
	orgId: string,
	selectedEmails: string[]
): Promise<{ deliveryIds: string[]; error?: string }> {
	// Verify campaign belongs to org
	const campaign = await db.campaign.findFirst({
		where: { id: campaignId, orgId }
	});

	if (!campaign) {
		return { deliveryIds: [], error: 'Campaign not found' };
	}

	if (!['ACTIVE', 'PAUSED', 'COMPLETE'].includes(campaign.status)) {
		return { deliveryIds: [], error: 'Campaign must be active, paused, or complete to send reports' };
	}

	// Resolve targets from campaign JSON
	const rawTargets = campaign.targets as unknown;
	const allTargets: DeliveryTarget[] = [];

	if (Array.isArray(rawTargets)) {
		for (const t of rawTargets) {
			if (t && typeof t === 'object' && 'email' in t && typeof t.email === 'string') {
				allTargets.push({
					email: t.email,
					name: typeof t.name === 'string' ? t.name : null,
					title: typeof t.title === 'string' ? t.title : null,
					district: typeof t.district === 'string' ? t.district : null
				});
			}
		}
	}

	// Filter to selected targets only
	const selectedSet = new Set(selectedEmails);
	const targets = allTargets.filter((t) => selectedSet.has(t.email));

	if (targets.length === 0) {
		return { deliveryIds: [], error: 'No valid targets selected' };
	}

	// Freeze the packet at send time
	const packet = await computeVerificationPacket(campaignId, orgId);
	const packetSnapshot = JSON.parse(JSON.stringify(packet));

	// Load org for sender info
	const org = await db.organization.findUnique({
		where: { id: orgId },
		select: { name: true, slug: true }
	});

	// Create delivery rows and send via SES
	const deliveryIds: string[] = [];

	for (const target of targets) {
		const delivery = await db.campaignDelivery.create({
			data: {
				campaignId,
				targetEmail: target.email,
				targetName: target.name,
				targetTitle: target.title,
				targetDistrict: target.district,
				status: 'queued',
				packetSnapshot
			}
		});
		deliveryIds.push(delivery.id);

		// Render and send
		const html = renderReportHtml(
			{ id: campaign.id, title: campaign.title, body: campaign.body },
			packet,
			target
		);
		const result = await sendEmail(
			target.email,
			`${org!.slug}@commons.email`,
			org!.name,
			`Campaign Report: ${campaign.title}`,
			html
		);

		await db.campaignDelivery.update({
			where: { id: delivery.id },
			data: {
				status: result.success ? 'sent' : 'failed',
				sentAt: result.success ? new Date() : undefined
			}
		});
	}

	return { deliveryIds };
}

/**
 * Load past deliveries for a campaign.
 */
export async function loadPastDeliveries(
	campaignId: string,
	orgId: string
): Promise<PastDelivery[]> {
	// Verify campaign belongs to org
	const campaign = await db.campaign.findFirst({
		where: { id: campaignId, orgId },
		select: { id: true }
	});

	if (!campaign) return [];

	const deliveries = await db.campaignDelivery.findMany({
		where: { campaignId },
		orderBy: { createdAt: 'desc' }
	});

	return deliveries.map((d) => {
		const snap = d.packetSnapshot as Record<string, unknown> | null;
		return {
			id: d.id,
			targetEmail: d.targetEmail,
			targetName: d.targetName,
			targetTitle: d.targetTitle,
			targetDistrict: d.targetDistrict,
			status: d.status,
			sentAt: d.sentAt?.toISOString() ?? null,
			createdAt: d.createdAt.toISOString(),
			proofStrength:
				snap && typeof snap.verified === 'number' && typeof snap.districtCount === 'number'
					? { verified: snap.verified, districtCount: snap.districtCount }
					: null
		};
	});
}
