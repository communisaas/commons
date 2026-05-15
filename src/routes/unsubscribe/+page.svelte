<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting = $state(false);
	let email = $state('');
</script>

<svelte:head>
	<title>Unsubscribe — Commons</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto max-w-2xl px-4 py-16">
	{#if form?.received}
		<!-- Single indistinguishable response across {ok, already-unsubscribed,
		     not-on-list, blast-not-found}. The server intentionally returns no
		     `reason` discriminator — keeping the form from being a probe oracle
		     for the org's supporter list. -->
		<h1 class="font-brand text-2xl font-bold text-slate-900">Request received</h1>
		<p class="mt-3 font-brand text-base text-slate-700">
			If your address is on file with this organization, it has been unsubscribed.
			No further action required.
		</p>
	{:else if form?.error}
		<h1 class="font-brand text-2xl font-bold text-slate-900">We couldn't process that</h1>
		<p class="mt-3 font-brand text-base text-slate-700">{form.error}</p>
		<a
			href={data.blastId ? `/unsubscribe?blast=${data.blastId}` : '/unsubscribe'}
			class="mt-6 inline-block font-brand text-sm text-indigo-600 hover:text-indigo-800"
		>
			Try again
		</a>
	{:else}
		<h1 class="font-brand text-2xl font-bold text-slate-900">Unsubscribe</h1>
		<p class="mt-3 font-brand text-base text-slate-700">
			Enter the email address that received this message to unsubscribe from
			further communications from the sending organization.
		</p>
		<form
			method="POST"
			action="?/apply"
			class="mt-8"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<label class="block">
				<span class="font-brand text-sm font-medium text-slate-700">Email address</span>
				<input
					type="email"
					name="email"
					bind:value={email}
					required
					autocomplete="email"
					class="mt-2 block w-full rounded border border-slate-300 px-3 py-2 font-brand text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
			</label>
			{#if data.blastId}
				<input type="hidden" name="blast" value={data.blastId} />
			{/if}
			<button
				type="submit"
				disabled={submitting || !email}
				class="mt-5 rounded border border-slate-900 bg-slate-900 px-5 py-2 font-brand text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
			>
				{submitting ? 'Applying…' : 'Confirm unsubscribe'}
			</button>
		</form>
	{/if}

	<footer class="mt-16 border-t border-slate-200 pt-6">
		<p class="font-brand text-xs text-slate-500">
			Public unsubscribe surface — Commons. Per-recipient one-click unsubscribe
			via the inbox client (RFC 8058 List-Unsubscribe-Post) is a follow-up
			tracked separately.
		</p>
	</footer>
</main>
