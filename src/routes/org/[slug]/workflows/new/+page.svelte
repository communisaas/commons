<script lang="ts">
	import type { PageData } from './$types';
	import {
		TRIGGER_LABELS,
		STEP_LABELS,
		DELAY_UNITS,
		CONDITION_OPERATORS,
		toDelayMinutes,
		type DelayUnit
	} from '$lib/config/workflow-labels';

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
	let steps = $state<Step[]>([]);
	let saving = $state(false);
	let errorMsg = $state('');

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
		if (triggerType === 'tag_added' && triggerTagId) trigger.tagId = triggerTagId;
		if (triggerType === 'campaign_action' && triggerCampaignId) trigger.campaignId = triggerCampaignId;

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
				body: JSON.stringify({ name: name.trim(), description: description.trim() || null, trigger, steps: payloadSteps })
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
	<title>New Workflow | {data.org.name}</title>
</svelte:head>

<div class="min-h-screen bg-surface-raised text-text-primary">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<!-- Back link -->
		<a href="/org/{data.org.slug}/workflows" class="mb-6 inline-block text-sm text-text-tertiary hover:text-text-primary">
			&larr; All Workflows
		</a>

		<h1 class="mb-8 text-2xl font-bold text-text-primary">New Workflow</h1>

		<!-- Error -->
		{#if errorMsg}
			<div class="mb-6 rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<!-- Name + Description -->
		<div class="mb-6 space-y-4 rounded-lg border border-surface-border p-4">
			<div>
				<label for="wf-name" class="mb-1 block text-sm font-medium text-text-tertiary">Name</label>
				<input
					id="wf-name"
					type="text"
					bind:value={name}
					placeholder="e.g. Welcome new supporters"
					class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
				/>
			</div>
			<div>
				<label for="wf-desc" class="mb-1 block text-sm font-medium text-text-tertiary">Description (optional)</label>
				<input
					id="wf-desc"
					type="text"
					bind:value={description}
					placeholder="What does this workflow do?"
					class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
				/>
			</div>
		</div>

		<!-- Trigger -->
		<div class="mb-6 rounded-lg border border-surface-border p-4">
			<h2 class="mb-3 text-sm font-medium text-text-tertiary">Trigger</h2>
			<select
				bind:value={triggerType}
				class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
			>
				{#each Object.entries(TRIGGER_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>

			{#if triggerType === 'tag_added'}
				<div class="mt-3">
					<label for="trigger-tag" class="mb-1 block text-xs text-text-tertiary">Tag</label>
					{#if data.tags.length > 0}
						<select
							id="trigger-tag"
							bind:value={triggerTagId}
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
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
							class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
						/>
					{/if}
				</div>
			{/if}

			{#if triggerType === 'campaign_action'}
				<div class="mt-3">
					<label for="trigger-campaign" class="mb-1 block text-xs text-text-tertiary">Campaign ID</label>
					<input
						id="trigger-campaign"
						type="text"
						bind:value={triggerCampaignId}
						placeholder="Campaign ID"
						class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
					/>
				</div>
			{/if}
		</div>

		<!-- Steps -->
		<div class="mb-6 rounded-lg border border-surface-border p-4">
			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-sm font-medium text-text-tertiary">Steps ({steps.length})</h2>
				<button
					onclick={addStep}
					class="rounded-lg border border-surface-border-strong px-3 py-1.5 text-sm text-text-secondary hover:border-text-tertiary hover:text-text-primary"
				>
					+ Add Step
				</button>
			</div>

			{#if steps.length === 0}
				<p class="py-6 text-center text-sm text-text-tertiary">No steps yet. Add a step to define what happens when this workflow triggers.</p>
			{:else}
				<div class="space-y-3">
					{#each steps as step, i (i)}
						<div class="rounded-lg border border-surface-border-strong/50 bg-surface-base p-3">
							<!-- Step header -->
							<div class="mb-2 flex items-center justify-between gap-2">
								<span class="shrink-0 text-xs font-medium text-text-tertiary">Step {i + 1}</span>
								<div class="flex items-center gap-1">
									<button
										onclick={() => moveStep(i, -1)}
										disabled={i === 0}
										class="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary disabled:opacity-30"
									>
										Up
									</button>
									<button
										onclick={() => moveStep(i, 1)}
										disabled={i === steps.length - 1}
										class="rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:text-text-secondary disabled:opacity-30"
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
								class="mb-2 w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
							>
								{#each Object.entries(STEP_LABELS) as [value, label] (value)}
									<option {value}>{label}</option>
								{/each}
							</select>

							<!-- Type-specific fields -->
							{#if step.type === 'send_email'}
								<div class="space-y-2">
									<input
										type="text"
										bind:value={step.subject}
										placeholder="Email subject"
										class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
									/>
									<textarea
										bind:value={step.body}
										placeholder="Email body"
										rows="3"
										class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
									></textarea>
								</div>
							{:else if step.type === 'add_tag' || step.type === 'remove_tag'}
								{#if data.tags.length > 0}
									<select
										bind:value={step.tagId}
										class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
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
										class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
									/>
								{/if}
							{:else if step.type === 'delay'}
								<div class="flex gap-2">
									<input
										type="number"
										bind:value={step.duration}
										min="1"
										class="w-24 rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
									/>
									<select
										bind:value={step.unit}
										class="rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
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
											class="flex-1 rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
										/>
										<select
											bind:value={step.operator}
											class="rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
										>
											{#each CONDITION_OPERATORS as opt (opt.value)}
												<option value={opt.value}>{opt.label}</option>
											{/each}
										</select>
										<input
											type="text"
											bind:value={step.value}
											placeholder="Value"
											class="w-32 rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder-text-quaternary focus:border-text-tertiary focus:outline-none"
										/>
									</div>
									<div class="flex gap-2">
										<div class="flex-1">
											<label class="mb-1 block text-xs text-text-tertiary">Then go to step</label>
											<input
												type="number"
												bind:value={step.thenStep}
												min="0"
												max={steps.length}
												class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
											/>
										</div>
										<div class="flex-1">
											<label class="mb-1 block text-xs text-text-tertiary">Else go to step</label>
											<input
												type="number"
												bind:value={step.elseStep}
												min="0"
												max={steps.length}
												class="w-full rounded-lg border border-surface-border-strong bg-surface-raised px-3 py-2 text-sm text-text-primary focus:border-text-tertiary focus:outline-none"
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

		<!-- Save -->
		<div class="flex items-center justify-end gap-3">
			<a
				href="/org/{data.org.slug}/workflows"
				class="rounded-lg border border-surface-border-strong px-4 py-2 text-sm text-text-secondary hover:border-text-tertiary hover:text-text-primary"
			>
				Cancel
			</a>
			<button
				onclick={save}
				disabled={saving}
				class="rounded-lg bg-surface-overlay px-4 py-2 text-sm font-semibold text-text-primary hover:bg-surface-raised disabled:opacity-50"
			>
				{saving ? 'Saving...' : 'Create Workflow'}
			</button>
		</div>
	</div>
</div>
