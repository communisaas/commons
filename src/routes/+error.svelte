<script lang="ts">
	import { page } from '$app/stores';

	const status = $derived($page.status);
	const message = $derived($page.error?.message ?? '');

	const headline = $derived.by(() => {
		if (status === 404) return 'No record at this address';
		if (status === 403) return 'Not yours to read';
		if (status === 410) return 'Record withdrawn';
		if (status >= 500) return 'Substrate not responding';
		return 'Request did not resolve';
	});

	const explanation = $derived.by(() => {
		if (status === 404) {
			return message || 'The path you followed points to nothing in the public record.';
		}
		if (status === 403) {
			return message || 'This record exists but is not visible from your session.';
		}
		if (status === 410) {
			return message || 'A record once stood here. It has been withdrawn.';
		}
		if (status >= 500) {
			return 'The system that holds the record is unavailable. Try again shortly.';
		}
		return message || 'The request returned a status the page does not handle.';
	});
</script>

<svelte:head>
	<title>{status} · {headline}</title>
</svelte:head>

<div class="mx-auto max-w-xl px-6 py-24">
	<p class="font-mono text-xs uppercase tracking-wider text-slate-500">
		HTTP {status}
	</p>
	<h1 class="mt-3 text-3xl font-semibold text-slate-900">{headline}</h1>
	<p class="mt-3 text-base text-slate-600">{explanation}</p>

	{#if $page.url?.pathname}
		<p class="mt-8 font-mono text-xs text-slate-500 break-all">
			Path: {$page.url.pathname}
		</p>
	{/if}

	<div class="mt-10 flex flex-wrap gap-3">
		<a
			href="/"
			class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
		>
			Return to the index
		</a>
	</div>
</div>
