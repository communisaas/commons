<script lang="ts">
	import { enhance } from '$app/forms';
	import CountrySelector from '$lib/components/geographic/CountrySelector.svelte';
	import JurisdictionPicker from '$lib/components/geographic/JurisdictionPicker.svelte';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const prefill = data.alertPrefill;
	let debateEnabled = $state(false);
	let targetCountry = $state(form?.targetCountry ?? 'US');
	let targetJurisdiction = $state(form?.targetJurisdiction ?? '');
	let position = $state<string>('');
</script>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<nav class="flex items-center gap-2 text-sm text-text-tertiary mb-4">
			<a href="/org/{data.org.slug}/campaigns" class="hover:text-text-secondary transition-colors">
				Campaigns
			</a>
			<svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
			<span class="text-text-tertiary">Assemble Proof</span>
		</nav>
		<h1 class="text-xl font-semibold text-text-primary">Assemble Proof Packet</h1>
		<p class="text-sm text-text-tertiary mt-1">Direct verified constituent proof at your decision-makers.</p>
	</div>

	{#if form?.error}
		<div class="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
			{form.error}
		</div>
	{/if}

	<form method="POST" use:enhance class="space-y-6">
		{#if prefill}
			<input type="hidden" name="fromAlertId" value={prefill.alertId} />
			<input type="hidden" name="billId" value={prefill.billId} />
			<input type="hidden" name="position" value={position} />

			<!-- Alert context banner -->
			<div class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
				<p class="text-[10px] font-mono uppercase tracking-wider text-amber-400/70 mb-1">Responding to legislative alert</p>
				<p class="text-sm font-medium text-text-primary">{prefill.billTitle}</p>
				{#if prefill.billSummary}
					<p class="text-xs text-text-tertiary mt-1 line-clamp-2">{prefill.billSummary}</p>
				{/if}

				{#if prefill.billJurisdictionLevel === 'state'}
					<div class="mt-2 rounded border border-amber-500/10 bg-amber-500/5 px-3 py-2">
						<p class="text-[10px] text-amber-400/80">State bill -- you may need to manually add your target legislators after creating this campaign.</p>
					</div>
				{/if}

				<!-- Position selector -->
				<div class="mt-3">
					<p class="text-xs font-medium text-text-secondary mb-1.5">Your organization's position on this bill</p>
					<div class="flex gap-3">
						<button
							type="button"
							class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {position === 'support' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-surface-border bg-surface-raised text-text-tertiary hover:text-text-secondary'}"
							onclick={() => { position = 'support'; }}
						>
							Support
						</button>
						<button
							type="button"
							class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {position === 'oppose' ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-surface-border bg-surface-raised text-text-tertiary hover:text-text-secondary'}"
							onclick={() => { position = 'oppose'; }}
						>
							Oppose
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Section 1: Who should see this proof? -->
		<div class="rounded-lg bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-4 space-y-4">
			<div>
				<p class="text-sm font-medium text-text-secondary">Who should see this proof?</p>
				<p class="text-xs text-text-tertiary mt-0.5">Choose the jurisdiction where your proof will land</p>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label for="targetCountry" class="block text-sm font-medium text-text-secondary mb-1.5">Country</label>
					<input type="hidden" name="targetCountry" value={targetCountry} />
					<CountrySelector value={targetCountry} onchange={(c) => { targetCountry = c; targetJurisdiction = ''; }} />
				</div>
				<div>
					<label for="targetJurisdiction" class="block text-sm font-medium text-text-secondary mb-1.5">
						Jurisdiction
						<span class="text-text-quaternary font-normal">(optional)</span>
					</label>
					<input type="hidden" name="targetJurisdiction" value={targetJurisdiction} />
					<JurisdictionPicker value={targetJurisdiction || null} country={targetCountry} onchange={(j) => { targetJurisdiction = j; }} />
				</div>
			</div>

			{#if targetJurisdiction}
				<p class="text-xs text-text-tertiary">
					Proof will target decision-makers in <span class="text-text-secondary font-medium">{targetJurisdiction}</span>, <span class="text-text-secondary font-medium">{targetCountry}</span>
				</p>
			{/if}
		</div>

		<!-- Section 2: What are you proving? -->
		<div class="space-y-5">
			<p class="text-sm font-medium text-text-secondary">What are you proving?</p>

			<!-- Title -->
			<div>
				<label for="title" class="block text-sm font-medium text-text-secondary mb-1.5">Title</label>
				<input
					type="text"
					id="title"
					name="title"
					required
					value={form?.title ?? prefill?.billTitle ?? ''}
					placeholder="e.g., District 5 Zoning Letter Drive"
					class="w-full rounded-lg participation-input text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
				/>
			</div>

			<!-- Type -->
			<div>
				<label for="type" class="block text-sm font-medium text-text-secondary mb-1.5">Type</label>
				<select
					id="type"
					name="type"
					required
					class="w-full rounded-lg participation-input text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
				>
					<option value="LETTER" selected={form?.type === 'LETTER' || !!prefill}>Letter</option>
					<option value="EVENT" selected={form?.type === 'EVENT'}>Event</option>
					<option value="FORM" selected={form?.type === 'FORM'}>Form</option>
				</select>
			</div>

			<!-- Body -->
			<div>
				<label for="body" class="block text-sm font-medium text-text-secondary mb-1.5">
					Description
					<span class="text-text-quaternary font-normal">(optional)</span>
				</label>
				<textarea
					id="body"
					name="body"
					rows="4"
					placeholder="What civic action are supporters being asked to prove?"
					class="w-full rounded-lg participation-input text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors resize-y"
				>{form?.body ?? prefill?.billSummary ?? ''}</textarea>
			</div>

			<!-- Template -->
			<div>
				<label for="templateId" class="block text-sm font-medium text-text-secondary mb-1.5">
					Template
					<span class="text-text-quaternary font-normal">(optional)</span>
				</label>
				<select
					id="templateId"
					name="templateId"
					class="w-full rounded-lg participation-input text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
				>
					<option value="">None</option>
					{#each data.templates as template}
						<option value={template.id}>{template.title}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Debate settings -->
		<div class="rounded-lg bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-4 space-y-4">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-medium text-text-secondary">Adversarial Debate</p>
					<p class="text-xs text-text-tertiary mt-0.5">Enable on-chain debate for this proof packet</p>
				</div>
				<label class="relative inline-flex items-center cursor-pointer">
					<input
						type="checkbox"
						name="debateEnabled"
						class="sr-only peer"
						bind:checked={debateEnabled}
					/>
					<div class="w-9 h-5 bg-surface-border-strong peer-focus:ring-2 peer-focus:ring-teal-500/40 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-text-tertiary after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600 peer-checked:after:bg-white"></div>
				</label>
			</div>

			{#if debateEnabled}
				<p class="text-xs text-text-tertiary">
					When supporters take verified action, an adversarial debate spawns. The strongest arguments surface and attach to your proof packet, making it harder to dismiss.
				</p>
				<div>
					<label for="debateThreshold" class="block text-sm font-medium text-text-secondary mb-1.5">
						Threshold
						<span class="text-text-quaternary font-normal">(minimum verified participants)</span>
					</label>
					<input
						type="number"
						id="debateThreshold"
						name="debateThreshold"
						min="1"
						value="50"
						class="w-32 rounded-lg participation-input text-sm font-mono focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none transition-colors"
					/>
				</div>
			{/if}
		</div>

		<!-- Proof preview -->
		<div class="rounded-md border border-surface-border bg-surface-raised p-6 space-y-3">
			<p class="text-[10px] font-mono uppercase tracking-wider text-text-quaternary">What decision-makers will see</p>
			<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
				<p class="text-xs font-mono uppercase tracking-wider text-text-quaternary mb-1">Verification Packet</p>
				<p class="font-mono tabular-nums text-2xl font-bold text-text-quaternary">0</p>
				<p class="text-xs text-text-quaternary mt-1">Proof assembles as supporters take action</p>
			</div>
		</div>

		<!-- Submit -->
		<div class="flex items-center gap-3 pt-2">
			<button
				type="submit"
				class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-500 transition-colors"
			>
				Assemble Proof Packet
			</button>
			<a
				href="/org/{data.org.slug}/campaigns"
				class="rounded-lg px-4 py-2.5 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
			>
				Cancel
			</a>
		</div>
	</form>
</div>
