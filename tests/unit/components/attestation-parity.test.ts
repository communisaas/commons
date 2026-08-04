/**
 * THE GATE: what the sender READS must equal what the recipient RECEIVES.
 *
 * The preview footer and the outgoing mailto body are two different surfaces.
 * When each composed its own tier copy they drifted, and the drift ran in the
 * dishonest direction — the sender was shown a stronger verification class than
 * the mail actually carried.
 *
 * Both surfaces here are driven from ONE page-data fixture shaped the way the
 * template route emits it: a `user` object that carries no district field, and
 * a sibling top-level `userDistrictCode`. The sender side reaches it through the
 * projection the route hands `TemplatePreview`; the recipient side reaches it by
 * mounting the real modal, which reads the district off page data itself. No
 * attestation option is constructed anywhere in this file — a test that fed the
 * district to the send path by hand would be asserting its own arithmetic, and
 * would keep passing after the modal stopped opting the lane in at all.
 *
 * The second direction matters as much as the first: a lane whose preview shows
 * no footer must send no footer, or the recipient reads a verification claim
 * about a sender who was never shown it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const HASH = 'a'.repeat(64);

/** What the route's `+page.server.ts` ships to the page — no district on the user. */
interface PageUser {
	id: string;
	name: string;
	email: string;
	trust_tier: number;
	verification_method: string;
	credentialHash: string;
}

interface PageData {
	user: PageUser;
	userDistrictCode: string | null;
}

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

	// One mutable fixture. Each case rewrites `data` before mounting, and the
	// page store below reads it at subscribe time so a freshly mounted modal
	// sees the current sender rather than the one the previous case installed.
	return {
		page: {
			data: {} as Record<string, unknown>,
			url: new URL('http://localhost/s/attestation-parity'),
			params: { slug: 'attestation-parity' },
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

// `generateMailtoUrl` and `analyzeEmailFlow` are the surface under test and stay
// real. Only the hand-off to the mail client is stubbed, so the modal's delayed
// launch cannot ask jsdom to navigate while an assertion is still waiting.
vi.mock('$lib/services/emailService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/emailService')>()),
	launchEmail: vi.fn()
}));

import PreviewContent from '$lib/components/template-browser/parts/PreviewContent.svelte';
import TemplateModal from '$lib/components/template/TemplateModal.svelte';
import { modalActions, modalContext } from '$lib/stores/modalSystem.svelte';
import type { Template } from '$lib/types/template';

const template = {
	id: 't1',
	slug: 'attestation-parity',
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
} as unknown as Template;

const baseUser: PageUser = {
	id: 'u1',
	name: 'Ada',
	email: 'ada@example.test',
	trust_tier: 2,
	verification_method: 'civic_api',
	credentialHash: HASH
};

/** Install the page data this case's sender arrives on. */
function seedPage(user: Partial<PageUser> = {}, userDistrictCode: string | null = 'CA-12'): void {
	h.page.data = { user: { ...baseUser, ...user }, userDistrictCode } satisfies PageData;
}

const pageData = () => h.page.data as unknown as PageData;

/**
 * The sender's route reads page data one way: it flattens the sibling district
 * onto the user it hands the preview. Copied from the template route so the
 * fixture reaches this surface exactly as production does.
 */
function renderPreview(componentId: string) {
	const data = pageData();
	return render(PreviewContent, {
		props: {
			template,
			inModal: false,
			context: 'page',
			user: {
				id: data.user.id,
				name: data.user.name,
				trust_tier: data.user.trust_tier,
				district_code: data.userDistrictCode ?? undefined,
				verification_method: data.user.verification_method,
				credentialHash: data.user.credentialHash
			},
			onScroll: () => {},
			personalConnectionValue: '',
			componentId
		} as never
	});
}

/** What the sender reads, straight out of the rendered preview. */
function senderVisibleLine(componentId: string): string {
	const { container } = renderPreview(componentId);
	const node = container.querySelector('[data-testid="attestation-line"]');
	expect(node, 'the preview must render an attestation line for a tier-2+ sender').toBeTruthy();
	return (node?.textContent ?? '').trim();
}

/**
 * The body the recipient receives, decoded off the URL the mounted modal put in
 * modal state. The modal reads the same page data the preview did and opts its
 * own lane in; nothing here tells it which district to claim.
 */
async function recipientBody(): Promise<string> {
	const data = pageData();
	render(TemplateModal, {
		props: { template, user: data.user, personalConnection: '' } as never
	});

	await vi.waitFor(() => expect(modalContext.modalContext.mailtoUrl).toBeTruthy(), {
		timeout: 5000,
		interval: 25
	});

	const url = modalContext.modalContext.mailtoUrl as string;
	const marker = '&body=';
	return decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
}

/** The whole footer below the rule; empty string when the lane sent none. */
async function recipientFooter(): Promise<string> {
	const body = await recipientBody();
	if (!body.includes('---')) return '';
	return (body.split('---').pop() ?? '').trim();
}

/** The one line both surfaces must agree on, byte for byte. */
async function recipientVisibleLine(): Promise<string> {
	return (await recipientFooter()).split('\n')[0];
}

describe('sender-visible attestation == recipient-visible attestation', () => {
	beforeEach(() => {
		// `legacyModalState` is module-level and outlives an `it` block. Clearing it
		// and proving it clear is what makes a case that produces no mailto fail
		// instead of silently reading the previous case's URL.
		modalActions.reset();
		expect(modalContext.modalContext.mailtoUrl).toBeUndefined();
		seedPage();
	});

	it('a self-reported (Census-geocoded) tier-2 sender reads exactly what the mail carries', async () => {
		const senderVisible = senderVisibleLine('attestation-parity-census');
		const recipientLine = await recipientVisibleLine();

		expect(senderVisible).toBe(recipientLine);
		expect(senderVisible).toBe('Self-reported constituent (Census geocoder) · CA-12');
		expect(senderVisible).not.toContain('Verified resident');
	});

	it('an mDL tier-3 sender reads exactly what the mail carries', async () => {
		seedPage({ trust_tier: 3, verification_method: 'mdl' });

		const senderVisible = senderVisibleLine('attestation-parity-mdl');
		const recipientLine = await recipientVisibleLine();

		expect(senderVisible).toBe(recipientLine);
		expect(senderVisible).toBe('Address-resolved constituent (mDL) · CA-12');
		expect(senderVisible).not.toContain('Verified resident');
	});

	it('the verify offer the preview links is the one the mail carries', async () => {
		// The hash is a second recipient-visible claim on the same footer. The
		// preview links it; the mail must offer the same record, not a stale or
		// truncated one that 404s.
		const { container } = renderPreview('attestation-parity-verify');
		const href = container.querySelector('a[href^="/v/"]')?.getAttribute('href');
		expect(href).toBe(`/v/${HASH}`);

		expect(await recipientFooter()).toContain(`https://commons.email/v/${HASH}`);
	});

	it('a sender the preview shows no footer sends the recipient none', async () => {
		// Tier 0 is the only class that composes to a null line — tier 1 still reads
		// "Verified sender". A footer here would be a verification claim the sender
		// never read, arriving through a lane that opts in unconditionally.
		seedPage({ trust_tier: 0 });

		const { container } = renderPreview('attestation-parity-tier0');
		expect(container.querySelector('[data-testid="attestation-line"]')).toBeNull();

		expect(await recipientBody()).not.toContain('---');
	});
});
