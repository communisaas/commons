/**
 * The words that were checked are the words that go out.
 *
 * Every send lane on `/s/[slug]` moderates the sender's typed text, awaits a
 * network round trip, and then builds the message. The field it moderated is
 * mutable `$state` bound three components deep, so the await is a window: type
 * something benign, press send, replace it before the verdict lands, and the
 * approval issued for the first text used to authorize composing the second.
 *
 * This file executes that race against the real mounted send surface — not a
 * reconstruction of it — on all three lanes, and asserts the swapped text
 * reaches neither the `mailto:` Commons composes nor the copy-paste peak. The
 * control at the bottom runs the identical flow with no edit and requires the
 * letter to go out, so a gate that passed by breaking send would fail here.
 *
 * What this does NOT claim: that a person cannot edit the letter in their own
 * mail client after the handoff. No mailto lane can prevent that, and this repo
 * refuses to pretend otherwise (`send-handoff-honesty.test.ts`). The claim is
 * narrower and real — Commons never composes, attests, or hands over bytes its
 * own moderation policy did not see.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render, waitFor } from '@testing-library/svelte';
import { createHash } from 'node:crypto';
import { present } from '$lib/core/fact';

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

// Analytics is a network side effect of arriving. It is mocked so the delivery
// ATTEMPT metric can be asserted on: a refused send must not report one.
vi.mock('$lib/core/analytics/client', () => ({
	trackTemplateView: vi.fn(),
	trackDeliveryAttempt: vi.fn(),
	trackTemplateShare: vi.fn(),
	trackBaseRateRelation: vi.fn()
}));

import SendSurface from '../../../src/routes/s/[slug]/+page.svelte';
import { trackDeliveryAttempt } from '$lib/core/analytics/client';
import { modalActions } from '$lib/stores/modalSystem.svelte';
import { SENDER_TEXT_CHANGED_REASON } from '$lib/utils/personal-connection';

/** What the sender actually typed and had checked. */
const A = 'My daughter crosses here every morning.';
/** What lands in the field during the await. Never reviewed, never sendable. */
const B = 'I know where you sleep and I am coming for you.';
/** A substring of B distinctive enough that finding it anywhere is the failure. */
const B_MARK = 'I know where you sleep';

const DIRECTOR_EMAIL = 'director@example.gov';
const DIRECTOR_NAME = 'Director Ada Reyes';
const REP_NAME = 'Rep. Nora Vance';

/** The suppression map the send seam requires before it will assemble anything. */
const DNC_LINKS = { [DIRECTOR_EMAIL]: 'https://commons.email/dnc/x' };

function sha256Hex(input: string): string {
	return createHash('sha256').update(input).digest('hex');
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/**
 * The network the surface talks to during a send.
 *
 * Moderation is DEFERRED — the returned resolvers are the race window. The
 * do-not-contact lookup answers completely and immediately: a bare `{}` there
 * makes the send refuse for an unrelated reason and every assertion below would
 * pass vacuously, which is why the refusals are matched against their exact text.
 */
function stubNetwork() {
	const pendingModeration: Array<(response: Response) => void> = [];
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(typeof input === 'string' ? input : ((input as Request).url ?? input));
		if (url.includes('/api/moderation/personalization')) {
			return new Promise<Response>((resolve) => {
				pendingModeration.push(resolve);
			});
		}
		if (url.includes('/api/do-not-contact/links')) {
			return jsonResponse({ links: DNC_LINKS });
		}
		return jsonResponse({});
	});
	vi.stubGlobal('fetch', fetchMock);
	return { pendingModeration, fetchMock };
}

/** A location the page can assign a `mailto:` to and the test can read back. */
function interceptLocation() {
	Object.defineProperty(window, 'location', {
		configurable: true,
		writable: true,
		value: {
			href: '',
			hash: '',
			search: '?via=share',
			pathname: '/s/fix-the-crosswalk',
			origin: 'http://localhost'
		}
	});
}

function assignedHref(): string {
	const href = (window.location as unknown as { href: string }).href ?? '';
	// `assembleMailto` percent-encodes the body; compare on the decoded form.
	try {
		return decodeURIComponent(href);
	} catch {
		return href;
	}
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
					name: DIRECTOR_NAME,
					title: 'Director of Transportation',
					organization: 'City DOT',
					email: DIRECTOR_EMAIL,
					deliveryRoute: 'email'
				}
			]
		},
		// A cwcCode routes this card through `openTemplateModal` — the third lane,
		// which composes into the modal payload rather than into a mailto.
		districtOfficials: [
			{
				name: REP_NAME,
				title: 'Representative',
				organization: 'U.S. House',
				bioguideId: 'V000111',
				cwcCode: 'CA12',
				chamber: 'house',
				phone: null,
				contactFormUrl: null,
				websiteUrl: null
			}
		]
	} as unknown as ComponentProps<typeof SendSurface>['data'];
}

/** Open the voice card and put `text` in the field, the way a person does. */
async function typeIntoVoiceCard(container: HTMLElement, text: string): Promise<HTMLTextAreaElement> {
	const voiceCard = await waitFor(() => {
		const card = container.querySelector('[role="button"][aria-label^="Add your"]');
		expect(card).not.toBeNull();
		return card as HTMLElement;
	});
	voiceCard.click();

	const field = await waitFor(() => {
		const found = container.querySelector('textarea');
		expect(found).not.toBeNull();
		return found as HTMLTextAreaElement;
	});
	setField(field, text);
	return field;
}

/** The mid-await mutation. A script, an extension, or a coupled component. */
function setField(field: HTMLTextAreaElement, text: string): void {
	field.value = text;
	field.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonByText(container: HTMLElement, pattern: RegExp): HTMLButtonElement {
	const button = [...container.querySelectorAll('button')].find((candidate) =>
		pattern.test(candidate.textContent ?? '')
	);
	expect(button, `no button matching ${pattern}`).toBeDefined();
	return button as HTMLButtonElement;
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
	const button = container.querySelector(`button[aria-label="${label}"]`);
	expect(button, `no button labelled ${label}`).not.toBeNull();
	return button as HTMLButtonElement;
}

async function alertText(container: HTMLElement): Promise<string> {
	const alert = await waitFor(() => {
		const found = container.querySelector('[role="alert"]');
		expect(found).not.toBeNull();
		return found as HTMLElement;
	});
	return (alert.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The copy-paste peak (`SendConfirmation.svelte`) — the other place bytes surface. */
function copyPeakText(container: HTMLElement): string {
	const copy = container.querySelector('textarea.sc-copy-text') as HTMLTextAreaElement | null;
	return copy?.value ?? '';
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Everything a refused send must NOT have done, asserted in one place. */
function expectNothingWasSent(container: HTMLElement): void {
	expect((window.location as unknown as { href: string }).href).toBe('');
	expect(assignedHref()).not.toContain(B_MARK);
	expect(copyPeakText(container)).not.toContain(B_MARK);
	// No send peak at all: nothing was handed over, so nothing is owed a confirm.
	expect(container.querySelector('#sc-title')).toBeNull();
	expect(vi.mocked(trackDeliveryAttempt)).not.toHaveBeenCalled();
}

describe('text swapped during the moderation await never reaches the mail app', () => {
	it('single card lane: the reviewed words are refused once the field moves under them', async () => {
		interceptLocation();
		const { pendingModeration } = stubNetwork();
		const { container } = render(SendSurface, { props: { data: strangerPageData() } });

		const field = await typeIntoVoiceCard(container, A);
		buttonByText(container, /write to them/i).click();

		// The round trip is in flight. This is the whole window the bug lived in.
		await waitFor(() => expect(pendingModeration.length).toBe(1));
		setField(field, B);
		pendingModeration[0](jsonResponse({ approved: true, contentDigest: sha256Hex(A) }));

		expect(await alertText(container)).toContain(SENDER_TEXT_CHANGED_REASON);
		expectNothingWasSent(container);
		// The recipient was never marked in flight, so their card is still live.
		expect(container.querySelector(`button[aria-label="Write to ${DIRECTOR_NAME}"]`))
			.not.toBeNull();
	});

	it('batch lane: refuses the swap and hands the collective control back', async () => {
		interceptLocation();
		const { pendingModeration } = stubNetwork();
		const { container } = render(SendSurface, { props: { data: strangerPageData() } });

		const field = await typeIntoVoiceCard(container, A);
		buttonByText(container, /write to all/i).click();

		await waitFor(() => expect(pendingModeration.length).toBe(1));
		setField(field, B);
		pendingModeration[0](jsonResponse({ approved: true, contentDigest: sha256Hex(A) }));

		expect(await alertText(container)).toContain(SENDER_TEXT_CHANGED_REASON);
		expectNothingWasSent(container);
		// `batchRegistrationState` is back to idle: the label is the control again,
		// not the "Opening mail…" spinner it would be wedged on.
		await waitFor(() => expect(buttonByText(container, /write to all/i)).toBeDefined());
	});

	it('modal lane: the modal is never opened carrying the unreviewed words', async () => {
		interceptLocation();
		const { pendingModeration } = stubNetwork();
		const openModal = vi.spyOn(modalActions, 'openModal').mockImplementation(() => {});
		const { container } = render(SendSurface, { props: { data: strangerPageData() } });

		const field = await typeIntoVoiceCard(container, A);
		// A cwc route delegates to `openTemplateModal`, which composes the payload.
		buttonByLabel(container, `Write to ${REP_NAME}`).click();

		await waitFor(() => expect(pendingModeration.length).toBe(1));
		setField(field, B);
		pendingModeration[0](jsonResponse({ approved: true, contentDigest: sha256Hex(A) }));

		expect(await alertText(container)).toContain(SENDER_TEXT_CHANGED_REASON);
		expectNothingWasSent(container);
		expect(openModal).not.toHaveBeenCalled();
	});
});

describe('the same flow, unraced, still sends — the gate is not passing by breaking send', () => {
	it('single card lane: the typed words reach the mailto body', async () => {
		interceptLocation();
		const { pendingModeration } = stubNetwork();
		const { container } = render(SendSurface, { props: { data: strangerPageData() } });

		await typeIntoVoiceCard(container, A);
		buttonByText(container, /write to them/i).click();

		await waitFor(() => expect(pendingModeration.length).toBe(1));
		// No edit during the await. Nothing drifted; the send must go through.
		pendingModeration[0](jsonResponse({ approved: true, contentDigest: sha256Hex(A) }));

		await waitFor(() => expect(assignedHref()).toContain('mailto:'));
		const composed = assignedHref();
		expect(composed).toContain(DIRECTOR_EMAIL);
		expect(composed).toContain(A);
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(vi.mocked(trackDeliveryAttempt)).toHaveBeenCalled();

		// The peak's copy view reads off the same assembly the URL came from.
		await waitFor(() => expect(container.querySelector('#sc-title')).not.toBeNull());
		buttonByText(container, /copy it instead/i).click();
		await waitFor(() => expect(copyPeakText(container)).toContain(A));
	});

	it('modal lane: the reviewed words reach the modal payload', async () => {
		interceptLocation();
		const { pendingModeration } = stubNetwork();
		const openModal = vi.spyOn(modalActions, 'openModal').mockImplementation(() => {});
		const { container } = render(SendSurface, { props: { data: strangerPageData() } });

		await typeIntoVoiceCard(container, A);
		buttonByLabel(container, `Write to ${REP_NAME}`).click();

		await waitFor(() => expect(pendingModeration.length).toBe(1));
		pendingModeration[0](jsonResponse({ approved: true, contentDigest: sha256Hex(A) }));

		await waitFor(() => expect(openModal).toHaveBeenCalled());
		const payload = openModal.mock.calls[0]?.[2] as { personalConnection?: string } | undefined;
		expect(payload?.personalConnection).toBe(A);
		await settle();
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});
});
