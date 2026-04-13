/**
 * Campaign Analytics Loader
 *
 * Provides data for DeliveryMetrics, VerificationTimeline, and GeographicSpread
 * components on the campaign detail page.
 *
 * Called from:
 * - src/routes/org/[slug]/campaigns/[id]/+page.server.ts (behind FEATURES.ANALYTICS_EXPANDED)
 */

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '../../convex/_generated/dataModel';

// ── Types matching component interfaces ──

interface TimelineBucket {
	day: string;
	total: number;
	verified: number;
}

interface DistrictBucket {
	districtHash: string;
	count: number;
}

interface DeliveryMetrics {
	sent: number;
	delivered: number;
	opened: number;
	clicked: number;
	bounced: number;
	complained: number;
	deliveryRate: number;
	openRate: number;
	clickRate: number;
	bounceRate: number;
}

export interface CampaignAnalytics {
	timeline: TimelineBucket[];
	topDistricts: DistrictBucket[];
	delivery: DeliveryMetrics;
}

// ── Public API ──

export async function loadCampaignAnalytics(
	campaignId: Id<'campaigns'>,
	orgId: Id<'organizations'>
): Promise<CampaignAnalytics> {
	// Reuse the same query as packet computation — single Convex roundtrip
	const actions = await serverQuery(api.campaigns.getActionsForPacket, { campaignId });

	// Timeline: group by day
	const dayMap = new Map<string, { total: number; verified: number }>();
	for (const a of actions) {
		const day = new Date(a.sentAt).toISOString().split('T')[0];
		const bucket = dayMap.get(day) ?? { total: 0, verified: 0 };
		bucket.total++;
		if (a.verified) bucket.verified++;
		dayMap.set(day, bucket);
	}
	const timeline: TimelineBucket[] = [...dayMap.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([day, counts]) => ({ day, ...counts }));

	// Top districts: group by districtHash, top 10
	const districtMap = new Map<string, number>();
	for (const a of actions) {
		if (!a.districtHash) continue;
		districtMap.set(a.districtHash, (districtMap.get(a.districtHash) ?? 0) + 1);
	}
	const topDistricts: DistrictBucket[] = [...districtMap.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 10)
		.map(([districtHash, count]) => ({ districtHash, count }));

	// Delivery metrics from campaignDeliveries aggregation
	let delivery: DeliveryMetrics;
	try {
		delivery = await serverQuery(api.campaigns.getDeliveryMetrics, { campaignId });
	} catch {
		// Fallback if query fails (e.g., no deliveries yet)
		delivery = {
			sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0,
			complained: 0, deliveryRate: 0, openRate: 0, clickRate: 0, bounceRate: 0
		};
	}

	return { timeline, topDistricts, delivery };
}
