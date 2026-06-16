import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Template, RelationEdge } from '$lib/types/template';
import { resolveDomainHue } from '$lib/utils/domain-hue';
import { familyEdges } from '$lib/core/topic/relation-edges';

// svelte/motion (pulled in transitively by the design primitives) reads
// prefers-reduced-motion via window.matchMedia at module evaluation. Shim it
// before the component loads so the import does not throw under jsdom.
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

const RelationGraph = (
	await import('$lib/components/template-browser/relation/RelationGraph.svelte')
).default;

const COMPONENT_PATH =
	'src/lib/components/template-browser/relation/RelationGraph.svelte';

/** A minimal valid template; overrides pin only what an assertion is about. */
function makeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 't1',
		slug: 'restore-clinic-hours',
		title: 'Restore the clinic hours',
		description: 'Ask the county to fund evening hours at the public clinic.',
		domain: 'Healthcare',
		type: 'advocacy',
		deliveryMethod: 'direct',
		message_body: 'Body',
		delivery_config: {},
		recipient_config: {},
		coordinationScale: 0,
		isNew: false,
		status: 'published',
		is_public: true,
		send_count: 0,
		createdAt: '2026-06-01T00:00:00.000Z',
		updatedAt: '2026-06-01T00:00:00.000Z',
		...overrides
	} as Template;
}

/** Every node group rendered in the SVG. */
function nodes(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('.relation-node'));
}

/** Every edge path drawn in the SVG field (excludes the legend swatches, which
 *  are <line> samples, not field <path> edges). */
function fieldEdges(container: HTMLElement): Element[] {
	return Array.from(
		container.querySelectorAll('.relation-graph__edges .relation-edge')
	);
}

/** Isolated nodes — the honestly-alone templates. */
function isolatedNodes(container: HTMLElement): Element[] {
	return Array.from(container.querySelectorAll('.relation-node--isolated'));
}

describe('RelationGraph — the relatedness map', () => {
	it('draws one node per template (node count == template count)', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Healthcare', title: 'Clinic hours' }),
			makeTemplate({ id: 'b', domain: 'Housing', title: 'Zoning reform' }),
			makeTemplate({ id: 'c', domain: 'Transportation', title: 'Bike lanes' })
		];
		const { container } = render(RelationGraph, {
			props: { templates, onSelect: vi.fn() }
		});
		expect(nodes(container).length).toBe(templates.length);
	});

	it('colors each node via resolveDomainHue (the shared hue authority, not a generic dot)', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Healthcare' }),
			makeTemplate({ id: 'b', domain: 'Transportation' })
		];
		const { container } = render(RelationGraph, {
			props: { templates, onSelect: vi.fn() }
		});
		for (const t of templates) {
			const glyph = container.querySelector(
				`[data-template-id="${t.id}"] .relation-node__glyph`
			) as SVGCircleElement;
			expect(glyph).toBeTruthy();
			const expectedHue = resolveDomainHue(t);
			// The fill cites the resolver's hue — colour is the topic, not a constant.
			expect(glyph.getAttribute('fill')).toContain(String(expectedHue));
		}
	});

	it('renders exactly the admissible edges — no decorative or placeholder ties', () => {
		// Two templates in the same family (a family edge), one in a family of its
		// own (no kin, no measured twin → isolated). The only edge that may exist is
		// the one same-family pair; the lone template gets none.
		const templates = [
			makeTemplate({ id: 'a', domain: 'Transportation', title: 'Bike lanes' }),
			makeTemplate({ id: 'b', domain: 'Transportation', title: 'Freeway removal' }),
			makeTemplate({ id: 'c', domain: 'Healthcare', title: 'Clinic hours' })
		];
		const { container } = render(RelationGraph, {
			props: { templates, onSelect: vi.fn() }
		});
		// The admissible set is computed from the same pure source the component uses.
		const admissible = familyEdges(templates);
		expect(fieldEdges(container).length).toBe(admissible.length);
		// And it is exactly one tie (the two transportation templates), no more.
		expect(fieldEdges(container).length).toBe(1);
	});

	it('renders a measured twin edge passed in, scaling its weight by score', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Justice', title: 'Drug treatment' }),
			makeTemplate({ id: 'b', domain: 'Housing', title: 'Zoning reform' })
		];
		// A cross-domain pair: no family edge, only the measured twin we pass in.
		const edges: RelationEdge[] = [{ a: 'a', b: 'b', kind: 'twin', score: 0.9 }];
		const { container } = render(RelationGraph, {
			props: { templates, edges, onSelect: vi.fn() }
		});
		const drawn = fieldEdges(container);
		expect(drawn.length).toBe(1);
		const twin = drawn[0] as SVGPathElement;
		expect(twin.getAttribute('data-edge-kind')).toBe('twin');
		// The twin's stroke-width is set inline from the score (not the CSS default).
		const width = parseFloat(twin.style.strokeWidth);
		expect(width).toBeGreaterThan(2.2); // a high score sits above the base weight
	});

	it('distinguishes twin (solid) from family (dashed): different kinds, different encodings', () => {
		const templates = [
			// A same-family pair (Transportation) → a family edge.
			makeTemplate({ id: 'a', domain: 'Transportation', title: 'Bike lanes' }),
			makeTemplate({ id: 'b', domain: 'Transportation', title: 'Freeway removal' }),
			// A cross-domain pair we relate by a measured twin → a twin edge.
			makeTemplate({ id: 'c', domain: 'Justice', title: 'Drug treatment' }),
			makeTemplate({ id: 'd', domain: 'Education', title: 'Preschool' })
		];
		const edges: RelationEdge[] = [{ a: 'c', b: 'd', kind: 'twin', score: 0.7 }];
		const { container } = render(RelationGraph, {
			props: { templates, edges, onSelect: vi.fn() }
		});
		const drawn = fieldEdges(container);
		const kinds = drawn.map((e) => e.getAttribute('data-edge-kind'));
		expect(kinds).toContain('twin');
		expect(kinds).toContain('family');
		// The two kinds carry distinct classes (the renderer's distinct encodings).
		expect(container.querySelector('.relation-edge--twin')).toBeTruthy();
		expect(container.querySelector('.relation-edge--family')).toBeTruthy();
	});

	it('renders no-kin templates as visibly isolated, with no edge of their own', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Transportation', title: 'Bike lanes' }),
			makeTemplate({ id: 'b', domain: 'Transportation', title: 'Freeway removal' }),
			// Lone families: no twin, no same-family kin → honestly isolated.
			makeTemplate({ id: 'c', domain: 'Healthcare', title: 'Veterans health' }),
			makeTemplate({ id: 'd', domain: 'Labor', title: 'Retail wages' })
		];
		const { container } = render(RelationGraph, {
			props: { templates, onSelect: vi.fn() }
		});
		const isolated = isolatedNodes(container);
		const isolatedIds = isolated.map((n) => n.getAttribute('data-template-id'));
		expect(isolatedIds).toContain('c');
		expect(isolatedIds).toContain('d');
		// The connected transportation pair is NOT isolated.
		expect(isolatedIds).not.toContain('a');
		expect(isolatedIds).not.toContain('b');
		// Each isolated node is marked structurally so the surface can hold it alone.
		for (const n of isolated) {
			expect(n.getAttribute('data-isolated')).toBe('true');
		}
	});

	it('names the relation kinds in a plain-English legend', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Transportation' }),
			makeTemplate({ id: 'b', domain: 'Transportation' })
		];
		const { container, getByText } = render(RelationGraph, {
			props: { templates, onSelect: vi.fn() }
		});
		const legend = container.querySelector('.relation-graph__legend');
		expect(legend).toBeTruthy();
		// Plain English, naming both honest edge kinds.
		expect(getByText(/measured semantic twin/i)).toBeTruthy();
		expect(getByText(/shared civic family/i)).toBeTruthy();
	});

	it('shows the title copy in the approved-mock voice', () => {
		const { getByText } = render(RelationGraph, {
			props: { templates: [makeTemplate({ id: 'a' })], onSelect: vi.fn() }
		});
		expect(getByText(/The commons, by relation/i)).toBeTruthy();
	});

	it('reports a node activation up (click and keyboard)', async () => {
		const onSelect = vi.fn();
		const templates = [makeTemplate({ id: 'a', domain: 'Healthcare' })];
		const { container } = render(RelationGraph, {
			props: { templates, onSelect }
		});
		const node = container.querySelector('[data-template-id="a"]') as HTMLElement;
		await fireEvent.click(node);
		expect(onSelect).toHaveBeenCalledWith('a');
		await fireEvent.keyDown(node, { key: 'Enter' });
		expect(onSelect).toHaveBeenCalledTimes(2);
	});

	it('reports hover up so a caller can light the neighbourhood / preload', async () => {
		const onHover = vi.fn();
		const templates = [makeTemplate({ id: 'a', domain: 'Healthcare' })];
		const { container } = render(RelationGraph, {
			props: { templates, onSelect: vi.fn(), onHover }
		});
		const node = container.querySelector('[data-template-id="a"]') as HTMLElement;
		await fireEvent.mouseEnter(node);
		expect(onHover).toHaveBeenCalledWith('a', true);
		await fireEvent.mouseLeave(node);
		expect(onHover).toHaveBeenCalledWith('a', false);
	});

	it('does not draw a family edge across domains (cross-domain pairs have no kin)', () => {
		const templates = [
			makeTemplate({ id: 'a', domain: 'Healthcare' }),
			makeTemplate({ id: 'b', domain: 'Housing' })
		];
		const { container } = render(RelationGraph, {
			props: { templates, onSelect: vi.fn() }
		});
		// No measured twin passed, different domains → no admissible edge at all.
		expect(fieldEdges(container).length).toBe(0);
		// Both stand alone.
		expect(isolatedNodes(container).length).toBe(2);
	});

	it('paints the whole map at full presence at rest, even with a node selected', async () => {
		// The live condition the component lane never exercised: the landing's
		// template store auto-selects the first template on hydration, so the graph
		// is mounted with a non-null `selectedId`. The at-rest map must still paint
		// at FULL presence — `selectedId` marks one node but must NOT engage the
		// global dim. (Before the fix, any truthy `selectedId` lit a focus set and
		// the whole field rendered dimmed-to-one-node at rest.)
		const templates = [
			makeTemplate({ id: 'a', domain: 'Transportation', title: 'Bike lanes' }),
			makeTemplate({ id: 'b', domain: 'Transportation', title: 'Freeway removal' }),
			makeTemplate({ id: 'c', domain: 'Healthcare', title: 'Clinic hours' })
		];
		const { container } = render(RelationGraph, {
			props: { templates, selectedId: 'a', onSelect: vi.fn() }
		});

		// No hover, no graph focus → the field is not globally dimmed.
		const svg = container.querySelector('.relation-graph__svg') as SVGElement;
		expect(svg).toBeTruthy();
		expect(svg.classList.contains('has-focus')).toBe(false);

		// No node carries the dimmed class at rest — every node reads at presence.
		expect(container.querySelectorAll('.relation-node--dimmed').length).toBe(0);
		// And every node IS lit (the at-rest full-presence state).
		expect(container.querySelectorAll('.relation-node--lit').length).toBe(nodes(container).length);

		// The selected node is still marked (a quiet "this one is open" annotation),
		// but the marker is on exactly one node and dims nothing.
		expect(container.querySelectorAll('.relation-node--selected').length).toBe(1);
		const selected = container.querySelector('.relation-node--selected');
		expect(selected?.getAttribute('data-template-id')).toBe('a');

		// Hover still engages the focus state — the dim is hover-driven, not store-driven.
		const hovered = container.querySelector('[data-template-id="c"]') as HTMLElement;
		await fireEvent.mouseEnter(hovered);
		expect(svg.classList.contains('has-focus')).toBe(true);
		// On leave, the field returns to full presence.
		await fireEvent.mouseLeave(hovered);
		expect(svg.classList.contains('has-focus')).toBe(false);
	});

	it('renders an honest empty state when there are no templates', () => {
		const { container, getByText } = render(RelationGraph, {
			props: { templates: [], onSelect: vi.fn() }
		});
		expect(nodes(container).length).toBe(0);
		expect(fieldEdges(container).length).toBe(0);
		expect(getByText('No templates yet.')).toBeTruthy();
	});

	it('carries no foreign graph-library import in the source', () => {
		const src = readFileSync(resolve(process.cwd(), COMPONENT_PATH), 'utf8');
		expect(src).not.toMatch(/\bfrom\s+['"]d3/);
		expect(src).not.toMatch(/\bfrom\s+['"]cytoscape/);
		expect(src).not.toMatch(/\bfrom\s+['"]sigma/);
		expect(src).not.toMatch(/\bfrom\s+['"]vis-/);
		expect(src).not.toMatch(/force-graph/);
	});

	it('carries no foreign chrome — no pill, no white-box container, no oversized radius', () => {
		const src = readFileSync(resolve(process.cwd(), COMPONENT_PATH), 'utf8');
		// No oversized radius (max rounded-lg in this system).
		expect(src).not.toMatch(/rounded-(xl|2xl|3xl|full)\b/);
		// No bg-white container utility (white is for Artifacts only; the ground is cream).
		expect(src).not.toMatch(/class="[^"]*\bbg-white\b/);
	});
});
