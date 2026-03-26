// CONVEX: Keep SvelteKit — mutation-heavy campaign action form (supporter PII encryption, district verification, billing, debate auto-spawn, waitUntil)
import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { env } from '$env/dynamic/private';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';
import { FEATURES } from '$lib/config/features';
import { hashDistrict } from '$lib/core/identity/district-credential';
import { dispatchTrigger } from '$lib/server/automation/trigger';
import { spawnDebateForCampaign } from '$lib/server/debates/spawn';
import { computeEmailHash, encryptPii } from '$lib/core/crypto/user-pii-encryption';
import { findSupporterByEmail } from '$lib/server/supporters/find-by-email';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const campaign = await db.campaign.findFirst({
		where: { id: params.slug, status: 'ACTIVE' },
		include: {
			org: { select: { name: true, slug: true, avatar: true } },
			_count: { select: { actions: { where: { verified: true } } } }
		}
	});

	if (!campaign) {
		throw error(404, 'Campaign not found');
	}

	// Build debate query: direct debateId first, fall back to template chain
	const debateSelect = {
		id: true,
		template_id: true,
		proposition_text: true,
		status: true,
		deadline: true,
		argument_count: true,
		unique_participants: true,
		total_stake: true,
		winning_stance: true,
		current_prices: true,
		current_epoch: true,
		arguments: {
			select: { argument_index: true, stance: true, weighted_score: true },
			orderBy: { weighted_score: 'desc' as const },
			take: 5
		}
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let debateQuery: Promise<any> = Promise.resolve(null);

	if (FEATURES.DEBATE) {
		if (campaign.debateId) {
			// Direct link: campaign explicitly references a debate
			debateQuery = db.debate.findUnique({ where: { id: campaign.debateId }, select: debateSelect });
		} else if (campaign.debateEnabled && campaign.templateId) {
			// Template chain: campaign → template → debate (prefer active)
			debateQuery = db.debate.findFirst({
				where: { template_id: campaign.templateId },
				orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
				select: debateSelect
			});
		}
	}

	// Parallel queries for stats + optional debate data
	const [totalActions, districtCounts, tierDist, debate] = await Promise.all([
		db.campaignAction.count({
			where: { campaignId: campaign.id }
		}),
		db.campaignAction.groupBy({
			by: ['districtHash'],
			where: { campaignId: campaign.id, verified: true, districtHash: { not: null } },
			_count: true
		}),
		db.campaignAction.groupBy({
			by: ['engagementTier'],
			where: { campaignId: campaign.id, verified: true },
			_count: true,
			orderBy: { engagementTier: 'asc' }
		}),
		debateQuery
	]);

	// Serialize debate data for client (BigInt → string)
	let debateSignal: {
		id: string;
		propositionText: string;
		status: 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal';
		argumentCount: number;
		uniqueParticipants: number;
		totalStake: string;
		deadline: string;
		winningStance: string | null;
		currentPrices: Record<number, string> | null;
		currentEpoch: number | null;
		templateSlug: string | null;
		arguments: Array<{ argumentIndex: number; stance: 'SUPPORT' | 'OPPOSE' | 'AMEND' }>;
	} | null = null;

	if (debate) {
		// Resolve template slug for debate page link
		const template = await db.template.findUnique({
			where: { id: debate.template_id },
			select: { slug: true }
		});

		debateSignal = {
			id: debate.id,
			propositionText: debate.proposition_text,
			status: debate.status as 'active' | 'resolving' | 'resolved' | 'awaiting_governance' | 'under_appeal',
			argumentCount: debate.argument_count,
			uniqueParticipants: debate.unique_participants,
			totalStake: debate.total_stake.toString(),
			deadline: debate.deadline.toISOString(),
			winningStance: debate.winning_stance,
			currentPrices: debate.current_prices as Record<number, string> | null,
			currentEpoch: debate.current_epoch,
			templateSlug: template?.slug ?? null,
			arguments: debate.arguments.map((arg: { argument_index: number; stance: string }) => ({
				argumentIndex: arg.argument_index,
				stance: arg.stance as 'SUPPORT' | 'OPPOSE' | 'AMEND',
			}))
		};
	}

	return {
		campaign: {
			id: campaign.id,
			title: campaign.title,
			body: campaign.body,
			type: campaign.type,
			orgName: campaign.org.name,
			orgSlug: campaign.org.slug,
			orgAvatar: campaign.org.avatar,
			targets: (campaign.targets as Array<{ name: string; email?: string; title?: string; district?: string }> | null)?.map(t => ({
				name: t.name,
				title: t.title,
				district: t.district
			})) ?? null
		},
		stats: {
			verifiedActions: campaign._count.actions,
			totalActions,
			uniqueDistricts: districtCounts.length,
			tierDistribution: tierDist.map(t => ({
				tier: t.engagementTier,
				count: t._count
			}))
		},
		debateSignal
	};
};

export const actions: Actions = {
	default: async ({ request, params, getClientAddress, platform }) => {
		// Look up the campaign (must be ACTIVE)
		const campaign = await db.campaign.findFirst({
			where: { id: params.slug, status: 'ACTIVE' },
			select: {
				id: true,
				orgId: true,
				type: true,
				title: true
			}
		});

		if (!campaign) {
			return fail(404, { error: 'Campaign not found or inactive' });
		}

		// Rate limit: 10 submissions per minute per IP per campaign
		const ip = getClientAddress();
		const rlKey = `ratelimit:campaign:${params.slug}:${ip}`;
		const rl = await getRateLimiter().check(rlKey, { maxRequests: 10, windowMs: 60_000 });
		if (!rl.allowed) {
			return fail(429, { error: 'Too many submissions. Please try again later.' });
		}

		// Plan limit check — enforce billing tier action caps
		const usage = await getOrgUsage(campaign.orgId);
		if (isOverLimit(usage).actions) {
			return fail(403, { error: 'This campaign has reached its action limit for the current billing period.' });
		}

		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();
		const name = formData.get('name')?.toString().trim();
		const postalCode = formData.get('postalCode')?.toString().trim() || null;
		const message = formData.get('message')?.toString().trim() || null;
		const rawDistrictCode = formData.get('districtCode')?.toString().trim() || null;

		if (message && message.length > 5000) {
			return fail(400, { error: 'Message too long (5000 character maximum)' });
		}

		if (!email) {
			return fail(400, { error: 'Email is required' });
		}

		if (!name) {
			return fail(400, { error: 'Name is required' });
		}

		// Basic email validation
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
			return fail(400, { error: 'Please enter a valid email address' });
		}

		// Find or create supporter (dedup on orgId + email_hash, plaintext fallback)
		let supporter = await findSupporterByEmail(campaign.orgId, email);

		if (!supporter) {
			// C-5: Encrypt email at rest (fail-closed — no empty-string poison pills)
			const supId = crypto.randomUUID();
			const [eHash, eEncRaw] = await Promise.all([
				computeEmailHash(email),
				encryptPii(email, `supporter:${supId}`)
			]);
			if (!eHash || !eEncRaw) throw error(500, 'Supporter email encryption failed');
			const eEnc = JSON.stringify(eEncRaw);
			supporter = await db.supporter.create({
				data: {
					id: supId,
					orgId: campaign.orgId,
					name,
					postalCode,
					source: 'campaign',
					encrypted_email: eEnc,
					email_hash: eHash
				}
			});
		} else {
			// Update fields if not already set
			const updates: Record<string, string> = {};
			if (name && !supporter.name) updates.name = name;
			if (postalCode && !supporter.postalCode) updates.postalCode = postalCode;

			if (Object.keys(updates).length > 0) {
				await db.supporter.update({
					where: { id: supporter.id },
					data: updates
				});
			}
		}

		// ── District-level verification (ADDRESS_SPECIFICITY='district') ──
		// When district code is provided, validate format and use hashDistrict()
		// for a proper congressional district hash (not postal code hash).
		let districtHash: string | null = null;
		let districtVerified = false;
		const districtCodePattern = /^[A-Z]{2}-(\d{2}|AL)$/;

		if (
			FEATURES.ADDRESS_SPECIFICITY === 'district' &&
			rawDistrictCode &&
			districtCodePattern.test(rawDistrictCode)
		) {
			districtHash = await hashDistrict(rawDistrictCode);
			districtVerified = true;
		} else if (postalCode) {
			// Fallback: region-level hash from postal code (existing behavior)
			const salt = env.DISTRICT_HASH_SALT || 'commons-district-v1';
			const encoder = new TextEncoder();
			const hashBuffer = await crypto.subtle.digest(
				'SHA-256',
				encoder.encode(`${salt}:${postalCode.toLowerCase()}`)
			);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			districtHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		}

		// Compute messageHash if a message was provided
		let messageHash: string | null = null;
		if (message) {
			const encoder = new TextEncoder();
			const data = encoder.encode(message);
			const hashBuffer = await crypto.subtle.digest('SHA-256', data);
			const hashArray = Array.from(new Uint8Array(hashBuffer));
			messageHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		}

		// Deduplicate: one action per supporter per campaign
		const existingAction = await db.campaignAction.findFirst({
			where: { campaignId: campaign.id, supporterId: supporter.id }
		});

		if (existingAction) {
			const actionCount = await db.campaignAction.count({
				where: { campaignId: campaign.id, verified: true }
			});
			return {
				success: true,
				actionCount,
				supporterName: name,
				alreadySubmitted: true
			};
		}

		// Create the campaign action
		// Tier 2 = district verified, Tier 1 = postal code, Tier 0 = no location
		const verified = districtVerified || !!postalCode;
		const engagementTier = districtVerified ? 2 : postalCode ? 1 : 0;

		await db.campaignAction.create({
			data: {
				campaignId: campaign.id,
				supporterId: supporter.id,
				verified,
				engagementTier,
				districtHash,
				messageHash
			}
		});

		// Fire-and-forget: dispatch campaign_action trigger
		void dispatchTrigger(campaign.orgId, 'campaign_action', {
			entityId: campaign.id,
			supporterId: supporter.id,
			metadata: { campaignId: campaign.id }
		});

		// Check debate auto-spawn threshold — use waitUntil on CF Workers
		if (FEATURES.DEBATE) {
			const debatePromise = (async () => {
				try {
					const c = await db.campaign.findUnique({
						where: { id: campaign.id },
						select: { debateEnabled: true, debateThreshold: true, debateId: true }
					});
					if (!c?.debateEnabled || c.debateId) return;

					const actionCount = await db.campaignAction.count({
						where: { campaignId: campaign.id, verified: true }
					});
					if (actionCount >= (c.debateThreshold ?? 50)) {
						await spawnDebateForCampaign(campaign.id);
						console.log(`[debate-auto-spawn] Spawned debate for campaign ${campaign.id} at ${actionCount} actions`);
					}
				} catch (e) {
					console.error('[debate-auto-spawn] Failed:', e);
				}
			})();

			if (platform?.context) {
				platform.context.waitUntil(debatePromise);
			} else {
				void debatePromise;
			}
		}

		// Get updated counts
		const [verifiedCount, totalCount] = await Promise.all([
			db.campaignAction.count({
				where: { campaignId: campaign.id, verified: true }
			}),
			db.campaignAction.count({
				where: { campaignId: campaign.id }
			})
		]);

		return {
			success: true,
			actionCount: verifiedCount,
			totalCount,
			supporterName: name,
			verified
		};
	}
};
