<script lang="ts">
	import WorkflowEmailDependencyPanel from '$lib/components/automation/WorkflowEmailDependencyPanel.svelte';
	import type { PageData } from './$types';
	import {
		TRIGGER_LABELS,
		STEP_LABELS,
		DELAY_UNITS,
		CONDITION_OPERATORS,
		toDelayMinutes,
		type DelayUnit
	} from '$lib/config/workflow-labels';
	import { FEATURES } from '$lib/config/features';

	let { data }: { data: PageData } = $props();

	type Step = {
		type: string;
		subject?: string;
		body?: string;
		tagId?: string;
		duration?: number;
		unit?: string;
		field?: string;
		operator?: string;
		value?: string;
		thenStep?: number;
		elseStep?: number;
	};

	let name = $state('');
	let description = $state('');
	let triggerType = $state('supporter_created');
	let triggerTagId = $state('');
	let triggerCampaignId = $state('');
	let triggerEventId = $state('');
	let triggerFundingActionId = $state('');
	let steps = $state<Step[]>([]);
	let saving = $state(false);
	let errorMsg = $state('');

	const emailStepCount = $derived(steps.filter((step) => step.type === 'send_email').length);
	function addStep() {
		steps.push({ type: 'send_email', subject: '', body: '' });
	}

	function removeStep(index: number) {
		steps.splice(index, 1);
	}

	function moveStep(index: number, direction: -1 | 1) {
		const target = index + direction;
		if (target < 0 || target >= steps.length) return;
		const temp = steps[index];
		steps[index] = steps[target];
		steps[target] = temp;
	}

	function updateStepType(index: number, newType: string) {
		const base: Step = { type: newType };
		if (newType === 'send_email') {
			base.subject = '';
			base.body = '';
		} else if (newType === 'add_tag' || newType === 'remove_tag') {
			base.tagId = '';
		} else if (newType === 'delay') {
			base.duration = 1;
			base.unit = 'hours';
		} else if (newType === 'condition') {
			base.field = '';
			base.operator = 'equals';
			base.value = '';
			base.thenStep = 0;
			base.elseStep = 0;
		}
		steps[index] = base;
	}

	function stepOptionLabel(value: string, label: string): string {
		if (FEATURES.WORKFLOW_EXECUTION) return label;
		if (value === 'send_email') return 'Draft email step';
		if (value === 'add_tag') return 'Draft tag-write step';
		if (value === 'remove_tag') return 'Draft tag-removal step';
		if (value === 'condition') return 'Draft branch condition';
		return label;
	}

	async function save() {
		if (!name.trim()) {
			errorMsg = 'Name is required';
			return;
		}
		if (steps.length === 0) {
			errorMsg = 'Add at least one step';
			return;
		}

		saving = true;
		errorMsg = '';

		const trigger: Record<string, unknown> = { type: triggerType };
		if (triggerType === 'tag_added' && triggerTagId.trim()) trigger.tagId = triggerTagId.trim();
		if (triggerType === 'campaign_action' && triggerCampaignId.trim())
			trigger.campaignId = triggerCampaignId.trim();
		if (
			(triggerType === 'event_rsvp' || triggerType === 'event_checkin') &&
			triggerEventId.trim()
		) {
			trigger.eventId = triggerEventId.trim();
		}
		if (triggerType === 'donation_completed' && triggerFundingActionId.trim()) {
			trigger.campaignId = triggerFundingActionId.trim();
		}

		// Translate UI-friendly field names to the backend executor contract.
		// Must agree with convex/workflows.ts:~357 step shape.
		const payloadSteps = steps.map((s) => {
			if (s.type === 'send_email') {
				return { type: 'send_email', emailSubject: s.subject ?? '', emailBody: s.body ?? '' };
			}
			if (s.type === 'add_tag' || s.type === 'remove_tag') {
				return { type: s.type, tagId: s.tagId ?? '' };
			}
			if (s.type === 'delay') {
				return {
					type: 'delay',
					delayMinutes: toDelayMinutes(s.duration ?? 1, (s.unit ?? 'hours') as DelayUnit)
				};
			}
			if (s.type === 'condition') {
				return {
					type: 'condition',
					field: s.field ?? '',
					operator: s.operator ?? 'equals',
					value: s.value ?? '',
					thenStepIndex: s.thenStep ?? 0,
					elseStepIndex: s.elseStep ?? 0
				};
			}
			return { type: s.type };
		});

		try {
			const res = await fetch(`/api/org/${data.org.slug}/workflows`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					description: description.trim() || null,
					trigger,
					steps: payloadSteps
				})
			});

			if (res.ok) {
				const result = await res.json();
				window.location.href = `/org/${data.org.slug}/workflows/${result.id}`;
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to save (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Create workflow | {data.org.name}</title>
</svelte:head>

<div id="coordination-logic-draft" class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<a
			href="/org/{data.org.slug}/workflows"
			class="text-text-tertiary hover:text-text-primary mb-6 inline-block text-sm"
		>
			&larr; Workflows
		</a>

		<h1 class="text-text-primary mb-2 text-2xl font-bold">Create workflow</h1>
		<p class="text-text-tertiary mb-6 text-sm">
			Choose a trigger and add steps. Saved workflows start disabled; enable them from the
			workflow's page.
		</p>

		<WorkflowEmailDependencyPanel {emailStepCount} readiness={data.workflowEmailReadiness} />

		{#if errorMsg}
			<div
				class="mb-6 rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400"
			>
				{errorMsg}
			</div>
		{/if}

		<div
			id="coordination-definition"
			class="border-surface-border mb-6 space-y-4 rounded-md border p-4"
		>
			<div>
				<label for="wf-name" class="text-text-tertiary mb-1 block text-sm font-medium">Name</label>
				<input
					id="wf-name"
					type="text"
					bind:value={name}
					placeholder="e.g. Welcome verified people"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
				/>
			</div>
			<div>
				<label for="wf-desc" class="text-text-tertiary mb-1 block text-sm font-medium"
					>Description (optional)</label
				>
				<input
					id="wf-desc"
					type="text"
					bind:value={description}
					placeholder="What does this workflow do?"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
				/>
			</div>
		</div>

		<div id="coordination-trigger" class="border-surface-border mb-6 rounded-md border p-4">
			<h2 class="text-text-tertiary mb-3 text-sm font-medium">Trigger</h2>
			<select
				bind:value={triggerType}
				class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
			>
				{#each Object.entries(TRIGGER_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>

			{#if triggerType === 'tag_added'}
				<div class="mt-3">
					<label for="trigger-tag" class="text-text-tertiary mb-1 block text-xs">Tag</label>
					{#if data.tags.length > 0}
						<select
							id="trigger-tag"
							bind:value={triggerTagId}
							class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
						>
							<option value="">Select a tag...</option>
							{#each data.tags as tag (tag.id)}
								<option value={tag.id}>{tag.name}</option>
							{/each}
						</select>
					{:else}
						<input
							id="trigger-tag"
							type="text"
							bind:value={triggerTagId}
							placeholder="Tag ID"
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
						/>
					{/if}
					<p class="text-text-quaternary mt-1 text-xs">Blank matches every tag application.</p>
				</div>
			{/if}

			{#if triggerType === 'campaign_action'}
				<div class="mt-3">
					<label for="trigger-campaign" class="text-text-tertiary mb-1 block text-xs"
						>Action record ID</label
					>
					<input
						id="trigger-campaign"
						type="text"
						bind:value={triggerCampaignId}
						placeholder="Action record ID"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
					/>
					<p class="text-text-quaternary mt-1 text-xs">Blank matches every action response.</p>
				</div>
			{/if}

			{#if triggerType === 'event_rsvp' || triggerType === 'event_checkin'}
				<div class="mt-3">
					<label for="trigger-event" class="text-text-tertiary mb-1 block text-xs"
						>Event record ID</label
					>
					<input
						id="trigger-event"
						type="text"
						bind:value={triggerEventId}
						placeholder="Event record ID"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
					/>
					<p class="text-text-quaternary mt-1 text-xs">Blank matches every event record.</p>
				</div>
			{/if}

			{#if triggerType === 'donation_completed'}
				<div class="mt-3">
					<label for="trigger-funding" class="text-text-tertiary mb-1 block text-xs"
						>Funding action ID</label
					>
					<input
						id="trigger-funding"
						type="text"
						bind:value={triggerFundingActionId}
						placeholder="Funding action ID"
						class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
					/>
					<p class="text-text-quaternary mt-1 text-xs">Blank matches every completed donation.</p>
				</div>
			{/if}
		</div>

		<div id="coordination-steps" class="border-surface-border mb-6 rounded-md border p-4">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-text-tertiary text-sm font-medium">Steps ({steps.length})</h2>
				<button
					onclick={addStep}
					class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-lg border px-3 py-1.5 text-sm"
				>
					+ Add draft step
				</button>
			</div>

			{#if steps.length === 0}
				<p class="text-text-tertiary py-6 text-center text-sm">
					No steps yet. Add a draft step to define the intended response when this trigger fires.
				</p>
			{:else}
				<div class="space-y-3">
					{#each steps as step, i (i)}
						<div class="border-surface-border-strong/50 bg-surface-base rounded-lg border p-3">
							<!-- Step header -->
							<div class="mb-2 flex items-center justify-between gap-2">
								<span class="text-text-tertiary shrink-0 text-xs font-medium">Step {i + 1}</span>
								<div class="flex items-center gap-1">
									<button
										onclick={() => moveStep(i, -1)}
										disabled={i === 0}
										class="text-text-tertiary hover:text-text-secondary rounded px-1.5 py-0.5 text-xs disabled:opacity-30"
									>
										Up
									</button>
									<button
										onclick={() => moveStep(i, 1)}
										disabled={i === steps.length - 1}
										class="text-text-tertiary hover:text-text-secondary rounded px-1.5 py-0.5 text-xs disabled:opacity-30"
									>
										Down
									</button>
									<button
										onclick={() => removeStep(i)}
										class="rounded px-1.5 py-0.5 text-xs text-red-500 hover:text-red-400"
									>
										Remove
									</button>
								</div>
							</div>

							<!-- Step type -->
							<select
								value={step.type}
								onchange={(e) => updateStepType(i, e.currentTarget.value)}
								class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary mb-2 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
							>
								{#each Object.entries(STEP_LABELS) as [value, label] (value)}
									<option {value}>{stepOptionLabel(value, label)}</option>
								{/each}
							</select>

							<!-- Type-specific fields -->
							{#if step.type === 'send_email'}
								<div class="space-y-2">
									<input
										type="text"
										bind:value={step.subject}
										placeholder="Draft email subject"
										class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
									/>
									<textarea
										bind:value={step.body}
										placeholder="Draft email body"
										rows="3"
										class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
									></textarea>
								</div>
							{:else if step.type === 'add_tag' || step.type === 'remove_tag'}
								{#if data.tags.length > 0}
									<select
										bind:value={step.tagId}
										class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
									>
										<option value="">Select a tag...</option>
										{#each data.tags as tag (tag.id)}
											<option value={tag.id}>{tag.name}</option>
										{/each}
									</select>
								{:else}
									<input
										type="text"
										bind:value={step.tagId}
										placeholder="Tag ID"
										class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
									/>
								{/if}
							{:else if step.type === 'delay'}
								<div class="flex gap-2">
									<input
										type="number"
										bind:value={step.duration}
										min="1"
										class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-24 rounded-lg border px-3 py-2 text-sm focus:outline-none"
									/>
									<select
										bind:value={step.unit}
										class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary rounded-lg border px-3 py-2 text-sm focus:outline-none"
									>
										{#each DELAY_UNITS as opt (opt.value)}
											<option value={opt.value}>{opt.label}</option>
										{/each}
									</select>
								</div>
							{:else if step.type === 'condition'}
								<div class="space-y-2">
									<div class="flex gap-2">
										<input
											type="text"
											bind:value={step.field}
											placeholder="Field (e.g. engagementTier)"
											class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none"
										/>
										<select
											bind:value={step.operator}
											class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary rounded-lg border px-3 py-2 text-sm focus:outline-none"
										>
											{#each CONDITION_OPERATORS as opt (opt.value)}
												<option value={opt.value}>{opt.label}</option>
											{/each}
										</select>
										<input
											type="text"
											bind:value={step.value}
											placeholder="Value"
											class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-32 rounded-lg border px-3 py-2 text-sm focus:outline-none"
										/>
									</div>
									<div class="flex gap-2">
										<div class="flex-1">
											<label for="then-step-{i}" class="text-text-tertiary mb-1 block text-xs">
												Then go to step
											</label>
											<input
												id="then-step-{i}"
												type="number"
												bind:value={step.thenStep}
												min="0"
												max={steps.length}
												class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
											/>
										</div>
										<div class="flex-1">
											<label for="else-step-{i}" class="text-text-tertiary mb-1 block text-xs">
												Else go to step
											</label>
											<input
												id="else-step-{i}"
												type="number"
												bind:value={step.elseStep}
												min="0"
												max={steps.length}
												class="border-surface-border-strong bg-surface-raised text-text-primary focus:border-text-tertiary w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
											/>
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="flex items-center justify-end gap-3">
			<a
				href="/org/{data.org.slug}/workflows"
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-lg border px-4 py-2 text-sm"
			>
				Cancel
			</a>
			<button
				onclick={save}
				disabled={saving}
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Save workflow'}
			</button>
		</div>
	</div>
</div>
