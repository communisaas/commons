/**
 * The 7th person is not the author.
 *
 * A stranger follows a shared link to `/s/<slug>`, types their own sentence, and
 * presses the button that hands the letter to their mail app. Their words go
 * through `moderatePersonalConnection` (`src/lib/utils/personal-connection.ts`)
 * to `/api/moderation/personalization`, which spends the same shared free pool
 * the Durable Object admits from. When that pool is empty the server answers 429
 * carrying `budgetScope: 'platform'` and the real `resetAt` — and the client used
 * to throw both away and render "Content moderation is temporarily unavailable.
 * Please try again in a moment." That sentence is false in both halves: it is not
 * the moderation service, and the reset can be thirty days out.
 *
 * This mounts the real send surface with NO author session and asserts what is
 * rendered into the page's `role="alert"` element. Every expected sentence is a
 * literal owned here — asking the component what it renders would pass either way.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render, waitFor } from '@testing-library/svelte';
import { present } from '$lib/core/fact';

/** Phrasing that charges the reader for capacity. Forbidden on the shared-pool branch. */
const FIRST_PERSON_CONSUMPTION = /\byou(?:'ve| have)?\s+used\b/i;

/** The exact sentences this surface owes each kind of denial. */
const SHARED_POOL_EMPTY = 'The shared free moderation pool is empty until it resets.';
const NOBODY_CHECKED = "Nobody's added words can be checked until then.";
const STILL_SENDABLE = 'You can still send the letter as written.';
const OWN_SHARE_SPENT = "You've used your share of the free moderation pool this month.";
const COULD_NOT_CONFIRM =
	"We couldn't confirm how much moderation capacity is left, so your added words were not checked.";
const OLD_LIE = 'Content moderation is temporarily unavailable. Please try again in a moment.';

const h = vi.hoisted(() => {
	// jsdom implements neither of these, and the send surface calls both while
	// growing the voice-card textarea. Neither is under test; without them the
	// real failure is drowned in an unhandled animation-frame exception.
	if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
		Element.prototype.scrollIntoView = function scrollIntoView() {};
	}
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
			// No `user`: this reader arrived from a shared link and is nobody's author.
			data: {} as Record<string, unknown>,
			url: new URL('http://localhost/s/fix-the-crosswalk?via=share'),
			params: { slug: 'fix-the-crosswalk' },
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

// Analytics is a network side effect of arriving, not part of the denial under test.
vi.mock('$lib/core/analytics/client', () => ({
	trackTemplateView: vi.fn(),
	trackDeliveryAttempt: vi.fn(),
	trackTemplateShare: vi.fn(),
	trackBaseRateRelation: vi.fn()
}));

import SendSurface from '../../../src/routes/s/[slug]/+page.svelte';
import { moderatePersonalConnection } from '$lib/utils/personal-connection';

/** A reset one calendar month out — the case "in a moment" mangles. */
const MONTH_AWAY_RESET = new Date(Date.now() + 25 * 24 * 60 * 60 * 1_000);

type Scope = 'actor' | 'platform' | 'blocked' | undefined;

/** The 429 `rateLimitResponse` actually returns (`llm-cost-protection.ts`). */
function budgetDenial(scope: Scope, resetAt = MONTH_AWAY_RESET.toISOString()) {
	return new Response(
		JSON.stringify({
			error: 'AI capacity limit reached. Please try again after the reset time.',
			tier: 'authenticated',
			remaining: 0,
			limit: 2,
			resetAt,
			...(scope === undefined ? {} : { budgetScope: scope })
		}),
		{ status: 429, headers: { 'content-type': 'application/json' } }
	);
}

/** How a month-away reset must read: a date, never a bare time of day. */
function expectedResetPhrase(): string {
	return `on ${MONTH_AWAY_RESET.toLocaleString([], {
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	})}`;
}

function strangerPageData() {
	return {
		template: {
			id: 'crosswalk',
			slug: 'fix-the-crosswalk',
			title: 'Fix the crosswalk on Mission St',
			description: 'The crossing has no signal and children use it daily.',
			domain: 'Public Safety',
			type: 'advocacy',
			deliveryMethod: 'email',
			subject: 'Fix the crosswalk on Mission St',
			message_body: 'Dear [Representative Name],\n\nPlease fund a signal.\n\n[Personal Connection]',
			delivery_config: {},
			recipient_config: {},
			metrics: { sent: 0, opened: 0, clicked: 0, responded: 0 },
			status: 'published',
			is_public: true,
			send_count: 0,
			topics: []
		},
		// The stranger: no session, no district, not the author.
		user: null,
		userDistrictCode: null,
		viewerIsConstituent: false,
		viewerIsAuthor: false,
		priorContacts: present([]),
		debate: null,
		baseRateRelation: null,
		recipientConfig: {
			decisionMakers: [
				{
					name: 'Director Ada Reyes',
					title: 'Director of Transportation',
					organization: 'City DOT',
					email: 'director@example.gov',
					deliveryRoute: 'email'
				}
			]
		},
		districtOfficials: []
	} as unknown as ComponentProps<typeof SendSurface>['data'];
}

function visible(container: HTMLElement): string {
	return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe("the stranger's send surface tells the truth about an empty shared pool", () => {
	it('renders the shared-pool denial in the page alert, with a real date and no first-person spend', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(typeof input === 'string' ? input : ((input as Request).url ?? input));
				if (url.includes('/api/moderation/personalization')) return budgetDenial('platform');
				return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
			})
		);

		const rendered = render(SendSurface, { props: { data: strangerPageData() } });

		// The stranger types their own words into the voice card, then asks to send.
		// Both go through the page's own state — no test back door into the reason.
		const voiceCard = await waitFor(() => {
			const card = rendered.container.querySelector('[role="button"][aria-label^="Add your"]');
			expect(card).not.toBeNull();
			return card as HTMLElement;
		});
		voiceCard.click();

		const typed = await waitFor(() => {
			const field = rendered.container.querySelector('textarea');
			expect(field).not.toBeNull();
			return field as HTMLTextAreaElement;
		});
		typed.value = 'My daughter crosses here every morning.';
		typed.dispatchEvent(new Event('input', { bubbles: true }));

		const writeButton = await waitFor(() => {
			const button = [...rendered.container.querySelectorAll('button')].find((candidate) =>
				/write to them/i.test(candidate.textContent ?? '')
			);
			expect(button).toBeDefined();
			return button as HTMLButtonElement;
		});
		writeButton.click();

		const alert = await waitFor(() => {
			const found = rendered.container.querySelector('[role="alert"]');
			expect(found).not.toBeNull();
			return found as HTMLElement;
		});
		const message = (alert.textContent ?? '').replace(/\s+/g, ' ').trim();

		expect(message).toContain(SHARED_POOL_EMPTY);
		expect(message).toContain(NOBODY_CHECKED);
		expect(message).toContain(expectedResetPhrase());
		expect(message).not.toMatch(/temporarily/i);
		expect(message).not.toMatch(FIRST_PERSON_CONSUMPTION);
		expect(message).not.toContain(OLD_LIE);
		expect(visible(rendered.container)).toContain(SHARED_POOL_EMPTY);
	});
});

/**
 * The same reason strings, exercised directly on the send gate, so the three
 * branches are pinned even where a rendered mount can only carry one of them.
 * `moderatePersonalConnection` is the single call site every send lane on this
 * page uses.
 */
describe('the send gate maps each measured scope to its own sentence', () => {
	function stubDenial(scope: Scope) {
		vi.stubGlobal('fetch', vi.fn(async () => budgetDenial(scope)));
	}

	it('names the reader’s own share only when the server measured the reader', async () => {
		stubDenial('actor');
		const result = await moderatePersonalConnection('My daughter crosses here.', 'fix-the-crosswalk');
		expect(result.approved).toBe(false);
		expect(result.approved === false && result.reason).toContain(OWN_SHARE_SPENT);
		expect(result.approved === false && result.reason).toContain(expectedResetPhrase());
	});

	it('never charges the reader for a shared pool a stranger emptied', async () => {
		stubDenial('platform');
		const result = await moderatePersonalConnection('My daughter crosses here.', 'fix-the-crosswalk');
		expect(result.approved).toBe(false);
		const reason = result.approved === false ? result.reason : '';
		expect(reason).toContain(SHARED_POOL_EMPTY);
		expect(reason).toContain(NOBODY_CHECKED);
		expect(reason).not.toMatch(FIRST_PERSON_CONSUMPTION);
	});

	it('falls into neither measured branch when nobody measured anything', async () => {
		for (const scope of ['blocked', undefined] as const) {
			stubDenial(scope);
			const result = await moderatePersonalConnection(
				'My daughter crosses here.',
				'fix-the-crosswalk'
			);
			const reason = result.approved === false ? result.reason : '';
			expect(reason).toContain(COULD_NOT_CONFIRM);
			expect(reason).not.toContain(SHARED_POOL_EMPTY);
			expect(reason).not.toMatch(FIRST_PERSON_CONSUMPTION);
		}
	});

	it('keeps three pairwise-distinct reasons, each blocking the send', async () => {
		const reasons: string[] = [];
		for (const scope of ['actor', 'platform', 'blocked'] as const) {
			stubDenial(scope);
			const result = await moderatePersonalConnection(
				'My daughter crosses here.',
				'fix-the-crosswalk'
			);
			// Every branch is a refusal: nothing here can make an unapproved message
			// sendable.
			expect(result.approved).toBe(false);
			reasons.push(result.approved === false ? result.reason : '');
		}
		expect(new Set(reasons).size).toBe(3);
		for (const reason of reasons) {
			expect(reason).toContain(STILL_SENDABLE);
			expect(reason).not.toContain(OLD_LIE);
		}
	});

	it('still says "temporarily unavailable" for the genuine 503, which is true', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: 'Moderation service error' }), { status: 503 })
			)
		);
		const result = await moderatePersonalConnection('My daughter crosses here.', 'fix-the-crosswalk');
		expect(result.approved === false && result.reason).toBe(OLD_LIE);
	});
});
