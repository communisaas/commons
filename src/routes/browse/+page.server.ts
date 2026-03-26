import type { PageServerLoad } from './$types';
import { db } from '$lib/core/db';
import { TEMPLATE_LIST_SELECT } from '$lib/core/db/template-select';
import { extractRecipientEmails } from '$lib/types/templateConfig';
import { z } from 'zod';
import { FEATURES } from '$lib/config/features';
import { tryDecryptPii } from '$lib/core/crypto/user-pii-encryption';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async () => {
	// ─── DUAL-STACK: Try Convex first, fallback to Prisma ───
	if (PUBLIC_CONVEX_URL) {
		try {
			const convexTemplates = await serverQuery(api.templates.listPublic, {
				excludeCwc: !FEATURES.CONGRESSIONAL
			});

			console.log(`[Browse] Convex: loaded ${convexTemplates.length} public templates`);

			return {
				templates: convexTemplates
			};
		} catch (err) {
			console.error('[Browse] Convex failed, falling back to Prisma:', err);
		}
	}

	// ─── PRISMA FALLBACK ───
	try {
		const dbTemplates = await db.template.findMany({
			where: {
				is_public: true,
				...(!FEATURES.CONGRESSIONAL ? { deliveryMethod: { not: 'cwc' } } : {}),
			},
			orderBy: { createdAt: 'desc' },
			select: TEMPLATE_LIST_SELECT,
		});

		// Batch query: debate summaries for all templates
		let debateSummaryMap = new Map<string, {
			status: string;
			winning_stance: string | null;
			unique_participants: number;
			argument_count: number;
			deadline: Date;
		}>();
		try {
			const debates = await db.debate.findMany({
				where: {
					template_id: { in: dbTemplates.map(t => t.id) },
					status: { not: 'cancelled' }
				},
				select: {
					template_id: true,
					status: true,
					winning_stance: true,
					unique_participants: true,
					argument_count: true,
					deadline: true,
				},
				orderBy: { created_at: 'desc' },
				distinct: ['template_id']
			});
			for (const d of debates) {
				debateSummaryMap.set(d.template_id, d);
			}
		} catch {
			// debate table may not exist yet
		}

		// Zod schema for metrics validation
		const MetricsSchema = z
			.object({
				total_districts: z.number().optional(),
				district_coverage_percent: z.number().optional(),
				opened: z.number().optional(),
				clicked: z.number().optional()
			})
			.passthrough();

		const templates = await Promise.all(dbTemplates.map(async (template) => {
			// Extract metrics from JSON field with validation
			let jsonMetrics = {};
			if (typeof template.metrics === 'string') {
				try {
					const parsed = JSON.parse(template.metrics);
					const result = MetricsSchema.safeParse(parsed);
					if (result.success) {
						jsonMetrics = result.data;
					} else {
						console.warn(
							`[Browse Page] Invalid metrics for template ${template.id}:`,
							result.error.flatten()
						);
					}
				} catch (error) {
					console.warn(`[Browse Page] Failed to parse metrics for template ${template.id}:`, error);
				}
			} else {
				const result = MetricsSchema.safeParse(template.metrics || {});
				if (result.success) {
					jsonMetrics = result.data;
				} else {
					console.warn(
						`[Browse Page] Invalid metrics object for template ${template.id}:`,
						result.error.flatten()
					);
				}
			}

			return {
				id: template.id,
				slug: template.slug,
				title: template.title,
				description: template.description,
				category: template.category,
				type: template.type,
				deliveryMethod: template.deliveryMethod,
				preview: template.preview,
				message_body: template.message_body,
				subject: template.title,
				// Org endorsement: institutional provenance for the perceptual bridge
				endorsingOrg: template.org
					? { name: template.org.name, slug: template.org.slug, avatar: template.org.avatar }
					: null,
				endorsingOrgs: (template.endorsements ?? [])
					.filter((e: { org: { slug: string } }) => e.org.slug !== template.org?.slug)
					.map((e: { org: { name: string; slug: string; avatar: string | null } }) => ({
						name: e.org.name, slug: e.org.slug, avatar: e.org.avatar
					})),

				// === PERCEPTUAL ENCODING ===
				hasActiveDebate: debateSummaryMap.has(template.id) &&
					['active', 'resolving', 'awaiting_governance', 'under_appeal'].includes(
						debateSummaryMap.get(template.id)!.status
					),
				debateSummary: debateSummaryMap.has(template.id) ? (() => {
					const d = debateSummaryMap.get(template.id)!;
					return {
						status: d.status as 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal',
						winningStance: d.winning_stance ?? undefined,
						uniqueParticipants: d.unique_participants,
						argumentCount: d.argument_count,
						deadline: d.deadline?.toISOString() ?? undefined,
					};
				})() : undefined,

				// === AGGREGATE METRICS (consistent structure) ===
				verified_sends: template.verified_sends,
				unique_districts: template.unique_districts,

				// === METRICS OBJECT (backward compatibility) ===
				metrics: {
					sent: template.verified_sends, // Use schema field as source of truth
					districts_covered: template.unique_districts, // Use schema field as source of truth
					total_districts: (jsonMetrics as { total_districts?: number }).total_districts || 435,
					district_coverage_percent:
						(jsonMetrics as { district_coverage_percent?: number }).district_coverage_percent ||
						(template.unique_districts ? Math.round((template.unique_districts / 435) * 100) : 0),
					opened: (jsonMetrics as { opened?: number }).opened || 0,
					clicked: (jsonMetrics as { clicked?: number }).clicked || 0
				},

				// Config
				delivery_config: template.delivery_config,
				recipient_config: template.recipient_config,
				recipientEmails: extractRecipientEmails(template.recipient_config),

				// Metadata
				is_public: template.is_public,

				// Author (C-3: decrypt encrypted_name)
				author: template.user
					? {
							name: await tryDecryptPii(
								template.user.encrypted_name ? JSON.parse(template.user.encrypted_name) : null,
								template.user.id
							) || 'User',
							avatar: template.user.avatar
						}
					: null,

				createdAt: template.createdAt.toISOString()
			};
		}));

		return {
			templates
		};
	} catch (error) {
		console.error('Browse page load error:', error);
		// Return empty array on error to prevent page crash
		return {
			templates: []
		};
	}
};
