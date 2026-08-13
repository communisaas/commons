/**
 * When the free provider lane empties, three different things can have
 * happened, and a person is entitled to know which one.
 *
 * `actor`    — they spent their own monthly share.
 * `platform` — a stranger spent the shared pool; the reader may have used none of it.
 * `blocked`  — the denial carried no reason we recognise, so nobody measured anything.
 *
 * The old copy stated the first of those unconditionally, which made it a lie
 * two-thirds of the time. These mounts render the real resolvers at the stage a
 * person actually reaches and assert the three bodies are pairwise distinct,
 * that the shared-pool branch never attributes the spend to the reader, that a
 * month-away reset renders as a date rather than a bare time of day, and that
 * every branch keeps the escape it had before.
 *
 * Every expected sentence is a literal owned here, not read back off the
 * component — asking the component what it renders would pass either way.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import { createEmptyTemplateFormData } from '$lib/types/template';

/** Phrasing that charges the reader for capacity. Forbidden on the shared-pool branch. */
const FIRST_PERSON_CONSUMPTION = /\byou(?:'ve| have)?\s+used\b/i;

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
			data: { user: { id: 'user_1' } } as Record<string, unknown>,
			url: new URL('http://localhost/'),
			params: {},
			route: { id: '/' },
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

// The authoring resolver derives a recovery key and an input hash before it
// reaches the network. Neither is under test here, and both need WebCrypto that
// jsdom does not reliably provide.
vi.mock('$lib/core/agents/message-job-recovery', () => ({
	computeMessageInputHash: vi.fn(async () => 'input-hash'),
	getOrCreateMessageRecoveryPublicKey: vi.fn(async () => ({ kty: 'EC' })),
	decryptMessageJobResult: vi.fn(async () => null)
}));

import DecisionMakerResolver from '$lib/components/template/creator/DecisionMakerResolver.svelte';
import MessageGenerationResolver from '$lib/components/template/creator/MessageGenerationResolver.svelte';

type Scope = 'actor' | 'platform' | 'blocked' | undefined;

/** Rendered text with source-formatting line breaks collapsed. */
function visible(container: HTMLElement): string {
	return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** A reset one calendar month out — the case the old time-only render mangled. */
const MONTH_AWAY_RESET = new Date(Date.now() + 25 * 24 * 60 * 60 * 1_000).toISOString();

function denyWith(scope: Scope, resetAt: string) {
	global.fetch = vi.fn().mockResolvedValue({
		ok: false,
		status: 429,
		statusText: 'Too Many Requests',
		headers: new Headers(),
		json: async () => ({
			error: 'AI capacity limit reached. Please try again after the reset time.',
			tier: 'authenticated',
			remaining: 0,
			limit: 2,
			resetAt,
			...(scope === undefined ? {} : { budgetScope: scope })
		}),
		text: async () => ''
	}) as unknown as typeof fetch;
}

function draft() {
	const formData = createEmptyTemplateFormData('Fix the crosswalk on Mission St');
	formData.objective.title = 'Fix the crosswalk on Mission St';
	formData.objective.description = 'The crossing has no signal and children use it daily.';
	return formData;
}

async function renderDenied(
	component: typeof DecisionMakerResolver | typeof MessageGenerationResolver,
	scope: Scope,
	resetAt = MONTH_AWAY_RESET
) {
	denyWith(scope, resetAt);
	const formData = draft();
	if (component === MessageGenerationResolver) {
		formData.audience.decisionMakers = [
			{
				name: 'A Supervisor',
				title: 'Supervisor',
				organization: 'Board of Supervisors',
				email: 'supervisor@example.gov',
				isAiResolved: true
			}
		] as never;
	}
	const options = { props: { formData, onnext: () => {}, onback: () => {} } };
	const rendered =
		component === MessageGenerationResolver
			? render(MessageGenerationResolver, options)
			: render(DecisionMakerResolver, options);
	await waitFor(() => {
		expect(visible(rendered.container)).toMatch(/limit reached/i);
	});
	return rendered;
}

describe('free-lane exhaustion copy on the research step', () => {
	it('tells a person whose own share ran out that it was their share', async () => {
		const { container } = await renderDenied(DecisionMakerResolver, 'actor');
		expect(visible(container)).toContain(
			"You've used your share of the free research pool this month."
		);
	});

	it('never charges the reader for a shared pool a stranger emptied', async () => {
		const { container } = await renderDenied(DecisionMakerResolver, 'platform');
		expect(visible(container)).toContain(
			'The shared free research pool is empty until it resets.'
		);
		expect(visible(container)).toContain('Nobody can run a lookup until then.');
		expect(visible(container)).not.toMatch(FIRST_PERSON_CONSUMPTION);
	});

	it('says it could not tell, rather than falling back into either measured branch', async () => {
		const { container } = await renderDenied(DecisionMakerResolver, undefined);
		expect(visible(container)).toContain("We couldn't confirm how much capacity is left.");
		expect(visible(container)).not.toMatch(FIRST_PERSON_CONSUMPTION);
		expect(visible(container)).not.toContain('The shared free research pool');
	});

	it('renders three pairwise-distinct bodies and keeps the manual-recipient escape in each', async () => {
		const bodies: string[] = [];
		for (const scope of ['actor', 'platform', 'blocked'] as const) {
			const { container, getByRole, unmount } = await renderDenied(DecisionMakerResolver, scope);
			expect(getByRole('button', { name: /add recipients manually/i })).toBeTruthy();
			bodies.push(visible(container));
			unmount();
		}
		expect(new Set(bodies).size).toBe(3);
	});

	it('renders a month-away reset as a date, not as a time of day', async () => {
		const { container } = await renderDenied(DecisionMakerResolver, 'platform');
		const text = visible(container);
		expect(text).toMatch(/Resets on [A-Z][a-z]{2} \d{1,2}/);
		expect(text).not.toMatch(/Resets at \d{1,2}:\d{2}/);
	});

	it('still renders a same-day reset as a time of day', async () => {
		const soon = new Date(Date.now() + 30 * 60 * 1_000);
		// Only meaningful while the clock has not crossed midnight mid-run.
		if (soon.getDate() !== new Date().getDate()) return;
		const { container } = await renderDenied(
			DecisionMakerResolver,
			'actor',
			soon.toISOString()
		);
		expect(visible(container)).toMatch(/Resets at \d{1,2}:\d{2}/);
	});
});

describe('free-lane exhaustion copy on the authoring step', () => {
	it('renders three pairwise-distinct bodies and keeps the go-back escape in each', async () => {
		const bodies: string[] = [];
		for (const scope of ['actor', 'platform', 'blocked'] as const) {
			const { container, getByRole, unmount } = await renderDenied(
				MessageGenerationResolver,
				scope
			);
			expect(getByRole('button', { name: /go back/i })).toBeTruthy();
			bodies.push(visible(container));
			unmount();
		}
		expect(new Set(bodies).size).toBe(3);
	});

	it('attributes an actor denial to the reader and a platform denial to nobody', async () => {
		const actor = await renderDenied(MessageGenerationResolver, 'actor');
		expect(visible(actor.container)).toContain(
			"You've used your share of the free authoring pool this month."
		);
		actor.unmount();

		const platform = await renderDenied(MessageGenerationResolver, 'platform');
		expect(visible(platform.container)).toContain(
			'The shared free authoring pool is empty until it resets.'
		);
		expect(visible(platform.container)).not.toMatch(FIRST_PERSON_CONSUMPTION);
	});

	it('says it could not tell when the denial carried no reason it recognises', async () => {
		const { container } = await renderDenied(MessageGenerationResolver, undefined);
		expect(visible(container)).toContain("We couldn't confirm how much capacity is left.");
		expect(visible(container)).not.toMatch(FIRST_PERSON_CONSUMPTION);
	});

	it('does not gain a recipient control on an authoring step', async () => {
		const { queryByRole } = await renderDenied(MessageGenerationResolver, 'platform');
		expect(queryByRole('button', { name: /add recipients manually/i })).toBeNull();
	});
});
