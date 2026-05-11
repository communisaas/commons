<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import type { ProcessedDecisionMaker, CustomRecipient } from '$lib/types/template';
	import { FEATURES } from '$lib/config/features';
	import DecisionMakerGrouped from './DecisionMakerGrouped.svelte';
	import DecisionMakerCard from './DecisionMakerCard.svelte';
	import CustomDecisionMakerForm from './CustomDecisionMakerForm.svelte';
	import { isDuplicateEmail } from '$lib/utils/decision-maker-processing';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';

	const labels = getJurisdictionLabels();

	interface Props {
		decisionMakers: ProcessedDecisionMaker[];
		customRecipients: CustomRecipient[];
		includesCongress: boolean;
		audienceGuidance?: string;
		onupdate: (data: {
			decisionMakers: ProcessedDecisionMaker[];
			customRecipients: CustomRecipient[];
			includesCongress: boolean;
		}) => void;
	}

	let {
		decisionMakers = $bindable(),
		customRecipients = $bindable(),
		includesCongress = $bindable(),
		audienceGuidance
	}: Props = $props();

	let showCustomForm = $state(false);
	let duplicateError = $state<string | null>(null);

	const withEmail = $derived(decisionMakers?.filter(dm => dm.email) || []);
	const withoutEmail = $derived(decisionMakers?.filter(dm => !dm.email) || []);
	const totalRecipients = $derived(
		withEmail.length + (customRecipients?.length || 0) + (includesCongress ? 1 : 0)
	);

	function handleAddCustom(recipient: { email: string; name: string; organization?: string }) {
		// Check for duplicates
		if (isDuplicateEmail(recipient.email, decisionMakers || [], customRecipients || [])) {
			duplicateError = 'This email is already in your recipient list';
			return;
		}

		// Add to custom recipients
		customRecipients = [...(customRecipients || []), recipient];
		showCustomForm = false;
		duplicateError = null;
	}

	function handleRemoveDecisionMaker(index: number) {
		if (!decisionMakers) return;
		decisionMakers = decisionMakers.filter((_, i) => i !== index);
	}

	function handleRemoveCustom(index: number) {
		if (!customRecipients) return;
		customRecipients = customRecipients.filter((_, i) => i !== index);
	}

	function handleUpdateEmail(index: number, email: string) {
		if (!decisionMakers) return;
		decisionMakers = decisionMakers.map((dm, i) =>
			i === index ? { ...dm, email } : dm
		);
	}
</script>

<div class="space-y-6 py-4">
	<!-- Header -->
	<div>
		<h3 class="text-lg font-semibold text-slate-900 md:text-xl">
			{#if decisionMakers?.length > 0}
				{#if withEmail.length > 0}
					We found {withEmail.length} decision-maker{withEmail.length === 1 ? '' : 's'} with verified contact
				{:else}
					We identified {decisionMakers.length} decision-maker{decisionMakers.length === 1 ? '' : 's'}
				{/if}
			{:else}
				Add decision-makers
			{/if}
		</h3>
		{#if withoutEmail.length > 0 && withEmail.length > 0}
			<p class="mt-1 text-sm text-slate-600">
				{withoutEmail.length} more identified — add their email to include them
			</p>
		{:else if withoutEmail.length > 0 && withEmail.length === 0}
			<p class="mt-1 text-sm text-amber-600">
				Email addresses weren't found in public sources. Add emails to include them, or add recipients manually below.
			</p>
		{:else if totalRecipients > 0}
			<p class="mt-1 text-sm text-slate-600">
				Total recipients: {totalRecipients}
			</p>
		{/if}
		{#if audienceGuidance}
			<p class="mt-1 text-xs italic text-slate-500">
				Your guidance: "{audienceGuidance.length > 80 ? audienceGuidance.slice(0, 77) + '...' : audienceGuidance}"
			</p>
		{/if}
	</div>

	<!-- AI-Resolved Decision-Makers (Grouped by Organization) -->
	{#if decisionMakers?.length > 0}
		<DecisionMakerGrouped
			{decisionMakers}
			onremove={handleRemoveDecisionMaker}
			onupdateemail={handleUpdateEmail}
		/>
	{/if}

	<!-- Custom Recipients -->
	{#if customRecipients?.length > 0}
		<div class="space-y-3">
			<h4 class="text-sm font-medium text-slate-700">Custom recipients</h4>
			{#each customRecipients as cr, i}
				<DecisionMakerCard
					decisionMaker={{
						name: cr.name,
						title: cr.organization || 'Custom recipient',
						organization: cr.organization || '',
						email: cr.email,
						provenance: 'Manually added by you',
						reasoning: 'Manually added recipient',
						isAiResolved: false
					}}
					onremove={() => handleRemoveCustom(i)}
				/>
			{/each}
		</div>
	{/if}

	<!-- Add Custom Decision-Maker -->
	{#if showCustomForm}
		<CustomDecisionMakerForm
			onadd={handleAddCustom}
			oncancel={() => {
				showCustomForm = false;
				duplicateError = null;
			}}
		/>
	{:else}
		<button
			type="button"
			onclick={() => (showCustomForm = true)}
			class="inline-flex items-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-participation-primary-400 hover:bg-participation-primary-50 hover:text-participation-primary-700"
		>
			<Plus class="h-4 w-4" />
			Add another decision-maker
		</button>
	{/if}

	<!-- Duplicate Error -->
	{#if duplicateError}
		<div class="rounded-lg border border-red-200 bg-red-50 p-3">
			<p class="text-sm text-red-700">{duplicateError}</p>
		</div>
	{/if}

	<!-- Congressional Checkbox -->
	{#if FEATURES.CONGRESSIONAL}
		<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
			<label class="flex items-start gap-3">
				<input
					type="checkbox"
					bind:checked={includesCongress}
					class="mt-0.5 h-5 w-5 rounded border-slate-300 text-participation-primary-600 focus:ring-2 focus:ring-participation-primary-500"
				/>
				<div class="flex-1">
					<p class="font-medium text-slate-900">Also send to my {labels.legislativeAdjective} representatives</p>
					<p class="mt-0.5 text-sm text-slate-600">
						Your message will be sent via certified delivery to your House rep and both Senators
					</p>
				</div>
			</label>
		</div>
	{/if}

	<!-- Empty State -->
	{#if (decisionMakers?.length || 0) === 0 && (customRecipients?.length || 0) === 0 && !includesCongress}
		<div class="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
			<p class="text-sm text-slate-600">
				No decision-makers found. Add contacts manually{#if FEATURES.CONGRESSIONAL} or include {labels.legislativeAdjective} representatives{/if}.
			</p>
		</div>
	{/if}
</div>
