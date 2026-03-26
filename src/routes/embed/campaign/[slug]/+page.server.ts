// CONVEX: Keep SvelteKit — form action uses PII encryption, billing, rate limiting, debate auto-spawn, waitUntil
import { error, fail } from '@sveltejs/kit';
import { db } from '$lib/core/db';
import { getRateLimiter } from '$lib/core/security/rate-limiter';
import { getOrgUsage, isOverLimit } from '$lib/server/billing/usage';
import { dispatchTrigger } from '$lib/server/automation/trigger';
import { spawnDebateForCampaign } from '$lib/server/debates/spawn';
import { FEATURES } from '$lib/config/features';
import { computeEmailHash, encryptPii } from '$lib/core/crypto/user-pii-encryption';
import { findSupporterByEmail } from '$lib/server/supporters/find-by-email';
import type { PageServerLoad, Actions } from './$types';

import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';

export const load: PageServerLoad = async ({ params }) => {
	const campaign = await serverQuery(api.campaigns.getPublic, { campaignId: params.slug });
	if (!campaign || campaign.status !== 'ACTIVE') {
		throw error(404, 'Campaign not found or inactive');
	}

	return {
		campaign: {
			id: campaign._id,
			title: campaign.title,
			body: campaign.body ?? null,
			type: campaign.type,
			orgName: campaign.orgName ?? '',
			orgSlug: campaign.orgSlug ?? '',
			verifiedActions: campaign.verifiedActionCount ?? 0
		}
	};
};

export const actions: Actions = {
	default: async ({ request, params, getClientAddress, platform }) => {
		// Look up the campaign (must be ACTIVE)
		const campaign = await db.campaign.findFirst({
			where: { id: params.slug, status: 'ACTIVE' },
			select: { id: true, orgId: true, type: true, _count: { select: { actions: { where: { verified: true } } } } }
		});

		if (!campaign) {
			return fail(404, { error: 'Campaign not found or inactive' });
		}

		// Rate limit: 10 submissions per minute per IP per campaign
		const ip = getClientAddress();
		const rlKey = `ratelimit:embed:${params.slug}:${ip}`;
		const rl = await getRateLimiter().check(rlKey, { maxRequests: 10, windowMs: 60_000 });
		if (!rl.allowed) {
			return fail(429, { error: 'Too many submissions. Please try again later.' });
		}

		// Billing usage check — enforce action limits
		const usage = await getOrgUsage(campaign.orgId);
		if (isOverLimit(usage).actions) {
			return fail(403, { error: 'This campaign has reached its action limit for the current billing period.' });
		}

		const formData = await request.formData();
		const email = formData.get('email')?.toString().trim().toLowerCase();
		const name = formData.get('name')?.toString().trim();
		const postalCode = formData.get('postalCode')?.toString().trim() || null;
		const phone = formData.get('phone')?.toString().trim() || null;
		const message = formData.get('message')?.toString().trim() || null;

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
			return fail(400, { error: 'Invalid email address' });
		}

		// Find or create supporter (dedup on orgId + email_hash, plaintext fallback)
		let supporter = await findSupporterByEmail(campaign.orgId, email);

		let isNewSupporter = false;
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
					phone,
					source: 'widget',
					encrypted_email: eEnc,
					email_hash: eHash
				}
			});
			isNewSupporter = true;
		} else {
			// Update name/postal/phone if provided and not already set
			const updates: Record<string, string> = {};
			if (name && !supporter.name) updates.name = name;
			if (postalCode && !supporter.postalCode) updates.postalCode = postalCode;
			if (phone && !supporter.phone) updates.phone = phone;

			if (Object.keys(updates).length > 0) {
				await db.supporter.update({
					where: { id: supporter.id },
					data: updates
				});
			}
		}

		// Fire-and-forget: dispatch supporter_created trigger
		if (isNewSupporter) {
			void dispatchTrigger(campaign.orgId, 'supporter_created', { entityId: supporter.id, supporterId: supporter.id });
		}

		// Compute messageHash if a message was provided (for ALD uniqueness)
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
			// Already submitted — return success without creating duplicate
			const actionCount = await db.campaignAction.count({
				where: { campaignId: campaign.id, verified: true }
			});
			return { success: true, actionCount, alreadySubmitted: true };
		}

		// Create the campaign action
		await db.campaignAction.create({
			data: {
				campaignId: campaign.id,
				supporterId: supporter.id,
				verified: false,
				engagementTier: 0,
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

		// Get updated verified action count
		const actionCount = await db.campaignAction.count({
			where: { campaignId: campaign.id, verified: true }
		});

		return { success: true, actionCount };
	}
};
