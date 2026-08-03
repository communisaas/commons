import { browser } from '$app/environment';
import { z } from 'zod';

const GUEST_STATE_KEY = 'commons_guest_template';

/** How long a guest's template interest may stay on disk. */
const GUEST_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The only shape ever written to localStorage: template interest plus the
 * expiry that bounds it. `.strict()` closes the set — an envelope carrying any
 * other field (a raw address from an earlier build, a field a future edit
 * forgot to declare) fails to parse and is deleted on read instead of adopted.
 */
const PersistedGuestEnvelopeSchema = z
	.object({
		templateSlug: z.string(),
		templateTitle: z.string(),
		source: z.enum(['social-link', 'direct-link', 'share']),
		timestamp: z.number(),
		viewCount: z.number(),
		expiresAt: z.number()
	})
	.strict();

type PersistedGuestEnvelope = z.infer<typeof PersistedGuestEnvelopeSchema>;

/**
 * In-memory guest state.
 *
 * `address` is deliberately absent from the persisted envelope. A raw postal
 * address is the most sensitive value the guest flow touches, a shared browser
 * is not infrastructure we control, and a guest has no owner hash to key it to.
 * It lives for the life of the page and nowhere else, which is all the
 * address-backed flow needs: the district commitment is computed at collection
 * time from the submitted address, and consumers read this field only as a
 * "this guest already gave an address" signal.
 */
export interface GuestTemplateState extends PersistedGuestEnvelope {
	address?: string;
}

/**
 * Project the in-memory state onto the persisted envelope field by field, so
 * nothing reaches disk implicitly. A new sensitive field on GuestTemplateState
 * stays in memory unless it is declared in the schema above and copied here.
 */
function toEnvelope(next: GuestTemplateState): PersistedGuestEnvelope {
	return {
		templateSlug: next.templateSlug,
		templateTitle: next.templateTitle,
		source: next.source,
		timestamp: next.timestamp,
		viewCount: next.viewCount,
		expiresAt: next.expiresAt
	};
}

// Guest state for pre-authentication template interactions
function createGuestState() {
	let state = $state<GuestTemplateState | null>(null);

	function persist(next: GuestTemplateState): void {
		if (!browser) return;
		localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(toEnvelope(next)));
	}

	function discardStored(): void {
		state = null;
		if (browser) {
			localStorage.removeItem(GUEST_STATE_KEY);
		}
	}

	return {
		get state() {
			return state;
		},

		// Store template interaction for guest users
		setTemplate(
			slug: string,
			title: string,
			source: GuestTemplateState['source'] = 'direct-link'
		): void {
			const now = Date.now();
			const newState: GuestTemplateState = {
				templateSlug: slug,
				templateTitle: title,
				source,
				timestamp: now,
				viewCount: 1,
				expiresAt: now + GUEST_STATE_TTL_MS
			};

			state = newState;

			// Persist to localStorage for cross-session continuity
			persist(newState);
		},

		// Hold the address for the address-backed flow — in memory only, for the
		// life of this page. Nothing about it is written to disk, so the stored
		// envelope is intentionally left untouched here.
		setAddress(address: string): void {
			if (!state) return;

			state = { ...state, address };
		},

		// Clear after successful conversion
		clear(): void {
			discardStored();
		},

		// Restore from localStorage on app load
		restore(): void {
			if (!browser) return;

			const stored = localStorage.getItem(GUEST_STATE_KEY);
			if (!stored) return;

			let parsed: unknown;
			try {
				parsed = JSON.parse(stored);
			} catch {
				// Never log the payload — it is the untrusted side of this boundary.
				console.warn('[GuestState] Discarding unreadable stored state');
				discardStored();
				return;
			}

			const result = PersistedGuestEnvelopeSchema.safeParse(parsed);
			if (!result.success) {
				console.warn('[GuestState] Discarding unrecognized stored state');
				discardStored();
				return;
			}

			if (Date.now() >= result.data.expiresAt) {
				discardStored();
				return;
			}

			state = { ...result.data };
		}
	};
}

export const guestState = createGuestState();

// Auto-restore on app load
if (browser) {
	guestState.restore();
}
