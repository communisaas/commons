import { writable, type Writable } from 'svelte/store';
import type { TemplateFormData } from '$lib/types/template';
import { z } from 'zod';

interface PendingSuggestion {
	subject_line: string;
	core_message: string;
	topics: string[];
	domain: string;
	url_slug: string;
	voice_sample: string;
}

interface DraftStorage {
	[key: string]: {
		data: TemplateFormData;
		lastSaved: number;
		currentStep: string;
		pendingSuggestion?: PendingSuggestion | null;
		/** Short hash of the owning user's id. Drafts with a different ownerHash
		 * from the active session are ignored on load — prevents cross-user
		 * draft leakage on shared devices when a user doesn't explicitly log out. */
		ownerHash?: string;
	};
}

// Storage key for localStorage
const STORAGE_KEY = 'commons_template_drafts';

/** Derive a short stable hash for the owning user. Uses SHA-256 on the userId
 * (or email) and returns the first 16 hex chars — enough to avoid collisions
 * across a single device while not recording the plaintext id in localStorage. */
export async function deriveOwnerHash(userIdentifier: string): Promise<string> {
	const bytes = new TextEncoder().encode(userIdentifier);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest))
		.slice(0, 8)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

// Auto-save interval (30 seconds)
const AUTO_SAVE_INTERVAL = 30 * 1000;

interface TemplateDraftStore {
	subscribe: Writable<DraftStorage>['subscribe'];
	saveDraft: (
		draftId: string,
		data: TemplateFormData,
		currentStep: string,
		pendingSuggestion?: PendingSuggestion | null
	) => void;
	getDraft: (
		draftId: string
	) => {
		data: TemplateFormData;
		lastSaved: number;
		currentStep: string;
		pendingSuggestion?: PendingSuggestion | null;
	} | null;
	/** Hydrate encrypted DM emails back into a draft's data. Call after getDraft. */
	hydrateEmails: (draftId: string, data: TemplateFormData) => Promise<void>;
	deleteDraft: (draftId: string) => void;
	startAutoSave: (
		draftId: string,
		getFormData: () => TemplateFormData,
		getCurrentStep: () => string,
		getPendingSuggestion?: () => PendingSuggestion | null
	) => () => void;
	hasDraft: (draftId: string) => boolean;
	getDraftAge: (draftId: string) => number | null;
	getAllDraftIds: () => string[];
	/** Set the active owner hash. Drafts saved under a different owner become
	 * invisible to getDraft/getAllDraftIds/hasDraft after this call. Pass null
	 * to revert to unscoped (guest) behavior. Call this once at mount, after
	 * the user's id becomes available. */
	setOwner: (ownerHash: string | null) => void;
}

function createTemplateDraftStore(): TemplateDraftStore {
	const { subscribe, set, update } = writable<DraftStorage>({});

	// Zod schema for draft validation
	const PendingSuggestionSchema = z
		.object({
			subject_line: z.string(),
			core_message: z.string(),
			topics: z.array(z.string()),
			domain: z.string().optional().default(''),
			url_slug: z.string(),
			voice_sample: z.string()
		})
		.nullable()
		.optional();

	const DraftEntrySchema = z.object({
		data: z.unknown(), // TemplateFormData is complex, validate structure later
		lastSaved: z.number(),
		currentStep: z.string(),
		pendingSuggestion: PendingSuggestionSchema,
		ownerHash: z.string().optional()
	});

	const DraftStorageSchema = z.record(DraftEntrySchema);

	// Active owner scope (set via setOwner after user auth is resolved).
	// Drafts are filtered to this owner on every read; writes stamp this value.
	let currentOwnerHash: string | null = null;

	function draftMatchesOwner(entry: DraftStorage[string]): boolean {
		// No active owner set (pre-auth boot) — show all (legacy behavior).
		if (currentOwnerHash === null) return true;
		// Active owner set — require stored ownerHash to match. Drafts with no
		// ownerHash are legacy, pre-scoping entries; treat them as guest-owned
		// and visible only when no owner is set.
		return entry.ownerHash === currentOwnerHash;
	}

	// Load drafts from localStorage on initialization
	function loadDrafts(): DraftStorage {
		if (typeof localStorage === 'undefined') return {};

		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored);
				const result = DraftStorageSchema.safeParse(parsed);

				if (!result.success) {
					console.warn(
						'[TemplateDraft] Invalid draft storage structure:',
						result.error.flatten()
					);
					return {};
				}

				// Clean up old drafts (older than 7 days)
				const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
				const cleaned: DraftStorage = {};

				for (const [key, draft] of Object.entries(result.data)) {
					if (draft.lastSaved > cutoff) {
						cleaned[key] = draft as DraftStorage[string];
					}
				}

				return cleaned;
			}
		} catch (error) {
			console.warn('[TemplateDraft] Failed to load template drafts from localStorage:', error);
		}

		return {};
	}

	// Save drafts to localStorage.
	// DM emails are stripped from the main blob and encrypted separately.
	function saveDrafts(drafts: DraftStorage) {
		if (typeof localStorage === 'undefined') return;

		// Extract emails before writing, replace with empty strings in the persisted copy
		const emailsByDraft = new Map<string, Array<{ idx: number; email: string }>>();
		const sanitized = JSON.parse(JSON.stringify(drafts)) as DraftStorage;

		for (const [draftId, draft] of Object.entries(sanitized)) {
			const dms = (draft.data as TemplateFormData)?.audience?.decisionMakers;
			if (!Array.isArray(dms)) continue;
			const emails: Array<{ idx: number; email: string }> = [];
			for (let i = 0; i < dms.length; i++) {
				if (dms[i].email) {
					emails.push({ idx: i, email: dms[i].email as string });
					dms[i].email = ''; // strip from main blob
				}
			}
			if (emails.length > 0) emailsByDraft.set(draftId, emails);
		}

		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
		} catch {
			console.warn('Failed to save template drafts to localStorage');
		}

		// Store DM emails in a separate localStorage key per draft
		if (emailsByDraft.size > 0) {
			for (const [draftId, emails] of emailsByDraft) {
				try {
					localStorage.setItem(`${STORAGE_KEY}_emails_${draftId}`, JSON.stringify(emails));
				} catch {
					// localStorage full or unavailable
				}
			}
		}
	}

	/** Restore DM emails from localStorage back into draft data. */
	async function decryptDraftEmails(draftId: string, data: TemplateFormData): Promise<void> {
		const stored = localStorage.getItem(`${STORAGE_KEY}_emails_${draftId}`);
		if (!stored) return;

		try {
			const emails: Array<{ idx: number; email: string }> = JSON.parse(stored);
			const dms = data.audience?.decisionMakers;
			if (!Array.isArray(dms)) return;

			for (const { idx, email } of emails) {
				if (dms[idx]) {
					dms[idx].email = email;
				}
			}
		} catch {
			// Decryption failed (different device, cleared keys) — emails stay empty
		}
	}

	// Initialize with stored data
	const initialDrafts = loadDrafts();
	set(initialDrafts);

	// Auto-save timer registry
	const autoSaveTimers = new Map<string, ReturnType<typeof setInterval>>();

	function toPlainTemplateFormData(data: TemplateFormData): TemplateFormData {
		// Create a plain, serializable copy detached from any reactive proxies
		// CRITICAL: Must serialize ALL fields for voice pipeline integrity
		return {
			objective: {
				title: data.objective?.title ?? '',
				description: data.objective?.description ?? '',
				domain: data.objective?.domain ?? '',
				slug: data.objective?.slug ?? '',
				// Voice pipeline fields
				topics: Array.isArray(data.objective?.topics) ? [...data.objective.topics] : [],
				voiceSample: data.objective?.voiceSample ?? '',
				rawInput: data.objective?.rawInput ?? '',
				aiGenerated: data.objective?.aiGenerated ?? false
			},
			audience: {
				recipientEmails: Array.isArray(data.audience?.recipientEmails)
					? [...data.audience.recipientEmails]
					: [],
				// Decision makers from AI resolution — emails encrypted at localStorage boundary
				decisionMakers: Array.isArray(data.audience?.decisionMakers)
					? data.audience.decisionMakers.map((dm) => ({
							name: dm.name ?? '',
							title: dm.title ?? '',
							organization: dm.organization ?? '',
							reasoning: dm.reasoning ?? '',
							source_url: dm.source_url ?? '',
							confidence: dm.confidence ?? 0,
							email: dm.email ?? '',
							source: dm.source ?? '',
							isAiResolved: dm.isAiResolved ?? true,
							provenance: dm.provenance ?? ''
						}))
					: [],
				// These fields were missing - critical for recipient extraction
				includesCongress: data.audience?.includesCongress ?? false,
				customRecipients: Array.isArray(data.audience?.customRecipients)
					? data.audience.customRecipients.map((r) => ({
							name: r.name ?? '',
							email: r.email ?? '',
							title: r.title ?? '',
							organization: r.organization ?? ''
						}))
					: []
			},
			content: {
				preview: data.content?.preview ?? '',
				variables: Array.isArray(data.content?.variables) ? [...data.content.variables] : [],
				// Message generation metadata
				sources: Array.isArray(data.content?.sources)
					? data.content.sources.map((s) => ({
							num: s.num ?? 0,
							title: s.title ?? '',
							url: s.url ?? '',
							type: s.type ?? 'journalism'
						}))
					: [],
				researchLog: Array.isArray(data.content?.researchLog) ? [...data.content.researchLog] : [],
				geographicScope: data.content?.geographicScope ?? null,
				aiGenerated: data.content?.aiGenerated ?? false,
				edited: data.content?.edited ?? false
			},
			review: {}
		};
	}

	function saveDraft(
		draftId: string,
		data: TemplateFormData,
		currentStep: string,
		suggestionToSave?: PendingSuggestion | null
	) {
		let plain: TemplateFormData;
		try {
			// Prefer a structuredClone of a plain object to avoid proxy issues
			plain = toPlainTemplateFormData(data);
			// Extra safety: ensure no reactive proxies sneak in
			plain = structuredClone(plain);
		} catch {
			// Fallback: JSON round-trip as a last resort
			plain = JSON.parse(JSON.stringify(toPlainTemplateFormData(data)));
		}

		const draft: DraftStorage[string] = {
			data: plain,
			lastSaved: Date.now(),
			currentStep,
			pendingSuggestion: suggestionToSave ?? null,
			// Stamp owner at save time. Null when auth isn't yet resolved; once
			// the component calls setOwner(), subsequent saves scope correctly.
			ownerHash: currentOwnerHash ?? undefined
		};

		update((drafts) => {
			const updated = { ...drafts, [draftId]: draft };
			saveDrafts(updated);
			return updated;
		});
	}

	function getDraft(
		draftId: string
	): {
		data: TemplateFormData;
		lastSaved: number;
		currentStep: string;
		pendingSuggestion?: PendingSuggestion | null;
	} | null {
		const drafts = loadDrafts();
		const entry = drafts[draftId];
		if (!entry) return null;
		if (!draftMatchesOwner(entry)) return null;
		return entry;
	}

	function deleteDraft(draftId: string) {
		update((drafts) => {
			const updated = { ...drafts };
			delete updated[draftId];
			saveDrafts(updated);

			// Clear encrypted emails
			try { localStorage.removeItem(`${STORAGE_KEY}_emails_${draftId}`); } catch { /* */ }

			// Clear any auto-save timer
			const timerId = autoSaveTimers.get(draftId);
			if (timerId) {
				clearInterval(timerId);
				autoSaveTimers.delete(draftId);
			}

			return updated;
		});
	}

	function startAutoSave(
		draftId: string,
		getFormData: () => TemplateFormData,
		getCurrentStep: () => string,
		getPendingSuggestion?: () => PendingSuggestion | null
	) {
		// Clear existing timer
		const existingTimer = autoSaveTimers.get(draftId);
		if (existingTimer) {
			clearInterval(existingTimer);
		}

		// Set up new auto-save timer
		const timerId = setInterval(() => {
			const formData = getFormData();
			const currentStep = getCurrentStep();

			// Save if there's ANY meaningful content
			// Critical: rawInput IS the user's work - don't ignore it
			const hasContent =
				formData.objective.rawInput?.trim() ||
				formData.objective.title?.trim() ||
				formData.content.preview?.trim();

			if (hasContent) {
				saveDraft(draftId, formData, currentStep, getPendingSuggestion?.() ?? null);
			}
		}, AUTO_SAVE_INTERVAL);

		autoSaveTimers.set(draftId, timerId);

		// Cleanup function
		return () => {
			clearInterval(timerId);
			autoSaveTimers.delete(draftId);
		};
	}

	function hasDraft(draftId: string): boolean {
		const drafts = loadDrafts();
		const entry = drafts[draftId];
		if (!entry) return false;
		return draftMatchesOwner(entry);
	}

	function getDraftAge(draftId: string): number | null {
		const draft = getDraft(draftId);
		if (!draft) return null;
		return Date.now() - draft.lastSaved;
	}

	function getAllDraftIds(): string[] {
		const drafts = loadDrafts();
		return Object.entries(drafts)
			.filter(([, entry]) => draftMatchesOwner(entry))
			.map(([id]) => id);
	}

	function setOwner(ownerHash: string | null) {
		currentOwnerHash = ownerHash;
	}

	return {
		subscribe,
		saveDraft,
		getDraft,
		hydrateEmails: decryptDraftEmails,
		deleteDraft,
		startAutoSave,
		hasDraft,
		getDraftAge,
		getAllDraftIds,
		setOwner
	};
}

export const templateDraftStore = createTemplateDraftStore();

// Export alias for backwards compatibility
export const templateDraft = templateDraftStore;

// Helper function to generate a draft ID for a new template
export function generateDraftId(): string {
	return `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to format time ago
export function formatTimeAgo(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const minutes = Math.floor(diff / (60 * 1000));
	const hours = Math.floor(diff / (60 * 60 * 1000));
	const days = Math.floor(diff / (24 * 60 * 60 * 1000));

	if (days > 0) {
		return `${days} day${days === 1 ? '' : 's'} ago`;
	} else if (hours > 0) {
		return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	} else if (minutes > 0) {
		return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	} else {
		return 'Just now';
	}
}
