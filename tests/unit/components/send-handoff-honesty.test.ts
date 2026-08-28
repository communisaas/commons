/**
 * The honest strings have to be READ by a surface a person actually reaches.
 *
 * A constant that says the right thing and a component that renders the old
 * claim both pass a grep. So this file mounts the real `TemplateModal` and
 * asserts on the DOM the sender sees: the self-reported receipt, and the state
 * that used to be unreachable because the 2000ms timeout resolved optimistically.
 *
 * Two mounts, two claims:
 *   - `celebration` on a `mailto_direct` lane must not assert a send happened.
 *     Nobody watched it. The receipt states its basis instead.
 *   - `handoff_unobserved` must offer all three continuations, including the
 *     one-click `I sent it`. Telling a person who did send that they failed is
 *     the costlier error, so the escape is mandatory, not decorative.
 *
 * Every expectation is a literal owned here or imported from the module that
 * owns the sentence. Asking the component what it renders would pass either way.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

/** The claim no self-reported surface may make. Owned here, not derived. */
const DELIVERY_CLAIM = /\b(delivered|received by|reached their inbox)\b/i;

/** The wording that is only earned on a server-accepted lane. */
const SERVER_ACCEPTED_CLAIM = 'Your message has been sent.';

const h = vi.hoisted(() => {
	// The modal builds a `spring` at module scope, and Svelte's motion module
	// constructs a `MediaQuery` while doing so. jsdom ships no `matchMedia`, and
	// the shared suite setup installs its stub in a `beforeEach` — far too late
	// for a read that happens during module evaluation. A hoisted body runs
	// before the imports below, which is early enough.
	if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
		Object.defineProperty(window, 'matchMedia', {
			configurable: true,
			writable: true,
			value: (query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addListener: () => {},
				removeListener: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
				dispatchEvent: () => false
			})
		});
	}

	return {
		page: {
			data: {} as Record<string, unknown>,
			url: new URL('http://localhost/s/send-handoff-honesty'),
			params: { slug: 'send-handoff-honesty' },
			route: { id: '/s/[slug]' },
			status: 200,
			error: null,
			form: null,
			state: {}
		}
	};
});

vi.mock('$app/stores', () => {
	const pageStore = {
		subscribe: (run: (value: unknown) => void) => {
			run(h.page);
			return () => {};
		}
	};
	const navigating = {
		subscribe: (run: (value: unknown) => void) => {
			run(null);
			return () => {};
		}
	};
	const updated = {
		subscribe: (run: (value: unknown) => void) => {
			run(false);
			return () => {};
		},
		check: async () => false
	};
	return {
		page: pageStore,
		navigating,
		updated,
		getStores: () => ({ page: pageStore, navigating, updated })
	};
});

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidate: vi.fn(),
	invalidateAll: vi.fn(),
	preloadData: vi.fn(),
	preloadCode: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn()
}));

// An explicit `initialState` short-circuits `onMount` before any send path runs,
// so neither of these is reached. They are stubbed anyway: a mount test that
// silently starts depending on the network is a flake waiting for CI.
vi.mock('$lib/services/emailService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/emailService')>()),
	launchEmail: vi.fn()
}));

vi.mock('$lib/utils/do-not-contact-links', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/utils/do-not-contact-links')>()),
	fetchDoNotContactUrls: vi.fn(async () => ({ state: 'absent' as const }))
}));

import TemplateModal from '$lib/components/template/TemplateModal.svelte';
import {
	RECEIPT_HEADING,
	SELF_REPORTED_SEND_BASIS,
	SERVER_ACCEPTED_SEND_BASIS
} from '$lib/services/send-lane';
import type { ComponentTemplate } from '$lib/types/component-props';

/**
 * An ordinary email template. With `user: null` this resolves to `mailto_direct`
 * — the lane whose only witness is the sender — and the receipt's guest CTA
 * branch renders, not the congressional blocks this node must leave alone.
 */
const template = {
	id: 't1',
	slug: 'send-handoff-honesty',
	title: 'A subject',
	description: 'A test template',
	domain: 'Testing',
	type: 'advocacy',
	deliveryMethod: 'email',
	subject: 'A subject',
	message_body: 'A body',
	delivery_config: {},
	recipient_config: { emails: ['rep@example.test'] },
	coordinationScale: 0,
	isNew: false,
	status: 'published',
	is_public: true,
	send_count: 0
} as unknown as ComponentTemplate;

/** Mount the modal straight into one state, guest-side. */
function mountAt(initialState: string) {
	h.page.data = { user: null, userDistrictCode: null };
	return render(TemplateModal, {
		props: { template, user: null, initialState } as never
	});
}

/** Everything the sender can read, collapsed to one whitespace-normalised string. */
function readableText(container: HTMLElement): string {
	return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('the self-reported receipt states its basis instead of asserting a send', () => {
	it('renders the marked-sent heading and the basis sentence, and no delivery claim', async () => {
		const { container } = mountAt('celebration');
		await new Promise((resolve) => setTimeout(resolve, 0));

		// The receipt headline is the evidence-keyed one, not the bare assertion.
		// Read the `h2` directly: `Marked sent` is deliberately also a `dt` label
		// below, and a text query would match both.
		const heading = container.querySelector('h2');
		expect(heading?.textContent?.trim()).toBe(RECEIPT_HEADING.self_reported);

		const text = readableText(container);
		expect(text).toContain(SELF_REPORTED_SEND_BASIS);
		expect(text).not.toContain(SERVER_ACCEPTED_CLAIM);
		expect(text).not.toContain(SERVER_ACCEPTED_SEND_BASIS);
		expect(text).not.toMatch(DELIVERY_CLAIM);
	});

	it('labels the timestamp as when the sender marked it, not when it arrived', async () => {
		const { container } = mountAt('celebration');
		await new Promise((resolve) => setTimeout(resolve, 0));

		const labels = Array.from(container.querySelectorAll('dt')).map((node) =>
			(node.textContent ?? '').trim()
		);
		expect(labels).toContain('Marked sent');
		expect(labels).not.toContain('When');
	});
});

describe('the unobserved hand-off is reachable, reads as not-known, and keeps every door open', () => {
	it('says nothing was seen — never that it failed, never that it sent', async () => {
		const { container, findByText } = mountAt('handoff_unobserved');

		await findByText(/We couldn't tell whether your email app opened/i);

		const text = readableText(container);
		expect(text).not.toMatch(/\bfailed\b/i);
		expect(text).not.toMatch(/didn't open/i);
		expect(text).not.toMatch(/\berror\b/i);
	});

	it('offers all three continuations, including the one-click "I sent it"', async () => {
		const { container, findByText } = mountAt('handoff_unobserved');

		// Retry, the sender's own assertion, and the manual-copy escape.
		await findByText('Try opening email again');
		await findByText('I sent it');
		await findByText('View template to copy message manually');

		// Exactly three continuations. The close control carries an icon and no
		// words, so a text-bearing button is an offered continuation.
		const actions = Array.from(container.querySelectorAll('button'))
			.map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
			.filter((label) => label.length > 0);
		expect(actions).toEqual([
			'Try opening email again',
			'I sent it',
			'View template to copy message manually'
		]);
	});
});
