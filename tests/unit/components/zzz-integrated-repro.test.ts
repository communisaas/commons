// The modal's send path touches IndexedDB in more places than the credential
// store -- constituent address retrieval and session-credential cleanup both do
// -- and in a lane without it every one of those throws and the path never
// reaches a mailto. A repro file whose environment cannot run the code path
// reproduces nothing, so this lane gets the same polyfill the identity suites
// already use.
import 'fake-indexeddb/auto';
/** TEMPORARY integrated-review reproduction harness. Delete after running. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const SERVER_HASH = 'a'.repeat(64);
const WALLET_HASH = 'b'.repeat(64);

const h = vi.hoisted(() => {
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
			url: new URL('http://localhost/s/repro'),
			params: { slug: 'repro' },
			route: { id: '/s/[slug]' },
			status: 200,
			error: null,
			form: null,
			state: {}
		},
		walletHash: { value: null as string | null }
	};
});

vi.mock('$app/stores', () => {
	const pageStore = {
		subscribe: (run: (value: unknown) => void) => {
			run(h.page);
			return () => {};
		}
	};
	const navigating = { subscribe: (run: (v: unknown) => void) => { run(null); return () => {}; } };
	const updated = {
		subscribe: (run: (v: unknown) => void) => { run(false); return () => {}; },
		check: async () => false
	};
	return { page: pageStore, navigating, updated, getStores: () => ({ page: pageStore, navigating, updated }) };
});

// h.walletHash was declared in the harness and never consumed by anything, so
// the wallet branch below was unreachable and C1b tried to reach it with a
// doMock issued AFTER render -- which cannot affect an already-resolved module
// graph. TemplateModal dynamic-imports this module (TemplateModal.svelte:457),
// so mocking it here is what makes the handle real.
// A template with direct recipients cannot produce a mailto until the
// do-not-contact links resolve to a PRESENT fact -- TemplateModal.svelte:475
// sets an error state and returns otherwise. That call is network work, so in
// this lane it never resolved and every direct-recipient case timed out with no
// modal state at all, which is what made C1b look like a wallet-hash problem.
vi.mock('$lib/utils/do-not-contact-links', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		fetchDoNotContactUrls: async () => ({
			state: 'present' as const,
			value: { 'rep@example.test': 'https://example.test/do-not-contact' }
		})
	};
});

vi.mock('$lib/core/identity/credential-store', () => ({
	getCredential: async () =>
		h.walletHash.value === null
			? null
			: {
					userId: 'u1',
					type: 'district_residency',
					credential: {},
					issuedAt: new Date(0).toISOString(),
					expiresAt: new Date(0).toISOString(),
					credentialHash: h.walletHash.value
				},
	storeCredential: async () => {}
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(), invalidate: vi.fn(), invalidateAll: vi.fn(), preloadData: vi.fn(),
	preloadCode: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn(),
	pushState: vi.fn(), replaceState: vi.fn()
}));

vi.mock('$lib/services/emailService', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/services/emailService')>()),
	launchEmail: vi.fn()
}));

import PreviewContent from '$lib/components/template-browser/parts/PreviewContent.svelte';
import TemplateModal from '$lib/components/template/TemplateModal.svelte';
import { modalActions, modalContext } from '$lib/stores/modalSystem.svelte';
import type { Template } from '$lib/types/template';

const emailTemplate = {
	id: 't1', slug: 'repro', title: 'A subject', description: 'd', domain: 'Testing',
	type: 'advocacy', deliveryMethod: 'email', subject: 'A subject', message_body: 'A body',
	delivery_config: {}, recipient_config: { emails: ['rep@example.test'] },
	coordinationScale: 0, isNew: false, status: 'published', is_public: true, send_count: 0
} as unknown as Template;

const cwcTemplate = { ...(emailTemplate as object), deliveryMethod: 'cwc' } as unknown as Template;

function seed(user: Record<string, unknown> | null, districtCode: string | null = 'CA-12') {
	h.page.data = { user, userDistrictCode: districtCode };
}

const tier2User = {
	id: 'u1', name: 'Ada', email: 'ada@example.test', trust_tier: 2,
	verification_method: 'civic_api', credentialHash: SERVER_HASH
};

async function bodyFromModal(template: Template, user: unknown, timeout = 4000): Promise<string | null> {
	render(TemplateModal, { props: { template, user, personalConnection: '' } as never });
	try {
		await vi.waitFor(() => expect(modalContext.modalContext.mailtoUrl).toBeTruthy(), {
			timeout, interval: 25
		});
	} catch {
		return null;
	}
	const url = modalContext.modalContext.mailtoUrl as string;
	const marker = '&body=';
	return decodeURIComponent(url.slice(url.indexOf(marker) + marker.length));
}

describe('REPRO', () => {
	beforeEach(() => {
		modalActions.reset();
		h.walletHash.value = null;
		seed({ ...tier2User });
	});

	it('C1a: the lane now has indexedDB, and reports no credential until one is held', async () => {
		// This case used to assert `typeof indexedDB === 'undefined'` and call the
		// wallet branch unreachable. That was true and it made the rest of the file
		// untestable, so the polyfill is imported at the top and the branch is
		// driven by h.walletHash. With the handle unset the answer is still null --
		// the same answer an empty real store gives.
		expect(typeof indexedDB).not.toBe('undefined');
		const { getCredential } = await import('$lib/core/identity/credential-store');
		await expect(getCredential('u1', 'district_residency')).resolves.toBeNull();
	});

	it('C1b: preview links the SERVER hash; the mail carries the WALLET hash', async () => {
		const { container } = render(PreviewContent, {
			props: {
				template: emailTemplate, inModal: false, context: 'page',
				user: {
					id: tier2User.id, name: tier2User.name, trust_tier: 2,
					district_code: 'CA-12', verification_method: 'civic_api',
					credentialHash: SERVER_HASH
				},
				onScroll: () => {}, personalConnectionValue: '', componentId: 'repro-preview'
			} as never
		});
		const href = container.querySelector('a[href^="/v/"]')?.getAttribute('href');
		expect(href).toBe(`/v/${SERVER_HASH}`);

		// A browser that DOES hold a wallet credential, with a different hash.
		h.walletHash.value = WALLET_HASH;

		const body = await bodyFromModal(emailTemplate, h.page.data.user);
		expect(body).toBeTruthy();
		expect(body).toContain(WALLET_HASH);
		expect(body).not.toContain(SERVER_HASH);
	});

	it('C2a: tier-1 signed-in sender on a cwc template — modal never leaves loading', async () => {
		seed({ id: 'u2', name: 'Bo', email: 'bo@example.test', trust_tier: 1, verification_method: null, credentialHash: null });
		const body = await bodyFromModal(cwcTemplate, h.page.data.user, 2000);
		console.log('C2a state >>>', modalActions.modalState, 'mailto:', modalContext.modalContext.mailtoUrl);
		expect(body).toBeNull();
		expect(modalActions.modalState).toBe('loading');
	});

	it('C2b: a GUEST on the same cwc template gets a mailto immediately', async () => {
		seed(null);
		const body = await bodyFromModal(cwcTemplate, null, 4000);
		console.log('C2b state >>>', modalActions.modalState, 'body:', JSON.stringify(body)?.slice(0, 120));
		expect(body).toBeTruthy();
	});

	it('C2c: tier-2 signed-in sender WITH address on a cwc template', async () => {
		seed({ id: 'u3', name: 'Cy', email: 'cy@example.test', trust_tier: 2, verification_method: 'civic_api', credentialHash: SERVER_HASH });
		render(TemplateModal, { props: { template: cwcTemplate, user: h.page.data.user, personalConnection: '' } as never });
		await new Promise((r) => setTimeout(r, 1200));
		console.log('C2c state >>>', modalActions.modalState);
		expect(true).toBe(true);
	});
});
