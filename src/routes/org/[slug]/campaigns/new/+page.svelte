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
	let campaignType = $state<string>(form?.type ?? data.initialType ?? 'LETTER');

	const isCongressional = $derived(campaignType === 'CONGRESSIONAL');
</script>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<nav class="text-text-tertiary mb-4 flex items-center gap-2 text-sm">
			<a href="/org/{data.org.slug}/campaigns" class="hover:text-text-secondary transition-colors">
				Action records
			</a>
			<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
			</svg>
			<span class="text-text-tertiary">Draft action</span>
		</nav>
		<h1 class="text-text-primary text-xl font-semibold">Draft action record</h1>
		<p class="text-text-tertiary mt-1 text-sm">
			Describe the action you're asking people to take. It saves as a draft — participation and
			proof collection start after that.
		</p>
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
				<p class="mb-1 font-mono text-[10px] tracking-wider text-amber-400/70 uppercase">
					Responding to legislative alert
				</p>
				<p class="text-text-primary text-sm font-medium">{prefill.billTitle}</p>
				{#if prefill.billSummary}
					<p class="text-text-tertiary mt-1 line-clamp-2 text-xs">{prefill.billSummary}</p>
				{/if}

				{#if prefill.billJurisdictionLevel === 'state'}
					<div class="mt-2 rounded border border-amber-500/10 bg-amber-500/5 px-3 py-2">
						<p class="text-[10px] text-amber-400/80">
							State bill -- you may need to manually add target legislators after creating this
							action.
						</p>
					</div>
				{/if}

				<!-- Position selector -->
				<div class="mt-3">
					<p class="text-text-secondary mb-1.5 text-xs font-medium">
						Your organization's position on this bill
					</p>
					<div class="flex gap-3">
						<button
							type="button"
							class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {position ===
							'support'
								? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
								: 'border-surface-border bg-surface-raised text-text-tertiary hover:text-text-secondary'}"
							onclick={() => {
								position = 'support';
							}}
						>
							Support
						</button>
						<button
							type="button"
							class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {position ===
							'oppose'
								? 'border-red-500/40 bg-red-500/10 text-red-400'
								: 'border-surface-border bg-surface-raised text-text-tertiary hover:text-text-secondary'}"
							onclick={() => {
								position = 'oppose';
							}}
						>
							Oppose
						</button>
					</div>
				</div>
			</div>
		{/if}

		<!-- Section 1: Who should see this proof? -->
		<div
			id="proof-destination"
			class="bg-surface-base border-surface-border scroll-mt-24 space-y-4 rounded-lg border p-4"
		>
			<div>
				<p class="text-text-secondary text-sm font-medium">Who should see this proof?</p>
				<p class="text-text-tertiary mt-0.5 text-xs">
					Choose the jurisdiction where your proof will land
				</p>
			</div>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<label for="targetCountry" class="text-text-secondary mb-1.5 block text-sm font-medium"
						>Country</label
					>
					<input type="hidden" name="targetCountry" value={targetCountry} />
					<CountrySelector
						value={targetCountry}
						onchange={(c) => {
							targetCountry = c;
							targetJurisdiction = '';
						}}
					/>
				</div>
				<div>
					<label
						for="targetJurisdiction"
						class="text-text-secondary mb-1.5 block text-sm font-medium"
					>
						Jurisdiction
						<span class="text-text-quaternary font-normal">(optional)</span>
					</label>
					<input type="hidden" name="targetJurisdiction" value={targetJurisdiction} />
					<JurisdictionPicker
						value={targetJurisdiction || null}
						country={targetCountry}
						onchange={(j) => {
							targetJurisdiction = j;
						}}
					/>
				</div>
			</div>

			{#if targetJurisdiction}
				<p class="text-text-tertiary text-xs">
					Proof will target decision-makers in <span class="text-text-secondary font-medium"
						>{targetJurisdiction}</span
					>, <span class="text-text-secondary font-medium">{targetCountry}</span>
				</p>
			{/if}
		</div>

		<!-- Section 2: What are you proving? -->
		<div id="action-identity" class="scroll-mt-24 space-y-5">
			<p class="text-text-secondary text-sm font-medium">What are you proving?</p>

			<!-- Title -->
			<div>
				<label for="title" class="text-text-secondary mb-1.5 block text-sm font-medium">Title</label
				>
				<input
					type="text"
					id="title"
					name="title"
					required
					value={form?.title ?? prefill?.billTitle ?? ''}
					placeholder="e.g., District 5 Zoning Letter Drive"
					class="participation-input w-full rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				/>
			</div>

			<!-- Type -->
			<div>
				<label for="type" class="text-text-secondary mb-1.5 block text-sm font-medium">Type</label>
				<select
					id="type"
					name="type"
					required
					bind:value={campaignType}
					class="participation-input w-full rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				>
					<option value="LETTER">Letter</option>
					<option value="EVENT">Event</option>
					<option value="FORM">Form</option>
					{#if data.congressionalAuthoringEnabled}
						<option value="CONGRESSIONAL">Congressional message (to Congress)</option>
					{/if}
				</select>

				{#if isCongressional}
					<div class="mt-3 rounded-lg border border-teal-500/25 bg-teal-500/5 px-4 py-3">
						<p class="text-text-secondary text-sm font-medium">Delivers to Congress</p>
						<p class="text-text-tertiary mt-1 text-xs leading-relaxed">
							This action sends each supporter's message to their House and Senate offices
							through the Communicating with Congress system. Supporters who have verified
							their address deliver. Supporters who have verified with a government ID
							deliver too — and their messages carry a higher-assurance badge in the proof
							packet, so a staffer can see at a glance how many came from gov-ID-verified
							constituents.
						</p>
					</div>
				{/if}
			</div>

			<!-- Body -->
			<div>
				<label for="body" class="text-text-secondary mb-1.5 block text-sm font-medium">
					Description
					<span class="text-text-quaternary font-normal">(optional)</span>
				</label>
				<textarea
					id="body"
					name="body"
					rows="4"
					placeholder="What civic action are people being asked to prove?"
					class="participation-input w-full resize-y rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					>{form?.body ?? prefill?.billSummary ?? ''}</textarea
				>
			</div>

			<!-- Template -->
			<div>
				<label for="templateId" class="text-text-secondary mb-1.5 block text-sm font-medium">
					Template
					<span class="text-text-quaternary font-normal">(optional)</span>
				</label>
				<select
					id="templateId"
					name="templateId"
					class="participation-input w-full rounded-lg text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				>
					<option value="">None</option>
					{#each data.templates as template}
						<option value={template.id}>{template.title}</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Debate settings -->
		<div
			id="quality-settlement"
			class="bg-surface-base border-surface-border scroll-mt-24 space-y-4 rounded-lg border p-4"
		>
			<div class="flex items-center justify-between">
				<div>
					<p class="text-text-secondary text-sm font-medium">Debate</p>
					<p class="text-text-tertiary mt-0.5 text-xs">
						Let a debate open once enough verified people participate.
					</p>
				</div>
				<label class="relative inline-flex cursor-pointer items-center">
					<input
						type="checkbox"
						name="debateEnabled"
						class="peer sr-only"
						bind:checked={debateEnabled}
					/>
					<div
						class="bg-surface-border-strong peer after:bg-text-tertiary h-5 w-9 rounded-full peer-checked:bg-teal-600 peer-focus:ring-2 peer-focus:ring-teal-500/40 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white peer-checked:after:bg-white"
					></div>
				</label>
			</div>

			{#if debateEnabled}
				<p class="text-text-tertiary text-xs">
					The threshold saves with this draft. A debate doesn't open until that many verified
					people have participated.
				</p>
				<div>
					<label for="debateThreshold" class="text-text-secondary mb-1.5 block text-sm font-medium">
						Threshold
						<span class="text-text-quaternary font-normal">(minimum verified participants)</span>
					</label>
					<input
						type="number"
						id="debateThreshold"
						name="debateThreshold"
						min="1"
						value="50"
						class="participation-input w-32 rounded-lg font-mono text-sm transition-colors focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
					/>
				</div>
			{/if}
		</div>

		<!-- Proof preview -->
		<div class="border-surface-border bg-surface-raised space-y-3 rounded-md border p-6">
			<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
				Proof packet preview
			</p>
			<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
				<p class="text-text-quaternary mb-1 font-mono text-xs tracking-wider uppercase">
					Draft packet
				</p>
				<p class="text-text-quaternary font-mono text-2xl font-bold tabular-nums">Pending</p>
				<p class="text-text-quaternary mt-1 text-xs">
					Packet evidence assembles after save and verified participation.
				</p>
			</div>

			{#if isCongressional}
				<div class="border-surface-border space-y-2 rounded-lg border px-4 py-3">
					<p class="text-text-quaternary font-mono text-[10px] tracking-wider uppercase">
						Assurance breakdown
					</p>
					<div class="flex items-center justify-between text-xs">
						<span class="text-text-secondary">Address-verified — delivers</span>
						<span class="text-text-quaternary font-mono tabular-nums">Pending</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-text-secondary">Government-ID verified — delivers, badged</span>
						<span class="text-text-quaternary font-mono tabular-nums">Pending</span>
					</div>
					<p class="text-text-quaternary mt-1 text-[11px] leading-relaxed">
						The packet shows both counts so a recipient office can weigh reach against
						gov-ID-grade assurance. Address verification is the delivery floor; gov-ID
						verification raises the badge, not the bar.
					</p>
				</div>
			{/if}
		</div>

		<!-- Submit -->
		<div class="flex items-center gap-3 pt-2">
			<button
				type="submit"
				class="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
			>
				Create action record
			</button>
			<a
				href="/org/{data.org.slug}/campaigns"
				class="text-text-tertiary hover:text-text-secondary rounded-lg px-4 py-2.5 text-sm transition-colors"
			>
				Cancel
			</a>
		</div>
	</form>
</div>
