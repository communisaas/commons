/**
 * What the collective control promises is what the send path can address.
 *
 * A stranger arrives at `/s/<slug>?via=share`. That route never redirects on
 * `locals`, so the landscape mounts for a viewer who is nobody's constituent.
 * The batch header used to offer "Write to all {everyone}" while the send path
 * silently narrowed to `m.email && m.deliveryRoute === 'email'` — congressional
 * and form-only positions were counted into a promise nothing would keep.
 *
 * These cases mount the real components with the stranger's props and read the
 * rendered DOM and the emitted ids, never the source. The fix is a promise
 * change, not a population change: every unroutable person must still be on the
 * page, by name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import type { RecipientConfigDecisionMaker, Template } from '$lib/types/template';
import { slugify, type DistrictOfficialInput } from '$lib/utils/landscapeMerge';

// svelte/motion reads prefers-reduced-motion via window.matchMedia at module
// evaluation — before the shared beforeEach mock from tests/config/setup.ts
// applies. Shim it first, then import the components dynamically.
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

const PowerLandscape = (await import('$lib/components/action/PowerLandscape.svelte')).default;
const TemplatePreview = (
	await import('$lib/components/template-browser/TemplatePreview.svelte')
).default;

function template(deliveryMethod: string): Template {
	return {
		id: 'reach-honesty',
		slug: 'reach-honesty',
		title: 'Fund the evening clinic',
		description: 'Ask for evening clinic hours.',
		domain: 'Public Health',
		type: 'advocacy',
		deliveryMethod,
		message_body: 'Dear official,\n\nPlease act.',
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
 * mergeLandscape dedupes on a normalized name that strips Rep./Sen./Dr., so
 * every fixture below carries a distinct surname.
 */
function dm(name: string, email?: string): RecipientConfigDecisionMaker {
	return {
		name,
		title: 'Board Member',
		role: 'Board Member',
		organization: 'County Health Board',
		roleCategory: 'votes',
		...(email ? { email } : {})
	} as RecipientConfigDecisionMaker;
}

function official(
	name: string,
	extra: Partial<DistrictOfficialInput> = {}
): DistrictOfficialInput {
	return {
		name,
		title: 'Representative',
		organization: 'U.S. House',
		bioguideId: null,
		cwcCode: 'H001',
		chamber: 'house',
		phone: null,
		contactFormUrl: null,
		websiteUrl: null,
		...extra
	};
}

/** The stranger's props: no constituency, no history, no prior self-report. */
function strangerProps(
	decisionMakers: RecipientConfigDecisionMaker[],
	districtOfficials: DistrictOfficialInput[],
	deliveryMethod: string,
	onBatchRegister: (ids: string[]) => void = () => {}
) {
	return {
		template: template(deliveryMethod),
		decisionMakers,
		districtOfficials,
		contactedRecipients: new Set<string>(),
		departingRecipients: new Set<string>(),
		priorContactIds: new Set<string>(),
		viewerIsConstituent: false,
		onWriteTo: () => {},
		onBatchRegister
	};
}

const MIXED_DMS = [
	dm('Amara Okonkwo', 'amara@county.example'),
	dm('Beatriz Salgado', 'beatriz@county.example'),
	dm('Corwin Halliday')
];
const MIXED_OFFICIALS = [
	official('Dara Whitfield'),
	official('Emil Vasquez', { cwcCode: 'S002', chamber: 'senate' }),
	official('Fenna Ibarra', { cwcCode: 'S003', chamber: 'senate' })
];

describe('the batch control promises only the reach the send path has', () => {
	it('counts the addressable set, not the headcount, and hides nobody', () => {
		const { container, getByRole } = render(
			PowerLandscape,
			strangerProps(MIXED_DMS, MIXED_OFFICIALS, 'email')
		);

		const button = getByRole('button', { name: /write to all/i });
		expect(button.textContent).toContain('Write to all 2');
		expect(container.textContent).not.toContain('Write to all 6');
		expect(container.textContent).toMatch(/4[^.]*no email route/);

		for (const name of [
			'Amara Okonkwo',
			'Beatriz Salgado',
			'Corwin Halliday',
			'Dara Whitfield',
			'Emil Vasquez',
			'Fenna Ibarra'
		]) {
			expect(container.textContent).toContain(name);
		}
	});

	it('offers no batch button on an all-CWC landscape and states why, by number', () => {
		const { container, queryByRole, getByRole } = render(
			PowerLandscape,
			strangerProps([], MIXED_OFFICIALS, 'cwc')
		);

		expect(queryByRole('button', { name: /write to all/i })).toBeNull();
		const status = getByRole('status');
		expect(status.textContent).toContain('3');

		// The anti-hiding lock: an unreachable landscape is still a full landscape.
		for (const name of ['Dara Whitfield', 'Emil Vasquez', 'Fenna Ibarra']) {
			expect(container.textContent).toContain(name);
		}
	});

	it('excludes a CWC official who also happens to carry an email', () => {
		const onBatchRegister = vi.fn();
		const cwcWithEmail = official('Gemma Thorpe', { email: 'gemma@house.example' });
		const { getByRole } = render(
			PowerLandscape,
			strangerProps(
				[MIXED_DMS[0], MIXED_DMS[1]],
				[cwcWithEmail],
				'email',
				onBatchRegister
			)
		);

		// A naive `m.email` count says 3. The send path can address 2.
		const button = getByRole('button', { name: /write to all/i });
		expect(button.textContent).toContain('Write to all 2');

		button.click();
		const ids = onBatchRegister.mock.calls[0][0] as string[];
		expect(ids).toHaveLength(2);
		expect(ids).not.toContain(slugify('Gemma Thorpe'));
	});

	it('hands the click exactly the ids it advertised', () => {
		const onBatchRegister = vi.fn();
		const { getByRole } = render(
			PowerLandscape,
			strangerProps(MIXED_DMS, MIXED_OFFICIALS, 'email', onBatchRegister)
		);

		getByRole('button', { name: /write to all/i }).click();
		expect(onBatchRegister).toHaveBeenCalledTimes(1);
		expect(onBatchRegister.mock.calls[0][0]).toEqual([
			slugify('Amara Okonkwo'),
			slugify('Beatriz Salgado')
		]);
	});

	it('renders no send control in the page-context preview column', () => {
		// Positive control: the same mount in modal context DOES render a send
		// button, so the negative assertion below is about `context`, not a
		// mis-typed testid or a component that failed to mount.
		const modal = render(TemplatePreview, {
			props: {
				template: template('cwc'),
				user: null,
				context: 'modal',
				onSendMessage: () => {}
			}
		});
		expect(
			modal.queryByTestId('send-email-button') ?? modal.queryByTestId('contact-congress-button')
		).not.toBeNull();
		modal.unmount();

		// `context: 'page'` is the exact value src/routes/s/[slug]/+page.svelte
		// passes. This is why the scroll-only `onSendMessage` handler it also
		// passes is unreachable on this surface — no control ever calls it.
		const page = render(TemplatePreview, {
			props: {
				template: template('cwc'),
				user: null,
				context: 'page',
				onSendMessage: () => {}
			}
		});
		expect(page.queryByTestId('send-email-button')).toBeNull();
		expect(page.queryByTestId('contact-congress-button')).toBeNull();
	});
});
