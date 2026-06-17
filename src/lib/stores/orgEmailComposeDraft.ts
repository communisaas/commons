import type { ActiveMessageJob } from '$lib/core/agents/message-job-recovery';
import type { GeographicScopeSource } from '$lib/components/org/os/orgOS.svelte';

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

const STORAGE_KEY = 'commons_org_email_compose_drafts';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type DraftStorage = Record<string, OrgEmailComposeDraft>;

function loadDrafts(): DraftStorage {
	if (typeof localStorage === 'undefined') return {};
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (!stored) return {};
		const parsed = JSON.parse(stored);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed as DraftStorage;
	} catch {
		return {};
	}
}

function saveDrafts(drafts: DraftStorage): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
	} catch {
		// localStorage can be unavailable/full. The caller will still keep the UI stable.
	}
}

function pruneDrafts(drafts: DraftStorage): DraftStorage {
	const cutoff = Date.now() - DRAFT_TTL_MS;
	return Object.fromEntries(
		// Guard the per-entry shape — localStorage can hold a malformed/null value
		// that would throw on `draft.createdAt`. Drop anything not well-formed.
		Object.entries(drafts).filter(([, draft]) => {
			const createdAt = (draft as Partial<OrgEmailComposeDraft> | null)?.createdAt;
			return typeof createdAt === 'number' && createdAt >= cutoff;
		})
	);
}

export function generateOrgEmailComposeDraftId(): string {
	return `org-email-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveOrgEmailComposeDraft(draft: OrgEmailComposeDraft): string {
	const draftId = generateOrgEmailComposeDraftId();
	const drafts = pruneDrafts(loadDrafts());
	drafts[draftId] = draft;
	saveDrafts(drafts);
	return draftId;
}

export function getOrgEmailComposeDraft(draftId: string): OrgEmailComposeDraft | null {
	if (!draftId) return null;
	const drafts = pruneDrafts(loadDrafts());
	const draft = drafts[draftId] ?? null;
	saveDrafts(drafts);
	return draft;
}

export function deleteOrgEmailComposeDraft(draftId: string): void {
	if (!draftId || typeof localStorage === 'undefined') return;
	const drafts = loadDrafts();
	delete drafts[draftId];
	saveDrafts(drafts);
}
