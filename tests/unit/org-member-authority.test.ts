import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function source(rel: string): string {
	return fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
}

describe('org member authority contract', () => {
	it('has guarded Convex mutations for member removal and role changes', () => {
		const organizations = source('convex/organizations.ts');

		expect(organizations).toContain('export const removeMember');
		expect(organizations).toContain('export const updateMemberRole');
		expect(organizations).toContain('Cannot remove the last owner');
		expect(organizations).toContain('Cannot demote the last owner');
		expect(organizations).toContain('ROLE_RANK');
		expect(organizations).toContain('ctx.db.delete(target._id)');
		expect(organizations).toContain('memberCount: Math.max(0, currentCount - 1)');
	});

	it('exposes DELETE and PATCH member authority endpoints', () => {
		const endpoint = source('src/routes/api/org/[slug]/members/+server.ts');

		expect(endpoint).toContain('export const DELETE');
		expect(endpoint).toContain('api.organizations.removeMember');
		expect(endpoint).toContain('export const PATCH');
		expect(endpoint).toContain('api.organizations.updateMemberRole');
		expect(endpoint).toContain("role must be owner, editor, or member");
	});

	it('makes owner-only authority and last-owner guard visible in Org authority UI', () => {
		const settings = source('src/routes/org/[slug]/settings/+page.svelte');

		// In-page member controls: owner-gated mutation UI with last-owner lockout.
		expect(settings).toContain('Role authority');
		expect(settings).toContain('{#if isOwner}');
		expect(settings).toContain('ownerCount');
		expect(settings).toContain('canRemoveMember');
		expect(settings).toContain('roleOptionDisabled');
		expect(settings).toContain('Last owner cannot be demoted');
		expect(settings).toContain('Last owner cannot be removed');

		// The "Role and removal authority" copy moved into the operating-authority
		// readiness rows (capability-hypergraph), which the settings page renders
		// in full via capabilityItems.
		expect(settings).toContain('buildOperatingAuthorityReadiness');
		expect(settings).toContain('operatingAuthorityReadiness.rows.map((row) => ({');

		const readiness = source('src/lib/data/capability-hypergraph.ts');
		expect(readiness).toContain("id: 'role-removal-authority'");
		expect(readiness).toContain("label: 'Role and removal authority'");
		expect(readiness).toContain(
			'Owner role required; rank ceilings and last-owner lockout prevent orphaning the org.'
		);
		expect(readiness).toContain("cite: 'organizations.removeMember/updateMemberRole'");
	});
});
