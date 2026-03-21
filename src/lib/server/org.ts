import { error } from '@sveltejs/kit';
import { db } from '$lib/core/db';

export type OrgRole = 'owner' | 'editor' | 'member';

export interface OrgContext {
	org: {
		id: string;
		name: string;
		slug: string;
		description: string | null;
		avatar: string | null;
		max_seats: number;
		max_templates_month: number;
		dm_cache_ttl_days: number;
		identity_commitment: string | null;
		createdAt: Date;
	};
	membership: {
		role: OrgRole;
		joinedAt: Date;
	};
}

export interface OrgBilling {
	stripe_customer_id: string | null;
	billing_email: string | null;
	wallet_address: string | null;
}

/**
 * Load org context for the current user.
 * Throws 404 if org not found, 403 if user is not a member.
 */
export async function loadOrgContext(slug: string, userId: string): Promise<OrgContext> {
	const org = await db.organization.findUnique({
		where: { slug },
		include: {
			memberships: {
				where: { userId },
				select: { role: true, joinedAt: true }
			}
		}
	});

	if (!org) {
		throw error(404, 'Organization not found');
	}

	const membership = org.memberships[0];
	if (!membership) {
		throw error(403, 'You are not a member of this organization');
	}

	return {
		org: {
			id: org.id,
			name: org.name,
			slug: org.slug,
			description: org.description,
			avatar: org.avatar,
			max_seats: org.max_seats,
			max_templates_month: org.max_templates_month,
			dm_cache_ttl_days: org.dm_cache_ttl_days,
			identity_commitment: org.identity_commitment,
			createdAt: org.createdAt
		},
		membership: {
			role: membership.role as OrgRole,
			joinedAt: membership.joinedAt
		}
	};
}

/**
 * Load billing-sensitive fields for an org. Use only where needed.
 */
export async function loadOrgBilling(orgId: string): Promise<OrgBilling> {
	const org = await db.organization.findUnique({
		where: { id: orgId },
		select: { stripe_customer_id: true, billing_email: true, wallet_address: true }
	});
	if (!org) throw error(404, 'Organization not found');
	return {
		stripe_customer_id: org.stripe_customer_id,
		billing_email: org.billing_email,
		wallet_address: org.wallet_address
	};
}

/**
 * Require a minimum role level. Throws 403 if insufficient.
 * Hierarchy: owner > editor > member
 */
export function requireRole(current: OrgRole, minimum: OrgRole): void {
	const hierarchy: Record<OrgRole, number> = { member: 0, editor: 1, owner: 2 };
	const currentLevel = hierarchy[current] ?? -1;
	if (currentLevel < hierarchy[minimum]) {
		throw error(403, `Requires ${minimum} role or higher`);
	}
}
