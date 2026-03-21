import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { extractRecipientEmails, extractTemplateMetrics } from '$lib/types/templateConfig';
import type { LayoutServerLoad } from './$types';
import { detectCountryFromHeaders, resolveChannel } from '$lib/services/channelResolver';
import { FEATURES } from '$lib/config/features';
import { queryNoisySnapshots } from '$lib/core/analytics/snapshot';
import { getDaysAgoUTC, getTodayUTC } from '$lib/core/analytics/aggregate';

export const load: LayoutServerLoad = async ({ params, locals: _locals, request }) => {
	const { slug } = params;

	// Look up template by slug
	const template = await db.template.findUnique({
		where: {
			slug,
			is_public: true // Only show public templates via deep links
		},
		include: {
			user: {
				select: {
					name: true,
					avatar: true
				}
			}
		}
	});

	if (!template) {
		throw error(404, 'Template not found');
	}

	// Gate CWC templates behind CONGRESSIONAL feature flag
	if (!FEATURES.CONGRESSIONAL && template.deliveryMethod === 'cwc') {
		throw error(404, 'Template not found');
	}

	// Detect country and resolve channel
	const detectedCountry = detectCountryFromHeaders(request.headers) || 'US';
	const channelInfo = await resolveChannel(detectedCountry);

	// DP snapshots (historical, Laplace-noised) + today's LDP-corrected aggregate
	const today = getTodayUTC();
	const ninetyDaysAgo = getDaysAgoUTC(90);
	const [viewSnapshots, sendSnapshots, todayViews, todaySends] = await Promise.all([
		queryNoisySnapshots({
			metric: 'template_view',
			start: ninetyDaysAgo,
			end: today,
			filters: { template_id: template.id }
		}),
		queryNoisySnapshots({
			metric: 'delivery_attempt',
			start: ninetyDaysAgo,
			end: today,
			filters: { template_id: template.id }
		}),
		db.analytics_aggregate.aggregate({
			where: { metric: 'template_view', template_id: template.id, date: today },
			_sum: { count: true }
		}),
		db.analytics_aggregate.aggregate({
			where: { metric: 'delivery_attempt', template_id: template.id, date: today },
			_sum: { count: true }
		})
	]);
	const noisyViews = (viewSnapshots[0]?.count ?? 0) + (todayViews._sum.count ?? 0);
	const noisySends = (sendSnapshots[0]?.count ?? 0) + (todaySends._sum.count ?? 0);

	// View tracking handled client-side via DP analytics pipeline (trackTemplateView)
	const jsonMetrics = extractTemplateMetrics(template.metrics);

	// Format template for client
	const formattedTemplate = {
		id: template.id,
		slug: template.slug,
		title: template.title,
		description: template.description,
		category: template.category,
		type: template.type,
		deliveryMethod: template.deliveryMethod,
		subject: template.title,
		message_body: template.message_body,
		sources: template.sources || [],
		research_log: template.research_log || [],
		preview: template.preview,
		is_public: template.is_public,
		// === AGGREGATE METRICS (consistent with schema) ===
		verified_sends: template.verified_sends,
		unique_districts: template.unique_districts,

		// === METRICS OBJECT (backward compatibility) ===
		metrics: {
			sent: noisySends || template.verified_sends, // DP pipeline, fallback to schema field
			districts_covered: template.unique_districts, // Use schema field as source of truth
			total_districts: jsonMetrics.total_districts || 435,
			district_coverage_percent:
				jsonMetrics.district_coverage_percent ||
				(template.unique_districts ? Math.round((template.unique_districts / 435) * 100) : 0),
			opened: jsonMetrics.opened || 0,
			clicked: jsonMetrics.clicked || 0,
			responded: jsonMetrics.responded || 0,
			views: noisyViews
		},

		delivery_config: template.delivery_config,
		recipient_config: null,
		recipientEmails: [],
		author: template.user
			? {
					name: template.user.name,
					avatar: template.user.avatar
				}
			: null,
		createdAt: template.createdAt.toISOString()
	};

	return {
		template: formattedTemplate,
		channel: channelInfo
	};
};
