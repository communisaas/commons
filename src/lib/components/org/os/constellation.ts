/**
 * constellation — the layout model for the org canvas field.
 *
 * The canvas is not a single authoring node any more: it is the org's WHOLE
 * working world, laid across fixed world-space REGIONS so the operator carries
 * the org's topology in their hands, not in their head. This module is the pure
 * (no-Svelte, no-DOM) layer that turns the already-loaded `OrgSpacesData` plus
 * the live process registry into a flat list of POSITIONED objects the canvas
 * renders. Keeping it pure makes it SSR-safe and unit-testable, and keeps the
 * field component focused on interaction + paint.
 *
 * REGIONS are fixed landscape (they do NOT pan as a group — the operator pans
 * the whole world across them, so their relative positions are spatial memory):
 *
 *   · STUDIO   (center)        — the STUDIO authoring node + ALL running/finished
 *                              agent processes, and the org's campaigns.
 *   · PEOPLE   (west)          — People as proof-weighted reach: the pipeline
 *                              funnel + email health.
 *   · POWER  (east)          — decision-makers, watched bills, the scorecard
 *                              average: the gravity the org aims at.
 *   · RESULTS (south of STUDIO) — Results artifacts: Verification Packet(s) +
 *                              bounded receipt/response posture.
 *
 * HONESTY RULE (carried from the OS kernel): every object here is REAL signal the
 * backend actually carries. A `null` slice (query unavailable / dormant) yields
 * NO objects for that region — the canvas renders an honest empty state. Nothing
 * is fabricated; counts are passed through verbatim.
 */

import type { OrgProcess } from './orgOS.svelte';
import type {
	OrgSpacesData,
	ReturnSpaceCampaign,
	BaseSpaceData,
	LandscapeDecisionMaker,
	LandscapeBill,
	LandscapeScorecard
} from './spaces';
import type { VerificationPacket } from '$lib/types/verification-packet';

// ─── Regions (fixed world-space) ─────────────────────────────────────────
export type RegionId = 'STUDIO' | 'PEOPLE' | 'POWER' | 'RESULTS';

export interface Region {
	id: RegionId;
	label: string;
	/** Top-left of the region's bounding zone, in world coordinates. */
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The four regions, fixed in world space. The STUDIO authoring node anchors STUDIO
 * at the origin so a fresh visitor lands centered on the instrument; the People,
 * Power, and Results territories surround it like a compass rose. Coordinates are
 * generous (objects are ~220–320px wide) so regions don't crowd at default zoom.
 */
export const REGIONS: Record<RegionId, Region> = {
	STUDIO: { id: 'STUDIO', label: 'Studio', x: -460, y: -360, width: 920, height: 760 },
	PEOPLE: { id: 'PEOPLE', label: 'People', x: -1500, y: -260, width: 720, height: 620 },
	POWER: { id: 'POWER', label: 'Power', x: 820, y: -300, width: 760, height: 760 },
	RESULTS: { id: 'RESULTS', label: 'Results', x: -560, y: 560, width: 1120, height: 520 }
};

export const REGION_ORDER: RegionId[] = ['STUDIO', 'PEOPLE', 'POWER', 'RESULTS'];

// ─── Object union ────────────────────────────────────────────────────────
// Each constellation object carries its world position, its region, the primary
// canonical route deep link (null for map-native objects like processes),
// and a typed `data` payload the renderer switches on.

export type ConstellationObject =
	| ProcessObject
	| StudioObject
	| CampaignObject
	| FunnelObject
	| EmailHealthObject
	| DecisionMakerObject
	| BillObject
	| ScorecardObject
	| PacketObject;

interface BaseObject {
	id: string;
	region: RegionId;
	/** World coordinates of the object's CENTER. */
	x: number;
	y: number;
	/** Detail handoff for write-heavy capabilities. null = map-native here. */
	detailHref: string | null;
}

export interface ProcessObject extends BaseObject {
	type: 'process';
	proc: OrgProcess;
}

/** The singular authoring instrument — Compose spawns processes here. */
export interface StudioObject extends BaseObject {
	type: 'studio';
}

export interface CampaignObject extends BaseObject {
	type: 'campaign';
	campaign: ReturnSpaceCampaign;
}

export interface FunnelObject extends BaseObject {
	type: 'funnel';
	funnel: BaseSpaceData;
}

export interface EmailHealthObject extends BaseObject {
	type: 'email-health';
	health: BaseSpaceData['emailHealth'];
}

export interface DecisionMakerObject extends BaseObject {
	type: 'decision-maker';
	dm: LandscapeDecisionMaker;
}

export interface BillObject extends BaseObject {
	type: 'bill';
	bill: LandscapeBill;
}

export interface ScorecardObject extends BaseObject {
	type: 'scorecard';
	/** The single best-engagement scorecard surfaced as POWER's gravity reading. */
	scorecard: LandscapeScorecard;
	/** How many scorecards the average is over (for honest context). */
	scorecardCount: number;
	scorecardAvg: number | null;
}

export interface PacketObject extends BaseObject {
	type: 'packet';
	packet: VerificationPacket;
	/** The campaign the packet is for (title context), if resolvable. */
	campaignTitle: string | null;
	campaignId: string | null;
}

export type DataConstellationObject = Exclude<ConstellationObject, ProcessObject | StudioObject>;

// ─── Deterministic in-region placement ───────────────────────────────────
// Objects flow into their region as a wrapped grid with fixed gutters. The
// placement is DETERMINISTIC (index-driven, never Math.random) so an object
// keeps its spot across re-renders — spatial memory depends on stability.

interface GridSlot {
	x: number;
	y: number;
}

/** A wrapped grid inside a region's inner box, leaving a margin for the label. */
function regionGrid(
	region: Region,
	count: number,
	opts: { cols: number; cellW: number; cellH: number; topPad?: number }
): GridSlot[] {
	const { cols, cellW, cellH, topPad = 96 } = opts;
	const slots: GridSlot[] = [];
	// Center the grid horizontally within the region's inner width.
	const usedW = Math.min(count, cols) * cellW;
	const startX = region.x + Math.max(48, (region.width - usedW) / 2) + cellW / 2;
	const startY = region.y + topPad + cellH / 2;
	for (let i = 0; i < count; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		slots.push({ x: startX + col * cellW, y: startY + row * cellH });
	}
	return slots;
}

// ─── Composition ─────────────────────────────────────────────────────────

export interface ComposeInput {
	spaces: OrgSpacesData | null;
	/** Full registry (running + finished) from os.processes — most recent first. */
	processes: OrgProcess[];
	/** Cap on how many of each list-type object to surface (calm over clutter). */
	limits?: Partial<{ campaigns: number; dms: number; bills: number; processes: number }>;
}

const DEFAULT_LIMITS = { campaigns: 6, dms: 8, bills: 6, processes: 6 };

/**
 * Compose the org's real objects into a positioned constellation. Pure: no DOM,
 * no Svelte, SSR-safe. Returns objects sorted region-then-placement so render
 * order is stable.
 */
export function composeConstellation(input: ComposeInput): ConstellationObject[] {
	const limits = { ...DEFAULT_LIMITS, ...(input.limits ?? {}) };
	const { spaces, processes } = input;
	const objects: ConstellationObject[] = [];

	const ret = spaces?.return ?? null;
	const base = spaces?.base ?? null;
	const land = spaces?.landscape ?? null;

	// ── STUDIO ──────────────────────────────────────────────────────────────
	// The STUDIO authoring node anchors the origin (the operator lands here).
	objects.push({
		type: 'studio',
		id: 'studio',
		region: 'STUDIO',
		x: 0,
		y: REGIONS.STUDIO.y + 64,
		detailHref: null
	});

	// All processes (running + finished) flow as a grid BELOW the studio node.
	const procs = processes.slice(0, limits.processes);
	if (procs.length > 0) {
		const slots = regionGrid(REGIONS.STUDIO, procs.length, {
			cols: 3,
			cellW: 280,
			cellH: 200,
			topPad: 220
		});
		procs.forEach((proc, i) => {
			objects.push({
				type: 'process',
				id: `proc-${proc.id}`,
				region: 'STUDIO',
				x: slots[i].x,
				y: slots[i].y,
				detailHref: null,
				proc
			});
		});
	}

	// Campaigns line the bottom band of STUDIO as living nodes (drafting/active/
	// delivered). Capped for calm; the count is honest in the empty-region tell.
	const campaigns = (ret?.campaigns ?? []).slice(0, limits.campaigns);
	if (campaigns.length > 0) {
		const baseY = REGIONS.STUDIO.y + REGIONS.STUDIO.height - 120;
		const cols = 3;
		const cellW = 280;
		const usedW = Math.min(campaigns.length, cols) * cellW;
		const startX = -usedW / 2 + cellW / 2;
		campaigns.forEach((campaign, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			objects.push({
				type: 'campaign',
				id: `campaign-${campaign.id}`,
				region: 'STUDIO',
				x: startX + col * cellW,
				y: baseY + row * 150,
				detailHref: campaign.id ? `__DETAIL__/campaigns/${campaign.id}` : null,
				campaign
			});
		});
	}

	// ── PEOPLE (west) ─────────────────────────────────────────────────────────
	if (base) {
		objects.push({
			type: 'funnel',
			id: 'people-funnel',
			region: 'PEOPLE',
			x: REGIONS.PEOPLE.x + REGIONS.PEOPLE.width / 2,
			y: REGIONS.PEOPLE.y + 200,
			detailHref: '__DETAIL__/supporters#people-ledger-boundary',
			funnel: base
		});
		objects.push({
			type: 'email-health',
			id: 'people-email-health',
			region: 'PEOPLE',
			x: REGIONS.PEOPLE.x + REGIONS.PEOPLE.width / 2,
			y: REGIONS.PEOPLE.y + 430,
			detailHref: '__DETAIL__/supporters#email-health',
			health: base.emailHealth
		});
	}

	// ── POWER (east) ────────────────────────────────────────────────────────
	if (land) {
		const dms = land.followed.slice(0, limits.dms);
		if (dms.length > 0) {
			const slots = regionGrid(REGIONS.POWER, dms.length, {
				cols: 2,
				cellW: 350,
				cellH: 130,
				topPad: 96
			});
			dms.forEach((dm, i) => {
				objects.push({
					type: 'decision-maker',
					id: `dm-${dm.id}`,
					region: 'POWER',
					x: slots[i].x,
					y: slots[i].y,
					// Deep-link to the representatives list (the follow id is not the
					// DM route id, so we never fabricate a detail URL).
					detailHref: '__DETAIL__/representatives#power-reach-boundary',
					dm
				});
			});
		}

		const bills = land.bills.slice(0, limits.bills);
		if (bills.length > 0) {
			const dmRows = Math.ceil(Math.min(dms.length, limits.dms) / 2);
			const billTop = 96 + dmRows * 130 + 40;
			const slots = regionGrid(REGIONS.POWER, bills.length, {
				cols: 2,
				cellW: 350,
				cellH: 120,
				topPad: billTop
			});
			bills.forEach((bill, i) => {
				objects.push({
					type: 'bill',
					id: `bill-${bill.id}`,
					region: 'POWER',
					x: slots[i].x,
					y: slots[i].y,
					detailHref: '__DETAIL__/legislation#bill-terrain-boundary',
					bill
				});
			});
		}

		// The scorecard reading is the POWER region's gravity summary — present
		// only when at least one real scorecard exists.
		if (land.scorecardSnapshotCount > 0) {
			const top = land.scorecards.find((scorecard) => scorecard.score !== null);
			if (top) {
				objects.push({
					type: 'scorecard',
					id: 'power-scorecard',
					region: 'POWER',
					x: REGIONS.POWER.x + REGIONS.POWER.width / 2,
					y: REGIONS.POWER.y + REGIONS.POWER.height - 70,
					detailHref: '__DETAIL__/scorecards#scorecard-list',
					scorecard: top,
					scorecardCount: land.scorecardSnapshotCount,
					scorecardAvg: land.scorecardAvg
				});
			}
		}
	}

	// ── RESULTS (south) ──────────────────────────────────────────────────────
	if (ret) {
		if (ret.packet) {
			const topCampaign = ret.campaigns.find((c) => c.id === ret.topCampaignId) ?? null;
			objects.push({
				type: 'packet',
				id: `packet-${ret.topCampaignId ?? 'top'}`,
				region: 'RESULTS',
				x: REGIONS.RESULTS.x + 300,
				y: REGIONS.RESULTS.y + 230,
				detailHref: ret.topCampaignId
					? `__DETAIL__/campaigns/${ret.topCampaignId}/report#proof-delivery`
					: null,
				packet: ret.packet,
				campaignTitle: topCampaign?.title ?? null,
				campaignId: ret.topCampaignId
			});
		}
	}

	return objects;
}

/**
 * Resolve a `__DETAIL__`-prefixed deep link against the org base route. The
 * composer emits base-relative hrefs prefixed with `__DETAIL__` so it stays
 * pure (no knowledge of the slug); the component resolves them at render.
 */
export function resolveDetailHref(href: string | null, base: string): string | null {
	if (!href) return null;
	return href.startsWith('__DETAIL__') ? base + href.slice('__DETAIL__'.length) : href;
}

/**
 * Per-region object presence — drives the honest empty-state tells. A region
 * with zero real objects (other than the always-present STUDIO node in STUDIO)
 * renders "nothing here yet" rather than a fabricated placeholder.
 */
export function regionPopulation(objects: ConstellationObject[]): Record<RegionId, number> {
	const pop: Record<RegionId, number> = { STUDIO: 0, PEOPLE: 0, POWER: 0, RESULTS: 0 };
	for (const o of objects) {
		// The STUDIO node is structural, not "content" — don't count it toward the
		// STUDIO population tell (an org with only the studio node is honestly empty).
		if (o.type === 'studio') continue;
		pop[o.region] += 1;
	}
	return pop;
}
