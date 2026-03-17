/**
 * AN Import Pipeline
 *
 * Core sync logic:
 * 1. Fetches people (with optional `since` filter for incremental)
 * 2. Maps each person to the Supporter model
 * 3. Dedup on (orgId, email) — same as CSV import
 * 4. Subscription status: strictest wins
 * 5. Tags: union (additive)
 * 6. Custom fields: merge (fill nulls)
 * 7. Source: 'action_network'
 * 8. Fetches action types and maps participation to CampaignAction
 * 9. Updates AnSync progress throughout
 */

import type { PrismaClient } from '@prisma/client';
import { dispatchTrigger } from '$lib/server/automation/trigger';
import {
	fetchPeople,
	fetchTags,
	fetchPetitions,
	fetchSignatures,
	fetchEvents,
	fetchAttendances,
	fetchForms,
	fetchSubmissions,
	fetchAdvocacyCampaigns,
	fetchOutreaches,
	countResource,
	type ANPerson,
	type ANTag
} from './client';
import { createHash } from 'node:crypto';

// ── Constants ────────────────────────────────────────────────

const BATCH_SIZE = 100;
const PROGRESS_INTERVAL = 25;

// Email status strictness ordering — higher index = stricter
const EMAIL_STATUS_RANK: Record<string, number> = {
	subscribed: 0,
	unsubscribed: 1,
	bounced: 2,
	complained: 3
};

// ── Helpers ──────────────────────────────────────────────────

function stricterStatus(a: string, b: string): string {
	const rankA = EMAIL_STATUS_RANK[a] ?? 0;
	const rankB = EMAIL_STATUS_RANK[b] ?? 0;
	return rankA >= rankB ? a : b;
}

function sha256(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

/**
 * Extract the AN identifier from identifiers array.
 * Format: "action_network:abc123-def456-..."
 */
function extractAnId(identifiers?: string[]): string | null {
	if (!identifiers) return null;
	for (const id of identifiers) {
		if (id.startsWith('action_network:')) {
			return id.slice('action_network:'.length);
		}
	}
	return null;
}

/**
 * Map AN email status to our status.
 * AN uses: subscribed, unsubscribed, bouncing, spam_complaint
 */
function mapEmailStatus(anStatus?: string): string {
	switch (anStatus) {
		case 'unsubscribed':
			return 'unsubscribed';
		case 'bouncing':
			return 'bounced';
		case 'spam_complaint':
			return 'complained';
		default:
			return 'subscribed';
	}
}

/**
 * Map AN person to supporter fields.
 */
function mapPerson(person: ANPerson): {
	email: string;
	name: string | null;
	postalCode: string | null;
	country: string | null;
	phone: string | null;
	emailStatus: string;
	customFields: Record<string, string>;
} | null {
	// Find primary email
	const primaryEmail = person.email_addresses?.find((e) => e.primary) ?? person.email_addresses?.[0];
	if (!primaryEmail?.address) return null;

	const email = primaryEmail.address.toLowerCase().trim();
	if (!email.includes('@')) return null;

	// Name
	const nameParts = [person.given_name, person.family_name].filter(Boolean);
	const name = nameParts.length > 0 ? nameParts.join(' ') : null;

	// Address
	const primaryAddress = person.postal_addresses?.[0];
	const postalCode = primaryAddress?.postal_code || null;
	const country = primaryAddress?.country || null;

	// Phone
	const primaryPhone = person.phone_numbers?.find((p) => p.primary) ?? person.phone_numbers?.[0];
	const phone = primaryPhone?.number || null;

	// Email status
	const emailStatus = mapEmailStatus(primaryEmail.status);

	// Custom fields
	const customFields = person.custom_fields ?? {};

	return { email, name, postalCode, country, phone, emailStatus, customFields };
}

// ── Campaign type mapping ────────────────────────────────────

type ANActionType = 'petitions' | 'events' | 'forms' | 'advocacy_campaigns';

function anTypeToCampaignType(anType: ANActionType): string {
	switch (anType) {
		case 'petitions':
			return 'LETTER';
		case 'events':
			return 'EVENT';
		case 'forms':
			return 'FORM';
		case 'advocacy_campaigns':
			return 'LETTER';
	}
}

// ── Main sync function ───────────────────────────────────────

export async function runSync(
	syncId: string,
	orgId: string,
	apiKey: string,
	syncType: 'full' | 'incremental',
	lastSyncAt: Date | null,
	prisma: PrismaClient
): Promise<void> {
	const errors: string[] = [];
	let imported = 0;
	let updated = 0;
	let skipped = 0;

	try {
		// Mark as running
		await prisma.anSync.update({
			where: { id: syncId },
			data: {
				status: 'running',
				startedAt: new Date(),
				currentResource: 'people',
				errors: []
			}
		});

		// ── Phase 1: Count total resources ─────────────────────
		let totalResources = 0;
		try {
			totalResources = await countResource(apiKey, 'people');
		} catch {
			// Non-fatal — progress bar won't show percentage
		}

		await prisma.anSync.update({
			where: { id: syncId },
			data: { totalResources }
		});

		// ── Phase 2: Fetch and sync AN tags ────────────────────
		await prisma.anSync.update({
			where: { id: syncId },
			data: { currentResource: 'tags' }
		});

		const anTagHrefToId = new Map<string, string>(); // AN tag self href → local tag ID
		try {
			for await (const anTag of fetchTags(apiKey)) {
				if (!anTag.name) continue;
				const tagName = anTag.name.trim();
				if (!tagName) continue;

				// Upsert tag
				const existing = await prisma.tag.findUnique({
					where: { orgId_name: { orgId, name: tagName } }
				});
				const localId = existing
					? existing.id
					: (await prisma.tag.create({ data: { orgId, name: tagName } })).id;

				// Map the AN tag's self href to the local ID so taggings can resolve it
				const selfHref = anTag._links?.self?.href;
				if (selfHref) {
					anTagHrefToId.set(selfHref, localId);
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`Tags fetch failed: ${msg}`);
		}

		// ── Phase 3: Fetch and sync people ─────────────────────
		await prisma.anSync.update({
			where: { id: syncId },
			data: { currentResource: 'people' }
		});

		const since = syncType === 'incremental' && lastSyncAt ? lastSyncAt : undefined;
		const peopleBatch: ANPerson[] = [];
		let processedCount = 0;

		for await (const person of fetchPeople(apiKey, since)) {
			peopleBatch.push(person);

			if (peopleBatch.length >= BATCH_SIZE) {
				const result = await processPeopleBatch(peopleBatch, orgId, anTagHrefToId, apiKey, prisma);
				imported += result.imported;
				updated += result.updated;
				skipped += result.skipped;
				if (result.errors.length > 0) errors.push(...result.errors);

				processedCount += peopleBatch.length;
				peopleBatch.length = 0;

				// Update progress
				await prisma.anSync.update({
					where: { id: syncId },
					data: { processedResources: processedCount, imported, updated, skipped }
				});
			} else if (peopleBatch.length % PROGRESS_INTERVAL === 0) {
				// Intermediate progress update
				await prisma.anSync.update({
					where: { id: syncId },
					data: { processedResources: processedCount + peopleBatch.length }
				});
			}
		}

		// Process remaining batch
		if (peopleBatch.length > 0) {
			const result = await processPeopleBatch(peopleBatch, orgId, anTagHrefToId, apiKey, prisma);
			imported += result.imported;
			updated += result.updated;
			skipped += result.skipped;
			if (result.errors.length > 0) errors.push(...result.errors);
			processedCount += peopleBatch.length;
		}

		await prisma.anSync.update({
			where: { id: syncId },
			data: { processedResources: processedCount, imported, updated, skipped }
		});

		// ── Phase 4: Fetch actions (petitions, events, forms, advocacy campaigns) ──
		if (syncType === 'full') {
			await syncActions(syncId, orgId, apiKey, errors, prisma);
		}

		// ── Complete ───────────────────────────────────────────
		await prisma.anSync.update({
			where: { id: syncId },
			data: {
				status: 'completed',
				completedAt: new Date(),
				lastSyncAt: new Date(),
				imported,
				updated,
				skipped,
				currentResource: null,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				errors: errors.length > 0 ? (errors.slice(0, 100) as any) : null
			}
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		errors.push(`Fatal: ${msg}`);

		await prisma.anSync.update({
			where: { id: syncId },
			data: {
				status: 'failed',
				completedAt: new Date(),
				imported,
				updated,
				skipped,
				currentResource: null,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				errors: errors.slice(0, 100) as any
			}
		});
	}
}

// ── People batch processor ───────────────────────────────────

async function processPeopleBatch(
	people: ANPerson[],
	orgId: string,
	tagHrefToId: Map<string, string>,
	apiKey: string,
	prisma: PrismaClient
): Promise<{ imported: number; updated: number; skipped: number; errors: string[] }> {
	let imported = 0;
	let updated = 0;
	let skipped = 0;
	const errors: string[] = [];

	for (const person of people) {
		try {
			const mapped = mapPerson(person);
			if (!mapped) {
				skipped++;
				continue;
			}

			// Check for existing supporter
			const existing = await prisma.supporter.findUnique({
				where: { orgId_email: { orgId, email: mapped.email } },
				select: {
					id: true,
					name: true,
					postalCode: true,
					phone: true,
					country: true,
					emailStatus: true,
					customFields: true,
					source: true
				}
			});

			if (existing) {
				// Update: fill nulls + strictest email status + merge custom fields
				const updateData: Record<string, unknown> = {};

				if (mapped.name && !existing.name) updateData.name = mapped.name;
				if (mapped.postalCode && !existing.postalCode) updateData.postalCode = mapped.postalCode;
				if (mapped.phone && !existing.phone) updateData.phone = mapped.phone;
				if (mapped.country && !existing.country) updateData.country = mapped.country;

				// Strictest-wins email status
				const newStatus = stricterStatus(existing.emailStatus, mapped.emailStatus);
				if (newStatus !== existing.emailStatus) {
					updateData.emailStatus = newStatus;
				}

				// Merge custom fields (fill nulls)
				const existingCustom = (existing.customFields as Record<string, string> | null) ?? {};
				const mergedCustom = { ...mapped.customFields };
				for (const [key, val] of Object.entries(existingCustom)) {
					if (val != null) mergedCustom[key] = val; // existing values take precedence
				}
				if (Object.keys(mergedCustom).length > 0) {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					updateData.customFields = mergedCustom as any;
				}

				if (Object.keys(updateData).length > 0) {
					await prisma.supporter.update({
						where: { id: existing.id },
						data: updateData
					});
				}

				// Add tags (union, additive) from AN taggings
				await syncPersonTags(person, existing.id, tagHrefToId, apiKey, prisma);

				updated++;
			} else {
				// Create new supporter
				const supporter = await prisma.supporter.create({
					data: {
						orgId,
						email: mapped.email,
						name: mapped.name,
						postalCode: mapped.postalCode,
						phone: mapped.phone,
						country: mapped.country,
						emailStatus: mapped.emailStatus,
						source: 'action_network',
						importedAt: new Date(),
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						customFields: Object.keys(mapped.customFields).length > 0 ? (mapped.customFields as any) : undefined
					}
				});

				// Add tags from AN taggings
				await syncPersonTags(person, supporter.id, tagHrefToId, apiKey, prisma);

				// Fire-and-forget: dispatch supporter_created trigger
				void dispatchTrigger(orgId, 'supporter_created', { entityId: supporter.id, supporterId: supporter.id });

				imported++;
			}
		} catch (err) {
			const email = person.email_addresses?.[0]?.address ?? 'unknown';
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`Person ${email}: ${msg}`);
			skipped++;
		}
	}

	return { imported, updated, skipped, errors };
}

// ── Person tag sync ──────────────────────────────────────────

async function syncPersonTags(
	person: ANPerson,
	supporterId: string,
	tagHrefToId: Map<string, string>,
	apiKey: string,
	prisma: PrismaClient
): Promise<void> {
	if (tagHrefToId.size === 0) return;

	const taggingsUrl = person._links?.['osdi:taggings']?.href;
	if (!taggingsUrl) return;

	try {
		for await (const tagging of (await import('./client')).fetchTaggings(apiKey, taggingsUrl)) {
			// Each tagging links to a tag via _links['osdi:tag'].href
			const tagHref = tagging._links?.['osdi:tag']?.href;
			if (!tagHref) continue;

			// Resolve the AN tag href to a local tag ID using the map built in Phase 2
			const localTagId = tagHrefToId.get(tagHref);
			if (!localTagId) continue;

			// Upsert supporter-tag association
			await prisma.supporterTag.upsert({
				where: {
					supporterId_tagId: { supporterId, tagId: localTagId }
				},
				update: {},
				create: { supporterId, tagId: localTagId }
			});
		}
	} catch {
		// Non-fatal — continue without tags for this person
	}
}

// ── Actions sync ─────────────────────────────────────────────

async function syncActions(
	syncId: string,
	orgId: string,
	apiKey: string,
	errors: string[],
	prisma: PrismaClient
): Promise<void> {
	// Process each action type: petitions, events, forms, advocacy campaigns
	const actionTypes: Array<{
		resource: ANActionType;
		label: string;
		fetchList: typeof fetchPetitions;
		fetchParticipation: (key: string, url: string) => AsyncGenerator<{ created_date?: string; _links?: Record<string, { href: string } | undefined> }, void, undefined>;
		participationKey: string;
	}> = [
		{
			resource: 'petitions',
			label: 'petitions',
			fetchList: fetchPetitions as typeof fetchPetitions,
			fetchParticipation: fetchSignatures as typeof fetchSignatures,
			participationKey: 'person'
		},
		{
			resource: 'events',
			label: 'events',
			fetchList: fetchEvents as typeof fetchEvents,
			fetchParticipation: fetchAttendances as typeof fetchAttendances,
			participationKey: 'person'
		},
		{
			resource: 'forms',
			label: 'forms',
			fetchList: fetchForms as typeof fetchForms,
			fetchParticipation: fetchSubmissions as typeof fetchSubmissions,
			participationKey: 'person'
		},
		{
			resource: 'advocacy_campaigns',
			label: 'advocacy campaigns',
			fetchList: fetchAdvocacyCampaigns as typeof fetchAdvocacyCampaigns,
			fetchParticipation: fetchOutreaches as typeof fetchOutreaches,
			participationKey: 'person'
		}
	];

	for (const actionType of actionTypes) {
		try {
			await prisma.anSync.update({
				where: { id: syncId },
				data: { currentResource: actionType.resource }
			});

			for await (const item of actionType.fetchList(apiKey)) {
				const anId = extractAnId(item.identifiers);
				const title = (item as { title?: string }).title ?? `AN ${actionType.label}`;
				const campaignType = anTypeToCampaignType(actionType.resource);

				// Find or create campaign for this AN action
				let campaign = await prisma.campaign.findFirst({
					where: {
						orgId,
						body: anId ? `an:${anId}` : undefined, // Use body field to store AN reference
						type: campaignType
					}
				});

				if (!campaign && anId) {
					campaign = await prisma.campaign.create({
						data: {
							orgId,
							type: campaignType,
							title: title.slice(0, 255),
							body: `an:${anId}`,
							status: 'COMPLETE'
						}
					});
				}

				if (!campaign) continue;

				// Fetch participation records
				const selfHref = item._links?.self?.href;
				if (!selfHref) continue;

				try {
					for await (const participation of actionType.fetchParticipation(apiKey, selfHref)) {
						// Extract person link to match supporter
						const personHref = participation._links?.['osdi:person']?.href;
						if (!personHref) continue;

						const sentAt = participation.created_date
							? new Date(participation.created_date)
							: new Date();

						// Create campaign action (don't link to supporter — we'd need person→email lookup)
						// We use messageHash to deduplicate
						const actionHash = sha256(`${campaign.id}:${personHref}:${sentAt.toISOString()}`);

						const existingAction = await prisma.campaignAction.findFirst({
							where: { campaignId: campaign.id, messageHash: actionHash }
						});

						if (!existingAction) {
							await prisma.campaignAction.create({
								data: {
									campaignId: campaign.id,
									verified: false,
									engagementTier: 0,
									messageHash: actionHash,
									sentAt
								}
							});
						}
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					errors.push(`${actionType.label} participation: ${msg}`);
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`${actionType.label}: ${msg}`);
		}
	}
}
