/**
 * Org membership and role checking helpers for Convex functions.
 *
 * Port of src/lib/server/org.ts patterns to Convex's query/mutation context.
 * No SvelteKit imports — pure Convex code.
 */

import { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { computeEmailHash } from "./_pii";

export type OrgRole = "owner" | "editor" | "member";

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  member: 0,
  editor: 1,
  owner: 2,
};

/**
 * Check if user is authenticated, throw if not.
 * Looks up the user in the users table by email from the auth identity.
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx,
): Promise<{ userId: Id<"users">; tokenIdentifier: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  // Prefer tokenIdentifier (guaranteed by Convex), fall back to email
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (user) return { userId: user._id, tokenIdentifier: identity.tokenIdentifier };

  // Fallback: email hash lookup (tokenIdentifier may not be set yet for legacy users)
  if (identity.email) {
    const emailHash = await computeEmailHash(identity.email);
    if (emailHash) {
      const userByHash = await ctx.db
        .query("users")
        .withIndex("by_emailHash", (q) => q.eq("emailHash", emailHash))
        .unique();
      if (userByHash) return { userId: userByHash._id, tokenIdentifier: identity.tokenIdentifier };
    }
  }
  throw new Error("User not found");
}

/**
 * Load org by slug, throw 404 if not found.
 */
export async function loadOrg(
  ctx: QueryCtx | MutationCtx,
  slug: string,
): Promise<Doc<"organizations">> {
  const org = await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();

  if (!org) {
    throw new Error("Organization not found");
  }

  return org;
}

/**
 * Load org membership, throw 403 if not a member.
 */
export async function requireOrgMembership(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  userId: Id<"users">,
): Promise<Doc<"orgMemberships">> {
  const membership = await ctx.db
    .query("orgMemberships")
    .withIndex("by_userId_orgId", (q) => q.eq("userId", userId).eq("orgId", orgId))
    .first();

  if (!membership) {
    throw new Error("You are not a member of this organization");
  }

  return membership;
}

/**
 * Check minimum role level. Throws if insufficient.
 * Hierarchy: member (0) < editor (1) < owner (2)
 */
export function requireRole(
  membership: Doc<"orgMemberships">,
  minimumRole: OrgRole,
): void {
  const currentLevel = ROLE_HIERARCHY[membership.role as OrgRole] ?? -1;
  if (currentLevel < ROLE_HIERARCHY[minimumRole]) {
    throw new Error(`Requires ${minimumRole} role or higher`);
  }
}

/**
 * Combined: auth + org lookup + membership + role check in one call.
 */
export async function requireOrgRole(
  ctx: QueryCtx | MutationCtx,
  slug: string,
  minimumRole: OrgRole,
): Promise<{
  org: Doc<"organizations">;
  membership: Doc<"orgMemberships">;
  userId: Id<"users">;
}> {
  const { userId } = await requireAuth(ctx);
  const org = await loadOrg(ctx, slug);
  const membership = await requireOrgMembership(ctx, org._id, userId);
  requireRole(membership, minimumRole);

  return { org, membership, userId };
}

/**
 * Verify a resource belongs to an org. Prevents cross-tenant access
 * where auth checks pass on slug but raw IDs bypass org scoping.
 */
export async function requireResourceOwnership(
  ctx: QueryCtx | MutationCtx,
  table: string,
  resourceId: any,
  orgId: any,
  orgIdField: string = "orgId"
): Promise<void> {
  const doc = await ctx.db.get(resourceId);
  if (!doc) throw new Error("Resource not found");
  if ((doc as any)[orgIdField] !== orgId) throw new Error("Access denied — resource belongs to another organization");
}
