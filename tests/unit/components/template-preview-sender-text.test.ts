/**
 * A note the lane cannot carry does not survive the sign-in round trip.
 *
 * The preview writes the sender's typed words to session storage so an OAuth
 * detour does not lose them. Signing in on a congressional template moves the
 * sender from the mailto relay — which delivers the note — to the proof path,
 * which transmits no body at all. This suite mounts the component on both sides
 * of that transition and reads the outcome off the rendered letter and off
 * sessionStorage, never off the component's internals.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import type { Template } from '$lib/types/template';

// svelte/motion reads prefers-reduced-motion via window.matchMedia at module
// evaluation — before the shared beforeEach mock from tests/config/setup.ts
// applies. Shim it first, then import the component dynamically.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	Object.defineProperty(window, 'matchMedia', {
		value: (query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false
		}),
		writable: true,
		configurable: true
	});
}

const TemplatePreview = (
	await import('$lib/components/template-browser/TemplatePreview.svelte')
).default;

const TEMPLATE_ID = 'cwc-hearing-aid-wait';
const STORAGE_KEY = `template_${TEMPLATE_ID}_personalization`;
const TYPED = 'My son waited eleven months for a hearing aid.';

function cwcTemplate(): Template {
	return {
		id: TEMPLATE_ID,
		slug: 'cwc-hearing-aid-wait',
		title: 'Cut the hearing aid wait',
		description: 'Ask for evening clinic hours.',
		domain: 'Public Health',
		type: 'advocacy',
		deliveryMethod: 'cwc',
		message_body: 'Dear official,\n\n[Personal Connection]\n\nPlease act.',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: false,
		status: 'published',
		is_public: true,
		send_count: 0,
		createdAt: '2026-06-01T00:00:00.000Z',
		updatedAt: '2026-06-01T00:00:00.000Z'
	} as Template;
}

/**
 * The shared test setup swaps `sessionStorage` for a mock whose `getItem` always
 * answers null, which would make every assertion here vacuously true. A real
 * in-memory store is what makes the round trip observable at all.
 */
function installMemorySessionStorage() {
	const data = new Map<string, string>();
	const storage = {
		getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
		setItem: (key: string, value: string) => {
			data.set(key, String(value));
		},
		removeItem: (key: string) => {
			data.delete(key);
		},
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	};
	Object.defineProperty(window, 'sessionStorage', {
		value: storage,
		writable: true,
		configurable: true
	});
}

/** What the guest side of the round trip leaves behind before sign-in. */
function seedStoredNote(note: string) {
	sessionStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ personalConnection: note, timestamp: Date.now() })
	);
}

const signedInSender = { id: 'u1', name: 'Ada Lovelace', trust_tier: 2 };

describe('a note stored before sign-in meets the lane it would travel on', () => {
	beforeEach(() => {
		installMemorySessionStorage();
		vi.spyOn(console, 'debug').mockImplementation(() => {});
	});

	it('the store this suite reads is a real one, not the always-empty shared mock', () => {
		seedStoredNote(TYPED);
		expect(sessionStorage.getItem(STORAGE_KEY)).toContain(TYPED);
	});

	it('is discarded, cleared and announced when the sender lands on the proof lane', async () => {
		seedStoredNote(TYPED);

		const { container, findByRole } = render(TemplatePreview, {
			props: { template: cwcTemplate(), user: signedInSender, context: 'modal' }
		});

		// The sender is told, rather than left to discover the loss at the recipient.
		const alert = await findByRole('alert');
		expect(alert.textContent).toContain('cannot travel with it');
		// Nothing was restored into the letter this sender reads.
		expect(container.textContent).not.toContain(TYPED);
		// And nothing is left to resurface on a later mount.
		expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	it('is restored in silence for a guest, whose lane delivers it', async () => {
		seedStoredNote(TYPED);

		const { container, queryByRole } = render(TemplatePreview, {
			props: { template: cwcTemplate(), user: null, context: 'modal' }
		});

		await waitFor(() => expect(container.textContent).toContain(TYPED));
		expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
		expect(queryByRole('alert')).toBeNull();
	});

	it('says nothing when there was no note to lose', async () => {
		seedStoredNote('');

		const { queryByRole } = render(TemplatePreview, {
			props: { template: cwcTemplate(), user: signedInSender, context: 'modal' }
		});

		await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
		expect(queryByRole('alert')).toBeNull();
	});
});
