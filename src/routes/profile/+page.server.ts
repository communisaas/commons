import { redirect } from '@sveltejs/kit';
import { serverQuery } from 'convex-sveltekit';
import { api } from '$lib/convex';
import type { Id } from '$convex/_generated/dataModel';
import type { PageServerLoad } from './$types';

type ProfileTemplateDTO = {
	id: string;
	title: string;
	slug: string;
	status: string;
	isPublic: boolean;
	createdAt: string;
	useCount: number;
};

type ProfileRepresentativeDTO = {
	name: string;
	party: string | null;
	chamber: string;
	state: string | null;
	district: string | null;
};

function toProfileGroundState(state: unknown) {
	if (!state || typeof state !== 'object') return null;
	const record = state as {
		vault?: { status?: string } | null;
		cell?: {
			cellId?: string;
			h3Cell?: string;
			source?: string;
			expiresAt?: number;
		} | null;
		wrappers?: Array<{ status?: string }>;
	};

	return {
		vault: record.vault
			? {
					status: record.vault.status
				}
			: null,
		cell: record.cell
			? {
					cellId: record.cell.cellId,
					h3Cell: record.cell.h3Cell,
					source: record.cell.source,
					expiresAt: record.cell.expiresAt
				}
			: null,
		wrappers: Array.isArray(record.wrappers)
			? record.wrappers.map((wrapper) => ({ status: wrapper.status }))
			: []
	};
}

function toProfileGroundCredential(state: unknown) {
	if (!state || typeof state !== 'object') return null;
	const credential = (state as { credential?: unknown }).credential;
	if (!credential || typeof credential !== 'object') return null;
	const record = credential as {
		district?: string | null;
		districtCredentialId?: string | null;
		districtCommitment?: string | null;
		slotCount?: number | null;
		source?: string | null;
		issuedAt?: number | null;
		expiresAt?: number | null;
	};
	return {
		district: record.district ?? null,
		districtCredentialId: record.districtCredentialId ?? null,
		districtCommitment: record.districtCommitment ?? null,
		slotCount: record.slotCount ?? null,
		source: record.source ?? null,
		issuedAt: record.issuedAt ?? null,
		expiresAt: record.expiresAt ?? null
	};
}

const isoDate = (value: number | string | Date | null | undefined): string | null => {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === 'number') return new Date(value).toISOString();
	if (typeof value === 'string') return value;
	return null;
};

const countRelations = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		throw redirect(302, '/');
	}

	let convexProfile = null;
	let convexTemplates = null;
	let convexReps = null;
	let convexGroundState = null;
	let convexGroundRestoreState = null;
	let convexBudget: {
		tierBypass: boolean;
		nextAllowedAt: number | null;
		recentCount: number;
		periodCap: number;
		windowMs: number;
		emailSybilTripped: boolean;
	} | null = null;
	try {
		[
			convexProfile,
			convexTemplates,
			convexReps,
			convexBudget,
			convexGroundState,
			convexGroundRestoreState
		] =
			await Promise.all([
				serverQuery(api.users.getProfile, {}),
				serverQuery(api.users.getMyTemplates, {}),
				serverQuery(api.users.getMyRepresentatives, {}),
				serverQuery(api.users.getReverificationBudget, { userId: locals.user.id as Id<'users'> }),
				serverQuery(api.ground.getMyGroundState, {}),
				serverQuery(api.ground.getMyGroundRestoreState, {})
			]);
	} catch (err) {
		console.error(
			'[Profile Page] Convex query failed:',
			err instanceof Error ? err.message : String(err)
		);
	}

	const templates: ProfileTemplateDTO[] = (convexTemplates ?? []).map((template) => ({
		id: template._id,
		title: template.title,
		slug: template.slug,
		status: template.status,
		isPublic: template.isPublic,
		createdAt: isoDate(template._creationTime) ?? new Date(0).toISOString(),
		useCount: countRelations((template as { campaigns?: unknown }).campaigns)
	}));
	const templateStats = templates.reduce(
		(acc, template) => {
			acc.total++;
			if (template.status === 'published') acc.published++;
			if (template.isPublic) acc.public++;
			acc.totalUses += template.useCount;
			return acc;
		},
		{ total: 0, published: 0, public: 0, totalUses: 0, totalSent: 0, totalDelivered: 0 }
	);
	const addressVerifiedAt = convexProfile?.addressVerifiedAt
		? new Date(convexProfile.addressVerifiedAt).toISOString()
		: (locals.user.address_verified_at?.toISOString() ?? null);
	const profileGroundState = toProfileGroundState(convexGroundState);

	return {
		user: {
			id: locals.user.id,
			email: convexProfile?.email ?? locals.user.email,
			name: convexProfile?.name ?? locals.user.name,
			avatar: convexProfile?.avatar ?? locals.user.avatar,
			trust_tier: convexProfile?.trustTier ?? locals.user.trust_tier ?? 0,
			district_verified: convexProfile?.districtVerified ?? locals.user.district_verified ?? false,
			address_verified_at: addressVerifiedAt
		},
		reverificationBudget: convexBudget,
		groundState: {
			...(profileGroundState ?? { vault: null, cell: null, wrappers: [] }),
			credential: toProfileGroundCredential(convexGroundRestoreState)
		},
		streamed: {
			userDetails: Promise.resolve(
				convexProfile
					? {
							id: convexProfile._id,
							name: convexProfile.name,
							email: convexProfile.email,
							avatar: convexProfile.avatar,
							profile: {
								role: convexProfile.role,
								organization: convexProfile.organization,
								connection: convexProfile.connection,
								completed_at: convexProfile.profileCompletedAt ?? null,
								visibility: convexProfile.profileVisibility
							},
							verification: {
								is_verified: convexProfile.isVerified,
								method: convexProfile.verificationMethod,
								verified_at: convexProfile.verifiedAt,
								district_verified: convexProfile.districtVerified,
								address_verified_at: addressVerifiedAt
							},
							reputation: {
								trust_tier: convexProfile.trustTier,
								trust_score: convexProfile.trustScore,
								tier: convexProfile.reputationTier,
								authority_level: null,
								active_months: null,
								templates_contributed: null,
								template_adoption_rate: null,
								peer_endorsements: null
							},
							timestamps: { created_at: convexProfile._creationTime ?? null, updated_at: null }
						}
					: null
			),
			templatesData: Promise.resolve({ templates, templateStats }),
			representatives: Promise.resolve(
				(convexReps ?? []).flatMap((rep): ProfileRepresentativeDTO[] => {
					if (!rep) return [];
					const record = rep as {
						name: string;
						party?: string | null;
						chamber?: string;
						state?: string | null;
						district?: string | null;
						};
						return [
							{
								name: record.name,
								party: record.party ?? null,
								chamber: record.chamber ?? '',
								state: record.state ?? null,
								district: record.district ?? null
							}
						];
					})
				)
		}
	};
};
