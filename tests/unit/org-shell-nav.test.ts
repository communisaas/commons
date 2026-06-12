/**
 * Shell navigation contract.
 *
 * The Mantle dock and Spotlight are plain navigation: a mark is a label, an
 * href, and at most one count badge read from real loaded data; a Spotlight
 * destination is a label, a group, and a route or space switch. Neither
 * surface imports the capability vocabulary modules or renders contract
 * grammar, and both guard their space-switch navigation with the URL-aware
 * check so a mark click works from a ?view=full page.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
	SecondaryLink,
	WorkspaceMark
} from '$lib/components/org/WorkspaceSwitcher.svelte';
import type { SpotlightDestination } from '$lib/components/org/os/Spotlight.svelte';

const SWITCHER = 'src/lib/components/org/WorkspaceSwitcher.svelte';
const SPOTLIGHT = 'src/lib/components/org/os/Spotlight.svelte';
const ORG_LAYOUT = 'src/routes/org/[slug]/+layout.svelte';

const switcher = readFileSync(SWITCHER, 'utf8');
const spotlight = readFileSync(SPOTLIGHT, 'utf8');
const layout = readFileSync(ORG_LAYOUT, 'utf8');

// Assembled from fragments so the excised vocabulary never appears verbatim
// in this file either.
const CAPABILITY_MODULE_IMPORT = new RegExp(
	`\\$lib/data/capability-(state-label${'s'}|hyper${'graph'}|cluster${'s'})`
);
const CONTRACT_GRAMMAR = new RegExp(
	`(hand${'off'}|gateSignal|ws-${'contract'}|sp-${'gate'}|draft-${'only'}|not (yet )?arm${'ed'})`,
	'i'
);
const GATE_MACHINERY = new RegExp(
	`(${'get'}GateEvidence|${'format'}GateEvidence|${'command'}Gate|${'build'}LaunchPressureRows|${'build'}GateRegisterRows|${'build'}SendReadiness|${'build'}StudioAuthoringReadiness)`
);

describe('the workspace mark type', () => {
	it('is plain navigation data: id, label, href, count, folded links', () => {
		const mark: WorkspaceMark = {
			id: 'base',
			label: 'People',
			href: '/org/x/supporters',
			count: 12,
			secondary: [
				{ href: '/org/x/supporters/import', label: 'Import people', note: 'One sentence.' }
			]
		};
		expect(mark.id).toBe('base');
		expect(mark.secondary?.[0].note).toBe('One sentence.');
	});

	it('treats a null count as an unread slice, not a zero', () => {
		const unread: WorkspaceMark = { id: 'return', label: 'Results', href: '/org/x', count: null };
		expect(unread.count).toBeNull();
	});

	it('rejects the removed contract grammar at compile time', () => {
		// @ts-expect-error — capability state grammar is gone from the mark
		const withState: WorkspaceMark = { id: 'studio', label: 'Studio', href: '/x', state: 'live' };
		// @ts-expect-error — gate prose is gone from folded links
		const withGate: SecondaryLink = { href: '/x', label: 'X', gate: 'gated until …' };
		expect(withState.label).toBe('Studio');
		expect(withGate.label).toBe('X');
	});
});

describe('the spotlight destination type', () => {
	it('is a label, a group, and a route or space switch', () => {
		const route: SpotlightDestination = {
			id: 'route-x',
			label: 'Bills',
			group: 'Power',
			kind: 'route',
			href: '/org/x/legislation',
			count: 3
		};
		const space: SpotlightDestination = {
			id: 'space-studio',
			label: 'Studio',
			group: 'Workspaces',
			kind: 'space',
			spaceId: 'studio'
		};
		expect(route.kind).toBe('route');
		expect(space.spaceId).toBe('studio');
	});

	it('rejects the removed contract grammar at compile time', () => {
		// @ts-expect-error — action verb grammar is gone from destinations
		const bad: SpotlightDestination = { id: 'x', label: 'X', group: 'G', kind: 'route', action: 'read posture' };
		expect(bad.label).toBe('X');
	});
});

describe('the workspace switcher', () => {
	it('imports no capability vocabulary modules', () => {
		expect(switcher).not.toMatch(CAPABILITY_MODULE_IMPORT);
	});

	it('renders no contract grammar', () => {
		expect(switcher).not.toMatch(CONTRACT_GRAMMAR);
	});

	it('reads the live process count from the OS kernel for the Studio mark', () => {
		expect(switcher).toContain('os.runningProcesses.length');
		expect(switcher).toContain('ws-count--alive');
	});

	it('guards the mark click with the URL-aware space check', () => {
		expect(switcher).toContain('rendersSpaceForUrl($page.url, base)');
		expect(switcher).not.toMatch(/isSpacePath\(/);
	});
});

describe('spotlight', () => {
	it('imports no capability vocabulary modules and nothing from the switcher', () => {
		expect(spotlight).not.toMatch(CAPABILITY_MODULE_IMPORT);
		expect(spotlight).not.toContain('WorkspaceSwitcher');
	});

	it('renders no contract grammar', () => {
		expect(spotlight).not.toMatch(CONTRACT_GRAMMAR);
	});

	it('guards the space switch with the URL-aware check', () => {
		expect(spotlight).toContain('rendersSpaceForUrl($page.url, base)');
		expect(spotlight).not.toMatch(/isSpacePath\(/);
	});
});

describe('the org layout', () => {
	it('imports no capability vocabulary modules', () => {
		expect(layout).not.toMatch(CAPABILITY_MODULE_IMPORT);
	});

	it('builds no gate or readiness machinery', () => {
		expect(layout).not.toMatch(GATE_MACHINERY);
	});

	it('derives count badges from the real loaded slices', () => {
		expect(layout).toContain('data.spaces.base?.total ?? null');
		expect(layout).toContain('data.spaces.return?.stats.activeCampaigns ?? null');
		expect(layout).toContain('data.spaces.landscape?.followedCount ?? null');
	});

	it('sources bounded-action notes from the shared limit-sentence module', () => {
		expect(layout).toContain("from '$lib/data/org-limit-sentences'");
		expect(layout).toContain("orgLimitSentence('text_dispatch_not_armed')");
		expect(layout).toContain("orgLimitSentence('email_server_dispatch_dependency_missing')");
	});
});
