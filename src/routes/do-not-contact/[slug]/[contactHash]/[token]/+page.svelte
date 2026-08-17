<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Do not contact | commons.email</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
	<div class="w-full max-w-lg space-y-4">
		{#if form?.sent}
			<!-- One copy for every outcome: sent, over the daily cap, no longer
			     published, mailer unavailable. A difference here would tell a
			     stranger whether the address is still on a published roster. -->
			<div class="space-y-3 rounded-md border border-zinc-700/50 bg-zinc-900/50 p-8">
				<h1 class="text-lg font-semibold text-zinc-100">Check this address's inbox</h1>
				<p class="text-sm text-zinc-400">
					If this address is still published by this campaign, Commons has emailed it a
					confirmation link. Removal only happens when that link is used, so only the mailbox
					itself can complete it. The link expires in 24 hours.
				</p>
				<p class="text-sm text-zinc-400">
					If nothing arrives, write to
					<a href="mailto:hello@commons.email" class="underline">hello@commons.email</a> and an
					operator will handle it.
				</p>
			</div>
		{:else if form?.error}
			<div class="rounded-md border border-zinc-700/50 bg-zinc-900/50 p-8">
				<h1 class="text-lg font-semibold text-zinc-100">Not completed</h1>
				<p class="mt-2 text-sm text-zinc-400">{form.error}</p>
			</div>
		{:else if data.status === 'confirm'}
			<div class="space-y-4 rounded-md border border-zinc-700/50 bg-zinc-900/50 p-8">
				<h1 class="text-lg font-semibold text-zinc-100">Remove this address from Commons</h1>
				<p class="text-sm text-zinc-400">
					Commons will stop showing this address and stop including it in messages. This is
					permanent and applies to every organization on the platform.
				</p>
				<p class="text-sm text-zinc-400">
					Because anyone who sent you a message also holds this link, it cannot remove the address
					on its own. Commons will email the address a confirmation link; using that link is what
					removes it.
				</p>
				<p class="text-sm text-zinc-400">
					Commons does not send messages on senders' behalf on this route, so it cannot recall
					messages that were already sent.
				</p>
				<form method="POST" use:enhance>
					<button
						type="submit"
						class="rounded-lg bg-zinc-700 px-6 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600"
					>
						Email me the confirmation link
					</button>
				</form>
			</div>
		{:else}
			<div class="rounded-md border border-zinc-700/50 bg-zinc-900/50 p-8">
				<h1 class="text-lg font-semibold text-zinc-100">This link is not valid</h1>
				<p class="mt-2 text-sm text-zinc-400">
					Nothing was changed. The link may have been altered in transit.
				</p>
			</div>
		{/if}
		<a
			href="https://commons.email"
			class="inline-block text-sm text-zinc-500 transition-colors hover:text-zinc-300"
		>
			commons.email
		</a>
	</div>
</div>
