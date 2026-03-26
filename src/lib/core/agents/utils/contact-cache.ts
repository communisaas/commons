/**
 * Contact cache stub — original used Prisma orgResolvedContact table.
 * Now backed by Convex (resolved contacts stored in organizations table).
 * These stubs maintain the import contract; full implementation uses
 * serverQuery/serverMutation to Convex when org context is available.
 */

export interface ResolvedContact {
	orgKey: string;
	name: string;
	title: string;
	email: string;
	emailSource: string | null;
	resolvedBy: string;
}

export async function getCachedContacts(
	_orgId: string,
	_orgKeys: string[]
): Promise<Map<string, ResolvedContact>> {
	// Stub: cache miss — agent will resolve fresh
	return new Map();
}

export async function upsertResolvedContacts(
	_orgId: string,
	_contacts: ResolvedContact[],
	_resolvedBy: string
): Promise<void> {
	// Stub: no-op — contacts resolved by agent are not persisted here
	// In production, wire to serverMutation(api.organizations.upsertResolvedContacts)
}

export function normalizeOrgKey(key: string): string {
	return key.trim().toUpperCase().replace(/\s+/g, ':');
}
