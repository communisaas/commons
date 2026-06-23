/**
 * Web Share helper shared by every share surface (recipient page, success modal,
 * ShareButton). One source of truth for two things the surfaces kept getting
 * subtly wrong on their own:
 *
 *  1. Single-URL payload — the recruiting `text` already embeds the action link,
 *     so NO `url` field is set. Passing both duplicates the URL in the share sheet.
 *  2. One consistent capability check — older browsers expose `share()` without
 *     `canShare()`, so treat a missing `canShare` as "shareable" rather than
 *     silently skipping the native sheet.
 *
 * Returns a status the caller maps to its own UI; an AbortError (user cancelled
 * the sheet) is reported as 'dismissed' so callers never silently copy behind the
 * user's back.
 */
export type NativeShareResult = 'shared' | 'dismissed' | 'unavailable';

export async function tryNativeShare(opts: {
	title?: string;
	/** Must already embed the action URL — it is the sole carrier of the link. */
	text: string;
}): Promise<NativeShareResult> {
	if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
		return 'unavailable';
	}
	const payload: ShareData = opts.title ? { title: opts.title, text: opts.text } : { text: opts.text };
	if (typeof navigator.canShare === 'function' && !navigator.canShare(payload)) {
		return 'unavailable';
	}
	try {
		await navigator.share(payload);
		return 'shared';
	} catch (err) {
		if (err instanceof Error && err.name === 'AbortError') return 'dismissed';
		return 'unavailable';
	}
}
