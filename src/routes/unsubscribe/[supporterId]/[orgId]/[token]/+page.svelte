<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Unsubscribe | commons.email</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
	<div class="max-w-md w-full text-center space-y-4">
		{#if form?.done}
			<div class="rounded-md border border-teal-500/20 bg-teal-500/5 p-8">
				<svg class="w-12 h-12 mx-auto text-teal-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<h1 class="text-lg font-semibold text-zinc-100">Unsubscribed</h1>
				<p class="text-sm text-zinc-400 mt-2">You will no longer receive emails from this organization.</p>
			</div>
		{:else if form?.error}
			<div class="rounded-md border border-red-500/20 bg-red-500/5 p-8">
				<h1 class="text-lg font-semibold text-zinc-100">Error</h1>
				<p class="text-sm text-zinc-400 mt-2">{form.error}</p>
			</div>
		{:else if data.status === 'already'}
			<div class="rounded-md border border-zinc-700/50 bg-zinc-900/50 p-8">
				<h1 class="text-lg font-semibold text-zinc-100">Already Unsubscribed</h1>
				<p class="text-sm text-zinc-400 mt-2">You were already unsubscribed from this list.</p>
			</div>
		{:else if data.status === 'confirm'}
			<div class="rounded-md border border-zinc-700/50 bg-zinc-900/50 p-8 space-y-4">
				<h1 class="text-lg font-semibold text-zinc-100">Unsubscribe</h1>
				<p class="text-sm text-zinc-400">Click below to unsubscribe from future emails.</p>
				<form method="POST" use:enhance>
					<button
						type="submit"
						class="rounded-lg bg-zinc-700 px-6 py-2.5 text-sm font-medium text-zinc-100 hover:bg-zinc-600 transition-colors"
					>
						Confirm Unsubscribe
					</button>
				</form>
			</div>
		{:else}
			<div class="rounded-md border border-red-500/20 bg-red-500/5 p-8">
				<h1 class="text-lg font-semibold text-zinc-100">Invalid Link</h1>
				<p class="text-sm text-zinc-400 mt-2">This unsubscribe link is invalid or expired.</p>
			</div>
		{/if}
		<a href="https://commons.email" class="inline-block text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
			commons.email
		</a>
	</div>
</div>
