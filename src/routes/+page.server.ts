import type { PageServerLoad } from './$types';
import { db } from '$lib/core/db';
import { TEMPLATE_LIST_SELECT } from '$lib/core/db/template-select';
import { extractRecipientEmails } from '$lib/types/templateConfig';
import type { UnknownRecord } from '$lib/types/any-replacements';
import { z } from 'zod';
import { FEATURES } from '$lib/config/features';

const MetricsSchema = z
	.object({
		opened: z.number().optional(),
		clicked: z.number().optional(),
		responded: z.number().optional(),
		total_districts: z.number().optional(),
		district_coverage_percent: z.number().optional(),
		personalization_rate: z.number().optional(),
		effectiveness_score: z.number().optional(),
		cascade_depth: z.number().optional(),
		viral_coefficient: z.number().optional(),
		onboarding_starts: z.number().optional(),
		onboarding_completes: z.number().optional(),
		auth_completions: z.number().optional(),
		shares: z.number().optional()
	})
	.passthrough();

export const load: PageServerLoad = async ({ depends }) => {
	// Cache across client-side navigations — only re-fetch when invalidated
	depends('data:templates');

	try {
		const dbTemplates = await db.template.findMany({
			where: {
				is_public: true,
				...(!FEATURES.CONGRESSIONAL ? { deliveryMethod: { not: 'cwc' } } : {}),
			},
			orderBy: { createdAt: 'desc' },
			select: TEMPLATE_LIST_SELECT,
		});

		const templateIds = dbTemplates.map((t) => t.id);

		const [activeDebates, rawScopes] = await Promise.all([
			(db as unknown as {
				debate: { findMany: (params: unknown) => Promise<{ template_id: string; status: string; winning_stance: string | null; unique_participants: number; argument_count: number; deadline: Date }[]> };
			}).debate.findMany({
				where: {
					template_id: { in: templateIds },
					status: { not: 'cancelled' }
				},
				select: {
					template_id: true, status: true, winning_stance: true,
					unique_participants: true, argument_count: true, deadline: true,
				},
				orderBy: { created_at: 'desc' },
				distinct: ['template_id']
			}).catch(() => [] as { template_id: string; status: string }[]),

			(db as unknown as {
				templateScope: { findMany: (params: unknown) => Promise<UnknownRecord[]> };
			}).templateScope.findMany({
				where: { template_id: { in: templateIds } }
			}).catch(() => [] as UnknownRecord[]),
		]);

		const activeDebateTemplateIds = new Set(
			activeDebates
				.filter((d) => d.status === 'active')
				.map((d) => d.template_id)
		);

		const debateSummaryMap = new Map<string, typeof activeDebates[number]>();
		for (const d of activeDebates) {
			debateSummaryMap.set(d.template_id, d);
		}

		const scopesByTemplateId = new Map<string, UnknownRecord[]>();
		for (const s of rawScopes) {
			const tid = s.template_id as string;
			const arr = scopesByTemplateId.get(tid);
			if (arr) arr.push(s);
			else scopesByTemplateId.set(tid, [s]);
		}

		const templates = dbTemplates.map((template) => {
			let jsonMetrics = {};
			if (typeof template.metrics === 'string') {
				try {
					const parsed = JSON.parse(template.metrics);
					const result = MetricsSchema.safeParse(parsed);
					if (result.success) jsonMetrics = result.data;
				} catch { /* ignore */ }
			} else {
				const result = MetricsSchema.safeParse(template.metrics || {});
				if (result.success) jsonMetrics = result.data;
			}

			const sendCount = template.verified_sends || 0;
			const coordinationScale = Math.min(1.0, Math.log10(Math.max(1, sendCount)) / 3);
			const daysSinceCreation = (Date.now() - new Date(template.createdAt).getTime()) / (1000 * 60 * 60 * 24);
			const isNew = daysSinceCreation <= 7;

			const jm = jsonMetrics as Record<string, number | undefined>;

			return {
				id: template.id,
				slug: template.slug,
				title: template.title,
				description: template.description,
				category: template.category,
				topics: (template.topics as string[]) || [],
				type: template.type,
				deliveryMethod: template.deliveryMethod,
				subject: template.title,
				message_body: template.message_body,
				preview: template.preview,
				// Org endorsement: institutional provenance for the perceptual bridge
				endorsingOrg: template.org
					? { name: template.org.name, slug: template.org.slug, avatar: template.org.avatar }
					: null,
				endorsingOrgs: (template.endorsements ?? [])
					.filter((e: { org: { slug: string } }) => e.org.slug !== template.org?.slug)
					.map((e: { org: { name: string; slug: string; avatar: string | null } }) => ({
						name: e.org.name, slug: e.org.slug, avatar: e.org.avatar
					})),
				coordinationScale,
				isNew,
				hasActiveDebate: activeDebateTemplateIds.has(template.id),
				debateSummary: debateSummaryMap.has(template.id) ? (() => {
					const d = debateSummaryMap.get(template.id)!;
					return {
						status: d.status as 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal',
						winningStance: (d as { winning_stance?: string | null }).winning_stance ?? undefined,
						uniqueParticipants: (d as { unique_participants?: number }).unique_participants ?? 0,
						argumentCount: (d as { argument_count?: number }).argument_count ?? 0,
						deadline: (d as { deadline?: Date }).deadline?.toISOString() ?? undefined,
					};
				})() : undefined,
				verified_sends: template.verified_sends,
				unique_districts: template.unique_districts,
				send_count: template.verified_sends,
				metrics: {
					sent: template.verified_sends,
					districts_covered: template.unique_districts,
					opened: jm.opened || 0,
					clicked: jm.clicked || 0,
					responded: jm.responded || 0,
					total_districts: jm.total_districts || 435,
					district_coverage_percent: jm.district_coverage_percent ||
						(template.unique_districts ? Math.round((template.unique_districts / 435) * 100) : 0),
					personalization_rate: jm.personalization_rate || 0,
					effectiveness_score: jm.effectiveness_score,
					cascade_depth: jm.cascade_depth,
					viral_coefficient: jm.viral_coefficient,
					onboarding_starts: jm.onboarding_starts,
					onboarding_completes: jm.onboarding_completes,
					auth_completions: jm.auth_completions,
					shares: jm.shares,
				},
				delivery_config: template.delivery_config,
				cwc_config: template.cwc_config,
				recipient_config: template.recipient_config,
				campaign_id: template.campaign_id,
				status: template.status,
				is_public: template.is_public,
				jurisdictions: template.jurisdictions || [],
				scope: (scopesByTemplateId.get(template.id) ?? [])[0] || null,
				scopes: scopesByTemplateId.get(template.id) ?? [],
				recipientEmails: extractRecipientEmails(template.recipient_config),
				createdAt: template.createdAt.toISOString(),
			};
		});

		return { templates };
	} catch (error) {
		console.error('[Homepage] SSR template load failed:', error);
		return { templates: [] };
	}
};
