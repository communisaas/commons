# Brutalist Assessment Round 21 — Foundational Layer Audit

> **Status**: COMPLETE
> **Date**: 2026-03-19
> **Source**: Claude (MCP roast), validated by direct code reads
> **Prior rounds**: R1-R20 (149+ findings addressed)

## Methodology

Targeted foundational infrastructure: `hooks.server.ts`, auth system (`auth.ts`), org context loading (`org.ts`), billing enforcement (`usage.ts`), OAuth callback handler, and settings page. Focus on **auth primitives**, **billing enforcement gaps**, and **serialization boundaries**.

---

## Rejected / Accepted Risk

| Finding | Disposition |
|---------|------------|
| R21-01: Session token cookie === DB hash | ACCEPTED — BA-020 previously reviewed. Cookie stores SHA-256(token), DB stores same hash. Industry-standard stores raw token in cookie + hash in DB so DB leak can't be used directly. Current pattern is a known tradeoff; fixing would invalidate all sessions. Recommend addressing in next auth refactor. |
| R21-02: envShimApplied race condition | REJECTED — CF Workers are single-threaded per isolate. Module-level boolean is set once; no concurrent mutation possible. |
| R21-05: Auth degrades to anonymous on DB error | REJECTED — Intentional design. Comment at hooks.server.ts:129-131 explains: don't delete valid session cookie due to transient DB hiccup. Failing open to anonymous is correct; auth-required routes redirect to login. The alternative (503 on all pages) is worse. |
| R21-06: OAuth auto-links by email without confirmation | ACCEPTED — Standard industry pattern (GitHub, GitLab, etc.). All supported providers (Google, GitHub, LinkedIn, Facebook, Discord, Coinbase) verify email ownership. Twitter uses synthetic `username@twitter.local` emails that won't collide. Would need review if adding a provider that doesn't verify emails. |
| R21-07: Settings member emails to all roles | ACCEPTED — Co-members of the same organization in a management context. This is reasonable disclosure (you know your teammates). |
| R21-08: Mixed role contexts in inline checks | REJECTED — `['editor', 'admin', 'owner']` in events/org pages mixes network role ("admin") with org roles. But "admin" only exists in `OrgNetworkMember`, never in `OrgMembership`. The extra value is harmless dead code, not a bypass. |

---

## Validated Findings

### P1 — High (1)

#### F-R21-01: requireRole silently passes on unknown role values

**File**: `src/lib/server/org.ts:95-100`
**What**: The `requireRole` function uses a `Record<OrgRole, number>` hierarchy lookup. If `current` is any value not in the map (e.g., corrupted DB value, future role added without updating hierarchy), `hierarchy[current]` returns `undefined`. In JavaScript, `undefined < N` evaluates to `false` (NaN comparison), so the error is never thrown — the check silently passes.

The `convex/schema.ts` definition stores the role as `v.string()` with a literal-union narrowing only enforced at the mutation boundary. The `as OrgRole` cast in `loadOrgContext` (line 69) is unsafe. This function is called 76+ times across the codebase — a single bypass here compromises all role-gated endpoints.

**Impact**: Any unknown role string bypasses all `requireRole` checks. Requires DB corruption or schema mismatch to exploit, but the fix is trivial and eliminates an entire class of bypass.

**Solution**: Default unknown roles to -1 (below member):
```ts
export function requireRole(current: OrgRole, minimum: OrgRole): void {
    const hierarchy: Record<OrgRole, number> = { member: 0, editor: 1, owner: 2 };
    const currentLevel = hierarchy[current] ?? -1;
    if (currentLevel < hierarchy[minimum]) {
        throw error(403, `Requires ${minimum} role or higher`);
    }
}
```

**Pitfall**: If "admin" role is ever added to org membership (currently only exists in network membership), it would need to be added to the hierarchy. The `?? -1` fallback makes this safe by default — new roles are denied until explicitly added.

---

### P2 — Medium (2)

#### F-R21-02: max_templates_month billing limit never enforced

**File**: `src/routes/api/templates/+server.ts` (POST handler)
**What**: The `max_templates_month` field is defined in plan limits (10/100/500/1000 per tier), stored on Organization, and updated via Stripe webhook. But template creation (`POST /api/templates`) has no count check. Free-tier orgs can create unlimited templates.

The billing enforcement system (`getOrgUsage` / `isOverLimit`) tracks verified actions and emails but does NOT track template count.

**Impact**: Billing enforcement gap — orgs can exceed their template quota without restriction.

**Solution**: Add template count check at creation time:
```ts
// In POST handler, before db.template.create:
const { org } = await loadOrgContext(slug, locals.user.id);
const templateCount = await db.template.count({
    where: { orgId: org.id, createdAt: { gte: startOfMonth() } }
});
if (templateCount >= org.max_templates_month) {
    throw error(403, 'Monthly template limit reached. Upgrade your plan to create more.');
}
```

**Pitfall**: Template creation at `/api/templates` is user-scoped (`user: { connect: { id: user.id } }`), not org-scoped. Templates get an `orgId` through endorsement, not creation. The enforcement point should be either: (a) when an org endorses a template, (b) when org-scoped template creation is added, or (c) both. This requires a design decision — deferring to next cycle.

---

#### F-R21-03: Settings page invite emails visible to all org members

**File**: `src/routes/org/[slug]/settings/+page.server.ts:53-58`
**What**: The settings page returns pending invite emails to all org members. While the client-side UI hides invite management controls from non-editors (via `canInvite` derived), the raw data including invite emails is in the page source for any org member to inspect.

```ts
invites: invites.map((i) => ({
    id: i.id,
    email: i.email,  // ← visible to all roles
    role: i.role,
    expiresAt: i.expiresAt.toISOString()
})),
```

**Impact**: Minor PII leak — pending invitees' email addresses visible to member-role users who can't act on invitations.

**Solution**: Gate invite data behind editor role:
```ts
const { membership } = await loadOrgContext(org.slug, locals.user.id); // or from parent

// Only return invites to roles that can manage them
invites: ['editor', 'owner'].includes(membership.role)
    ? invites.map(...)
    : [],
```

**Pitfall**: The settings page gets `org` from `await parent()`. The parent layout (`+layout.server.ts`) already returns `membership`, so destructuring `{ org, membership }` from parent is sufficient — no extra DB call needed.

---

## Task Graph

### Cycle 1: All fixes (parallel)

| Task | Finding | File(s) | Agent |
|------|---------|---------|-------|
| T-R21-01: requireRole fallback | F-R21-01 | `src/lib/server/org.ts` | auth-eng |
| T-R21-02: Template limit enforcement | F-R21-02 | `src/routes/api/templates/+server.ts`, `src/lib/server/billing/usage.ts` | billing-eng |
| T-R21-03: Invite data role gate | F-R21-03 | `src/routes/org/[slug]/settings/+page.server.ts` | pii-eng |

**Review Gate G-R21-01**: Verify requireRole fallback, template limit enforced, invite data gated.

---

## Completion Tracking

| Task | Status | Agent | Notes |
|------|--------|-------|-------|
| T-R21-01 | DONE | auth-eng | `hierarchy[current] ?? -1` — unknown roles default below member |
| T-R21-02 | DEFERRED | — | Template creation is user-scoped; enforcement point requires design decision |
| T-R21-03 | DONE | pii-eng | Invites gated to editor/owner via parent() membership |
| G-R21-01 | PASSED | team-lead | requireRole fallback verified, invite data gated. Template limit deferred (design decision needed). |
