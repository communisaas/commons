/**
 * camera — the Capability Map camera model.
 *
 * The canvas is an operating field, not a whiteboard: you don't drag your desktop around
 * hunting for things, you state an INTENT and the camera flies you to the target.
 * This module is the PURE (no-Svelte, no-DOM, SSR-safe, unit-testable) core of
 * that camera:
 *
 *   · FRAMING math — given a viewport + a world-space bounding box, compute the
 *     scale + pan that centers the box at a comfortable read-zoom. The single
 *     source of truth for "what does it mean to look AT a thing." A single object,
 *     a region, or the whole constellation are all just bounds.
 *
 *   · TARGETS — the navigable destinations the camera can fly to: every real
 *     constellation object + the four fixed regions + the whole-constellation
 *     overview. Built from the same `ConstellationObject[]` the field renders, so
 *     the palette/cycle/dock all aim at exactly the objects that exist — never a
 *     fabricated destination.
 *
 *   · EASING — the ease-out curve the rAF lerp follows. Plain math; the component
 *     owns the rAF loop (browser-only) and reads this for each frame's progress.
 *
 * The COMPONENT (CanvasCapabilityMap) owns the imperative parts: the rAF loop, the
 * reactive viewport state it mutates, the history stack, cancellation on a manual
 * drag, and SSR guards. Keeping the math here makes the framing testable without a
 * DOM and keeps the component focused on interaction + paint.
 */

import { formatCapabilityClusters } from '$lib/data/capability-clusters';
import {
	operatorCapabilityActionLabel,
	operatorCapabilityStateLabel,
	type OperatorCapabilityState
} from '$lib/data/capability-state-labels';
import { REGIONS, REGION_ORDER, type ConstellationObject, type RegionId } from './constellation';
import { constellationCapabilityContract } from './constellation-capability-contract';

// ─── Viewport + framing ────────────────────────────────────────────────────

/** A camera pose: the CSS-var trio the WORLD layer transforms by. */
export interface CameraPose {
	scale: number;
	panX: number;
	panY: number;
}

/** A world-space axis-aligned box. Regions carry this directly; a point object
 *  gets a tight box around its center. The overview is the union of all regions. */
export interface WorldBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The viewport (the canvas root's measured pixel size). */
export interface Viewport {
	width: number;
	height: number;
}

/** Scale clamps — MUST match CanvasCapabilityMap's MIN_SCALE / MAX_SCALE so a framed
 *  pose never lands outside the zoom range the wheel/keyboard also honor. */
export const CAMERA_MIN_SCALE = 0.32;
export const CAMERA_MAX_SCALE = 2.6;

/** A comfortable "read" zoom for a single object — full detail resolves at >= 1.2
 *  (see CanvasCapabilityMap's `detail` tiers), so framing a point aims a touch above
 *  that floor so the object opens to its legible face, not its summary. */
export const READ_SCALE = 1.35;

/** Half-extent of the tight box drawn around a single object's center when we
 *  frame it. Big enough that the object + a breath of margin fill the read-zoom. */
const POINT_HALF_EXTENT = 150;

/**
 * Compute the camera pose that frames `bounds` centered in `viewport`, fitting
 * the box (plus padding) and clamping to the zoom range. Pure: deterministic in
 * its inputs, no DOM, no globals.
 *
 * `maxScale` lets a single-object frame cap at READ_SCALE (so we don't punch in
 * past legibility on a tiny box) while a region/overview frame may use the full
 * MAX so a small region still fills the viewport.
 */
export function frameBounds(
	viewport: Viewport,
	bounds: WorldBounds,
	opts: { padding?: number; maxScale?: number } = {}
): CameraPose {
	const padding = opts.padding ?? 80;
	const maxScale = Math.min(opts.maxScale ?? CAMERA_MAX_SCALE, CAMERA_MAX_SCALE);

	// Degenerate viewport (SSR / unmeasured) — return an identity-ish pose centered
	// on the bounds at scale 1 so callers never divide by zero.
	if (viewport.width <= 0 || viewport.height <= 0) {
		const cx = bounds.x + bounds.width / 2;
		const cy = bounds.y + bounds.height / 2;
		return { scale: 1, panX: -cx, panY: -cy };
	}

	const innerW = Math.max(1, viewport.width - padding * 2);
	const innerH = Math.max(1, viewport.height - padding * 2);
	const boxW = Math.max(1, bounds.width);
	const boxH = Math.max(1, bounds.height);

	const fit = Math.min(innerW / boxW, innerH / boxH);
	const scale = Math.max(CAMERA_MIN_SCALE, Math.min(maxScale, fit));

	const worldCenterX = bounds.x + bounds.width / 2;
	const worldCenterY = bounds.y + bounds.height / 2;
	const panX = viewport.width / 2 - worldCenterX * scale;
	const panY = viewport.height / 2 - worldCenterY * scale;

	return { scale, panX, panY };
}

/** A tight box around a single world point (an object's center). */
export function pointBounds(x: number, y: number, halfExtent = POINT_HALF_EXTENT): WorldBounds {
	return { x: x - halfExtent, y: y - halfExtent, width: halfExtent * 2, height: halfExtent * 2 };
}

/** A region's world-space box. */
export function regionBounds(id: RegionId): WorldBounds {
	const r = REGIONS[id];
	return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** The union of all four regions — the whole-constellation overview box. */
export function overviewBounds(): WorldBounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const id of REGION_ORDER) {
		const r = REGIONS[id];
		minX = Math.min(minX, r.x);
		minY = Math.min(minY, r.y);
		maxX = Math.max(maxX, r.x + r.width);
		maxY = Math.max(maxY, r.y + r.height);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ─── Navigable targets (the finder index + cycle order) ─────────────────────

export type CameraTargetKind = 'region' | 'overview' | 'object';

/** A flyable destination: a label to recognize it by + the bounds to frame +
 *  enough identity to focus/select it. Built from REAL objects + fixed regions. */
export interface CameraTarget {
	id: string;
	/** Recognition label (what the operator types to find it). */
	label: string;
	/** A short qualifier (region name, object kind) shown after the label. */
	sublabel: string;
	/** Group header for the palette (the region it lives in, or "Workspaces"). */
	group: string;
	kind: CameraTargetKind;
	/** World box to frame. */
	bounds: WorldBounds;
	/** Single-object frames cap at READ_SCALE so they don't over-punch. */
	maxScale: number;
	/** For an object target: the underlying constellation object (so a fly can
	 *  also focus a process, or open the object). null for region/overview. */
	object: ConstellationObject | null;
	/** For a process object: the process id, so cycle/dock can focus it. */
	processId: string | null;
	/** Extra capability vocabulary: state, cluster labels, gate ids/tasks, and sources. */
	searchTokens: string[];
	state: OperatorCapabilityState | null;
	stateLabel: string | null;
	clusterLabels: string | null;
	gateId: string | null;
	gateName: string | null;
	gateTasks: string | null;
	gateDependency: string | null;
	source: string | null;
	action: string | null;
	actionLabel: string | null;
	handoff: string | null;
	effect: string | null;
}

const REGION_GLOSS: Record<RegionId, string> = {
	STUDIO: 'Author in Studio',
	PEOPLE: 'Reachable people',
	POWER: 'Decision-makers and bills',
	RESULTS: 'Proof and response'
};

const REGION_SEARCH_TOKENS: Record<RegionId, string[]> = {
	STUDIO: [
		'Studio',
		'authoring',
		'grounded authoring',
		'message generation',
		'source grounding',
		'draft handoff'
	],
	PEOPLE: [
		'People',
		'reach',
		'supporters',
		'contacts',
		'import',
		'provenance',
		'consent',
		'verification'
	],
	POWER: [
		'Power',
		'decision-makers',
		'bills',
		'legislative monitoring',
		'accountability',
		'terrain'
	],
	RESULTS: ['Results', 'proof', 'packets', 'receipts', 'responses', 'scorecards']
};

type CapabilityTargetFields = Pick<
	CameraTarget,
	| 'searchTokens'
	| 'state'
	| 'stateLabel'
	| 'clusterLabels'
	| 'gateId'
	| 'gateName'
	| 'gateTasks'
	| 'gateDependency'
	| 'source'
	| 'action'
	| 'actionLabel'
	| 'handoff'
	| 'effect'
>;

function baseCapabilityTargetFields(searchTokens: string[] = []): CapabilityTargetFields {
	return {
		searchTokens,
		state: null,
		stateLabel: null,
		clusterLabels: null,
		gateId: null,
		gateName: null,
		gateTasks: null,
		gateDependency: null,
		source: null,
		action: null,
		actionLabel: null,
		handoff: null,
		effect: null
	};
}

function objectCapabilityTargetFields(object: ConstellationObject): CapabilityTargetFields {
	if (object.type === 'studio') {
		return baseCapabilityTargetFields([
			'Studio',
			'authoring instrument',
			'intent',
			'grounded authoring',
			'source grounding',
			'message draft'
		]);
	}

	if (object.type === 'process') {
		return baseCapabilityTargetFields([
			'Studio run',
			'authoring run',
			'process',
			object.proc.status,
			object.proc.title
		]);
	}

	const contract = constellationCapabilityContract(object);
	const clusterLabels = formatCapabilityClusters(contract.clusters);
	const stateLabel = operatorCapabilityStateLabel(contract.state);
	return {
		searchTokens: [
			contract.label,
			contract.action,
			contract.handoff,
			contract.effect,
			contract.state,
			stateLabel,
			contract.clusters,
			clusterLabels,
			contract.cite,
			contract.gate.id,
			contract.gate.name,
			contract.gate.tasks,
			contract.gate.dependency,
			contract.gate.chokepoint,
			contract.gate.semantics,
			contract.gate.clusters,
			contract.gate.source,
			...contract.gate.taskIds
		],
		state: contract.state,
		stateLabel,
		clusterLabels,
		gateId: contract.gate.id,
		gateName: contract.gate.name,
		gateTasks: contract.gate.tasks,
		gateDependency: contract.gate.dependency,
		source: contract.cite,
		action: contract.action,
		actionLabel: operatorCapabilityActionLabel(contract.state, contract.action),
		handoff: contract.handoff,
		effect: contract.effect
	};
}

/** A legible label for an object target — mirrors ConstellationNode's titling so
 *  the operator finds by the same name they read on the field. Pure. */
export function objectLabel(o: ConstellationObject): { label: string; sublabel: string } {
	switch (o.type) {
		case 'studio':
			return { label: 'Studio', sublabel: 'Authoring instrument' };
		case 'process':
			return { label: o.proc.title, sublabel: 'Process' };
		case 'campaign':
			return { label: o.campaign.title, sublabel: 'Campaign' };
		case 'funnel':
			return { label: 'People reach', sublabel: 'People' };
		case 'email-health':
			return { label: 'Email health', sublabel: 'People' };
		case 'decision-maker':
			return { label: o.dm.name, sublabel: 'Decision-maker' };
		case 'bill':
			return { label: o.bill.title, sublabel: 'Bill' };
		case 'scorecard':
			return { label: 'Engagement', sublabel: 'Scorecard' };
		case 'packet':
			return { label: o.campaignTitle ?? 'Verification packet', sublabel: 'Packet' };
	}
}

/**
 * Build the full target index: the overview, the four regions, then every real
 * constellation object. This is the capability finder's source list AND the cycle
 * order. Pure + deterministic (object order follows the composed constellation).
 */
export function buildTargets(constellation: ConstellationObject[]): CameraTarget[] {
	const targets: CameraTarget[] = [];

	// Overview first — the "zoom out to everything" anchor (Mission Control).
	targets.push({
		id: 'overview',
		label: 'Whole map',
		sublabel: 'Capability map',
		group: 'Workspaces',
		kind: 'overview',
		bounds: overviewBounds(),
		maxScale: CAMERA_MAX_SCALE,
		object: null,
		processId: null,
		...baseCapabilityTargetFields([
			'capability map',
			'state ledger',
			'coverage',
			'claim boundary',
			'gate register',
			'next moves'
		])
	});

	// The four workspaces.
	for (const id of REGION_ORDER) {
		targets.push({
			id: `region-${id}`,
			label: REGIONS[id].label,
			sublabel: REGION_GLOSS[id],
			group: 'Workspaces',
			kind: 'region',
			bounds: regionBounds(id),
			maxScale: CAMERA_MAX_SCALE,
			object: null,
			processId: null,
			...baseCapabilityTargetFields(REGION_SEARCH_TOKENS[id])
		});
	}

	// Every real object, grouped by its region.
	for (const o of constellation) {
		const { label, sublabel } = objectLabel(o);
		const capabilityFields = objectCapabilityTargetFields(o);
		targets.push({
			id: `object-${o.id}`,
			label,
			sublabel,
			group: REGIONS[o.region].label,
			kind: 'object',
			bounds: pointBounds(o.x, o.y),
			maxScale: READ_SCALE,
			object: o,
			processId: o.type === 'process' ? o.proc.id : null,
			...capabilityFields
		});
	}

	return targets;
}

/**
 * The cycle order for Tab / Shift-Tab (Cmd-Tab): running processes FIRST (what's
 * in flight leads), then the other objects, then the regions. Pure. Returns the
 * object/region targets only — overview is reachable by its own key, not by cycle.
 */
export function buildCycleOrder(targets: CameraTarget[]): CameraTarget[] {
	const processes = targets.filter((t) => t.kind === 'object' && t.processId !== null);
	const otherObjects = targets.filter((t) => t.kind === 'object' && t.processId === null);
	const regions = targets.filter((t) => t.kind === 'region');
	return [...processes, ...otherObjects, ...regions];
}

// ─── Fuzzy match (substring beats subsequence) ──────────────────────────────
// Mirrors Spotlight's scoring so the canvas palette feels identical to the org
// launcher. Pure.

export function scoreLabel(label: string, q: string): number {
	if (!q) return 1;
	const l = label.toLowerCase();
	const query = q.toLowerCase();
	if (l.includes(query)) return 2;
	let i = 0;
	for (const ch of l) {
		if (ch === query[i]) i += 1;
		if (i === query.length) return 1;
	}
	return 0;
}

export function targetSearchTokens(target: CameraTarget): string[] {
	return [
		target.label,
		target.sublabel,
		target.group,
		target.kind,
		target.state,
		target.stateLabel,
		target.clusterLabels,
		target.gateId,
		target.gateName,
		target.gateTasks,
		target.gateDependency,
		target.source,
		target.action,
		target.actionLabel,
		target.handoff,
		target.effect,
		...target.searchTokens
	].filter((token): token is string => Boolean(token?.trim()));
}

export function targetSearchText(target: CameraTarget): string {
	return targetSearchTokens(target).join(' ');
}

function scoreTarget(target: CameraTarget, query: string): number {
	return Math.max(...targetSearchTokens(target).map((token) => scoreLabel(token, query)), 0);
}

export function filterTargets(targets: CameraTarget[], query: string): CameraTarget[] {
	if (!query.trim()) return targets;
	return targets.filter((t) => scoreTarget(t, query) > 0);
}

// ─── Ease-out (the rAF lerp curve) ──────────────────────────────────────────

/** Cubic ease-out: fast departure, soft arrival. t in [0,1] → eased [0,1]. */
export function easeOutCubic(t: number): number {
	const c = Math.min(1, Math.max(0, t));
	return 1 - Math.pow(1 - c, 3);
}

/** Linear interpolate a pose by an already-eased progress. Pure. */
export function lerpPose(from: CameraPose, to: CameraPose, eased: number): CameraPose {
	return {
		scale: from.scale + (to.scale - from.scale) * eased,
		panX: from.panX + (to.panX - from.panX) * eased,
		panY: from.panY + (to.panY - from.panY) * eased
	};
}

/** Two poses are close enough that a fly would be imperceptible (skip the lerp). */
export function posesClose(a: CameraPose, b: CameraPose): boolean {
	return (
		Math.abs(a.scale - b.scale) < 0.001 &&
		Math.abs(a.panX - b.panX) < 0.5 &&
		Math.abs(a.panY - b.panY) < 0.5
	);
}
