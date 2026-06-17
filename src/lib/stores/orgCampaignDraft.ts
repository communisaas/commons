/**
 * Client-side handoff for Studio → campaigns/new (congressional). Mirrors
 * orgEmailComposeDraft: localStorage, 24h TTL, one-shot consume-on-read.
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

const STORAGE_KEY = 'commons_org_campaign_drafts';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type DraftStorage = Record<string, OrgCampaignDraft>;

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
		// localStorage can be unavailable/full. The caller keeps the UI stable.
	}
}

function pruneDrafts(drafts: DraftStorage): DraftStorage {
	const cutoff = Date.now() - DRAFT_TTL_MS;
	return Object.fromEntries(
		Object.entries(drafts).filter(([, draft]) => draft.createdAt >= cutoff)
	);
}

export function generateOrgCampaignDraftId(): string {
	return `org-campaign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveOrgCampaignDraft(draft: OrgCampaignDraft): string {
	const draftId = generateOrgCampaignDraftId();
	const drafts = pruneDrafts(loadDrafts());
	drafts[draftId] = draft;
	saveDrafts(drafts);
	return draftId;
}

export function getOrgCampaignDraft(draftId: string): OrgCampaignDraft | null {
	if (!draftId) return null;
	const drafts = pruneDrafts(loadDrafts());
	const draft = drafts[draftId] ?? null;
	saveDrafts(drafts);
	return draft;
}

export function deleteOrgCampaignDraft(draftId: string): void {
	if (!draftId || typeof localStorage === 'undefined') return;
	const drafts = loadDrafts();
	delete drafts[draftId];
	saveDrafts(drafts);
}
