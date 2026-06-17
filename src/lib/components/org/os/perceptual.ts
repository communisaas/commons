/**
 * Pure perceptual helpers for the org OS (D1). Extracted from the kernel/shell
 * so the merge + direction logic is unit-testable without a Svelte context
 * (matches the existing `spaceForPath`/`spotlightScore` exported-helper idiom).
 */
import type { SpaceId } from './orgOS.svelte';

export interface SignalLike {
	id: string;
	event: string;
	emittedAt: number;
}

export interface MergedSignalRow extends SignalLike {
	/** Discriminates rendering: 'kernel' rows are verbatim sentences (no relabel);
	 *  'server' rows are dotted event-keys run through eventLabel(). Load-bearing. */
	source: 'server' | 'kernel';
}

export interface MergedSignal {
	rows: MergedSignalRow[];
	/**
	 * Honest union count, or null ('unread') ONLY when the server slice failed to
	 * load AND there are no live kernel events. Never a fabricated server read.
	 */
	count: number | null;
}

/**
 * Merge the durable server snapshot with the live kernel signal — newest-first,
 * neither source clobbering the other. The two streams are different kinds of
 * truth: `server` is durable/reload-surviving but stale-as-of-page-load; `kernel`
 * is live-this-session but ephemeral. Kernel ids (`sig-*`) and server ids (Convex
 * doc ids) never collide, so no dedupe is needed and the keyed render is safe.
 *
 * `cap` bounds the RENDERED rows (the kernel self-caps at 40); `count` still
 * reflects the true union so the badge never hides activity beyond the window.
 */
export function mergeSignal(
	serverEvents: SignalLike[] | null,
	kernelEvents: SignalLike[],
	cap = 12
): MergedSignal {
	const kernelRows: MergedSignalRow[] = kernelEvents.map((e) => ({ ...e, source: 'kernel' }));
	const serverRows: MergedSignalRow[] = (serverEvents ?? []).map((e) => ({ ...e, source: 'server' }));
	const rows = [...kernelRows, ...serverRows]
		.sort((a, b) => b.emittedAt - a.emittedAt)
		.slice(0, cap);

	// HONESTY (repo HONESTY RULE): server null = "didn't load". Kernel events are
	// always real, so when server is null show the live kernel count (never mask a
	// failed server load as a successful read); when server is null AND no kernel,
	// stay 'unread' (null). Otherwise the true union.
	const count =
		serverEvents === null
			? kernelEvents.length > 0
				? kernelEvents.length
				: null
			: serverEvents.length + kernelEvents.length;

	return { rows, count };
}

/** Canonical switcher order — drives the directional translate on a space switch. */
export const SPACE_ORDER: readonly SpaceId[] = ['studio', 'base', 'landscape', 'return'];

/**
 * Directional sign for a space switch: +1 moving rightward in the switcher order,
 * −1 leftward, 0 when unknown/same. Feeds the cross-fade's small lateral translate.
 */
export function spaceSwitchDirection(prev: SpaceId | null, next: SpaceId): -1 | 0 | 1 {
	if (!prev || prev === next) return 0;
	const p = SPACE_ORDER.indexOf(prev);
	const n = SPACE_ORDER.indexOf(next);
	if (p < 0 || n < 0) return 0;
	return n > p ? 1 : -1;
}
