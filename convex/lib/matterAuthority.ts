import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { blocked, present, type Fact } from '../../src/lib/core/fact';

export const ORG_MATTER_EXTERNAL_ID_PREFIX = 'org-matter:';
export const ORG_AUTHORED_RELEVANCE_MATCH = 'org_authored';
export const ORG_AUTHORED_RELEVANCE_BLOCK_REASON =
	'Org-authored matter has not been scored against issue-domain evidence';

// Structural safety bound for tenant data, not a billing or plan limit.
export const ORG_MATTER_CAP_PER_ORG = 500;
export const MATTER_TITLE_MAX = 300;
export const MATTER_SUMMARY_MAX = 4_000;
export const MATTER_SOURCE_URL_MAX = 2_048;
export const MATTER_TOPIC_MAX = 64;
export const MATTER_TOPICS_MAX = 12;

export function orgAuthoredRelevanceFact(): Fact<number> {
	return blocked(ORG_AUTHORED_RELEVANCE_BLOCK_REASON);
}

export function measuredMatterRelevanceFact(score: number): Fact<number> {
	return present(score);
}

export function isMatterVisibleToOrg(
	bill: { orgId?: Id<'organizations'> },
	orgId: Id<'organizations'>
): boolean {
	return bill.orgId === undefined || bill.orgId === orgId;
}

export async function assertMatterUsableByOrg(
	ctx: Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>,
	billId: Id<'bills'>,
	orgId: Id<'organizations'>
): Promise<Doc<'bills'>> {
	const bill = await ctx.db.get(billId);
	// A foreign id is deliberately indistinguishable from an absent id so the refusal
	// does not confirm that another organization's matter exists.
	if (!bill || !isMatterVisibleToOrg(bill, orgId)) throw new Error('MATTER_NOT_FOUND');
	return bill;
}

export function assertHttpsSourceUrl(raw: string): string {
	const normalized = raw.trim();
	if (normalized.length === 0 || normalized.length > MATTER_SOURCE_URL_MAX) {
		throw new Error('MATTER_SOURCE_URL_INVALID');
	}
	try {
		const url = new URL(normalized);
		if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0) {
			throw new Error('MATTER_SOURCE_URL_INVALID');
		}
		return url.toString();
	} catch {
		throw new Error('MATTER_SOURCE_URL_INVALID');
	}
}

export async function matterExternalIdDigest(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}
