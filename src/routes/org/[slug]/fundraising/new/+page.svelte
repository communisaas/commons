<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form?: ActionData } = $props();

	let title = $state(form?.values?.title ?? '');
	let description = $state(form?.values?.description ?? '');
	let goalAmount = $state(form?.values?.goal_amount ?? '');
	let currency = $state(form?.values?.currency ?? 'usd');
	let publishNow = $state(form?.values?.publish_now ?? false);
</script>

<svelte:head>
	<title>Create fundraiser | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
		<div>
			<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
				<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
					Studio
				</a>
				<span aria-hidden="true">/</span>
				<a
					href="/org/{data.org.slug}/fundraising"
					class="hover:text-text-secondary transition-colors"
				>
					Fundraising
				</a>
				<span aria-hidden="true">/</span>
				<span>Create</span>
			</nav>
			<h1 class="text-text-primary text-xl font-semibold">Create fundraiser</h1>
			<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
				Save the details first. Publishing opens the public donation page.
			</p>
		</div>

		{#if form?.error}
			<div class="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
				{form.error}
			</div>
		{/if}

		<form method="POST" class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div
				id="fundraiser-definition"
				class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5"
			>
				<div>
					<p class="text-text-tertiary font-mono text-xs font-semibold tracking-wider uppercase">
						Fundraiser details
					</p>
				</div>

				<label class="block">
					<span class="text-text-secondary mb-1.5 block text-sm font-medium">Title</span>
					<input
						name="title"
						bind:value={title}
						required
						minlength="3"
						maxlength="200"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						placeholder="Legal defense fund"
					/>
				</label>

				<label class="block">
					<span class="text-text-secondary mb-1.5 block text-sm font-medium">Story</span>
					<textarea
						name="description"
						bind:value={description}
						rows="5"
						maxlength="5000"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full resize-y rounded-md border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
						placeholder="Why this contribution matters and what it funds."
					></textarea>
				</label>

				<div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium"> Goal amount </span>
						<input
							name="goal_amount"
							type="number"
							min="1"
							step="0.01"
							bind:value={goalAmount}
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none"
							placeholder="optional"
						/>
					</label>
					<label class="block">
						<span class="text-text-secondary mb-1.5 block text-sm font-medium">Currency</span>
						<input
							name="currency"
							bind:value={currency}
							maxlength="8"
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary w-full rounded-md border px-3 py-2 font-mono text-sm uppercase focus:border-teal-500 focus:outline-none"
						/>
					</label>
				</div>
			</div>

			<div class="space-y-4">
				<div
					id="fundraiser-publication"
					class="border-surface-border bg-surface-base rounded-md border p-4"
				>
					<p class="text-text-primary text-sm font-medium">Public donation page</p>
					<label class="mt-3 flex items-start gap-3">
						<input
							name="publish_now"
							type="checkbox"
							bind:checked={publishNow}
							class="border-surface-border-strong bg-surface-raised mt-1 h-4 w-4 rounded text-teal-500 focus:ring-teal-500"
						/>
						<span>
							<span class="text-text-secondary block text-sm">Publish immediately</span>
							<span class="text-text-tertiary mt-0.5 block text-xs">
								The public donation page starts accepting donations as soon as it's created.
							</span>
						</span>
					</label>
				</div>

				<div
					id="fundraiser-receipt-boundary"
					class="border-surface-border bg-surface-base rounded-md border p-4"
				>
					<p class="text-text-primary text-sm font-medium">Donor confirmations</p>
					<p class="text-text-tertiary mt-1 text-xs leading-5">
						Donors get a confirmation email after their payment completes. It confirms the
						donation; it is not a tax acknowledgment.
					</p>
				</div>

				<div class="flex flex-col gap-2">
					<button
						type="submit"
						class="rounded-md bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-500"
					>
						{publishNow ? 'Create and publish' : 'Save draft'}
					</button>
					<a
						href="/org/{data.org.slug}/fundraising"
						class="text-text-tertiary hover:text-text-primary rounded-md px-4 py-2.5 text-center text-sm transition-colors"
					>
						Cancel
					</a>
				</div>
			</div>
		</form>
	</div>
</div>
