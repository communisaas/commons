/**
 * orgOS — the operating-system state for the org shell.
 *
 * This is not a dashboard's view-model. It is an OS kernel held in runes:
 *
 *   · activeSpace      — which of the four persistent workspaces is in focus.
 *                        Visible language is Studio / People / Power / Results;
 *                        stable internal ids stay studio / base / landscape /
 *                        return so routing state does not churn. The spaces stay
 *                        MOUNTED; switching is instant and never tears one down.
 *
 *   · process registry — running authoring agents. A Compose spawns a PROCESS
 *                        that keeps running (and streaming) while the operator
 *                        switches spaces. The registry holds each process's live
 *                        streaming state — reasoning entries, sources, decision-
 *                        makers, the composed message, and status. The menu-bar
 *                        process center reads this to surface live work; the
 *                        STUDIO space reads it to render whichever process is
 *                        focused. Multitasking is the OS tell, so it must be real.
 *                        The serializable ledger is cached device-locally so a
 *                        refresh does not erase emitted reasoning/output; active
 *                        streams are restored as detached, not as still running.
 *
 *   · signal log       — ambient org events that scroll past in the menu bar.
 *
 *   · spotlight        — the universal launcher (Cmd/Ctrl-K). Open state lives
 *                        here so any chrome can raise it.
 *
 * Idiom: this repo's runes stores are `createXState()` factories (see
 * positionState.svelte.ts). Most are module singletons, but the OS is a
 * per-shell instance (its processes belong to one mounted org session), so the
 * shell creates an instance and shares it via Svelte context. `setOrgOS` /
 * `getOrgOS` wrap that contract. The class-free factory keeps the rune
 * reactivity intact across the getter boundary.
 *
 * The HONESTY RULE carries over from STUDIO: a process only ever holds what its
 * real SSE stream emitted. Nothing here fabricates a thought, a source, or a
 * count. Faking the multitasking would defeat the entire point.
 */

import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';
import type {
	ReasoningEntry,
	ReasoningStage
} from '$lib/components/org/studio/StudioReasoning.svelte';
import type { StudioSource } from '$lib/components/org/studio/StudioSources.svelte';
import type { GeoScope } from '$lib/core/agents/types';
import type { ActiveMessageJob } from '$lib/core/agents/message-job-recovery';
import type { ResolutionStopReason, StudioProcessEvidence } from '$lib/types/studio-process';

// ─── Spaces ──────────────────────────────────────────────────────────
export type SpaceId = 'studio' | 'base' | 'landscape' | 'return';

export const SPACE_LABELS: Record<SpaceId, 'Studio' | 'People' | 'Power' | 'Results'> = {
	studio: 'Studio',
	base: 'People',
	landscape: 'Power',
	return: 'Results'
};

/** Map a deep-link pathname suffix to the space that owns it, for addressability
 * + SSR fallback. The org root, Results, is the default. */
export function spaceForPath(pathname: string, base: string): SpaceId {
	const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
	if (
		rest.startsWith('/studio') ||
		rest.startsWith('/campaigns') ||
		rest.startsWith('/emails') ||
		rest.startsWith('/sms') ||
		rest.startsWith('/events') ||
		rest.startsWith('/fundraising') ||
		rest.startsWith('/workflows') ||
		rest.startsWith('/calls')
	)
		return 'studio';
	if (rest.startsWith('/supporters')) return 'base';
	if (
		rest.startsWith('/representatives') ||
		rest.startsWith('/legislation') ||
		rest.startsWith('/scorecards')
	)
		return 'landscape';
	return 'return';
}

/** The canonical deep-link route for a space (used to update the URL on switch
 * via shallow routing, and as the SSR fallback target). */
export function pathForSpace(space: SpaceId, base: string): string {
	switch (space) {
		case 'studio':
			return `${base}/studio`;
		case 'base':
			return `${base}/supporters`;
		case 'landscape':
			return `${base}/representatives`;
		case 'return':
			return base;
	}
}

/** True when the pathname IS one of the four canonical space paths (the org
 * root, /studio, /supporters, /representatives) — i.e. a path OWNED by a mounted
 * OrgShell space. Deep routes the OS hasn't absorbed yet (/campaigns, /settings,
 * /legislation, …) are NOT space paths: those still render their own page. The
 * org root + /studio support a trailing segment-free match; deep routes under a
 * space (e.g. /supporters/import) are treated as their own pages. */
export function isSpacePath(pathname: string, base: string): boolean {
	const rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
	const normalized = rest.replace(/\/$/, '');
	return (
		normalized === '' ||
		normalized === '/studio' ||
		normalized === '/supporters' ||
		normalized === '/representatives'
	);
}

/** The explicit opt-out from space-path suppression. A canonical space path
 * normally renders its mounted space and suppresses the route page underneath;
 * `?view=full` says "render the full page at this path instead" — the
 * paginated supporter table at /supporters, the decision-maker directory at
 * /representatives. The spaces link through `fullViewHref` so the deep tools
 * they summarize stay reachable. */
export const FULL_VIEW_PARAM = 'view';
export const FULL_VIEW_VALUE = 'full';

/** Append the full-view opt-out to a canonical space path. */
export function fullViewHref(path: string): string {
	return `${path}?${FULL_VIEW_PARAM}=${FULL_VIEW_VALUE}`;
}

/** True when this URL should render the mounted OrgShell space: the pathname
 * is a canonical space path AND the URL does not carry the `?view=full`
 * opt-out. With the opt-out, the deep route page renders at the same path. */
export function rendersSpaceForUrl(
	url: { pathname: string; searchParams: URLSearchParams },
	base: string
): boolean {
	return (
		isSpacePath(url.pathname, base) && url.searchParams.get(FULL_VIEW_PARAM) !== FULL_VIEW_VALUE
	);
}

// ─── Spotlight matching ──────────────────────────────────────────────
/** Spotlight match score: a substring match beats a subsequence match;
 * 0 = no match. An empty query matches everything at the floor score. */
export function spotlightScore(text: string, query: string): number {
	if (!query) return 1;
	const t = text.toLowerCase();
	const q = query.toLowerCase();
	if (t.includes(q)) return 2;
	let i = 0;
	for (const ch of t) {
		if (ch === q[i]) i += 1;
		if (i === q.length) return 1;
	}
	return 0;
}

/** Filter to matching items and order them best match first, so Enter on the
 * top row always takes the strongest match. The sort is stable: items with
 * equal scores keep their original (grouped) order, and an empty query leaves
 * the list untouched. */
export function rankSpotlightMatches<T>(
	items: T[],
	query: string,
	searchText: (item: T) => string
): T[] {
	return items
		.map((item) => ({ item, score: spotlightScore(searchText(item), query) }))
		.filter((scored) => scored.score > 0)
		.sort((a, b) => b.score - a.score)
		.map((scored) => scored.item);
}

// ─── Processes ───────────────────────────────────────────────────────
export type ProcessStatus =
	| 'resolving' // RESOLVE stage running (decision-maker tool loop)
	| 'grounding' // GROUND stage running (source discovery)
	| 'authoring' // AUTHOR stage running (message composition)
	| 'composed' // finished — a message exists
	| 'error' // failed
	| 'stopped'; // operator-aborted

export interface AuthoringIntent {
	subjectLine: string;
	coreMessage: string;
	audienceGuidance: string;
}

export interface ResolvedDecisionMaker {
	name: string;
	title: string;
	organization: string;
	email?: string;
}

export type GeographicScopeSource =
	| 'pending'
	| 'resolved-targets'
	| 'audience-guidance'
	| 'fallback';

export interface OrgProcess {
	id: string;
	/** A short title for the process — the intent's subject line, truncated. */
	title: string;
	intent: AuthoringIntent;
	status: ProcessStatus;
	/** Which loop stage is currently producing reasoning (drives the live pulse). */
	activeStage: ReasoningStage | null;
	stageLabel: string;
	/** The full, ordered reasoning trace. Real streamed entries only. */
	entries: ReasoningEntry[];
	decisionMakers: ResolvedDecisionMaker[];
	droppedEmailless: number;
	resolutionStopReason: ResolutionStopReason | null;
	resolutionStopDetail: string | null;
	/** Scope actually sent into source discovery/message generation. */
	geographicScope: GeoScope | null;
	geographicScopeLabel: string;
	geographicScopeBasis: string;
	geographicScopeSource: GeographicScopeSource;
	sourceEvidenceObserved: boolean;
	sourceEvidenceCount: number;
	sourceEvidenceEvaluatedCount: number;
	sourceEvidenceSearchOnlyCount: number;
	sourceEvidenceMode: 'discovery' | 'preverified' | null;
	sourceEvidenceEvaluationFallback: boolean;
	sourceEvidenceCandidateCount: number | null;
	sourceEvidenceFailedCount: number | null;
	sourceEvidenceSearchQueryCount: number | null;
	sources: StudioSource[];
	composedMessage: string;
	/** Recoverable message-generation handle for this device-local OS process. */
	activeMessageJob: ActiveMessageJob | null;
	/** True when this record was restored from the device-local Studio ledger. */
	restoredFromDevice: boolean;
	errorMessage: string | null;
	startedAt: number;
	endedAt: number | null;
	/** The AbortController so a process can be stopped from anywhere. Not reactive. */
	abort: AbortController | null;
}

const RUNNING_STATUSES: ProcessStatus[] = ['resolving', 'grounding', 'authoring'];
const PROCESS_STATUSES: ProcessStatus[] = [
	'resolving',
	'grounding',
	'authoring',
	'composed',
	'error',
	'stopped'
];
const RESOLUTION_STOP_REASONS: ResolutionStopReason[] = [
	'no-target',
	'no-public-email',
	'stopped',
	'unknown'
];
const STUDIO_PROCESS_STORAGE_VERSION = 1;
const STUDIO_PROCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STUDIO_PROCESS_STORAGE_LIMIT = 12;

type StoredOrgProcess = Omit<OrgProcess, 'abort' | 'restoredFromDevice'>;
type StoredProcessRegistry = {
	version: typeof STUDIO_PROCESS_STORAGE_VERSION;
	savedAt: number;
	focusedProcessId: string | null;
	processes: StoredOrgProcess[];
};

export function isRunning(p: OrgProcess): boolean {
	return RUNNING_STATUSES.includes(p.status);
}

function studioProcessStorageKey(base: string): string {
	return `commons_org_os_processes:${base || 'unknown'}`;
}

function toStoredProcess(proc: OrgProcess): StoredOrgProcess {
	return {
		id: proc.id,
		title: proc.title,
		intent: { ...proc.intent },
		status: proc.status,
		activeStage: proc.activeStage,
		stageLabel: proc.stageLabel,
		entries: proc.entries.map((entry) => ({ ...entry })),
		decisionMakers: proc.decisionMakers.map((dm) => ({ ...dm })),
		droppedEmailless: proc.droppedEmailless,
		resolutionStopReason: proc.resolutionStopReason,
		resolutionStopDetail: proc.resolutionStopDetail,
		geographicScope: proc.geographicScope ? ({ ...proc.geographicScope } as GeoScope) : null,
		geographicScopeLabel: proc.geographicScopeLabel,
		geographicScopeBasis: proc.geographicScopeBasis,
		geographicScopeSource: proc.geographicScopeSource,
		sourceEvidenceObserved: proc.sourceEvidenceObserved,
		sourceEvidenceCount: proc.sourceEvidenceCount,
		sourceEvidenceEvaluatedCount: proc.sourceEvidenceEvaluatedCount,
		sourceEvidenceSearchOnlyCount: proc.sourceEvidenceSearchOnlyCount,
		sourceEvidenceMode: proc.sourceEvidenceMode,
		sourceEvidenceEvaluationFallback: proc.sourceEvidenceEvaluationFallback,
		sourceEvidenceCandidateCount: proc.sourceEvidenceCandidateCount,
		sourceEvidenceFailedCount: proc.sourceEvidenceFailedCount,
		sourceEvidenceSearchQueryCount: proc.sourceEvidenceSearchQueryCount,
		sources: proc.sources.map((source) => ({ ...source })),
		composedMessage: proc.composedMessage,
		activeMessageJob: proc.activeMessageJob ? { ...proc.activeMessageJob } : null,
		errorMessage: proc.errorMessage,
		startedAt: proc.startedAt,
		endedAt: proc.endedAt
	};
}

function asProcessStatus(value: unknown): ProcessStatus {
	return PROCESS_STATUSES.includes(value as ProcessStatus) ? (value as ProcessStatus) : 'stopped';
}

function asResolutionStopReason(value: unknown): ResolutionStopReason | null {
	return RESOLUTION_STOP_REASONS.includes(value as ResolutionStopReason)
		? (value as ResolutionStopReason)
		: null;
}

function restoreProcess(raw: Partial<StoredOrgProcess>, restoredAt: number): OrgProcess | null {
	if (!raw || typeof raw !== 'object') return null;
	if (typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
	if (!raw.intent || typeof raw.intent.subjectLine !== 'string') return null;

	const rawStatus = asProcessStatus(raw.status);
	const wasRunning = RUNNING_STATUSES.includes(rawStatus);
	const status: ProcessStatus = wasRunning
		? raw.composedMessage
			? 'composed'
			: 'stopped'
		: rawStatus;

	return {
		id: raw.id,
		title: raw.title,
		intent: {
			subjectLine: raw.intent.subjectLine,
			coreMessage: raw.intent.coreMessage ?? '',
			audienceGuidance: raw.intent.audienceGuidance ?? ''
		},
		status,
		activeStage: wasRunning ? null : (raw.activeStage ?? null),
		stageLabel: wasRunning ? '' : (raw.stageLabel ?? ''),
		entries: Array.isArray(raw.entries) ? (raw.entries as ReasoningEntry[]) : [],
		decisionMakers: Array.isArray(raw.decisionMakers)
			? (raw.decisionMakers as ResolvedDecisionMaker[])
			: [],
		droppedEmailless: Number.isFinite(raw.droppedEmailless) ? Number(raw.droppedEmailless) : 0,
		resolutionStopReason:
			wasRunning && !raw.composedMessage
				? 'stopped'
				: asResolutionStopReason(raw.resolutionStopReason),
		resolutionStopDetail:
			wasRunning && !raw.composedMessage
				? (raw.resolutionStopDetail ??
					'Restored after page refresh; live resolution stream is no longer attached.')
				: (raw.resolutionStopDetail ?? null),
		geographicScope: raw.geographicScope ?? null,
		geographicScopeLabel: raw.geographicScopeLabel ?? 'Not resolved',
		geographicScopeBasis:
			raw.geographicScopeBasis ?? 'Restored local process record has no scope basis.',
		geographicScopeSource: raw.geographicScopeSource ?? 'pending',
		sourceEvidenceObserved: raw.sourceEvidenceObserved ?? false,
		sourceEvidenceCount: Number.isFinite(raw.sourceEvidenceCount)
			? Number(raw.sourceEvidenceCount)
			: 0,
		sourceEvidenceEvaluatedCount: Number.isFinite(raw.sourceEvidenceEvaluatedCount)
			? Number(raw.sourceEvidenceEvaluatedCount)
			: 0,
		sourceEvidenceSearchOnlyCount: Number.isFinite(raw.sourceEvidenceSearchOnlyCount)
			? Number(raw.sourceEvidenceSearchOnlyCount)
			: 0,
		sourceEvidenceMode:
			raw.sourceEvidenceMode === 'discovery' || raw.sourceEvidenceMode === 'preverified'
				? raw.sourceEvidenceMode
				: null,
		sourceEvidenceEvaluationFallback: raw.sourceEvidenceEvaluationFallback ?? false,
		sourceEvidenceCandidateCount: Number.isFinite(raw.sourceEvidenceCandidateCount)
			? Number(raw.sourceEvidenceCandidateCount)
			: null,
		sourceEvidenceFailedCount: Number.isFinite(raw.sourceEvidenceFailedCount)
			? Number(raw.sourceEvidenceFailedCount)
			: null,
		sourceEvidenceSearchQueryCount: Number.isFinite(raw.sourceEvidenceSearchQueryCount)
			? Number(raw.sourceEvidenceSearchQueryCount)
			: null,
		sources: Array.isArray(raw.sources) ? (raw.sources as StudioSource[]) : [],
		composedMessage: raw.composedMessage ?? '',
		activeMessageJob: raw.activeMessageJob ?? null,
		restoredFromDevice: true,
		errorMessage:
			wasRunning && !raw.composedMessage
				? (raw.errorMessage ?? 'Restored after page refresh; live stream is no longer attached.')
				: (raw.errorMessage ?? null),
		startedAt: Number.isFinite(raw.startedAt) ? Number(raw.startedAt) : restoredAt,
		endedAt:
			raw.endedAt !== null && raw.endedAt !== undefined
				? Number(raw.endedAt)
				: wasRunning
					? restoredAt
					: null,
		abort: null
	};
}

function loadStoredProcessRegistry(base: string): {
	processes: OrgProcess[];
	focusedProcessId: string | null;
} {
	if (!browser) return { processes: [], focusedProcessId: null };
	const key = studioProcessStorageKey(base);
	try {
		const stored = localStorage.getItem(key);
		if (!stored) return { processes: [], focusedProcessId: null };
		const parsed = JSON.parse(stored) as Partial<StoredProcessRegistry>;
		if (
			parsed.version !== STUDIO_PROCESS_STORAGE_VERSION ||
			!parsed.savedAt ||
			Date.now() - parsed.savedAt > STUDIO_PROCESS_TTL_MS ||
			!Array.isArray(parsed.processes)
		) {
			localStorage.removeItem(key);
			return { processes: [], focusedProcessId: null };
		}

		const restored = parsed.processes
			.slice(0, STUDIO_PROCESS_STORAGE_LIMIT)
			.map((process) => restoreProcess(process, Date.now()))
			.filter((process): process is OrgProcess => process !== null);
		const focusedProcessId =
			restored.find((process) => process.id === parsed.focusedProcessId)?.id ??
			restored[0]?.id ??
			null;
		return { processes: restored, focusedProcessId };
	} catch {
		localStorage.removeItem(key);
		return { processes: [], focusedProcessId: null };
	}
}

function saveStoredProcessRegistry(
	base: string,
	processes: OrgProcess[],
	focusedProcessId: string | null
): void {
	if (!browser) return;
	const key = studioProcessStorageKey(base);
	try {
		if (processes.length === 0) {
			localStorage.removeItem(key);
			return;
		}
		const limited = processes.slice(0, STUDIO_PROCESS_STORAGE_LIMIT);
		const registry: StoredProcessRegistry = {
			version: STUDIO_PROCESS_STORAGE_VERSION,
			savedAt: Date.now(),
			focusedProcessId: limited.some((process) => process.id === focusedProcessId)
				? focusedProcessId
				: (limited[0]?.id ?? null),
			processes: limited.map(toStoredProcess)
		};
		localStorage.setItem(key, JSON.stringify(registry));
	} catch {
		// Device-local persistence is opportunistic. The live OS registry remains authoritative.
	}
}

function paragraphCount(message: string): number {
	return message.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).length;
}

function evaluatedSourceCount(sources: StudioSource[]): number {
	return sources.filter(
		(source) =>
			!source.credibility_rationale?.startsWith('Evaluation unavailable') &&
			Boolean(source.incentive_position)
	).length;
}

// ─── Signal log ──────────────────────────────────────────────────────
export interface OrgSignalEvent {
	id: string;
	event: string;
	emittedAt: number;
}

// ─── The store ───────────────────────────────────────────────────────
function createOrgOS(initialSpace: SpaceId = 'return', base = '') {
	let activeSpace = $state<SpaceId>(initialSpace);
	let baseRoute = $state(base);
	const restoredRegistry = loadStoredProcessRegistry(base);

	// Process registry. An array (not a map) so ordering is stable and the rune
	// tracks structural mutation; processes are replaced (not deep-patched) so
	// downstream $derived recomputes cleanly.
	let processes = $state<OrgProcess[]>(restoredRegistry.processes);
	let focusedProcessId = $state<string | null>(restoredRegistry.focusedProcessId);

	// Ambient org events. Newest first, capped so the menu bar log stays light.
	let signal = $state<OrgSignalEvent[]>([]);

	let spotlightOpen = $state(false);

	let counter = 0;
	function nextId(prefix: string): string {
		counter += 1;
		return `${prefix}-${Date.now().toString(36)}-${counter}`;
	}

	function patch(id: string, mut: (p: OrgProcess) => void): void {
		const idx = processes.findIndex((p) => p.id === id);
		if (idx === -1) return;
		const next = { ...processes[idx] };
		mut(next);
		processes = [...processes.slice(0, idx), next, ...processes.slice(idx + 1)];
		persistProcesses();
	}

	function persistProcesses(): void {
		saveStoredProcessRegistry(baseRoute, processes, focusedProcessId);
	}

	return {
		// ── Spaces ──
		get activeSpace() {
			return activeSpace;
		},
		get base() {
			return baseRoute;
		},
		setBase(b: string) {
			baseRoute = b;
			persistProcesses();
		},
		/** Switch the focused space. Does NOT navigate — the caller updates the URL
		 * via shallow routing for addressability. Instant + stateful: every space
		 * stays mounted, so its in-flight state survives the switch. */
		switchSpace(space: SpaceId): void {
			activeSpace = space;
		},

		// ── Processes ──
		get processes() {
			return processes;
		},
		get runningProcesses() {
			return processes.filter(isRunning);
		},
		get focusedProcessId() {
			return focusedProcessId;
		},
		get focusedProcess(): OrgProcess | null {
			return processes.find((p) => p.id === focusedProcessId) ?? null;
		},
		get studioProcessEvidence(): StudioProcessEvidence {
			const focused = processes.find((p) => p.id === focusedProcessId) ?? null;
			const sourceEvidenceObserved = Boolean(focused?.sourceEvidenceObserved);
			const evaluatedSourcesFromRows = focused ? evaluatedSourceCount(focused.sources) : 0;
			const evaluatedSources = focused
				? sourceEvidenceObserved
					? focused.sourceEvidenceEvaluatedCount
					: evaluatedSourcesFromRows
				: 0;
			const searchOnlySources = focused
				? sourceEvidenceObserved
					? focused.sourceEvidenceSearchOnlyCount
					: focused.sources.length - evaluatedSourcesFromRows
				: 0;
			return {
				processCount: processes.length,
				runningCount: processes.filter(isRunning).length,
				restoredCount: processes.filter((process) => process.restoredFromDevice).length,
				focusedStatus: focused?.status ?? null,
				contactableTargetCount: focused?.decisionMakers.length ?? 0,
				droppedTargetCount: focused?.droppedEmailless ?? 0,
				resolutionStopReason: focused?.resolutionStopReason ?? null,
				resolutionStopDetail: focused?.resolutionStopDetail ?? null,
				sourceEvidenceObserved,
				sourceEvidenceCount: focused
					? sourceEvidenceObserved
						? focused.sourceEvidenceCount
						: focused.sources.length
					: 0,
				sourceEvidenceMode: focused?.sourceEvidenceMode ?? null,
				sourceEvidenceEvaluationFallback: focused?.sourceEvidenceEvaluationFallback ?? false,
				sourceEvidenceCandidateCount: focused?.sourceEvidenceCandidateCount ?? null,
				sourceEvidenceFailedCount: focused?.sourceEvidenceFailedCount ?? null,
				sourceEvidenceSearchQueryCount: focused?.sourceEvidenceSearchQueryCount ?? null,
				evaluatedSourceCount: evaluatedSources,
				searchOnlySourceCount: searchOnlySources,
				messageParagraphCount: focused?.composedMessage
					? paragraphCount(focused.composedMessage)
					: 0,
				draftHandoffCount: focused?.composedMessage ? 2 : 0,
				hasComposedMessage: Boolean(focused?.composedMessage),
				hasRecoveryJob: Boolean(focused?.activeMessageJob),
				recoveryJobStatus: focused?.activeMessageJob?.status ?? null,
				hasTraceHandle: Boolean(focused?.activeMessageJob?.traceId),
				scopeLabel: focused?.geographicScopeLabel ?? null,
				scopeSource: focused?.geographicScopeSource ?? null
			};
		},
		focusProcess(id: string | null): void {
			focusedProcessId = id;
			persistProcesses();
		},

		/** Spawn a process record for an authoring run. The runner (see
		 * authoring-process.ts) drives it; this only registers it and focuses it. */
		spawnProcess(intent: AuthoringIntent): OrgProcess {
			const id = nextId('proc');
			const rawTitle = intent.subjectLine.trim() || 'Untitled action';
			const proc: OrgProcess = {
				id,
				title: rawTitle.length > 42 ? rawTitle.slice(0, 41) + '…' : rawTitle,
				intent,
				status: 'resolving',
				activeStage: 'resolve',
				stageLabel: 'Resolve',
				entries: [],
				decisionMakers: [],
				droppedEmailless: 0,
				resolutionStopReason: null,
				resolutionStopDetail: null,
				geographicScope: null,
				geographicScopeLabel: 'Not resolved',
				geographicScopeBasis: 'Message scope resolves after contactable decision-makers are known.',
				geographicScopeSource: 'pending',
				sourceEvidenceObserved: false,
				sourceEvidenceCount: 0,
				sourceEvidenceEvaluatedCount: 0,
				sourceEvidenceSearchOnlyCount: 0,
				sourceEvidenceMode: null,
				sourceEvidenceEvaluationFallback: false,
				sourceEvidenceCandidateCount: null,
				sourceEvidenceFailedCount: null,
				sourceEvidenceSearchQueryCount: null,
				sources: [],
				composedMessage: '',
				activeMessageJob: null,
				restoredFromDevice: false,
				errorMessage: null,
				startedAt: Date.now(),
				endedAt: null,
				abort: new AbortController()
			};
			processes = [proc, ...processes];
			focusedProcessId = id;
			persistProcesses();
			return proc;
		},

		/** Mutate a process by id. The runner uses these to stream live state in. */
		updateProcess(id: string, mut: (p: OrgProcess) => void): void {
			patch(id, mut);
		},
		pushEntry(id: string, entry: ReasoningEntry): void {
			patch(id, (p) => {
				p.entries = [...p.entries, entry];
			});
		},
		pushThought(id: string, stage: ReasoningStage, content: string): void {
			patch(id, (p) => {
				p.entries = [...p.entries, { kind: 'thought', stage, content, ts: Date.now() }];
			});
		},
		pushAction(
			id: string,
			stage: ReasoningStage,
			action: string,
			title: string,
			status: 'in_progress' | 'complete' | 'error',
			statusMessage?: string
		): void {
			patch(id, (p) => {
				p.entries = [
					...p.entries,
					{ kind: 'action', stage, action, title, status, statusMessage, ts: Date.now() }
				];
			});
		},
		setStage(id: string, activeStage: ReasoningStage | null, stageLabel: string): void {
			patch(id, (p) => {
				p.activeStage = activeStage;
				p.stageLabel = stageLabel;
			});
		},
		setStatus(id: string, status: ProcessStatus): void {
			patch(id, (p) => {
				p.status = status;
				if (!RUNNING_STATUSES.includes(status)) {
					p.activeStage = null;
					p.stageLabel = '';
					if (p.endedAt === null) p.endedAt = Date.now();
				}
			});
		},
		/** Abort a running process. Idempotent. */
		stopProcess(id: string): void {
			const p = processes.find((x) => x.id === id);
			if (!p) return;
			p.abort?.abort();
			patch(id, (x) => {
				if (RUNNING_STATUSES.includes(x.status)) {
					x.status = x.composedMessage ? 'composed' : 'stopped';
					x.activeStage = null;
					x.stageLabel = '';
					if (!x.composedMessage && x.decisionMakers.length === 0) {
						x.resolutionStopReason = 'stopped';
						x.resolutionStopDetail = 'The operator stopped this loop before it emitted output.';
					}
					if (x.endedAt === null) x.endedAt = Date.now();
				}
			});
		},
		/** Drop a finished/failed process from the registry (clears the menu chip). */
		dismissProcess(id: string): void {
			const p = processes.find((x) => x.id === id);
			if (p && isRunning(p)) p.abort?.abort();
			processes = processes.filter((x) => x.id !== id);
			if (focusedProcessId === id) {
				focusedProcessId = processes[0]?.id ?? null;
			}
			persistProcesses();
		},

		// ── Signal log ──
		get signal() {
			return signal;
		},
		emitSignal(event: string): void {
			signal = [{ id: nextId('sig'), event, emittedAt: Date.now() }, ...signal].slice(0, 40);
		},

		// ── Spotlight ──
		get spotlightOpen() {
			return spotlightOpen;
		},
		openSpotlight(): void {
			spotlightOpen = true;
		},
		closeSpotlight(): void {
			spotlightOpen = false;
		},
		toggleSpotlight(): void {
			spotlightOpen = !spotlightOpen;
		}
	};
}

export type OrgOS = ReturnType<typeof createOrgOS>;

const ORG_OS_KEY = Symbol('orgOS');

/** Create the OS instance and publish it on context. Call once, in the shell. */
export function setOrgOS(initialSpace: SpaceId, base: string): OrgOS {
	const os = createOrgOS(initialSpace, base);
	setContext(ORG_OS_KEY, os);
	return os;
}

/** Read the shell's OS instance. Spaces + chrome call this. */
export function getOrgOS(): OrgOS {
	const os = getContext<OrgOS>(ORG_OS_KEY);
	if (!os) throw new Error('getOrgOS() called outside an OrgShell — no OS on context.');
	return os;
}
