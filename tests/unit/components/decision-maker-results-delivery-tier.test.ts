/**
 * A route the institution never established must not be handed to the author as
 * if it were an office channel.
 *
 * The delivery tier is derived on the server at resolution and travels to this
 * roster on the live path — the SSE projection at
 * `src/routes/api/agents/stream-decision-makers/+server.ts:358`, the object
 * spread in `src/lib/utils/decision-maker-processing.ts:39-48`,
 * `formData.audience.decisionMakers` bound at
 * `src/lib/components/template/creator/DecisionMakerResolver.svelte:484`, and
 * finally this component. So these assertions are on rendered output, not on the
 * copy module: what the author sees is the only thing that counts.
 *
 * Every tier below comes from a real `deriveDeliveryTier` call, except the one
 * case explicitly labelled as a client-forged literal.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { deriveDeliveryTier, type StandingEvidence } from '$lib/core/agents/target-class';
import { describeDeliveryTier } from '$lib/core/agents/delivery-tier-copy';

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

const DecisionMakerResults = (
	await import('$lib/components/template/creator/DecisionMakerResults.svelte')
).default;

const OFFICEHOLDER: StandingEvidence = {
	email: 'mayor@cityofx.gov',
	title: 'Mayor',
	groundedThisRun: true,
	groundingSourceUrl: 'https://www.cityofx.gov/mayor'
};

const SEAT_CHANNEL: StandingEvidence = {
	email: 'planning@county.gov',
	title: 'Senior Planner',
	groundedThisRun: true,
	groundingSourceUrl: 'https://county.gov/planning'
};

const PERSONAL_MAILBOX: StandingEvidence = {
	email: 'jane.doe@dept.edu',
	title: 'Program Coordinator',
	groundedThisRun: true,
	groundingSourceUrl: 'https://dept.edu/directory'
};

/** A roster row shaped like the ones `processDecisionMakers` emits. */
function row(name: string, evidence: StandingEvidence, organization = 'City of X') {
	return {
		name,
		title: evidence.title ?? '',
		organization,
		email: evidence.email ?? '',
		reasoning: 'Named in the source read this run',
		source: evidence.groundingSourceUrl ?? '',
		provenance: evidence.groundingSourceUrl ?? '',
		isAiResolved: true,
		deliveryTier: deriveDeliveryTier(evidence).deliveryTier
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mount(decisionMakers: any[]) {
	return render(DecisionMakerResults, {
		props: {
			decisionMakers,
			customRecipients: [],
			includesCongress: false,
			onupdate: () => {}
		}
	});
}

const TOKEN = '.reach-unestablished';

// The needle is taken from the module the component itself renders
// (`DecisionMakerResults.svelte:53`) rather than hand-written, so the assertion
// and the copy cannot drift apart, and so this file asserts on THIS node's
// sentence rather than on a substring of a shared copy namespace.
const UNESTABLISHED_SENTENCE = describeDeliveryTier('C') ?? '';

describe('the roster says which routes were never established', () => {
	it('says nothing when every route is an office channel or an officeholder', () => {
		const { container } = mount([
			row('Ada Mayor', OFFICEHOLDER),
			row('Planning Desk', SEAT_CHANNEL, 'County')
		]);

		expect(container.querySelector(TOKEN)).toBeNull();
	});

	it('says it once, with the count, when one route was not established', () => {
		// Vacuity guard: every `not.toContain(UNESTABLISHED_SENTENCE)` below would
		// pass for free if the copy module ever returned an empty string for 'C'.
		expect(UNESTABLISHED_SENTENCE.length).toBeGreaterThan(0);

		const { container } = mount([
			row('Ada Mayor', OFFICEHOLDER),
			row('Jane Doe', PERSONAL_MAILBOX, 'Department')
		]);

		const notes = container.querySelectorAll(TOKEN);
		expect(notes).toHaveLength(1);
		expect(notes[0].textContent).toContain('1');
		expect(notes[0].textContent).toContain(UNESTABLISHED_SENTENCE);
		// The person can find the row to remove.
		expect(notes[0].textContent).toContain('Jane Doe');
	});

	it('counts every unestablished route in the roster, not a visible slice', () => {
		const many = Array.from({ length: 5 }, (_, i) =>
			row(`Person ${i}`, PERSONAL_MAILBOX, `Org ${i}`)
		);
		const { container } = mount([row('Ada Mayor', OFFICEHOLDER), ...many]);

		const note = container.querySelector(TOKEN);
		expect(note?.textContent).toContain('5');
		expect(note?.textContent).toContain('+2 more');
	});

	it('renders differently for an unestablished route than for an officeholder', () => {
		const established = mount([row('Ada Mayor', OFFICEHOLDER), row('Bo Seat', SEAT_CHANNEL)]);
		const unestablished = mount([
			row('Ada Mayor', OFFICEHOLDER),
			row('Bo Seat', PERSONAL_MAILBOX)
		]);

		expect(unestablished.container.innerHTML).not.toEqual(established.container.innerHTML);
		expect(established.container.querySelector(TOKEN)).toBeNull();
		expect(unestablished.container.querySelector(TOKEN)).not.toBeNull();
	});

	it('absence is no statement — a row with no tier renders as it did before the field existed', () => {
		const withField = row('Jane Doe', PERSONAL_MAILBOX, 'Department');
		const deleted = { ...withField };
		delete (deleted as { deliveryTier?: unknown }).deliveryTier;

		const absent = mount([{ ...deleted }]);
		// The comparison row carries an ESTABLISHED tier derived from real evidence,
		// not a second copy of `deleted`: comparing `deleted` to itself proves only
		// that the render is deterministic. What the test name claims is that a row
		// with no tier is indistinguishable from one whose route WAS established,
		// and only this comparison proves it.
		const established = mount([
			{ ...deleted, deliveryTier: deriveDeliveryTier(SEAT_CHANNEL).deliveryTier }
		]);

		expect(absent.container.querySelector(TOKEN)).toBeNull();
		expect(absent.container.innerHTML).toEqual(established.container.innerHTML);
		// Narrowed from a bare two-word substring. This roster renders
		// `DecisionMakerGrouped`, which carries its own route copy from
		// `src/lib/core/agents/reach-census.ts:56` ("Address publication route not
		// established this run"), so a container-wide substring check asserts on a
		// neighbour's sentence rather than on this node's claim. This IS a narrowing
		// — a longer negative needle is weaker in the abstract — and it is honest
		// only because the structural proof carries the weight: :150 shows the
		// caution element is absent entirely, and the innerHTML equality above shows
		// the row is byte-identical to an established one. This line is belt and
		// braces on top of those.
		expect(absent.container.textContent ?? '').not.toContain(UNESTABLISHED_SENTENCE);
	});

	it('a forged tier buys silence, never a positive claim', () => {
		// Hand-written literal on purpose: no grounding evidence produced this. A
		// client that asserts the reassuring tier gets exactly the pixels of no
		// data — the surface makes no claim about A or B, so forging can only
		// remove a caution, never manufacture trust.
		const forged = { ...row('Jane Doe', PERSONAL_MAILBOX, 'Department'), deliveryTier: 'A' };
		const noTier = { ...forged };
		delete (noTier as { deliveryTier?: unknown }).deliveryTier;

		const forgedRender = mount([forged]);
		const silentRender = mount([noTier]);

		expect(forgedRender.container.querySelector(TOKEN)).toBeNull();
		expect(forgedRender.container.innerHTML).toEqual(silentRender.container.innerHTML);
	});

	it('never shows the sender the internal taxonomy', () => {
		const { container } = mount([
			row('Ada Mayor', OFFICEHOLDER),
			row('Bo Seat', SEAT_CHANNEL),
			row('Jane Doe', PERSONAL_MAILBOX, 'Department')
		]);

		expect(container.querySelector(TOKEN)).not.toBeNull();
		expect(container.textContent ?? '').not.toMatch(/(?<![\w-])[ABC](?![\w-])/);
		for (const reason of [
			'no_address',
			'not_grounded_this_run',
			'off_domain_publication',
			'personal_local_part_no_seat',
			'seat_channel_self_published',
			'officeholder_self_published',
			'designated_contact_self_published'
		]) {
			expect(container.innerHTML).not.toContain(reason);
		}
	});
});
