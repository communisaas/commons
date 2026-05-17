<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const message = $derived($page.error?.message ?? '');
	const pathname = $derived($page.url?.pathname ?? '');
	const eventId = $derived($page.error?.eventId);

	// Format the Sentry event ID into a short, copy-friendly reference:
	// first 12 hex chars in three 4-char groups (e.g. "7af9-b3c2-5e81").
	// Sentry's dashboard search resolves on prefix, so the short form is
	// unambiguous and easier to read aloud / paste into a support email.
	const referenceCode = $derived.by(() => {
		if (!eventId || typeof eventId !== 'string') return null;
		const head = eventId.slice(0, 12);
		if (head.length < 12) return null;
		return `${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}`;
	});

	let copied = $state(false);
	async function copyReference() {
		if (!referenceCode) return;
		try {
			await navigator.clipboard.writeText(referenceCode);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Clipboard API can fail (HTTPS-only, permissions). The reference
			// is still visible; user can copy manually.
		}
	}

	// Record-vocabulary is earned on routes that participate in the
	// public-record / proof / accountability surface — users have been
	// onboarded into the term through interactive UI. Everywhere else
	// (typo URLs, broken homepage, unknown routes) the visitor has not
	// earned the vocabulary and we speak plainly.
	const RECORD_PREFIXES = ['/v/', '/n/', '/d/', '/accountability/', '/verify/'];
	const isRecordContext = $derived(RECORD_PREFIXES.some((p) => pathname.startsWith(p)));

	const headline = $derived.by(() => {
		if (isRecordContext) {
			if (status === 404) return 'No record at this link';
			if (status === 403) return 'Not yours to read';
			if (status === 410) return 'Record withdrawn';
			if (status >= 500) return 'The record is temporarily unreachable';
			return 'Request did not resolve';
		}
		if (status === 404) return "We couldn't find that page";
		if (status === 403) return "You don't have access to this page";
		if (status === 410) return 'This was removed';
		if (status >= 500) return 'Something went wrong on our end';
		return "That didn't work";
	});

	const explanation = $derived.by(() => {
		if (isRecordContext) {
			if (status === 404)
				return message || 'The path you followed points to nothing in the public record.';
			if (status === 403)
				return message || 'This record exists but is not visible from your session.';
			if (status === 410) return message || 'A record once stood here. It has been withdrawn.';
			if (status >= 500)
				return 'The system that holds this record is unavailable. Try again in a moment.';
			return message || 'The request returned a status the page does not handle.';
		}
		if (status === 404)
			return 'The page you were looking for may have moved, been removed, or the link is mistyped.';
		if (status === 403)
			return 'You may need to sign in, or this page belongs to someone else.';
		if (status === 410) return 'The page that used to be here was taken down.';
		if (status >= 500) return "We're having trouble right now. Try again in a moment.";
		return message || 'The request returned a status the page does not handle.';
	});

	// Action ordering reflects what's likely to help. For 5xx the page might
	// load on retry (transient). For 404/403/410 retry is pointless — go home
	// is the primary move.
	const showRetry = $derived(status >= 500);

	function reload() {
		if (typeof window !== 'undefined') window.location.reload();
	}
</script>

<svelte:head>
	<title>{status} · {headline}</title>
</svelte:head>

<div class="mx-auto max-w-xl px-6 py-24">
	<h1 class="text-3xl font-semibold text-slate-900">{headline}</h1>
	<p class="mt-3 text-base leading-relaxed text-slate-600">{explanation}</p>

	<div class="mt-10 flex flex-wrap gap-3">
		{#if showRetry}
			<button
				type="button"
				onclick={reload}
				class="inline-flex items-center rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
			>
				Try again
			</button>
			<a
				href="/"
				class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
			>
				Go to homepage
			</a>
		{:else}
			<a
				href="/"
				class="inline-flex items-center rounded-lg border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
			>
				Go to homepage
			</a>
		{/if}
	</div>

	<!-- Subtle technical footer. Status + path in mono so a user who
	     screenshots this page for support gives us something legible,
	     without making the protocol-level detail the most prominent thing
	     on the page. Reference code is the user↔support bridge: paste it
	     to us and we resolve to the full trace in Sentry. -->
	{#if pathname}
		<div class="mt-12 space-y-2 font-mono text-xs text-slate-400">
			<p>Status {status} · {pathname}</p>
			{#if referenceCode}
				<p class="flex items-center gap-2">
					<span>Reference: <span class="text-slate-600">{referenceCode}</span></span>
					<button
						type="button"
						onclick={copyReference}
						class="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
						aria-label="Copy reference code"
					>
						{copied ? 'Copied' : 'Copy'}
					</button>
				</p>
				<p class="text-slate-400">
					If this keeps happening, email <a
						href="mailto:hello@commons.email?subject=Error%20{status}%20-%20{referenceCode}"
						class="underline decoration-dotted underline-offset-2 hover:text-slate-600"
						>hello@commons.email</a
					> with that reference.
				</p>
			{/if}
		</div>
	{/if}
</div>
