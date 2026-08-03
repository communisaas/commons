/**
 * Owner-scoped localStorage handoff drafts for the org delivery surfaces
 * (Studio → campaigns/new and Studio → emails/compose).
 *
 * Every entry persists as `{ ownerHash, draft }` — the owner stamp lives in
 * the envelope, never inside the payload — and every exported read requires
 * the reading operator's own identity. Org surfaces are always authenticated,
 * so unlike the public template draft store (whose permissive null-owner arm
 * serves genuine guest authoring), these stores FAIL CLOSED: an empty,
 * unknown, or malformed owner reads nothing. The handoff is one-shot — a
 * matching consume returns the payload and deletes the entry; a mismatched
 * read leaves the entry untouched, so one operator can never read or destroy
 * another operator's draft on a shared browser.
 */
import { deriveOwnerHash } from '$lib/stores/templateDraft';
import type { ActiveMessageJob } from '$lib/core/agents/message-job-recovery';
import type { GeographicScopeSource } from '$lib/components/org/os/orgOS.svelte';

/**
 * Studio → campaigns/new (congressional) payload.
 *
 * `campaigns.create` has no recipients/decision-makers parameter (the real
 * targets persist via a template the campaign references), so the Studio
 * artifact rides here as the campaign SHELL (title=subjectLine, body=composed
 * message, type, derived targets) plus carried-count metadata for the banner —
 * never a faked recipient binding the create mutation can't store.
 */
export interface OrgCampaignDraft {
	source: 'studio';
	title: string;
	body: string;
	type: 'CONGRESSIONAL';
	targetCountry?: string;
	targetJurisdiction?: string;
	createdAt: number;
	metadata: {
		processId: string;
		title: string;
		decisionMakerCount: number;
		sourceCount: number;
		geographicScopeLabel?: string;
	};
}

/** Studio → org email composer payload. */
export interface OrgEmailComposeDraft {
	source: 'studio';
	subject: string;
	bodyHtml: string;
	createdAt: number;
	metadata: {
		processId: string;
		title: string;
		decisionMakerCount: number;
		sourceCount: number;
		evaluatedSourceCount?: number;
		searchOnlySourceCount?: number;
		messageJobId?: string;
		messageInputHash?: string;
		messageJobStatus?: ActiveMessageJob['status'];
		messageTraceId?: string;
		geographicScopeLabel?: string;
		geographicScopeSource?: GeographicScopeSource;
		geographicScopeBasis?: string;
	};
}

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

// Shape of a deriveOwnerHash output (SHA-256 → first 16 hex chars). A stored
// stamp that fails this shape is treated as unowned garbage and never matches.
const OWNER_HASH_SHAPE = /^[a-f0-9]{16}$/u;

/** Envelope: the owner stamp sits beside the payload, never inside it. */
interface StoredOrgDraft<T> {
	ownerHash: string;
	draft: T;
}

type DraftStorage<T> = Record<string, StoredOrgDraft<T>>;

export interface OrgDraftStore<T> {
	/**
	 * Stamp the caller's owner hash and persist the draft. Returns the new
	 * draft id, or `null` (writing nothing) when `ownerId` is empty.
	 */
	save(draft: T, ownerId: string): Promise<string | null>;
	/**
	 * One-shot owner-scoped read. Returns the payload and deletes the entry
	 * only when the stored owner stamp matches the caller's derived hash.
	 * Returns `null` — leaving the entry untouched — for an empty draftId or
	 * ownerId, a missing entry, a malformed stored stamp, or a mismatch.
	 */
	consume(draftId: string, ownerId: string): Promise<T | null>;
}

function createOrgDraftStore<T extends { createdAt: number }>(config: {
	storageKey: string;
	idPrefix: string;
}): OrgDraftStore<T> {
	const { storageKey, idPrefix } = config;

	function loadDrafts(): DraftStorage<T> {
		if (typeof localStorage === 'undefined') return {};
		try {
			const stored = localStorage.getItem(storageKey);
			if (!stored) return {};
			const parsed = JSON.parse(stored);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
			return parsed as DraftStorage<T>;
		} catch {
			return {};
		}
	}

	function saveDrafts(drafts: DraftStorage<T>): void {
		if (typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(storageKey, JSON.stringify(drafts));
		} catch {
			// localStorage can be unavailable/full. The caller keeps the UI stable.
		}
	}

	function pruneDrafts(drafts: DraftStorage<T>): DraftStorage<T> {
		const cutoff = Date.now() - DRAFT_TTL_MS;
		return Object.fromEntries(
			// Guard the per-entry shape — localStorage can hold a malformed/null
			// value that would throw on `entry.draft.createdAt`. Drop anything
			// not well-formed.
			Object.entries(drafts).filter(([, entry]) => {
				const createdAt = (entry as Partial<StoredOrgDraft<T>> | null)?.draft?.createdAt;
				return typeof createdAt === 'number' && createdAt >= cutoff;
			})
		);
	}

	function generateId(): string {
		return `${idPrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}

	return {
		async save(draft: T, ownerId: string): Promise<string | null> {
			if (!ownerId) return null;
			const ownerHash = await deriveOwnerHash(ownerId);
			const draftId = generateId();
			const drafts = pruneDrafts(loadDrafts());
			drafts[draftId] = { ownerHash, draft };
			saveDrafts(drafts);
			return draftId;
		},

		async consume(draftId: string, ownerId: string): Promise<T | null> {
			if (!draftId || !ownerId) return null;
			const drafts = pruneDrafts(loadDrafts());
			const entry = drafts[draftId];
			if (!entry) {
				saveDrafts(drafts);
				return null;
			}
			const stored = entry.ownerHash;
			if (typeof stored !== 'string' || !OWNER_HASH_SHAPE.test(stored)) {
				// Unowned/malformed stamp: invisible. It ages out via the TTL prune.
				saveDrafts(drafts);
				return null;
			}
			const callerHash = await deriveOwnerHash(ownerId);
			if (stored !== callerHash) {
				// Another operator's draft: unreadable AND undeletable from here.
				saveDrafts(drafts);
				return null;
			}
			delete drafts[draftId];
			saveDrafts(drafts);
			return entry.draft;
		}
	};
}

/** Studio → campaigns/new handoff parking lot. */
export const orgCampaignDrafts = createOrgDraftStore<OrgCampaignDraft>({
	storageKey: 'commons_org_campaign_drafts',
	idPrefix: 'org-campaign'
});

/** Studio → org email composer handoff parking lot. */
export const orgEmailComposeDrafts = createOrgDraftStore<OrgEmailComposeDraft>({
	storageKey: 'commons_org_email_compose_drafts',
	idPrefix: 'org-email'
});

/**
 * Owner-scoped key for the email composer's single-record inline autosave
 * (a per-operator-per-org record, not an id-keyed map — so it stays outside
 * the factory above). Returns `null` unless `ownerHash` is a shape-valid
 * deriveOwnerHash output, so every read/write/remove fails closed while the
 * active operator's hash is unresolved. The `commons` prefix is load-bearing:
 * it keeps the key inside the logout sweep's prefix contract.
 */
export function orgComposeAutosaveKey(ownerHash: string | null, orgId: string): string | null {
	if (!ownerHash || !OWNER_HASH_SHAPE.test(ownerHash)) return null;
	return `commons_org_compose_draft:${ownerHash}:${orgId}`;
}
