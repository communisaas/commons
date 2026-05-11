<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	// ─────────────────────────────────────────────────────────────
	// Props
	// ─────────────────────────────────────────────────────────────

	/**
	 * When embedded=true, the loom strips its container styling
	 * (border, background, shadow, padding) to integrate seamlessly
	 * with parent containers like CoordinationExplainer.
	 */
	let { embedded = false }: { embedded?: boolean } = $props();

	const labels = getJurisdictionLabels();

	// ─────────────────────────────────────────────────────────────
	// Types
	// ─────────────────────────────────────────────────────────────

	type Node = {
		id: string;
		label: string;
		tone: 'sender' | 'target';
		badge?: string;
	};

	type PositionedNode = Node & { x: number; y: number };

	type Connection = {
		from: string;
		to: string;
		type: 'share' | 'deliver';
		phase: 'you-send' | 'you-share' | 'peers-send';
	};

	// ─────────────────────────────────────────────────────────────
	// Data
	// ─────────────────────────────────────────────────────────────

	const senders: Node[] = [
		{ id: 'you', label: 'You', tone: 'sender' },
		{ id: 'neighbors', label: 'Neighbors', tone: 'sender' },
		{ id: 'friends', label: 'Friends', tone: 'sender' },
		{ id: 'coworkers', label: 'Coworkers', tone: 'sender' }
	];

	const targets: Node[] = [
		{ id: 'rep', label: 'Representative', badge: 'Government', tone: 'target' },
		{ id: 'mayor', label: 'Mayor', badge: 'City', tone: 'target' },
		{ id: 'ceo', label: 'CEO', badge: 'Company', tone: 'target' }
	];

	// ─────────────────────────────────────────────────────────────
	// Layout Configuration
	// ─────────────────────────────────────────────────────────────

	const LAYOUT = {
		// Minimum node dimensions (px) - used to calculate spacing
		nodeWidth: 110,
		nodeHeight: 55,
		// Minimum gap between nodes (px)
		minGap: 16,
		// Padding from container edges (%)
		edgePadding: 8,
		// Vertical zones for sender/target tiers (%)
		// Wide screens: tight band for Gestalt proximity
		// Narrow screens: use staggered arc (10-40%) with clear corridor to targets
		senderZone: { min: 10, max: 40 }, // Expanded for mobile arc layout
		targetZone: { min: 60, max: 85 } // Clear corridor from senders
	};

	// ─────────────────────────────────────────────────────────────
	// Dynamic viewBox for responsive SVG
	// ─────────────────────────────────────────────────────────────

	let containerEl = $state<HTMLElement | null>(null);
	let containerWidth = $state(100);
	let containerHeight = $state(100);

	// ViewBox matches container aspect ratio - coordinates in percentage space (0-100)
	// but scaled to actual pixel dimensions for proper circle rendering
	const viewBox = $derived(`0 0 ${containerWidth} ${containerHeight}`);

	// Scale factor to convert percentage positions to viewBox coordinates
	const scaleX = $derived(containerWidth / 100);
	const scaleY = $derived(containerHeight / 100);

	// Use average scale for uniform particle sizes
	const avgScale = $derived((scaleX + scaleY) / 2);
	const particleRadiusAmbient = $derived(1.5 * avgScale);
	const particleRadiusActive = $derived(2.5 * avgScale);
	const strokeWidth = $derived(1.3 * avgScale);
	const strokeWidthActive = $derived(1.8 * avgScale);

	// Dynamic font scale: shrink text when container gets narrow
	// This preserves edge visibility by making nodes smaller
	// Scale ranges: 1.0 at 500px+ width, down to 0.75 at 300px
	const fontScale = $derived(() => {
		const minWidth = 300;
		const maxWidth = 500;
		const minScale = 0.75;
		const maxScale = 1.0;

		if (containerWidth >= maxWidth) return maxScale;
		if (containerWidth <= minWidth) return minScale;

		// Linear interpolation
		const t = (containerWidth - minWidth) / (maxWidth - minWidth);
		return minScale + t * (maxScale - minScale);
	});

	// Computed font sizes based on scale
	const labelFontSize = $derived(`${12 * fontScale()}px`);
	const tagFontSize = $derived(`${10 * fontScale()}px`);
	const microFontSize = $derived(`${10 * fontScale()}px`);
	const nodePadding = $derived(`${8 * fontScale()}px ${10 * fontScale()}px`);
	const nodeMinWidth = $derived(`${96 * fontScale()}px`);
	const nodeMaxWidth = $derived(`${134 * fontScale()}px`);

	// ─────────────────────────────────────────────────────────────
	// Dynamic Node Positioning (bipartite graph layout)
	// ─────────────────────────────────────────────────────────────

	// Aspect ratio determines layout strategy
	const aspectRatio = $derived(containerWidth / containerHeight);

	// Calculate sender positions: "You" + peers on same horizontal band
	// All senders MUST stay within senderZone - never extend into delivery edge corridor
	function calculateSenderPositions(width: number, height: number): PositionedNode[] {
		const count = senders.length;
		const aspect = width / height;

		// Available horizontal space
		const availableWidth = 100 - 2 * LAYOUT.edgePadding;

		// CRITICAL: Senders must stay strictly above the green delivery edge corridor
		// The corridor between senders and targets must be clear for edges to flow
		const maxSenderY = LAYOUT.senderZone.max - 5; // Leave buffer above corridor

		// TABLET screens (0.5 < aspect < 0.9): CENTERED CHEVRON layout
		// Perceptual principle: Coalition must feel like ONE cohesive unit
		// Empty space should be AROUND the coalition, not INSIDE it
		// Vertically centered: shifted +8% for better balance
		if (aspect >= 0.5 && aspect < 0.9) {
			// Chevron pattern: "You" at apex, peers fan out below, creates unity
			// This communicates: You initiate → Peers join → Coalition forms
			const chevronPositions: Array<{ x: number; y: number }> = [
				{ x: 50, y: 18 }, // You - apex center (initiator)
				{ x: 28, y: 32 }, // Neighbors - left wing
				{ x: 72, y: 32 }, // Friends - right wing
				{ x: 50, y: 46 } // Coworkers - base center
			];

			return senders.map((node, i) => ({
				...node,
				x: chevronPositions[i].x,
				y: chevronPositions[i].y
			}));
		}

		// NARROW screens (aspect < 0.5): PHONE CHEVRON
		// Embrace verticality as superpower - story unfolds top-to-bottom
		// Chevron shape: You at apex, peers fan out, base completes coalition
		// This mirrors the tablet chevron but uses FULL WIDTH for phone
		// Vertically centered: loom spans ~15-85%, center at 50%
		if (aspect < 0.5) {
			// Phone chevron - pushed to edges for maximum width utilization
			// Visual symmetry: senders chevron ↔ targets inverted chevron
			// Y positions shifted +9% for vertical centering
			const phoneChevronPositions: Array<{ x: number; y: number }> = [
				{ x: 50, y: 15 }, // You - apex center (initiator)
				{ x: 18, y: 27 }, // Neighbors - left wing (WIDE)
				{ x: 82, y: 27 }, // Friends - right wing (WIDE)
				{ x: 50, y: 41 } // Coworkers - base center (coalition complete)
			];

			return senders.map((node, i) => ({
				...node,
				x: phoneChevronPositions[i].x,
				y: phoneChevronPositions[i].y
			}));
		}

		// Wide screens: all senders on one row with generous spacing
		// Use full width with nodes pushed toward edges
		const baseY = LAYOUT.senderZone.min + (LAYOUT.senderZone.max - LAYOUT.senderZone.min) * 0.5;

		// Position at 15%, 38%, 62%, 85% for maximum separation
		// This pushes nodes toward edges and creates clear center corridor
		const positions = [15, 38, 62, 85];

		return senders.map((node, i) => {
			// Subtle vertical stagger: wave pattern for collision avoidance
			// Pattern: up, down, up, down creates visual breathing room
			const stagger = i % 2 === 0 ? -3 : 3;
			return {
				...node,
				x: positions[i] ?? 50,
				y: baseY + stagger
			};
		});
	}

	// Calculate target positions: spread across bottom tier
	function calculateTargetPositions(width: number, height: number): PositionedNode[] {
		const count = targets.length;
		const aspect = width / height;

		// PHONE screens (aspect < 0.5): INVERTED CHEVRON
		// Mirrors sender chevron for visual symmetry
		// Perceptual principle: Coalition converges → Impact fans out → Lands
		// Y positions shifted +9% for vertical centering (matches sender shift)
		if (aspect < 0.5) {
			// Inverted chevron: 2 targets on top row (WIDE), 1 at bottom apex
			// Pushed to edges to match sender chevron width
			const invertedChevronPositions: Array<{ x: number; y: number }> = [
				{ x: 18, y: 69 }, // Representative - left (matches Neighbors X)
				{ x: 82, y: 69 }, // Mayor - right (matches Friends X)
				{ x: 50, y: 85 } // CEO - apex inverted (matches You/Coworkers X)
			];

			return targets.map((node, i) => ({
				...node,
				x: invertedChevronPositions[i].x,
				y: invertedChevronPositions[i].y
			}));
		}

		// TABLET screens (0.5 ≤ aspect < 0.9): Explicit centered positions
		// Senders span 18-46%, so targets at 82% centers overall layout at 50%
		// (18 + 82) / 2 = 50% perfect vertical centering
		if (aspect >= 0.5 && aspect < 0.9) {
			const tabletTargetPositions: Array<{ x: number; y: number }> = [
				{ x: 20, y: 82 }, // Representative - left
				{ x: 50, y: 82 }, // Mayor - center
				{ x: 80, y: 82 } // CEO - right
			];

			return targets.map((node, i) => ({
				...node,
				x: tabletTargetPositions[i].x,
				y: tabletTargetPositions[i].y
			}));
		}

		// WIDE screens (aspect >= 0.9): horizontal row layout
		// Senders at ~25% (with stagger 22-28%), targets at 75% for vertical centering
		// (25 + 75) / 2 = 50% perfect vertical centering
		const targetY = 75;

		// Use explicit positions for maximum separation
		// 3 targets: 20%, 50%, 80% for generous spacing
		const positions = [20, 50, 80];
		return targets.map((node, i) => ({
			...node,
			x: positions[i] ?? 50,
			y: targetY
		}));
	}

	// Reactive positioned nodes based on container dimensions
	const senderPositions = $derived(calculateSenderPositions(containerWidth, containerHeight));
	const targetPositions = $derived(calculateTargetPositions(containerWidth, containerHeight));

	const positioned = $derived([...senderPositions, ...targetPositions]);

	const nodeLookup = $derived(
		positioned.reduce<Record<string, PositionedNode>>(
			(acc, node) => ({ ...acc, [node.id]: node }),
			{}
		)
	);

	// ─────────────────────────────────────────────────────────────
	// Connections with semantic types AND temporal phases
	// (Use base node arrays, not positioned - connections are stable)
	// ─────────────────────────────────────────────────────────────

	// Phase 1: You share with your network (propagation originates at YOU)
	const shareConnections: Connection[] = senders
		.filter((s) => s.id !== 'you')
		.map((s) => ({ from: 'you', to: s.id, type: 'share', phase: 'you-share' }));

	// Phase 2: You also send directly to targets
	const youDeliverConnections: Connection[] = targets.map((t) => ({
		from: 'you',
		to: t.id,
		type: 'deliver',
		phase: 'you-send'
	}));

	// Phase 3: Your network sends to targets (after receiving from you)
	const peerDeliverConnections: Connection[] = senders
		.filter((s) => s.id !== 'you')
		.flatMap((s) =>
			targets.map((t) => ({
				from: s.id,
				to: t.id,
				type: 'deliver' as const,
				phase: 'peers-send' as const
			}))
		);

	// Ordered by narrative sequence (strictly from you → peers → targets)
	const allConnections: Connection[] = [
		...youDeliverConnections,
		...shareConnections,
		...peerDeliverConnections
	];

	// ─────────────────────────────────────────────────────────────
	// Timing (perceptual rhythm + narrative sequence)
	// ─────────────────────────────────────────────────────────────

	const TIMING = {
		// Narrative reveal timing (propagation outward from You)
		phaseStarts: {
			'you-send': 0,
			'you-share': 700,
			'peers-send': 1400
		},
		edgeDrawDuration: 800, // How long each edge takes to draw
		edgeStagger: 100, // Stagger within a phase

		// Ambient particles (life after reveal)
		ambientDelay: 2800, // Start immediately after narrative completes
		ambientDuration: 5000, // Slow breathing rhythm
		ambientStagger: 600, // Offset between particles

		// Hover response
		activeDuration: 700,
		activeStagger: 180,

		// Transitions
		hoverTransition: 150
	};

	// ─────────────────────────────────────────────────────────────
	// Geometry helpers (using scaled coordinates)
	// ─────────────────────────────────────────────────────────────

	function getEdgePath(conn: Connection): string {
		const from = nodeLookup[conn.from];
		const to = nodeLookup[conn.to];

		// Scale percentage positions to viewBox coordinates
		const fromX = from.x * scaleX;
		const fromY = from.y * scaleY;
		const toX = to.x * scaleX;
		const toY = to.y * scaleY;

		const dx = toX - fromX;
		const dy = toY - fromY;
		const len = Math.sqrt(dx * dx + dy * dy) || 1;

		// Padding scales with container size (use average scale)
		const scale = (scaleX + scaleY) / 2;
		const pad = 4 * scale;
		const ox = (dx / len) * pad;
		const oy = (dy / len) * pad;

		const x1 = fromX + ox;
		const y1 = fromY + oy;
		const x2 = toX - ox;
		const y2 = toY - oy;

		if (conn.type === 'share') {
			// Share edges connect "You" to peers within the coalition
			// ALL share edges arc ABOVE the coalition - through top negative space
			// This ensures visibility and separates share from deliver edges
			const yDiff = Math.abs(y2 - y1);
			const horizontalThreshold = 8 * scaleY; // Tighter threshold

			if (yDiff < horizontalThreshold) {
				// Same row - gentle arc above (still visible, not hidden by nodes)
				const arcHeight = 12 * scaleY;
				const controlX = (x1 + x2) / 2;
				const controlY = Math.min(y1, y2) - arcHeight;
				return `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`;
			}

			// Different rows - arc ABOVE row 1, through top negative space
			// This is critical: share edges must be visible above the coalition
			const distance = Math.abs(dx);

			// Arc height scales with distance, but always above row 1
			const minArcHeight = 18 * scaleY;
			const distanceBonus = distance * 0.2;
			const arcHeight = minArcHeight + distanceBonus;

			// Control point above the HIGHER node (row 1)
			const controlX = (x1 + x2) / 2;
			const controlY = Math.min(y1, y2) - arcHeight;

			return `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`;
		} else {
			// Deliver edges: straight lines down to targets
			return `M ${x1} ${y1} L ${x2} ${y2}`;
		}
	}

	function getEdgeDelay(conn: Connection, indexInPhase: number): number {
		const phaseStart = TIMING.phaseStarts[conn.phase] ?? 0;
		return phaseStart + indexInPhase * TIMING.edgeStagger;
	}

	function getConnectionsForNode(nodeId: string): Connection[] {
		return allConnections.filter((c) => c.from === nodeId || c.to === nodeId);
	}

	function getConnectedNodeIds(nodeId: string): string[] {
		const connections = getConnectionsForNode(nodeId);
		const ids = new Set<string>();
		connections.forEach((c) => {
			ids.add(c.from);
			ids.add(c.to);
		});
		ids.delete(nodeId);
		return Array.from(ids);
	}

	// ... (rest of file) ...

	// ─────────────────────────────────────────────────────────────
	// Template Update for Particles
	// ─────────────────────────────────────────────────────────────

	/* 
	   (See below for the template replacement part - I will include it in the ReplacementContent 
	    if I can target the whole block, but the tool limits me to one contiguous block. 
	    I'll target the TIMING object first, then the template in a separate call if needed, 
	    or try to span both if they are close. They are somewhat far apart. 
	    I will replace the TIMING object and helper functions here, and then do the template.)
	*/

	// ─────────────────────────────────────────────────────────────
	// Narrative Content (the story each node reveals)
	// ─────────────────────────────────────────────────────────────

	type NarrativeContent = {
		headline: string;
		body: string[];
		insight: string;
	};

	const narrativeContent: Record<string, NarrativeContent> = {
		you: {
			headline: 'Write once. Sent by many.',
			body: [
				'You\'ve sent emails that vanished into the void. Called offices that promised to "pass along your concerns." Nothing changed.',
				'This time is different. You write once — your authentic grievance, your specific problem. Then you share a link. And everyone who shares your problem can send it too.'
			],
			insight: 'One complaint gets buried. Coordinated messages make impact.',
		},
		neighbors: {
			headline: 'They share your streets.',
			body: [
				'The same potholes. The same broken streetlights. The same rent increases.',
				"When you share the link, you're not asking for a favor. You're inviting them to a fight that's already theirs. They personalize with their address, their name. Same grievance. Thousands of voices."
			],
			insight: "Coalition isn't built. It's unlocked.",
		},
		friends: {
			headline: 'They share your outrage.',
			body: [
				'The friends who text you "did you see this??" about the same news stories. Who vent about the same problems over dinner.',
				"They've felt the same frustration. They just needed someone to start. You share. They make it their own."
			],
			insight: 'Your network is already aligned. Activate it.',
		},
		coworkers: {
			headline: 'They share your workplace.',
			body: [
				'The same policies. The same frustrations. The same fear of speaking up alone.',
				'When one person complains, they\'re a "problem employee." When dozens coordinate, they\'re a constituency.'
			],
			insight: 'Individual complaints are noise. Coordinated messages are power.',
		},
		rep: {
			headline: 'They count every constituent.',
			body: [
				`${labels.legislativeBody} offices tally every email, every call, every contact. Staff report contact volume to the member.`,
				"One email from their district? Filed. Fifty from the same zip code on the same issue? That's a crisis meeting."
			],
			insight: 'They work for you. Remind them.',
		},
		mayor: {
			headline: 'They watch the neighborhoods.',
			body: [
				'Local officials track complaint patterns obsessively. They know which intersections, which blocks, which issues are heating up.',
				"Scattered complaints are background noise. Coordinated pressure from one neighborhood? That's the next town hall agenda item."
			],
			insight: 'Local power responds to local pressure.',
		},
		ceo: {
			headline: 'They fear coordinated customers.',
			body: [
				"One angry customer is a support ticket. A thousand sending the same message? That's a brand crisis.",
				"Corporate accountability isn't about shame. It's about showing them the numbers. Making the cost of ignoring you higher than the cost of change."
			],
			insight: 'Corporations respond to collective voice.',
		}
	};

	// ─────────────────────────────────────────────────────────────
	// State
	// ─────────────────────────────────────────────────────────────

	let reducedMotion = $state(false);
	let hoveredId = $state<string | null>(null);
	let expandedNodeId = $state<string | null>(null);
	let mounted = $state(false);
	let narrativeComplete = $state(false);

	// Track which edges have finished drawing or been revealed
	// This prevents re-animation on hover
	let drawnEdges = $state(new Array(allConnections.length).fill(false));

	// Responsive state
	let clampShift = $state({ x: 0, y: 0 });
	let isMobile = $state(false);

	// Dynamic clamping state
	let nodeElements: Record<string, HTMLElement> = $state({});
	let expandedWidth = $state(0);
	let expandedHeight = $state(0);
	let pixelTransform = $state('');

	function markEdgeDrawn(index: number) {
		if (!drawnEdges[index]) {
			drawnEdges[index] = true;
		}
	}

	// Derived: is any node expanded?
	const isExpanded = $derived(expandedNodeId !== null);
	const expandedContent = $derived(expandedNodeId ? narrativeContent[expandedNodeId] : null);

	function getCausalConnections(nodeId: string): Connection[] {
		// 1. Get direct connections (incoming and outgoing)
		const direct = getConnectionsForNode(nodeId);

		// 2. If it's a target (decision maker), we need to show the upstream "You -> Peer" links
		//    that enabled the "Peer -> Target" links.
		const node = nodeLookup[nodeId];
		if (node?.tone === 'target') {
			// Find all peers sending to this target
			const incomingFromPeers = direct.filter((c) => c.to === nodeId && c.from !== 'you');

			// For each peer, find the "You -> Peer" connection
			const upstream = incomingFromPeers.flatMap((peerConn) =>
				allConnections.filter((c) => c.from === 'you' && c.to === peerConn.from)
			);

			return [...direct, ...upstream];
		}

		return direct;
	}

	const connectedNodeIds = $derived(hoveredId ? getConnectedNodeIds(hoveredId) : []);

	// Active connections:
	// - If "You" is hovered: Show everything (You -> Peers -> Targets)
	// - If Target is hovered: Show causal chain (You -> Peers -> Target)
	// - If Peer is hovered: Show direct (You -> Peer -> Targets)
	const activeConnections = $derived(
		hoveredId ? (hoveredId === 'you' ? allConnections : getCausalConnections(hoveredId)) : []
	);

	// Effect: When connections become active, mark them as drawn immediately
	// This ensures they "stick" even if we hover out before animation completes
	$effect(() => {
		activeConnections.forEach((conn) => {
			const idx = allConnections.indexOf(conn);
			if (idx !== -1) markEdgeDrawn(idx);
		});
	});

	// ─────────────────────────────────────────────────────────────
	// Node Expansion Handlers
	// ─────────────────────────────────────────────────────────────

	/**
	 * Smart Clamp Expansion
	 *
	 * Logic:
	 * 1. Expand the node "in place" (preserving spatial context).
	 * 2. Calculate if the expanded node would clip off the screen.
	 * 3. Apply a transform (clampShift) to nudge it back into the safe zone.
	 *
	 * This works universally:
	 * - On Desktop: Node stays near its origin, shifting only if near an edge.
	 * - On Mobile: Node (likely taking up full width) gets shifted to center if needed.
	 */
	async function handleNodeClick(nodeId: string): Promise<void> {
		// Collapsing - just reset state
		if (expandedNodeId === nodeId) {
			expandedNodeId = null;
			clampShift = { x: 0, y: 0 };
			return;
		}

		expandedNodeId = nodeId;
		hoveredId = null;

		// Force initial measurement to avoid frame delay
		const el = nodeElements[nodeId];
		if (el) {
			const rect = el.getBoundingClientRect();
			expandedWidth = rect.width;
			expandedHeight = rect.height;
		}
	}

	// ResizeObserver Effect
	// Tracks the dimensions of the expanded node accurately
	$effect(() => {
		if (expandedNodeId && nodeElements[expandedNodeId]) {
			const el = nodeElements[expandedNodeId];
			const observer = new ResizeObserver((entries) => {
				for (const entry of entries) {
					expandedWidth = entry.contentRect.width;
					expandedHeight = entry.contentRect.height;
				}
			});
			observer.observe(el);
			return () => observer.disconnect();
		} else {
			expandedWidth = 0;
			expandedHeight = 0;
		}
	});

	// Reactive Clamping Effect
	// Runs whenever expanded dimensions or active node changes
	$effect(() => {
		if (expandedNodeId && !isMobile && expandedWidth > 0 && expandedHeight > 0) {
			const viewportWidth = document.documentElement.clientWidth;
			const viewportHeight = document.documentElement.clientHeight;
			const margin = 32; // Safe area (increased for better negative space)

			let shiftX = 0;
			let shiftY = 0;

			// Get the node's logical position (percentage)
			const node = nodeLookup[expandedNodeId];
			if (!node) return;

			// Convert percentage position to pixel coordinates relative to viewport
			// We need the container's position in the viewport to do this accurately
			// But since the node is positioned relative to the container, and we want to clamp relative to viewport...
			// Actually, the node is `position: absolute` inside the container.
			// The `transform` shifts it relative to its `left`/`top` origin.
			// So we need to calculate where that `left`/`top` origin IS in the viewport.

			const containerRect = containerEl?.getBoundingClientRect();
			if (!containerRect) return;

			const originX = containerRect.left + (node.x / 100) * containerRect.width;
			const originY = containerRect.top + (node.y / 100) * containerRect.height;

			// Projected edges of expanded node (centered on origin)
			const leftEdge = originX - expandedWidth / 2;
			const rightEdge = originX + expandedWidth / 2;
			const topEdge = originY - expandedHeight / 2;
			const bottomEdge = originY + expandedHeight / 2;

			// Clamp Horizontal
			if (leftEdge < margin) {
				shiftX = margin - leftEdge;
			} else if (rightEdge > viewportWidth - margin) {
				shiftX = viewportWidth - margin - rightEdge;
			}

			// Clamp Vertical
			if (topEdge < margin) {
				shiftY = margin - topEdge;
			} else if (bottomEdge > viewportHeight - margin) {
				shiftY = viewportHeight - margin - bottomEdge;
			}

			clampShift = { x: shiftX, y: shiftY };

			// Calculate explicit pixel transform to avoid calc() ambiguity
			const translateX = -expandedWidth / 2 + shiftX;
			const translateY = -expandedHeight / 2 + shiftY;
			pixelTransform = `translate(${translateX}px, ${translateY}px)`;
		} else if (!expandedNodeId) {
			clampShift = { x: 0, y: 0 };
			pixelTransform = '';
		}
	});

	function handleDismiss(): void {
		expandedNodeId = null;
		clampShift = { x: 0, y: 0 };
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && expandedNodeId) {
			expandedNodeId = null;
			clampShift = { x: 0, y: 0 };
		}
	}

	function handleBackdropClick(event: MouseEvent): void {
		// Only dismiss if clicking the backdrop itself, not the expanded node
		if ((event.target as HTMLElement).classList.contains('expansion-backdrop')) {
			expandedNodeId = null;
			clampShift = { x: 0, y: 0 };
		}
	}

	onMount(() => {
		reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		// Initial check for mobile
		const mobileQuery = window.matchMedia('(max-width: 768px)');
		isMobile = mobileQuery.matches;

		// Listener for resize/orientation changes
		const handleMobileChange = (e: MediaQueryListEvent) => {
			isMobile = e.matches;
			// Reset clamp shift when switching modes to avoid weird states
			if (expandedNodeId) {
				clampShift = { x: 0, y: 0 };
			}
		};
		mobileQuery.addEventListener('change', handleMobileChange);

		// Track container dimensions for responsive SVG
		let resizeObserver: ResizeObserver | null = null;
		if (containerEl) {
			resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					containerWidth = entry.contentRect.width || 100;
					containerHeight = entry.contentRect.height || 100;
				}
			});
			resizeObserver.observe(containerEl);

			// Initial measurement
			containerWidth = containerEl.clientWidth || 100;
			containerHeight = containerEl.clientHeight || 100;
		}

		// Start mount animation
		let animationFrameId: number | null = null;
		animationFrameId = requestAnimationFrame(() => {
			mounted = true;
		});

		// Mark narrative complete after all edges drawn
		const narrativeTimeout = setTimeout(() => {
			narrativeComplete = true;
		}, TIMING.ambientDelay);

		// Global keydown listener for Escape
		window.addEventListener('keydown', handleKeydown);

		return () => {
			if (resizeObserver) {
				resizeObserver.disconnect();
			}
			if (animationFrameId !== null) {
				cancelAnimationFrame(animationFrameId);
			}
			clearTimeout(narrativeTimeout);
			window.removeEventListener('keydown', handleKeydown);
			mobileQuery.removeEventListener('change', handleMobileChange);
		};
	});

	function isConnectionActive(conn: Connection): boolean {
		return activeConnections.some((ac) => ac.from === conn.from && ac.to === conn.to);
	}

	function getNodeState(
		nodeId: string
	): 'idle' | 'hovered' | 'connected' | 'dimmed' | 'expanded' | 'recessed' {
		// Expansion state takes priority
		if (expandedNodeId) {
			if (nodeId === expandedNodeId) return 'expanded';
			return 'recessed'; // All other nodes recede when one is expanded
		}
		// Normal hover states
		if (!hoveredId) return 'idle';
		if (nodeId === hoveredId) return 'hovered';
		if (connectedNodeIds.includes(nodeId)) return 'connected';
		return 'dimmed';
	}

	// Track phase indices for stagger calculation
	let phase1Index = 0;
	let phase2Index = 0;
	let phase3Index = 0;

	function getPhaseIndex(conn: Connection): number {
		if (conn.phase === 'you-send') {
			const idx = youDeliverConnections.findIndex((c) => c.from === conn.from && c.to === conn.to);
			return idx;
		} else if (conn.phase === 'you-share') {
			const idx = shareConnections.findIndex((c) => c.from === conn.from && c.to === conn.to);
			return idx;
		} else {
			const idx = peerDeliverConnections.findIndex((c) => c.from === conn.from && c.to === conn.to);
			return idx;
		}
	}
</script>

<div
	class="relay-loom"
	class:mounted
	class:narrative-complete={narrativeComplete}
	class:reduced-motion={reducedMotion}
	class:is-expanded={isExpanded}
	class:embedded
	style:--label-font-size={labelFontSize}
	style:--tag-font-size={tagFontSize}
	style:--micro-font-size={microFontSize}
	style:--node-padding={nodePadding}
	style:--node-min-width={nodeMinWidth}
	style:--node-max-width={nodeMaxWidth}
>
	<div class="canvas-container" bind:this={containerEl}>
		<svg {viewBox} class="edge-canvas" aria-hidden="true">
			<defs>
				<!-- 
					Subtle Depth Gradients
					Gives the spheres a "jewel-like" quality without harsh highlights.
					Soft lighter top-left -> saturated bottom-right.
				-->
				<radialGradient id="sphere-gradient-share" cx="30%" cy="30%" r="80%">
					<stop offset="0%" stop-color="oklch(0.75 0.15 240)" />
					<!-- Lighter Blue -->
					<stop offset="100%" stop-color="var(--share-color)" />
					<!-- Base Blue -->
				</radialGradient>

				<radialGradient id="sphere-gradient-deliver" cx="30%" cy="30%" r="80%">
					<stop offset="0%" stop-color="oklch(0.85 0.14 175)" />
					<!-- Lighter Teal (matches hue 175) -->
					<stop offset="100%" stop-color="var(--deliver-color)" />
					<!-- Base Teal -->
				</radialGradient>

				<!-- Define paths for each connection (Drawing Layer - Pixel Units) -->
				{#each allConnections as conn, i}
					<path id="edge-path-{i}" d={getEdgePath(conn)} />
				{/each}

				<!-- 
					Filter: Signal Glow
					Refined bloom for data packets.
					Tighter core, softer ambient.
				-->
				<filter id="signal-glow" x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur in="SourceGraphic" stdDeviation="1" result="blur1" />
					<feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur2" />
					<feMerge>
						<feMergeNode in="blur2" />
						<feMergeNode in="blur1" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
			</defs>

			<!-- Layer 1: Edges with staged reveal -->
			<g class="edges-layer">
				{#each allConnections as conn, i}
					{@const phaseIndex = getPhaseIndex(conn)}
					{@const delay = getEdgeDelay(conn, phaseIndex)}
					{@const isActive = isConnectionActive(conn)}
					<use
						href="#edge-path-{i}"
						class="edge-drawing"
						class:share={conn.type === 'share'}
						class:deliver={conn.type === 'deliver'}
						class:active={isActive}
						class:drawn={drawnEdges[i]}
						style:--draw-delay="{delay}ms"
						style:--draw-duration="{TIMING.edgeDrawDuration}ms"
						style:--stroke-width={isActive ? strokeWidthActive : strokeWidth}
						onanimationend={() => markEdgeDrawn(i)}
					/>
				{/each}
			</g>

			<!-- Layer 2: Ambient particles (after narrative completes) -->
			{#if !reducedMotion && narrativeComplete}
				<g class="particles-ambient" filter="url(#signal-glow)">
					{#each allConnections as conn, i}
						{@const stagger = i * TIMING.ambientStagger}
						<circle
							r={particleRadiusAmbient}
							class="particle ambient"
							fill="url(#sphere-gradient-{conn.type})"
							style:--particle-delay="{stagger}ms"
						>
							<animateMotion
								dur="{TIMING.ambientDuration}ms"
								repeatCount="indefinite"
								begin="{TIMING.ambientDelay + stagger}ms"
								calcMode="spline"
								keySplines="0.4 0 0.2 1"
								keyTimes="0;1"
							>
								<mpath href="#edge-path-{i}" />
							</animateMotion>
						</circle>
					{/each}
				</g>
			{/if}

			<!-- Layer 3: Active particles (hover response) -->
			{#if !reducedMotion && hoveredId}
				<g class="particles-active" filter="url(#signal-glow)">
					{#each activeConnections as conn}
						{@const pathIndex = allConnections.findIndex(
							(c) => c.from === conn.from && c.to === conn.to
						)}
						{#each [0, 1, 2] as particleIndex}
							{@const stagger = particleIndex * TIMING.activeStagger}
							<circle
								r={particleRadiusActive}
								class="particle active"
								fill="url(#sphere-gradient-{conn.type})"
							>
								<animateMotion
									dur="{TIMING.activeDuration}ms"
									repeatCount="indefinite"
									begin="{stagger}ms"
									calcMode="spline"
									keySplines="0.33 1 0.68 1"
									keyTimes="0;1"
								>
									<mpath href="#edge-path-{pathIndex}" />
								</animateMotion>
							</circle>
						{/each}
					{/each}
				</g>
			{/if}
		</svg>

		<!-- Nodes -->
		{#each senderPositions as node}
			{@const state = getNodeState(node.id)}
			{@const content = narrativeContent[node.id]}
			<button
				class="node sender"
				class:hovered={state === 'hovered'}
				class:connected={state === 'connected'}
				class:dimmed={state === 'dimmed'}
				class:expanded={state === 'expanded'}
				class:recessed={state === 'recessed'}
				data-node-id={node.id}
				style:left="{node.x}%"
				style:top="{node.y}%"
				style:--clamp-transform={state === 'expanded' ? pixelTransform : undefined}
				onclick={() => handleNodeClick(node.id)}
				onmouseenter={() => !isExpanded && (hoveredId = node.id)}
				onmouseleave={() => !isExpanded && (hoveredId = null)}
				onfocus={() => !isExpanded && (hoveredId = node.id)}
				onblur={() => !isExpanded && (hoveredId = null)}
				bind:this={nodeElements[node.id]}
			>
				<span class="glow-ring"></span>
				<span class="node-content">
					<span class="label" class:you-label={node.id === 'you'}>{node.label}</span>
					<span class="tag">{node.id === 'you' ? 'Write once' : 'Share link'}</span>

					<!-- Expanded narrative content -->
					{#if state === 'expanded' && content}
						<div class="narrative-panel">
							<h4 class="narrative-headline">{content.headline}</h4>
							{#each content.body as paragraph}
								<p class="narrative-body">{paragraph}</p>
							{/each}
							<p class="narrative-insight">{content.insight}</p>
						</div>
					{/if}
				</span>
			</button>
		{/each}

		{#each targetPositions as node}
			{@const state = getNodeState(node.id)}
			{@const content = narrativeContent[node.id]}
			<button
				class="node target"
				class:hovered={state === 'hovered'}
				class:connected={state === 'connected'}
				class:dimmed={state === 'dimmed'}
				class:expanded={state === 'expanded'}
				class:recessed={state === 'recessed'}
				data-node-id={node.id}
				style:left="{node.x}%"
				style:top="{node.y}%"
				style:--clamp-transform={state === 'expanded' ? pixelTransform : undefined}
				onclick={() => handleNodeClick(node.id)}
				onmouseenter={() => !isExpanded && (hoveredId = node.id)}
				onmouseleave={() => !isExpanded && (hoveredId = null)}
				onfocus={() => !isExpanded && (hoveredId = node.id)}
				onblur={() => !isExpanded && (hoveredId = null)}
				bind:this={nodeElements[node.id]}
			>
				<span class="glow-ring"></span>
				<span class="node-content">
					<span class="label">{node.label}</span>
					{#if node.badge && state !== 'expanded'}
						<span class="micro">{node.badge}</span>
					{/if}

					<!-- Expanded narrative content -->
					{#if state === 'expanded' && content}
						<div class="narrative-panel">
							<h4 class="narrative-headline">{content.headline}</h4>
							{#each content.body as paragraph}
								<p class="narrative-body">{paragraph}</p>
							{/each}
							<p class="narrative-insight">{content.insight}</p>
						</div>
					{/if}
				</span>
			</button>
		{/each}

		<!-- Backdrop for dismissing expanded state -->
		{#if isExpanded}
			<button
				class="expansion-backdrop"
				onclick={handleBackdropClick}
				aria-label="Close expanded node"
			></button>
		{/if}
	</div>
</div>

<style>
	/* ─────────────────────────────────────────────────────────────
	   Container
	   ───────────────────────────────────────────────────────────── */

	.relay-loom {
		--share-color: oklch(0.7 0.15 270);
		--share-color-bright: oklch(0.8 0.18 270);
		/*
		 * Glow layers for box-shadow approach:
		 * Inner: brightest, tightest spread
		 * Mid: medium spread, lower opacity
		 * Outer: wide ambient glow
		 */
		--share-glow-inner: oklch(0.65 0.25 270 / 0.4);
		--share-glow-mid: oklch(0.78 0.1 270 / 0.2);
		--share-glow-outer: oklch(0.85 0.06 270 / 0.1);

		--deliver-color: oklch(0.75 0.14 175);
		--deliver-color-bright: oklch(0.85 0.16 175);
		/* Teal glow layers: same principle */
		--deliver-glow-inner: oklch(0.75 0.12 175 / 0.32);
		--deliver-glow-mid: oklch(0.8 0.08 175 / 0.18);
		--deliver-glow-outer: oklch(0.85 0.06 175 / 0.1);

		--transition-fast: 150ms;
		--transition-normal: 220ms;

		position: relative;
		isolation: isolate;
		width: 100%;
		max-width: 820px;
		margin: 0 auto;
		padding: 1.5rem 1.75rem 2.5rem;
		border-radius: 0.75rem;
		border: 1px solid oklch(0.85 0.02 250);
		background: linear-gradient(
			to bottom right,
			oklch(0.99 0.005 250),
			oklch(0.97 0.01 250),
			oklch(0.96 0.015 250)
		);
		box-shadow:
			0 1px 3px oklch(0 0 0 / 0.04),
			0 18px 60px -45px oklch(0.25 0.05 250 / 0.45);
		/* Allow glow rings to extend beyond container bounds
		   Clip only the edges, not the internal glow effects */
		overflow: visible;
	}

	@media (min-width: 1024px) {
		.relay-loom {
			max-width: 860px;
		}
	}

	@media (min-width: 1280px) {
		.relay-loom {
			max-width: 900px;
		}
	}

	/*
	 * Embedded mode: Strip container styling when nested in parent card
	 * (e.g., CoordinationExplainer). Parent provides visual container.
	 */
	.relay-loom.embedded {
		border: none;
		background: transparent;
		box-shadow: none;
		border-radius: 0;
		padding: 0;
		max-width: none;
	}

	/* Reduce canvas height when embedded */
	.relay-loom.embedded .canvas-container {
		height: 320px;
	}

	@media (min-width: 640px) {
		.relay-loom.embedded .canvas-container {
			height: 340px;
		}
	}

	@media (min-width: 1024px) {
		.relay-loom.embedded .canvas-container {
			height: 360px;
		}
	}

	.canvas-container {
		position: relative;
		height: 520px;
		width: 100%;
	}

	@media (min-width: 640px) {
		.canvas-container {
			height: 560px;
		}
	}

	@media (min-width: 1024px) {
		.canvas-container {
			height: 580px;
		}
	}

	/* ─────────────────────────────────────────────────────────────
	   SVG Canvas
	   ───────────────────────────────────────────────────────────── */

	.edge-canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	/* ─────────────────────────────────────────────────────────────
	   Edges with Staged Drawing Animation
	   ───────────────────────────────────────────────────────────── */

	.edge-drawing {
		fill: none;
		stroke-width: var(--stroke-width, 1.3);
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1000;
		stroke-dashoffset: 1000;
		opacity: 0;
		transition:
			stroke var(--transition-fast) ease-out,
			stroke-width var(--transition-fast) ease-out;
	}

	.edge-drawing.share {
		stroke: var(--share-color);
	}

	.edge-drawing.deliver {
		stroke: var(--deliver-color);
	}

	/* Staged reveal animation */
	.relay-loom.mounted .edge-drawing {
		animation: draw-edge var(--draw-duration, 800ms) ease-out forwards;
		animation-delay: var(--draw-delay, 0ms);
	}

	@keyframes draw-edge {
		0% {
			stroke-dashoffset: 1000;
			opacity: 0;
		}
		15% {
			opacity: 0.7;
		}
		100% {
			stroke-dashoffset: 0;
			opacity: 0.5;
		}
	}

	/* After narrative completes, edges settle to final state */
	.relay-loom.narrative-complete .edge-drawing {
		stroke-dasharray: none;
		stroke-dashoffset: 0;
		opacity: 0.4;
	}

	/* Hover intensifies connected edges */
	/* Prevent re-animation if already drawn */
	.edge-drawing.drawn {
		animation: none !important;
		stroke-dashoffset: 0 !important;
		opacity: 0.5;
		/* Keep stroke-dasharray to avoid layout shifts/re-paints */
		transition: opacity 200ms ease-out;
	}

	.edge-drawing.active {
		opacity: 0.75 !important;
		animation: none !important;
		stroke-dashoffset: 0 !important;
		transition:
			stroke-dashoffset 700ms ease-out,
			opacity 200ms ease-out;
	}

	.edge-drawing.active.share {
		stroke: var(--share-color-bright);
	}

	.edge-drawing.active.deliver {
		stroke: var(--deliver-color-bright);
	}

	/* Reduced motion: skip animation, show final state */
	.relay-loom.reduced-motion .edge-drawing {
		animation: none !important;
		stroke-dasharray: none !important;
		stroke-dashoffset: 0 !important;
		opacity: 0.4;
	}

	/* ─────────────────────────────────────────────────────────────
	   Signal Pulses (The Living Network)
	   ───────────────────────────────────────────────────────────── */

	/* ─────────────────────────────────────────────────────────────
	   Particles
	   ───────────────────────────────────────────────────────────── */

	.particle {
		will-change: transform;
	}

	.particle.ambient {
		opacity: 0;
	}

	/* Fade in ambient particles after narrative - use animation delay to sync with SMIL begin */
	.relay-loom.narrative-complete .particle.ambient {
		animation: particle-fade-in 400ms ease-out forwards;
		animation-delay: var(--particle-delay, 0ms);
	}

	@keyframes particle-fade-in {
		0% {
			opacity: 0;
		}
		100% {
			opacity: 0.55;
		}
	}

	.particle.active {
		opacity: 0.95;
	}

	/* Reduced motion: hide all particles */
	.relay-loom.reduced-motion .particles-ambient,
	.relay-loom.reduced-motion .particles-active {
		display: none;
	}


	/* ─────────────────────────────────────────────────────────────
	   Nodes
	   ───────────────────────────────────────────────────────────── */

	.node {
		position: absolute;
		transform: var(--clamp-transform, translate(-50%, -50%));
		min-width: var(--node-min-width, 96px);
		max-width: var(--node-max-width, 134px);
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
		text-align: center;
		outline: none;
		/* Smooth position transitions during resize - perceptual continuity */
		transition:
			left 280ms cubic-bezier(0.4, 0, 0.2, 1),
			top 280ms cubic-bezier(0.4, 0, 0.2, 1),
			min-width 280ms cubic-bezier(0.4, 0, 0.2, 1),
			max-width 280ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	/*
	 * Glow Ring — Perceptual Engineering
	 *
	 * Function: AMBIENT peripheral feedback
	 * Anti-pattern: Hard edges, visible banding, spotlight effect
	 *
	 * Solution: Layered box-shadows
	 * Box-shadows naturally have soft edges (Gaussian blur built-in)
	 * Multiple layers at increasing spread create smooth inverse-square falloff
	 * No gradient banding possible - shadows blend continuously
	 */
	.glow-ring {
		position: absolute;
		inset: -4px -6px;
		border-radius: 14px;
		background: transparent;
		opacity: 0;
		transition: opacity var(--transition-normal) ease-out;
		pointer-events: none;
		/*
		 * Layered shadows: each layer adds soft glow
		 * Inner layers: tighter spread, higher opacity
		 * Outer layers: wider spread, lower opacity
		 * Result: smooth falloff with NO hard edges
		 */
		box-shadow:
			0 0 8px 2px var(--node-glow-inner, transparent),
			0 0 16px 4px var(--node-glow-mid, transparent),
			0 0 28px 8px var(--node-glow-outer, transparent);
	}

	.node-content {
		position: relative;
		/* Ensure content stays above the glow ring */
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: var(--node-padding, 8px 10px);
		border-radius: 12px;
		border: 1px solid oklch(0.7 0.02 250 / 0.45);
		background: oklch(1 0 0 / 0.92);
		box-shadow:
			inset 0 1px 6px oklch(0 0 0 / 0.06),
			0 20px 50px -28px oklch(0.2 0.05 250 / 0.4);
		backdrop-filter: blur(4px);
		transition:
			transform var(--transition-normal) ease-out,
			box-shadow var(--transition-normal) ease-out,
			border-color var(--transition-normal) ease-out,
			opacity var(--transition-fast) ease-out,
			padding var(--transition-normal) ease-out;
	}

	.node.sender {
		--node-glow-inner: var(--share-glow-inner);
		--node-glow-mid: var(--share-glow-mid);
		--node-glow-outer: var(--share-glow-outer);
	}

	.node.sender .node-content {
		border-color: oklch(0.65 0.15 270 / 0.5);
	}

	.node.target {
		--node-glow-inner: var(--deliver-glow-inner);
		--node-glow-mid: var(--deliver-glow-mid);
		--node-glow-outer: var(--deliver-glow-outer);
	}

	.node.target .node-content {
		border-color: oklch(0.7 0.12 175 / 0.45);
		background:
			radial-gradient(circle at 80% 20%, oklch(0.85 0.1 175 / 0.08), transparent 60%),
			oklch(1 0 0 / 0.92);
	}

	/* States */
	.node.hovered .glow-ring {
		opacity: 1;
	}

	.node.hovered .node-content,
	.node:focus-visible .node-content {
		transform: scale(1.04);
		box-shadow:
			inset 0 1px 6px oklch(0 0 0 / 0.06),
			0 24px 60px -24px oklch(0.3 0.1 270 / 0.35);
	}

	.node.sender.hovered .node-content,
	.node.sender:focus-visible .node-content {
		border-color: oklch(0.6 0.18 270 / 0.7);
	}

	.node.target.hovered .node-content,
	.node.target:focus-visible .node-content {
		border-color: oklch(0.65 0.15 175 / 0.7);
		box-shadow:
			inset 0 1px 6px oklch(0 0 0 / 0.06),
			0 24px 60px -24px oklch(0.4 0.12 175 / 0.35);
	}

	.node.connected .node-content {
		border-color: oklch(0.6 0.1 250 / 0.6);
	}

	.node.connected .glow-ring {
		opacity: 0.4;
	}

	.node.dimmed .node-content {
		opacity: 0.5;
		filter: saturate(0.7);
	}

	/* Focus visible ring */
	.node:focus-visible .node-content {
		outline: 2px solid oklch(0.6 0.15 270 / 0.5);
		outline-offset: 2px;
	}

	/* ─────────────────────────────────────────────────────────────
	   Node Labels
	   ───────────────────────────────────────────────────────────── */

	.label {
		font-weight: 600;
		font-size: var(--label-font-size, 12px);
		color: oklch(0.25 0.02 250);
		transition: font-size var(--transition-normal) ease-out;
	}

	.you-label {
		color: oklch(0.55 0.18 220);
	}

	.tag {
		font-size: var(--tag-font-size, 10px);
		color: oklch(0.5 0.02 250);
		transition: font-size var(--transition-normal) ease-out;
	}

	.micro {
		display: inline-flex;
		padding: 4px 7px;
		border-radius: 999px;
		background: oklch(0.7 0.02 250 / 0.12);
		font-size: var(--micro-font-size, 10px);
		color: oklch(0.45 0.02 250);
		transition: font-size var(--transition-normal) ease-out;
	}

	/* ─────────────────────────────────────────────────────────────
	   Node Expansion — Perceptual Engineering

	   Cognitive mode shift: spatial reasoning → narrative comprehension

	   Key principles:
	   - Node expands TO REVEAL, not spawn new element (continuity)
	   - Other nodes RECEDE, not disappear (maintain spatial context)
	   - Backdrop is SUBTLE (focus, not block)
	   - Content reveals with timing (headline → body → insight → CTA)
	   ───────────────────────────────────────────────────────────── */

	/* Backdrop: subtle focus overlay */
	.expansion-backdrop {
		position: absolute;
		inset: 0;
		z-index: 5;
		background: oklch(0.98 0.005 250 / 0.7);
		backdrop-filter: blur(2px);
		border: none;
		cursor: pointer;
		opacity: 0;
		animation: backdrop-fade-in 250ms ease-out forwards;
	}

	@keyframes backdrop-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* Recessed state: other nodes fade when one is expanded */
	.node.recessed {
		pointer-events: none;
		z-index: 1;
	}

	.node.recessed .node-content {
		opacity: 0.35;
		filter: saturate(0.5) blur(0.5px);
		transform: scale(0.95);
	}

	.node.recessed .glow-ring {
		opacity: 0 !important;
	}

	/* Expanded state: node transforms to reveal narrative */
	.node.expanded {
		z-index: 10;
		/* Allow natural flow for expanded content */
		min-width: auto;
		max-width: none;
	}

	/* Mobile: Center in viewport */
	@media (max-width: 768px) {
		.node.expanded {
			left: 50% !important;
			top: 50% !important;
		}
	}

	.node.expanded .node-content {
		/* Expand to comfortable reading width, but respect viewport margins */
		width: 90vw; /* Mobile friendly default */
		max-width: 340px;
		max-height: 80vh; /* Vertical safety margin */
		overflow-y: auto; /* Scroll if content is too tall */

		padding: 1.25rem 1.5rem;
		gap: 0;
		align-items: flex-start;
		text-align: left;
		transform: scale(1);
		box-shadow:
			0 8px 30px -8px oklch(0.2 0.05 250 / 0.25),
			0 25px 60px -15px oklch(0.15 0.08 250 / 0.2);
		border-color: oklch(0.6 0.12 270 / 0.6);
		background: oklch(1 0 0 / 0.98);
	}

	.node.target.expanded .node-content {
		border-color: oklch(0.65 0.1 175 / 0.6);
	}

	.node.expanded .glow-ring {
		opacity: 0.8;
		/* Expand glow for expanded state */
		inset: -8px -10px;
	}

	/* Hide original label/tag in expanded state */
	.node.expanded .label,
	.node.expanded .tag {
		display: none;
	}

	/* ─────────────────────────────────────────────────────────────
	   Narrative Panel Content
	   ───────────────────────────────────────────────────────────── */

	.narrative-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		opacity: 0;
		animation: narrative-reveal 350ms ease-out 100ms forwards;
	}

	@keyframes narrative-reveal {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.narrative-headline {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1.125rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		line-height: 1.3;
		color: oklch(0.2 0.02 250);
		margin: 0 0 0.25rem 0;
	}

	.narrative-body {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 400;
		line-height: 1.55;
		color: oklch(0.35 0.02 250);
		margin: 0;
	}

	.narrative-body + .narrative-body {
		margin-top: 0.5rem;
	}

	.narrative-insight {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		font-style: italic;
		line-height: 1.4;
		color: oklch(0.45 0.08 270);
		margin: 0.5rem 0 0 0;
		padding-left: 0.75rem;
		border-left: 2px solid oklch(0.7 0.12 270 / 0.4);
	}

	.node.target .narrative-insight {
		color: oklch(0.45 0.08 175);
		border-left-color: oklch(0.7 0.1 175 / 0.4);
	}


	/* ─────────────────────────────────────────────────────────────
	   Responsive Expansion Sizing

	   Phone: Expanded node takes more width (limited horizontal space)
	   Tablet: Comfortable reading width
	   Desktop: Generous but not overwhelming
	   ───────────────────────────────────────────────────────────── */

	/*
	 * PHONE: Viewport-centered expansion
	 *
	 * Perceptual Engineering: On small screens, the user's intent is to READ.
	 * The loom's spatial context becomes secondary. The content must come to them.
	 *
	 * Solution: Use position:fixed to center expanded node in viewport.
	 * - Node "floats up" from its position to meet the user's eyes
	 * - Backdrop covers entire viewport (also fixed)
	 * - No scroll hunting required
	 */
	@media (max-width: 480px) {
		/* Backdrop must also be fixed to cover full viewport on phone */
		.expansion-backdrop {
			position: fixed;
			inset: 0;
		}

		/* Expanded node centers in viewport, detached from loom coordinates */
		.node.expanded {
			position: fixed;
			/* Override inline styles - center in viewport */
			left: 50% !important;
			top: 42% !important; /* Slightly above center for thumb comfort */
			/* transform already includes translate(-50%, -50%) from base .node */
		}

		.node.expanded .node-content {
			min-width: 260px;
			max-width: calc(100vw - 48px);
			max-height: calc(100vh - 120px);
			overflow-y: auto;
			padding: 1.25rem 1.25rem;
		}

		.narrative-headline {
			font-size: 1.0625rem;
		}

		.narrative-body {
			font-size: 0.8125rem;
		}

		.narrative-insight {
			font-size: 0.75rem;
		}
	}

	/* Tablet: optimal reading width */
	@media (min-width: 481px) and (max-width: 768px) {
		.node.expanded .node-content {
			min-width: 260px;
			max-width: 320px;
		}
	}

	/* Desktop: generous but focused */
	@media (min-width: 769px) {
		.node.expanded .node-content {
			min-width: 300px;
			max-width: 380px;
			padding: 1.5rem 1.75rem;
		}

		.narrative-headline {
			font-size: 1.25rem;
		}

		.narrative-body {
			font-size: 0.9375rem;
		}
	}

	/* Reduced motion: instant states, no animations */
	.relay-loom.reduced-motion .expansion-backdrop {
		animation: none;
		opacity: 1;
	}

	.relay-loom.reduced-motion .narrative-panel {
		animation: none;
		opacity: 1;
		transform: none;
	}

	.relay-loom.reduced-motion .node.recessed .node-content,
	.relay-loom.reduced-motion .node.expanded .node-content {
		transition: none;
	}
</style>
