<script lang="ts">
	/**
	 * RelationGraph — the relatedness map as a hand-built SVG diagram.
	 *
	 * Each public template is a node, coloured by its topic hue (the same
	 * `resolveDomainHue` authority the spectrum bands read, so a template's colour
	 * here agrees with its colour there). The structure is the EDGES — what relates
	 * to what — not a position on any axis:
	 *
	 *   - a SOLID edge is a measured semantic twin: mean-centered template cosine
	 *     that cleared the calibrated threshold and survived leave-one-out, computed
	 *     server-side (the 768-dim vectors never reach here — only the {a,b,score}
	 *     tuple does). Its weight scales with the score, so a stronger twin reads as
	 *     a thicker tie.
	 *   - a DASHED edge is civic-family kinship: the two templates share a domain
	 *     anchor. Taxonomic, not measured, so it is drawn lighter and subordinate.
	 *     These are derived right here from the already-shipped `domain` string
	 *     (`familyEdges`) — no embedding, no widened payload.
	 *   - an optional third subordinate style carries tag-CONCEPT edges when the
	 *     server emits any (templates sharing a tight tag cluster). At this corpus
	 *     it is usually empty, and that is honest.
	 *
	 * A template with NO admissible edge is NOT dragged into a cluster or given a
	 * decorative tie to look less lonely — the layout (`layoutRelationGraph`) seeds
	 * it on an outer ring so it settles honestly alone at the periphery. At the seed
	 * this surface is a few small clusters + several solitary concerns; that
	 * sparsity is the truth, not a defect, and the same rendering blooms denser as
	 * the corpus grows.
	 *
	 * This is our own diagram — SVG + oklch in the existing hand-built idiom, no d3
	 * or any foreign force/graph library. The layout is a deterministic, SSR-safe
	 * pure function, so the server and the client agree to the pixel and the map
	 * never lurches on hydration.
	 */

	import type { Template, RelationEdge } from '$lib/types/template';
	import { resolveDomainHue, anchorLabelForHue, matchAnchor } from '$lib/utils/domain-hue';
	import { familyEdges } from '$lib/core/topic/relation-edges';
	import { layoutRelationGraph } from '$lib/core/topic/graph-layout';
	import { spring as svelteSpring } from 'svelte/motion';
	import { SPRINGS } from '$lib/design/motion';
	import { Search } from '@lucide/svelte';

	interface Props {
		/** The public templates to relate — one node each. */
		templates: Template[];
		/** The measured edges resolved server-side (twin) plus any tag-concept edges.
		 *  Family edges are derived here from the templates' domains, so a caller
		 *  passes only what needs a vector to compute. Absent → twin/concept-free,
		 *  family kinship still renders. */
		edges?: RelationEdge[];
		/** The currently selected (diving) template id, threaded down so the dive
		 *  owner can mark it. Absent → nothing selected. */
		selectedId?: string | null;
		/** Called with the template id when a node is activated. */
		onSelect: (id: string) => void;
		/** Pointer enter (true) / leave (false) on a node, so a focus layer can light
		 *  the neighbourhood and a caller can preload the template. */
		onHover?: (id: string, isHovering: boolean) => void;
	}

	let { templates, edges = [], selectedId = null, onSelect, onHover }: Props = $props();

	// The drawing canvas the layout falls inside. A fixed coordinate space the SVG
	// scales responsively into via its viewBox — the same width/height the approved
	// mock laid out against, so the declump spacing reads as designed.
	const WIDTH = 1080;
	const HEIGHT = 600;

	/**
	 * A node ready to draw: its id, hue, the short label + the plain-English family
	 * caption that sit beside it. The label is the template's own title (trimmed to
	 * a readable length); the caption names the civic family the hue belongs to, so
	 * the colour is redundant with words and never the only carrier of meaning.
	 */
	interface GraphNode {
		id: string;
		hue: number;
		label: string;
		family: string | null;
	}

	// Trim a title to a single legible line over the field — the label is a
	// wayfinding mark, not the template's full headline (that waits in the dive).
	function shortLabel(title: string): string {
		const trimmed = (title ?? '').trim();
		if (trimmed.length <= 28) return trimmed;
		return trimmed.slice(0, 27).trimEnd() + '…';
	}

	// The plain-English civic family a template's domain belongs to (Housing,
	// Transportation, …), or null when its domain matches no canonical anchor — a
	// node with no family caption is, by the same token, one with no family edge.
	function familyName(template: Pick<Template, 'domain'>): string | null {
		const domain = typeof template.domain === 'string' ? template.domain.trim() : '';
		if (!domain) return null;
		const hue = matchAnchor(domain);
		return hue === null ? null : anchorLabelForHue(hue);
	}

	const nodes = $derived<GraphNode[]>(
		templates.map((t) => ({
			id: t.id,
			hue: resolveDomainHue(t),
			label: shortLabel(t.title),
			family: familyName(t)
		}))
	);

	// The full honest edge set: the measured/concept edges passed in (twin, and
	// concept when the server emits any) UNION the family kinship derived here. The
	// two sources are deduped by their normalized (a,b) key so a pair that is both
	// a measured twin and same-domain kin draws once, as the stronger (measured)
	// relation — the dashed family tie never overdraws a solid twin.
	const RANK: Record<RelationEdge['kind'], number> = { twin: 3, concept: 2, family: 1 };

	const allEdges = $derived.by<RelationEdge[]>(() => {
		const present = new Set(nodes.map((n) => n.id));
		const byPair = new Map<string, RelationEdge>();
		const add = (edge: RelationEdge) => {
			if (!present.has(edge.a) || !present.has(edge.b) || edge.a === edge.b) return;
			const key = edge.a <= edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`;
			const existing = byPair.get(key);
			if (!existing || RANK[edge.kind] > RANK[existing.kind]) byPair.set(key, edge);
		};
		// Measured + concept edges first (they carry the score), then family.
		for (const edge of edges) add(edge);
		for (const edge of familyEdges(templates)) add(edge);
		return Array.from(byPair.values());
	});

	// Which nodes carry at least one admissible edge. The complement is the set of
	// honestly-isolated templates — they get NO tie and the layout pushes them out.
	const connected = $derived.by(() => {
		const set = new Set<string>();
		for (const edge of allEdges) {
			set.add(edge.a);
			set.add(edge.b);
		}
		return set;
	});

	// Deterministic positions: the same nodes + edges always settle identically, on
	// the server and again on the client, so the map paints once and never lurches.
	const positions = $derived(
		layoutRelationGraph(
			nodes.map((n) => ({ id: n.id })),
			// The layout knows two pull strengths: a measured twin pulls hardest, all
			// taxonomic ties (family + tag-concept, both subordinate) pull as kin.
			allEdges.map((e) => ({ a: e.a, b: e.b, kind: e.kind === 'twin' ? 'twin' : 'family' })),
			{ width: WIDTH, height: HEIGHT }
		)
	);

	/**
	 * The twin score maps to a stroke weight in a narrow, legible band. A measured
	 * twin always reads as the heaviest tie; a stronger score sits a touch thicker.
	 * Family/concept ties keep their own (lighter) fixed weights, set in CSS.
	 */
	function twinWeight(score: number | undefined): number {
		const s = typeof score === 'number' ? Math.max(0, Math.min(1, score)) : 0.5;
		return 1.8 + s * 1.4; // ~1.8–3.2px
	}

	/** A drawable edge: its two endpoints' resolved positions + its kind/weight. */
	interface DrawEdge {
		key: string;
		kind: RelationEdge['kind'];
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		cx: number;
		cy: number;
		weight: number;
		/** True when either endpoint is the focused/selected node. */
		incident: boolean;
	}

	const drawEdges = $derived.by<DrawEdge[]>(() => {
		const out: DrawEdge[] = [];
		for (const edge of allEdges) {
			const a = positions.get(edge.a);
			const b = positions.get(edge.b);
			if (!a || !b) continue;
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			out.push({
				key: `${edge.a}|${edge.b}|${edge.kind}`,
				kind: edge.kind,
				x1: a.x,
				y1: a.y,
				x2: b.x,
				y2: b.y,
				cx: mx,
				cy: my - 14, // the mock's gentle arc, so parallel ties separate
				weight: edge.kind === 'twin' ? twinWeight(edge.score) : 0,
				incident: edge.a === focusId || edge.b === focusId
			});
		}
		return out;
	});

	/** A drawable node: position + presentation, plus where its label sits. */
	interface DrawNode extends GraphNode {
		x: number;
		y: number;
		/** Label baseline — above the node in the lower half, below it in the upper
		 *  half, so a label never collides with the edges fanning toward the centre. */
		labelY: number;
		metaY: number;
		isolated: boolean;
	}

	const drawNodes = $derived.by<DrawNode[]>(() =>
		nodes.map((n) => {
			const p = positions.get(n.id) ?? { x: WIDTH / 2, y: HEIGHT / 2 };
			const below = p.y <= HEIGHT / 2;
			const labelY = below ? p.y + 24 : p.y - 18;
			return {
				...n,
				x: p.x,
				y: p.y,
				labelY,
				metaY: labelY + 13,
				isolated: !connected.has(n.id)
			};
		})
	);

	// What lights its neighbourhood and dims the rest is FOCUS — and focus is the
	// reader's own, transient act, never the store's auto-selection. The landing's
	// template store auto-selects the first template on hydration, so `selectedId`
	// is essentially always set; if it drove the dim, the map would paint in the
	// dimmed-to-one-node focus state at rest and never read as a full, navigable
	// relation map. So the at-rest state is decoupled from `selectedId`: focus
	// engages ONLY on hover (and an explicit graph-local focus). With neither, the
	// whole field paints at full presence. `selectedId` is kept solely as a quiet
	// "this one is the dive owner" marker on its single node — it dims nothing.
	let hoverId = $state<string | null>(null);
	let focusedId = $state<string | null>(null);

	// Recognition navigation: the viewer types a fragment they remember and the
	// matching node comes to them — pulled to the centre, its neighbourhood lit, the
	// rest of the field receding. This is recognition over recall: you don't reconstruct
	// where a template sits, you name a piece of it and the map answers. The match runs
	// CLIENT-SIDE over the already-loaded nodes (no server round-trip at this size), so
	// it is immediate and causal — the field responds as you type.
	let searchQuery = $state('');

	// The node a query selects: the FIRST loaded node whose title or civic family
	// contains the trimmed query (case-insensitive). First-in-stable-order is a stable,
	// repeatable pick — the same query always lands on the same node. Empty query → no
	// match, so the field rests un-panned and un-focused.
	const searchMatch = $derived.by<GraphNode | null>(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return null;
		return (
			nodes.find(
				(n) => n.label.toLowerCase().includes(q) || (n.family?.toLowerCase().includes(q) ?? false)
			) ?? null
		);
	});
	const searchMatchId = $derived(searchMatch?.id ?? null);

	// How many loaded nodes the query touches — the plain-English feedback line reads
	// from this. (The PAN/focus lands on the first; the count tells the viewer whether
	// their query was specific.) A query with no match reports zero, honestly.
	const searchHitCount = $derived.by<number>(() => {
		const q = searchQuery.trim().toLowerCase();
		if (!q) return 0;
		return nodes.filter(
			(n) => n.label.toLowerCase().includes(q) || (n.family?.toLowerCase().includes(q) ?? false)
		).length;
	});

	// Focus precedence: a live hover or keyboard focus is the viewer's immediate,
	// transient act and wins; the search match is the standing recognition target
	// underneath. So a search centres + lights a node, and the viewer can still hover a
	// neighbour to read ITS ties without the search fighting back — on mouse-leave the
	// field falls back to the search-focused neighbourhood, not to nothing. Clearing the
	// search drops searchMatchId and the field returns to full presence.
	const focusId = $derived(hoverId ?? focusedId ?? searchMatchId);

	// Whether the viewer asked for less motion. Read once, on the client, via the
	// same matchMedia probe the dimensional primitives use — server-side it stays
	// false (no window), and the spring starts at rest, so SSR and first paint
	// agree. With it on, the focus transition jumps hard rather than springing.
	const prefersReducedMotion =
		typeof window !== 'undefined'
			? window.matchMedia('(prefers-reduced-motion: reduce)').matches
			: false;

	// The neighbourhood read is spring-driven, not a fixed CSS fade: a single 0→1
	// value (`--focus-depth`) that the SCORE_BAR spring drives toward 1 the instant
	// a node takes focus and back to 0 when focus clears. SCORE_BAR is snappy
	// (stiffness 0.3) so the dim deepens with a causal sub-100ms onset — the field
	// answers "what is near this one" immediately, then settles, never lurching.
	// The CSS interpolates the dim/lit opacities against this depth, so at rest
	// (depth 0) every node and tie reads at full presence and nothing is dimmed.
	// svelte-ignore state_referenced_locally — the rest value is captured once per instance
	const focusDepth = svelteSpring(0, SPRINGS.SCORE_BAR);
	$effect(() => {
		const target = focusId ? 1 : 0;
		// Reduced motion: snap to the target with no travel. Otherwise let the
		// spring carry it — its first frame already moves, so the onset is causal.
		focusDepth.set(target, prefersReducedMotion ? { hard: true } : undefined);
	});

	// Search centres a match by PANNING the field, never by relaying it out — the
	// layout is the viewer's spatial memory and must not scramble. The whole
	// drawn field is one rigid `<g>` that slides so the matched node lands at canvas
	// centre; every node keeps its relative place, the map just translates beneath the
	// viewport. At rest (no match) the pan is (0,0) and the field sits as laid out.
	// The translation rides ENTRANCE — a firm arrival with no bounce — so the match
	// settles at centre without overshoot. Reduced motion snaps it.
	// svelte-ignore state_referenced_locally — the rest value is captured once per instance
	const pan = svelteSpring({ x: 0, y: 0 }, SPRINGS.ENTRANCE);
	$effect(() => {
		const p = searchMatchId ? positions.get(searchMatchId) : null;
		// Bring the matched node to the canvas centre; with no match, rest at origin.
		const target = p ? { x: WIDTH / 2 - p.x, y: HEIGHT / 2 - p.y } : { x: 0, y: 0 };
		pan.set(target, prefersReducedMotion ? { hard: true } : undefined);
	});

	// Clearing the search query restores the field: the spring carries the pan back to
	// origin and dropping searchMatchId returns every node to full presence. Escape and
	// the clear button both route here so the field always returns to exactly where it
	// rested before the search.
	function clearSearch() {
		searchQuery = '';
	}

	// The lit set: the focused node + every node an admissible edge connects to it.
	// Empty when nothing is focused → the whole field reads at full presence (no
	// node is dimmed just because nothing is hovered).
	const litSet = $derived.by(() => {
		const set = new Set<string>();
		if (!focusId) return set;
		set.add(focusId);
		for (const edge of allEdges) {
			if (edge.a === focusId) set.add(edge.b);
			else if (edge.b === focusId) set.add(edge.a);
		}
		return set;
	});

	function isLit(id: string): boolean {
		// No focus → everything is at presence. With a focus → only the neighbourhood.
		return litSet.size === 0 || litSet.has(id);
	}

	function handleEnter(id: string) {
		hoverId = id;
		onHover?.(id, true);
	}
	function handleLeave(id: string) {
		if (hoverId === id) hoverId = null;
		onHover?.(id, false);
	}
	// Keyboard focus engages the same neighbourhood read as hover, but through a
	// distinct graph-local channel so tabbing through the field lights one node's
	// ties at a time. Like hover, it is transient — blur clears it — and it never
	// touches the store's `selectedId`, so the at-rest map stays at full presence.
	function handleFocus(id: string) {
		focusedId = id;
		onHover?.(id, true);
	}
	function handleBlur(id: string) {
		if (focusedId === id) focusedId = null;
		onHover?.(id, false);
	}

	// Node fill + stroke at three chroma levels off the template's hue — the same
	// oklch register the spectrum tiles use, so a node reads as the tile's glyph,
	// not a generic dot.
	function nodeFill(hue: number): string {
		return `oklch(0.62 0.16 ${hue})`;
	}
	function nodeStroke(hue: number): string {
		return `oklch(0.42 0.12 ${hue})`;
	}

	// ─── Mobile: a focus-centered relation view ───────────────────────────────
	//
	// A force-laid field of a dozen sub-tap dots is wrong on a phone — the thumb
	// can't land on a 14px glyph and the labels collide. So below the breakpoint the
	// SAME relation data takes a focus-centered form: one chosen concern is brought to
	// the centre, its kin pulled close as full-size tappable cards (each NAMING the tie
	// that binds it — a measured twin or a shared civic family), and the rest of the
	// field reachable as a list, with the honestly-isolated held apart so their
	// aloneness still reads. It expresses RELATION (the edges, who is near whom), not a
	// flat list — picking a kin re-centres the view on it, so you navigate the graph by
	// following ties, one neighbourhood at a time. Tapping the focus concern itself
	// falls into the template through the same touch dive the rest of the surface uses.
	//
	// The split is pointer-aware, not width-only (the same probe the spectrum overview
	// uses): a coarse pointer gets the focus-centered form at any width (a tablet in
	// portrait is wide but all thumb), a fine pointer on a wide screen keeps the
	// pannable SVG. Server-side it is false (no window), so SSR renders the desktop
	// graph and the client reconciles to the real pointer/width on mount — no layout
	// the server can't reproduce.
	let narrow = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(max-width: 767px), (pointer: coarse)');
		const sync = () => (narrow = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	// The concern at the centre of the mobile view. Null until the viewer picks one —
	// then it derives to a stable default: the first CONNECTED node in stable order (a
	// node with kin, so the centred view opens already showing a relation), falling
	// back to the very first node when nothing is connected. Deterministic: the same
	// corpus always opens on the same concern.
	let mobileFocusPick = $state<string | null>(null);
	const mobileFocusId = $derived.by<string | null>(() => {
		if (mobileFocusPick && nodes.some((n) => n.id === mobileFocusPick)) return mobileFocusPick;
		const firstConnected = nodes.find((n) => connected.has(n.id));
		return firstConnected?.id ?? nodes[0]?.id ?? null;
	});
	const mobileFocusNode = $derived<DrawNode | null>(
		drawNodes.find((n) => n.id === mobileFocusId) ?? null
	);

	/** A kin of the focused concern in the mobile view: the neighbour node plus the
	 *  edge kind (and score) that ties it to the focus, so the card can name the tie. */
	interface MobileKin {
		node: DrawNode;
		kind: RelationEdge['kind'];
		score?: number;
	}

	// The kin of the mobile focus: every node an admissible edge connects to it, each
	// carrying the kind of tie. Strongest relation first (a measured twin outranks
	// taxonomic kin), then by score, so the closest concern sits at the top.
	const mobileKin = $derived.by<MobileKin[]>(() => {
		const id = mobileFocusId;
		if (!id) return [];
		const byId = new Map(drawNodes.map((n) => [n.id, n]));
		const out: MobileKin[] = [];
		for (const edge of allEdges) {
			const otherId = edge.a === id ? edge.b : edge.b === id ? edge.a : null;
			if (!otherId) continue;
			const node = byId.get(otherId);
			if (!node) continue;
			out.push({ node, kind: edge.kind, score: edge.score });
		}
		out.sort((p, q) => {
			const r = RANK[q.kind] - RANK[p.kind];
			if (r !== 0) return r;
			return (q.score ?? 0) - (p.score ?? 0);
		});
		return out;
	});

	// The rest of the field, reachable but not in the focus's neighbourhood: every node
	// that is neither the focus nor one of its kin. Held in stable order, and split so
	// the honestly-isolated read as a separate, intentionally-alone set rather than
	// being folded in with the merely-not-adjacent.
	const mobileRest = $derived.by<DrawNode[]>(() => {
		const near = new Set<string>([mobileFocusId ?? '', ...mobileKin.map((k) => k.node.id)]);
		return drawNodes.filter((n) => !near.has(n.id));
	});
	const mobileRestConnected = $derived(mobileRest.filter((n) => !n.isolated));
	const mobileRestIsolated = $derived(mobileRest.filter((n) => n.isolated));

	// Re-centre the mobile view on a concern (follow a tie to its neighbourhood) — a
	// transform of which node is focal, never a relayout. Picking a kin walks the graph
	// one neighbourhood at a time.
	function centreMobile(id: string) {
		mobileFocusPick = id;
	}

	// Plain-English name for the tie a kin card carries.
	function kinTieLabel(kind: RelationEdge['kind']): string {
		if (kind === 'twin') return 'measured semantic twin';
		if (kind === 'concept') return 'shared tag concept';
		return 'shared civic family';
	}
</script>

<figure class="relation-graph" aria-label="Templates related by measured semantic kinship and civic family">
	<figcaption class="relation-graph__title font-brand">
		The commons, by relation
		<span class="relation-graph__subtitle"
			>linked by meaning; the topically-isolated fall to the edges</span
		>
	</figcaption>

	{#if drawNodes.length > 0}
		{#if !narrow}
		<!-- Recognition navigation: name a fragment you remember and the map brings the
		     matching node to the centre, lit, the rest receding. Reuses the template
		     search vocabulary (the same search glyph + type=search field), but the copy
		     speaks to relation — you are finding a concern in the field, not filtering a
		     list. Matching is client-side over the loaded nodes, so it answers as you type. -->
		<div class="relation-graph__search">
			<div class="relation-search__field">
				<Search class="relation-search__icon" size={16} aria-hidden="true" />
				<input
					type="search"
					class="relation-search__input font-brand"
					placeholder="Find a concern by name…"
					aria-label="Find a template by name or civic family"
					bind:value={searchQuery}
					data-testid="relation-search-input"
					onkeydown={(e) => {
						// Escape clears the field and returns the map to full presence.
						if (e.key === 'Escape') {
							e.preventDefault();
							clearSearch();
						}
						// Enter commits the recognition: keep the current match centred and
						// drop the soft keyboard, so the viewer can read the lit neighbourhood
						// without the field changing under them.
						if (e.key === 'Enter') {
							e.preventDefault();
							(e.currentTarget as HTMLInputElement).blur();
						}
					}}
				/>
				{#if searchQuery}
					<button
						type="button"
						class="relation-search__clear font-brand"
						onclick={clearSearch}
						aria-label="Clear search"
					>
						Clear
					</button>
				{/if}
			</div>
			{#if searchQuery.trim()}
				<p class="relation-search__feedback font-brand" aria-live="polite" data-testid="relation-search-feedback">
					{#if searchMatch}
						Centred on “{searchMatch.label}”{searchHitCount > 1
							? `, ${searchHitCount} match the search`
							: ''}.
					{:else}
						Nothing here by that name yet.
					{/if}
				</p>
			{/if}
		</div>

		<svg
			class="relation-graph__svg"
			viewBox="0 0 {WIDTH} {HEIGHT}"
			role="group"
			aria-label="Relation map"
			class:has-focus={litSet.size > 0}
			style="--focus-depth: {$focusDepth};"
		>
			<!-- The whole field rides one panning group. Search slides this so the matched
			     node reaches the centre — a translate, never a relayout, so the viewer's
			     spatial memory of the map survives. At rest the translate is (0,0). -->
			<g
				class="relation-graph__pan"
				transform="translate({$pan.x.toFixed(2)} {$pan.y.toFixed(2)})"
			>
			<!-- Edges first, so nodes and labels sit over them. -->
			<g class="relation-graph__edges" aria-hidden="true">
				{#each drawEdges as edge (edge.key)}
					<path
						d="M{edge.x1.toFixed(1)} {edge.y1.toFixed(1)} Q{edge.cx.toFixed(1)} {edge.cy.toFixed(
							1
						)} {edge.x2.toFixed(1)} {edge.y2.toFixed(1)}"
						class="relation-edge relation-edge--{edge.kind}"
						class:relation-edge--incident={edge.incident}
						data-edge-kind={edge.kind}
						style={edge.kind === 'twin' ? `stroke-width: ${edge.weight.toFixed(2)}px;` : ''}
					/>
				{/each}
			</g>

			<!-- Nodes + their haloed labels. The nodes render in `drawNodes` order —
			     which is the `templates` prop order, the same stable order the layout
			     seeds from — so Tab walks the field in a deterministic, repeatable
			     sequence and keyboard focus lights one node's neighbourhood at a time,
			     identically to hover. -->
			<g class="relation-graph__nodes">
				{#each drawNodes as node (node.id)}
					<g
						class="relation-node"
						class:relation-node--selected={node.id === selectedId}
						class:relation-node--isolated={node.isolated}
						class:relation-node--lit={isLit(node.id)}
						class:relation-node--dimmed={!isLit(node.id)}
						data-template-id={node.id}
						data-isolated={node.isolated}
						data-testid="relation-node-{node.id}"
						role="button"
						tabindex="0"
						aria-label="{node.label}{node.family ? `, ${node.family}` : ''}"
						onclick={() => onSelect(node.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onSelect(node.id);
							}
						}}
						onmouseenter={() => handleEnter(node.id)}
						onmouseleave={() => handleLeave(node.id)}
						onfocus={() => handleFocus(node.id)}
						onblur={() => handleBlur(node.id)}
					>
						<!-- A generous transparent hit-target so a node is easy to reach with a
						     pointer or thumb without enlarging the glyph itself. -->
						<circle class="relation-node__hit" cx={node.x.toFixed(1)} cy={node.y.toFixed(1)} r="22" />
						<!-- The keyboard focus ring: a sharing-indigo halo that appears only on
						     :focus-visible, so a tabbing reader always sees which node holds
						     focus. Drawn behind the glyph so it reads as a ring around it. -->
						<circle
							class="relation-node__focus-ring"
							cx={node.x.toFixed(1)}
							cy={node.y.toFixed(1)}
							r="16"
						/>
						<circle
							class="relation-node__glyph"
							cx={node.x.toFixed(1)}
							cy={node.y.toFixed(1)}
							r="10"
							fill={nodeFill(node.hue)}
							stroke={nodeStroke(node.hue)}
						/>
						<text class="relation-node__label" x={node.x.toFixed(1)} y={node.labelY.toFixed(1)}>
							{node.label}
						</text>
						{#if node.family}
							<text class="relation-node__meta" x={node.x.toFixed(1)} y={node.metaY.toFixed(1)}>
								{node.family}
							</text>
						{/if}
					</g>
				{/each}
			</g>
		</g>
		</svg>

		<!-- The legend names the relation kinds in plain English. The two line samples
		     echo the edge styles above so the eye learns the encoding once. -->
		<ul class="relation-graph__legend font-brand" aria-label="What the edges mean">
			<li class="relation-legend__item">
				<svg class="relation-legend__swatch" viewBox="0 0 40 8" aria-hidden="true">
					<line class="relation-edge relation-edge--twin" x1="2" y1="4" x2="38" y2="4" />
				</svg>
				<span>measured semantic twin (survives leave-one-out)</span>
			</li>
			<li class="relation-legend__item">
				<svg class="relation-legend__swatch" viewBox="0 0 40 8" aria-hidden="true">
					<line class="relation-edge relation-edge--family" x1="2" y1="4" x2="38" y2="4" />
				</svg>
				<span>shared civic family</span>
			</li>
			{#if allEdges.some((e) => e.kind === 'concept')}
				<li class="relation-legend__item">
					<svg class="relation-legend__swatch" viewBox="0 0 40 8" aria-hidden="true">
						<line class="relation-edge relation-edge--concept" x1="2" y1="4" x2="38" y2="4" />
					</svg>
					<span>shared tag concept</span>
				</li>
			{/if}
		</ul>
		{:else}
			<!-- ─── Mobile: the focus-centered relation view ───────────────────────────
			     The same relation data as the SVG, re-shaped for the thumb. One concern is
			     held at the centre; its kin are pulled close as full-size tappable cards,
			     each naming the tie that binds it; the rest of the field is a reachable
			     list, with the honestly-isolated held apart so their aloneness still reads.
			     Following a tie re-centres the view on that concern — you navigate the graph
			     a neighbourhood at a time, not a free-pan cloud of sub-tap dots. -->
			{#if mobileFocusNode}
				<div class="relation-focus" data-testid="relation-focus-view">
					<!-- The concern at the centre: a full-width card, the hue its glyph, the
					     civic family named under the title. Tapping it falls into the template
					     through the same touch dive the rest of the surface uses. -->
					<button
						type="button"
						class="relation-focus__centre font-brand"
						style="--card-hue: {mobileFocusNode.hue};"
						data-template-id={mobileFocusNode.id}
						data-testid="relation-focus-centre"
						aria-label="Open “{mobileFocusNode.label}”{mobileFocusNode.family
							? `, ${mobileFocusNode.family}`
							: ''}"
						onclick={() => onSelect(mobileFocusNode!.id)}
					>
						<span
							class="relation-focus__glyph"
							style="background: {nodeFill(mobileFocusNode.hue)}; border-color: {nodeStroke(
								mobileFocusNode.hue
							)};"
							aria-hidden="true"
						></span>
						<span class="relation-focus__centre-text">
							<span class="relation-focus__centre-label">{mobileFocusNode.label}</span>
							{#if mobileFocusNode.family}
								<span class="relation-focus__centre-family">{mobileFocusNode.family}</span>
							{/if}
						</span>
						<span class="relation-focus__open" aria-hidden="true">Open</span>
					</button>

					{#if mobileKin.length > 0}
						<!-- Kin brought close: each names the tie (a measured twin, or a shared
						     civic family) so the RELATION is the structure, not a flat list. The
						     card centres the view on that concern (follow the tie); a separate
						     control opens it. -->
						<p class="relation-focus__heading font-brand">Closest to this</p>
						<ul class="relation-focus__kin" aria-label="Concerns related to this one">
							{#each mobileKin as kin (kin.node.id)}
								<li class="relation-focus__kin-item">
									<button
										type="button"
										class="relation-kin font-brand relation-kin--{kin.kind}"
										style="--card-hue: {kin.node.hue};"
										data-template-id={kin.node.id}
										data-kin-kind={kin.kind}
										data-testid="relation-kin-{kin.node.id}"
										aria-label="Centre on “{kin.node.label}” — {kinTieLabel(kin.kind)}"
										onclick={() => centreMobile(kin.node.id)}
									>
										<span class="relation-kin__tie" aria-hidden="true">
											<span class="relation-kin__tie-line"></span>
										</span>
										<span
											class="relation-kin__glyph"
											style="background: {nodeFill(kin.node.hue)}; border-color: {nodeStroke(
												kin.node.hue
											)};"
											aria-hidden="true"
										></span>
										<span class="relation-kin__text">
											<span class="relation-kin__label">{kin.node.label}</span>
											<span class="relation-kin__tie-name">{kinTieLabel(kin.kind)}</span>
										</span>
									</button>
								</li>
							{/each}
						</ul>
					{:else}
						<!-- Honest: the focused concern stands alone — no admissible tie. Say so. -->
						<p class="relation-focus__alone font-brand">
							Stands alone — no close kin in the field yet.
						</p>
					{/if}

					{#if mobileRestConnected.length > 0 || mobileRestIsolated.length > 0}
						<!-- The rest of the field, reachable. Centring on any of them follows the
						     graph to its neighbourhood. The isolated are held in their own group so
						     their aloneness reads as intentional, not lost in the list. -->
						{#if mobileRestConnected.length > 0}
							<p class="relation-focus__heading font-brand">Elsewhere in the field</p>
							<ul class="relation-focus__rest" aria-label="Other related concerns">
								{#each mobileRestConnected as other (other.id)}
									<li>
										<button
											type="button"
											class="relation-other font-brand"
											style="--card-hue: {other.hue};"
											data-template-id={other.id}
											data-testid="relation-other-{other.id}"
											aria-label="Centre on “{other.label}”{other.family
												? `, ${other.family}`
												: ''}"
											onclick={() => centreMobile(other.id)}
										>
											<span
												class="relation-other__glyph"
												style="background: {nodeFill(other.hue)}; border-color: {nodeStroke(
													other.hue
												)};"
												aria-hidden="true"
											></span>
											<span class="relation-other__text">
												<span class="relation-other__label">{other.label}</span>
												{#if other.family}
													<span class="relation-other__family">{other.family}</span>
												{/if}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
						{#if mobileRestIsolated.length > 0}
							<p class="relation-focus__heading font-brand">Standing alone</p>
							<ul class="relation-focus__rest" aria-label="Concerns with no close kin">
								{#each mobileRestIsolated as other (other.id)}
									<li>
										<button
											type="button"
											class="relation-other relation-other--isolated font-brand"
											style="--card-hue: {other.hue};"
											data-template-id={other.id}
											data-isolated="true"
											data-testid="relation-other-{other.id}"
											aria-label="Centre on “{other.label}”{other.family
												? `, ${other.family}`
												: ''}, standing alone"
											onclick={() => centreMobile(other.id)}
										>
											<span
												class="relation-other__glyph"
												style="background: {nodeFill(other.hue)}; border-color: {nodeStroke(
													other.hue
												)};"
												aria-hidden="true"
											></span>
											<span class="relation-other__text">
												<span class="relation-other__label">{other.label}</span>
												{#if other.family}
													<span class="relation-other__family">{other.family}</span>
												{/if}
											</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					{/if}
				</div>
			{/if}
		{/if}
	{:else}
		<!-- Honest empty state: no field to relate yet. Plain English, no dead map. -->
		<div class="relation-graph__empty">
			<p class="font-brand relation-graph__empty-head">No templates yet.</p>
			<p class="font-brand relation-graph__empty-sub">You can write the first one.</p>
		</div>
	{/if}
</figure>

<style>
	/*
	 * The graph carries no chrome of its own — the warm-cream ground shows through,
	 * the edges and the void between clusters are the structure. The figure is a
	 * full-width field; the SVG scales responsively into it via its viewBox.
	 */
	.relation-graph {
		margin: 0;
		padding: 0.5rem 0 1.5rem;
		width: 100%;
	}

	.relation-graph__title {
		display: block;
		text-align: center;
		font-size: 0.9375rem;
		font-weight: 650;
		color: oklch(0.34 0.02 60);
		padding: 0 1rem 0.5rem;
		line-height: 1.4;
	}

	.relation-graph__subtitle {
		display: block;
		font-weight: 450;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 60);
		margin-top: 0.125rem;
	}

	/* ─── Search — recognition navigation ─────────────────────────────────────
	 * A single field centred over the map. It carries no heavy chrome: a thin warm
	 * underline-and-border on the cream ground (no white box, no pill), the search
	 * glyph at the lead, and a quiet feedback line below that names where the field
	 * just centred. The field is the only affordance that pulls the map; everything
	 * else is the map itself. */
	.relation-graph__search {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		margin: 0 auto 0.75rem;
		max-width: 24rem;
		padding: 0 1rem;
	}

	.relation-search__field {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.6rem;
		border: 1px solid oklch(0.82 0.02 70);
		border-radius: 0.5rem;
		background: oklch(0.99 0.005 80);
		transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.relation-search__field:focus-within {
		border-color: var(--coord-share-solid);
	}

	.relation-search__field :global(.relation-search__icon) {
		flex-shrink: 0;
		color: oklch(0.6 0.02 70);
	}

	.relation-search__input {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		font-size: 0.875rem;
		color: oklch(0.3 0.02 60);
		outline: none;
	}
	.relation-search__input::placeholder {
		color: oklch(0.62 0.02 70);
	}
	/* Suppress the native search-clear control — we render our own plain-English one. */
	.relation-search__input::-webkit-search-cancel-button {
		appearance: none;
	}

	.relation-search__clear {
		flex-shrink: 0;
		border: none;
		background: transparent;
		padding: 0.1rem 0.25rem;
		font-size: 0.75rem;
		color: oklch(0.5 0.02 60);
		cursor: pointer;
		transition: color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.relation-search__clear:hover {
		color: oklch(0.34 0.02 60);
	}

	.relation-search__feedback {
		margin: 0;
		font-size: 0.75rem;
		color: oklch(0.5 0.02 60);
		text-align: center;
	}

	.relation-graph__svg {
		display: block;
		width: 100%;
		height: auto;
		max-height: 70vh;
		/* Let the field breathe to its natural aspect; never overflow horizontally. */
		overflow: visible;
		/* The neighbourhood read's depth (0 at rest → 1 focused), the value the
		 * SCORE_BAR spring carries in. Defaults to 0 so a server-rendered SVG (no
		 * inline var yet) paints at full presence and the map never lurches. */
		--focus-depth: 0;
	}

	/* ─── Edges ──────────────────────────────────────────────────────────────
	 * Three kinds, three encodings. The colours are warm neutrals (not the topic
	 * hue — a tie is not a topic), so the hue stays the node's alone. Twin is the
	 * heaviest, solid; family is dashed + lighter; concept is the lightest dashed.
	 * Each tie's opacity interpolates from its rest presence toward a recede target
	 * as `--focus-depth` climbs; an incident tie brightens instead. No CSS
	 * transition — the spring is the animation, so the change is causal, never
	 * double-eased. */
	.relation-edge {
		fill: none;
		/* rest presence → recede target, mixed by the spring depth. */
		opacity: calc(var(--edge-rest) - (var(--edge-rest) - 0.12) * var(--focus-depth));
	}

	.relation-edge--twin {
		stroke: oklch(0.5 0.06 60);
		stroke-width: 2.2px; /* default; the node sets a score-scaled width inline */
		--edge-rest: 0.75;
	}

	.relation-edge--family {
		stroke: oklch(0.6 0.03 60);
		stroke-width: 1.3px;
		--edge-rest: 0.45;
		stroke-dasharray: 2 4;
	}

	.relation-edge--concept {
		stroke: oklch(0.62 0.04 60);
		stroke-width: 1.2px;
		--edge-rest: 0.4;
		stroke-dasharray: 1 5;
	}

	/* An incident tie (one endpoint is the focused node) brightens toward full as
	 * the depth climbs, so "what is near this one" answers at a glance while the
	 * rest of the field recedes into composed void. */
	.relation-edge--incident {
		opacity: calc(var(--edge-rest) + (0.85 - var(--edge-rest)) * var(--focus-depth));
	}

	/* ─── Nodes ──────────────────────────────────────────────────────────────── */
	.relation-node {
		cursor: pointer;
	}

	.relation-node__hit {
		fill: transparent;
	}

	.relation-node__glyph {
		stroke-width: 1.6px;
		/* Only the hover/focus lift is a CSS micro-interaction; the focus DIM is
		 * spring-driven on the group (below), so it is not eased here. */
		transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
		transform-box: fill-box;
		transform-origin: center;
	}

	.relation-node:hover .relation-node__glyph,
	.relation-node:focus-visible .relation-node__glyph {
		transform: scale(1.25);
	}

	/* The selected (dive-owner) node carries a quiet marker, not the hover lift —
	 * a slightly heavier glyph stroke so it reads as "this one is open" without
	 * scaling up into a competing strong center or dimming any of its neighbours.
	 * At rest the map is still a full, even field; this only annotates one node. */
	.relation-node--selected .relation-node__glyph {
		stroke-width: 2.6px;
	}

	/* The focused neighbourhood holds at presence; a non-neighbour recedes toward a
	 * composed void as the spring depth climbs. The floor (0.28) is deliberate — a
	 * dimmed node stays PERCEIVABLE so the global shape never disappears; the dim
	 * composes the void, it does not erase it. With no focus (depth 0) every node
	 * sits at 1, the full even field. No CSS transition — the spring is the motion. */
	.relation-node--dimmed {
		opacity: calc(1 - 0.72 * var(--focus-depth));
	}
	.relation-node--lit {
		opacity: 1;
	}

	/*
	 * Node labels: the template's short title in Satoshi, haloed with the
	 * warm-cream ground (paint-order: stroke) so the words stay legible wherever
	 * they cross an edge or a neighbour. The meta line names the civic family in a
	 * quieter neutral — provenance under the label, the same role the tile's topic
	 * ground plays.
	 */
	.relation-node__label {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 12px;
		font-weight: 650;
		fill: oklch(0.3 0.03 60);
		text-anchor: middle;
		paint-order: stroke;
		stroke: oklch(0.985 0.006 70);
		stroke-width: 4px;
		stroke-linejoin: round;
		pointer-events: none;
	}

	.relation-node__meta {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 9px;
		fill: oklch(0.57 0.02 60);
		text-anchor: middle;
		paint-order: stroke;
		stroke: oklch(0.985 0.006 70);
		stroke-width: 3px;
		stroke-linejoin: round;
		pointer-events: none;
	}

	/* Keyboard focus ring — a sharing-indigo halo around the glyph, visible only on
	 * :focus-visible so it never shows for a mouse click. The default SVG outline is
	 * suppressed in favour of this ring, which tracks the mark and reads clearly
	 * against the warm-cream ground at the small glyph scale. */
	.relation-node:focus-visible {
		outline: none;
	}
	.relation-node__focus-ring {
		fill: none;
		stroke: var(--coord-share-solid);
		stroke-width: 2px;
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
		pointer-events: none;
	}
	.relation-node:focus-visible .relation-node__focus-ring {
		opacity: 0.9;
	}

	/* ─── Legend ─────────────────────────────────────────────────────────────── */
	.relation-graph__legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.5rem;
		justify-content: center;
		margin: 0.5rem auto 0;
		padding: 0 1rem;
		list-style: none;
		max-width: 56rem;
	}

	.relation-legend__item {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.6875rem;
		color: oklch(0.5 0.02 60);
	}

	.relation-legend__swatch {
		width: 40px;
		height: 8px;
		flex-shrink: 0;
	}

	/* ─── Empty ──────────────────────────────────────────────────────────────── */
	.relation-graph__empty {
		padding: 3rem 1.5rem;
		text-align: center;
	}
	.relation-graph__empty-head {
		font-size: 1rem;
		font-weight: 600;
		color: oklch(0.32 0.02 250);
		margin: 0;
	}
	.relation-graph__empty-sub {
		font-size: 0.875rem;
		color: oklch(0.5 0.02 250);
		margin: 0.5rem 0 0;
	}

	/* ─── Mobile: the focus-centered relation view ─────────────────────────────
	 * Below the breakpoint the SVG field gives way to this. It carries the same
	 * vocabulary — the warm-cream ground shows through, the hue is each concern's
	 * glyph, the tie kinds keep the solid/dashed encoding the edges use — re-shaped
	 * into thumb-sized cards. No white box, no pill, max rounded-lg, every control
	 * at least 44px tall so the thumb lands cleanly. */
	.relation-focus {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0 1rem 0.5rem;
		width: 100%;
		box-sizing: border-box;
	}

	/* The concern at the centre — the strong center of the view. A full-width card on
	 * the cream ground, its hue carried as a left edge + glyph. Tapping it dives. */
	.relation-focus__centre {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		min-height: 56px;
		box-sizing: border-box;
		text-align: left;
		padding: 0.75rem 0.875rem;
		border: 1px solid oklch(0.8 0.03 var(--card-hue, 60));
		border-left: 4px solid oklch(0.6 0.14 var(--card-hue, 60));
		border-radius: 0.5rem;
		background: oklch(0.99 0.008 var(--card-hue, 60));
		cursor: pointer;
		transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.relation-focus__centre:active {
		border-color: oklch(0.6 0.12 var(--card-hue, 60));
	}

	.relation-focus__glyph {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 1.6px solid;
	}

	.relation-focus__centre-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}
	.relation-focus__centre-label {
		font-size: 0.9375rem;
		font-weight: 650;
		color: oklch(0.3 0.03 60);
		line-height: 1.25;
	}
	.relation-focus__centre-family {
		font-size: 0.75rem;
		color: oklch(0.55 0.02 60);
	}
	.relation-focus__open {
		flex-shrink: 0;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--coord-share-solid);
	}

	/* Section headings — quiet, plain English, naming the relation each group carries. */
	.relation-focus__heading {
		margin: 0.5rem 0 0;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: oklch(0.55 0.02 60);
	}

	.relation-focus__alone {
		margin: 0.25rem 0 0;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 60);
	}

	.relation-focus__kin,
	.relation-focus__rest {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	/* A kin card: the tie sample (echoing the edge encoding — solid twin, dashed
	 * family) at the lead, then the hue glyph, the concern's name, and the plain tie
	 * name. Tapping it re-centres the view on this concern. */
	.relation-kin {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		min-height: 48px;
		box-sizing: border-box;
		text-align: left;
		padding: 0.5rem 0.75rem;
		border: 1px solid oklch(0.84 0.02 70);
		border-radius: 0.5rem;
		background: oklch(0.985 0.006 70);
		cursor: pointer;
		transition: border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.relation-kin:active {
		border-color: oklch(0.7 0.03 70);
	}

	/* The tie sample mirrors the SVG edge encoding so the eye reads the same language
	 * in both forms: a solid heavier line for a measured twin, a dashed lighter line
	 * for shared family / concept. */
	.relation-kin__tie {
		flex-shrink: 0;
		width: 26px;
		display: flex;
		align-items: center;
	}
	.relation-kin__tie-line {
		width: 100%;
		height: 0;
	}
	.relation-kin--twin .relation-kin__tie-line {
		border-top: 2.4px solid oklch(0.5 0.06 60);
	}
	.relation-kin--family .relation-kin__tie-line {
		border-top: 1.6px dashed oklch(0.6 0.03 60);
	}
	.relation-kin--concept .relation-kin__tie-line {
		border-top: 1.4px dotted oklch(0.62 0.04 60);
	}

	.relation-kin__glyph {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 1.4px solid;
	}
	.relation-kin__text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}
	.relation-kin__label {
		font-size: 0.875rem;
		font-weight: 600;
		color: oklch(0.3 0.03 60);
		line-height: 1.25;
	}
	.relation-kin__tie-name {
		font-size: 0.6875rem;
		color: oklch(0.55 0.02 60);
	}

	/* A reachable-but-not-adjacent concern. Lighter than a kin card (no tie sample),
	 * still a full 44px+ target. Centring on it follows the graph to its neighbourhood. */
	.relation-other {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		min-height: 44px;
		box-sizing: border-box;
		text-align: left;
		padding: 0.5rem 0.75rem;
		border: 1px solid transparent;
		border-radius: 0.5rem;
		background: transparent;
		cursor: pointer;
		transition: background-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}
	.relation-other:active {
		background: oklch(0.97 0.008 var(--card-hue, 60));
	}
	/* An isolated concern is held visibly apart — a dotted edge marks its aloneness,
	 * the same honesty the periphery loners carry in the SVG. */
	.relation-other--isolated {
		border: 1px dashed oklch(0.84 0.02 70);
	}
	.relation-other__glyph {
		flex-shrink: 0;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 1.4px solid;
	}
	.relation-other__text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.0625rem;
	}
	.relation-other__label {
		font-size: 0.875rem;
		font-weight: 600;
		color: oklch(0.32 0.03 60);
		line-height: 1.25;
	}
	.relation-other__family {
		font-size: 0.6875rem;
		color: oklch(0.56 0.02 60);
	}

	/* Respect vestibular preferences: no glyph scaling transition. The focus dim is
	 * already suppressed in JS — the spring hard-sets `--focus-depth` under reduced
	 * motion, so the neighbourhood read snaps in with no travel rather than easing. */
	@media (prefers-reduced-motion: reduce) {
		.relation-node__glyph {
			transition: none;
		}
	}
</style>
