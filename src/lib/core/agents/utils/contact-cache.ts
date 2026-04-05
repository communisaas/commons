/**
 * Contact Cache — resolved contacts backed by Convex.
 *
 * Caches decision-maker contact info (email, title, org) for 14 days.
 * Cache hits skip the expensive Exa+Firecrawl+Gemini pipeline.
 *
 * Verification status is tracked separately — Phase 3.5 SMTP checks
 * update the cache so future hits can skip re-verification when fresh.
 */

import { serverQuery, serverMutation } from 'convex-sveltekit';
import { internal } from '$lib/convex';

export interface ResolvedContact {
	orgKey: string;
	name: string;
	title: string;
	email: string;
	emailSource: string | null;
	resolvedBy: string;
}

/**
 * Canonical org key normalization. DUPLICATED in convex/resolvedContacts.ts
 * because Convex functions can't import from $lib/. If you change this,
 * update the copy there too — mismatched keys make the cache write-only.
 */
export function normalizeOrgKey(key: string): string {
	return key.trim().toUpperCase().replace(/\s+/g, ':');
}

/**
 * Look up cached contacts by organization+title pairs.
 * Returns only non-expired entries with verified emails.
 */
export async function getCachedContacts(
	pairs: Array<{ organization: string; title: string }>
): Promise<ResolvedContact[]> {
	if (pairs.length === 0) return [];

	try {
		const normalizedPairs = pairs.map(p => ({
			orgKey: normalizeOrgKey(p.organization),
			title: p.title,
		}));

		const results = await serverQuery(internal.resolvedContacts.getCached, {
			pairs: normalizedPairs,
		});

		return (results || []).map((r: {
			orgKey: string;
			name: string | null;
			title: string | null;
			email: string;
			emailSource: string | null;
		}) => ({
			orgKey: r.orgKey,
			name: r.name ?? '',
			title: r.title ?? '',
			email: r.email,
			emailSource: r.emailSource,
			resolvedBy: 'cache',
		}));
	} catch (err) {
		console.warn('[contact-cache] getCachedContacts failed (non-fatal):', err);
		return [];
	}
}

/**
 * Persist resolved contacts to cache after synthesis.
 * Called fire-and-forget from gemini-provider after deduplication.
 */
export async function upsertResolvedContacts(
	contacts: Array<{
		organization: string;
		title: string;
		name: string;
		email: string;
		emailSource?: string;
	}>
): Promise<void> {
	if (contacts.length === 0) return;

	const withEmail = contacts.filter(c => c.email?.includes('@'));
	if (withEmail.length === 0) return;

	try {
		await serverMutation(internal.resolvedContacts.upsert, {
			contacts: withEmail.map(c => ({
				orgKey: normalizeOrgKey(c.organization),
				title: c.title,
				name: c.name,
				email: c.email,
				emailSource: c.emailSource,
			})),
		});
	} catch (err) {
		console.warn('[contact-cache] upsertResolvedContacts failed (non-fatal):', err);
	}
}

/**
 * Write back email verification status (deliverable/risky/undeliverable).
 * Called from decision-maker after Phase 3.5 SMTP verification.
 */
export type ContactVerificationStatus = 'deliverable' | 'risky' | 'undeliverable';

export async function updateContactVerification(
	updates: Array<{
		organization: string;
		title: string;
		verificationStatus: ContactVerificationStatus;
	}>
): Promise<void> {
	if (updates.length === 0) return;

	try {
		await serverMutation(internal.resolvedContacts.updateVerification, {
			updates: updates.map(u => ({
				orgKey: normalizeOrgKey(u.organization),
				title: u.title,
				verificationStatus: u.verificationStatus,
			})),
		});
	} catch (err) {
		console.warn('[contact-cache] updateContactVerification failed (non-fatal):', err);
	}
}
