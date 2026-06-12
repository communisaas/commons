<script lang="ts">
	import type {
		SegmentFilter,
		SegmentCondition,
		ConditionField,
		ConditionOperator,
		SavedSegment
	} from '$lib/types/segment';
	import {
		FIELD_OPTIONS,
		VERIFICATION_OPTIONS,
		TIER_OPTIONS,
		SOURCE_OPTIONS,
		EMAIL_STATUS_OPTIONS
	} from '$lib/types/segment';
	import { Datum } from '$lib/design';

	interface Props {
		orgSlug: string;
		tags: Array<{ id: string; name: string }>;
		campaigns?: Array<{ id: string; title: string }>;
		/** Called when filters change with the current filter state */
		onFilterChange?: (filter: SegmentFilter) => void;
		/** Called when a segment is applied; partial means count is a lower bound */
		onApply?: (filter: SegmentFilter, count: number, partial?: boolean) => void;
		/** Show save/load segment controls */
		showSaveControls?: boolean;
		/** Show bulk action controls (apply/remove tag, export CSV) */
		showBulkActions?: boolean;
		/** Initial filter to load */
		initialFilter?: SegmentFilter;
		/** Route-local boundary copy for civic geography labels */
		civicGeographyBoundary?: string;
	}

	let {
		orgSlug,
		tags,
		campaigns = [],
		onFilterChange,
		onApply,
		showSaveControls = true,
		showBulkActions = false,
		initialFilter,
		civicGeographyBoundary = 'Geography filters use imported state and congressional districts, plus districts recorded when people take action.'
	}: Props = $props();

	// --- State ---
	let logic = $state<'AND' | 'OR'>(initialFilter?.logic ?? 'AND');
	let conditions = $state<SegmentCondition[]>(initialFilter?.conditions ?? []);
	let matchCount = $state<number | null>(null);
	let matchCountPartial = $state(false);
	let countLoading = $state(false);
	let countTimeout: ReturnType<typeof setTimeout> | undefined;

	// Save/load state
	let savedSegments = $state<SavedSegment[]>([]);
	let segmentName = $state('');
	let editingSegmentId = $state<string | null>(null);
	let saveLoading = $state(false);
	let showSavedList = $state(false);
	let segmentsLoaded = $state(false);

	// --- Derived ---
	const currentFilter = $derived<SegmentFilter>({ logic, conditions });
	const importedReadableGeographyConditionCount = $derived(
		conditions.filter((condition) =>
			['stateCode', 'congressionalDistrict'].includes(condition.field)
		).length
	);
	const actionReadableGeographyConditionCount = $derived(
		conditions.filter((condition) => condition.field === 'actionDistrictLabel').length
	);
	const actionDistrictHashConditionCount = $derived(
		conditions.filter((condition) => condition.field === 'actionDistrict').length
	);
	const civicGeographyConditionCount = $derived(
		importedReadableGeographyConditionCount +
			actionReadableGeographyConditionCount +
			actionDistrictHashConditionCount
	);

	// --- Effects ---

	// Debounced count on filter change
	$effect(() => {
		// Read the reactive values to track them
		const _l = logic;
		const _c = JSON.stringify(conditions);

		if (countTimeout) clearTimeout(countTimeout);
		countTimeout = setTimeout(() => {
			fetchCount();
		}, 300);

		onFilterChange?.(currentFilter);
	});

	// --- Helpers ---
	function generateId(): string {
		return Math.random().toString(36).slice(2, 10);
	}

	function addCondition() {
		conditions = [
			...conditions,
			{
				id: generateId(),
				field: 'tag',
				operator: 'includes',
				value: []
			}
		];
	}

	function removeCondition(id: string) {
		conditions = conditions.filter((c) => c.id !== id);
	}

	function updateCondition(id: string, updates: Partial<SegmentCondition>) {
		conditions = conditions.map((c) => (c.id === id ? { ...c, ...updates } : c));
	}

	function changeField(id: string, field: ConditionField) {
		const fieldMeta = FIELD_OPTIONS.find((f) => f.value === field);
		const defaultOp = fieldMeta?.operators[0]?.value ?? 'equals';
		let defaultValue: SegmentCondition['value'] = '';

		if (field === 'tag') defaultValue = [];
		else if (field === 'engagementTier') defaultValue = 0;
		else if (field === 'dateRange') defaultValue = { from: '', to: '' };

		updateCondition(id, { field, operator: defaultOp, value: defaultValue });
	}

	async function fetchCount() {
		if (conditions.length === 0) {
			matchCount = null;
			matchCountPartial = false;
			return;
		}
		countLoading = true;
		try {
			const res = await fetch(`/api/org/${orgSlug}/segments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'count', filters: currentFilter })
			});
			if (res.ok) {
				const data = await res.json();
				matchCount = data.count;
				matchCountPartial = Boolean(data.partial);
			}
		} catch {
			// Silently fail count
		} finally {
			countLoading = false;
		}
	}

	async function loadSegments() {
		if (segmentsLoaded) {
			showSavedList = !showSavedList;
			return;
		}
		try {
			const res = await fetch(`/api/org/${orgSlug}/segments`);
			if (res.ok) {
				const data = await res.json();
				savedSegments = data.segments;
			}
		} catch {
			// ignore
		}
		segmentsLoaded = true;
		showSavedList = true;
	}

	function loadSegment(segment: SavedSegment) {
		const filter = segment.filters;
		logic = filter.logic;
		conditions = filter.conditions.map((c) => ({ ...c, id: generateId() }));
		editingSegmentId = segment.id;
		segmentName = segment.name;
		showSavedList = false;
	}

	async function saveSegment() {
		if (!segmentName.trim()) return;
		saveLoading = true;
		try {
			const body: Record<string, unknown> = {
				action: 'save',
				name: segmentName.trim(),
				filters: currentFilter
			};
			if (editingSegmentId) body.id = editingSegmentId;

			const res = await fetch(`/api/org/${orgSlug}/segments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				const data = await res.json();
				if (editingSegmentId) {
					savedSegments = savedSegments.map((s) => (s.id === editingSegmentId ? data.segment : s));
				} else {
					savedSegments = [data.segment, ...savedSegments];
					editingSegmentId = data.segment.id;
				}
			}
		} catch {
			// ignore
		} finally {
			saveLoading = false;
		}
	}

	async function deleteSegment(id: string) {
		try {
			await fetch(`/api/org/${orgSlug}/segments?id=${id}`, { method: 'DELETE' });
			savedSegments = savedSegments.filter((s) => s.id !== id);
			if (editingSegmentId === id) {
				editingSegmentId = null;
				segmentName = '';
			}
		} catch {
			// ignore
		}
	}

	function clearAll() {
		conditions = [];
		logic = 'AND';
		editingSegmentId = null;
		segmentName = '';
		matchCount = null;
		matchCountPartial = false;
	}

	function handleApply() {
		onApply?.(currentFilter, matchCount ?? 0, matchCountPartial);
	}

	// --- Value renderers for each field type ---
	function getOperatorsForField(field: ConditionField) {
		return FIELD_OPTIONS.find((f) => f.value === field)?.operators ?? [];
	}

	// --- Bulk actions ---
	let bulkActionLoading = $state(false);
	let bulkTagId = $state('');
	let bulkConfirm = $state<{
		action: 'apply_tag' | 'remove_tag';
		tagId: string;
		tagName: string;
	} | null>(null);
	let bulkResult = $state<{ message: string; type: 'success' | 'error' } | null>(null);

	const bulkDisabled = $derived(matchCount === null || matchCount === 0 || countLoading);

	function promptBulkTag(action: 'apply_tag' | 'remove_tag') {
		if (!bulkTagId) return;
		const tag = tags.find((t) => t.id === bulkTagId);
		if (!tag) return;
		bulkConfirm = { action, tagId: bulkTagId, tagName: tag.name };
	}

	async function executeBulkTag() {
		if (!bulkConfirm) return;
		bulkActionLoading = true;
		bulkResult = null;
		try {
			const res = await fetch(`/api/org/${orgSlug}/segments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: bulkConfirm.action,
					filters: currentFilter,
					tagId: bulkConfirm.tagId
				})
			});
			if (res.ok) {
				const data = await res.json();
				const verb = bulkConfirm.action === 'apply_tag' ? 'Applied tag to' : 'Removed tag from';
				bulkResult = {
					message: `${verb} ${data.partial ? 'at least ' : ''}${data.affected} supporter${data.affected === 1 ? '' : 's'}${data.partial ? '; action hit the page cap and can be rerun for the remaining matching rows' : ''}`,
					type: 'success'
				};
			} else {
				const data = await res.json().catch(() => ({ message: 'Request failed' }));
				bulkResult = { message: data.message ?? 'Request failed', type: 'error' };
			}
		} catch {
			bulkResult = { message: 'Network error', type: 'error' };
		} finally {
			bulkActionLoading = false;
			bulkConfirm = null;
		}
	}

	async function exportCsv() {
		bulkActionLoading = true;
		bulkResult = null;
		try {
			const res = await fetch(`/api/org/${orgSlug}/segments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'export_csv', filters: currentFilter })
			});
			if (res.ok) {
				const blob = await res.blob();
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `segment-export-${Date.now()}.csv`;
				a.click();
				URL.revokeObjectURL(url);
				bulkResult = { message: 'CSV downloaded', type: 'success' };
			} else {
				const data = await res.json().catch(() => ({ message: 'Export failed' }));
				bulkResult = { message: data.message ?? 'Export failed', type: 'error' };
			}
		} catch {
			bulkResult = { message: 'Network error', type: 'error' };
		} finally {
			bulkActionLoading = false;
		}
	}
</script>

<div class="space-y-4">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h3 class="text-sm font-medium text-zinc-300">Segment Builder</h3>
		<div class="flex items-center gap-2">
			{#if conditions.length > 0}
				<button
					type="button"
					class="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
					onclick={clearAll}
				>
					Clear all
				</button>
			{/if}
			{#if showSaveControls}
				<button
					type="button"
					class="text-xs text-teal-400 transition-colors hover:text-teal-300"
					onclick={loadSegments}
				>
					{showSavedList ? 'Hide saved' : 'Saved segments'}
				</button>
			{/if}
		</div>
	</div>

	<div
		class="border-surface-border bg-surface-overlay grid gap-3 rounded-md border px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]"
		aria-label="Segment civic geography boundary"
	>
		<div class="min-w-0 space-y-1">
			<p class="text-text-secondary text-xs font-medium">Geography coverage</p>
			<p class="text-text-quaternary text-xs leading-relaxed">
				{civicGeographyBoundary}
			</p>
		</div>
		<div class="grid min-w-0 grid-cols-3 gap-2 md:min-w-72">
			<div class="bg-surface-base flex min-w-0 flex-col gap-1 rounded px-2 py-2">
				<span class="text-text-primary text-sm leading-none">
					<Datum
						value={importedReadableGeographyConditionCount}
						cite="SegmentBuilder currentFilter"
					/>
				</span>
				<span class="text-text-quaternary truncate text-[0.65rem] uppercase">imported labels</span>
			</div>
			<div class="bg-surface-base flex min-w-0 flex-col gap-1 rounded px-2 py-2">
				<span class="text-text-primary text-sm leading-none">
					<Datum
						value={actionReadableGeographyConditionCount}
						cite="SegmentBuilder currentFilter"
					/>
				</span>
				<span class="text-text-quaternary truncate text-[0.65rem] uppercase">action labels</span>
			</div>
			<div class="bg-surface-base flex min-w-0 flex-col gap-1 rounded px-2 py-2">
				<span class="text-text-primary text-sm leading-none">
					<Datum value={actionDistrictHashConditionCount} cite="SegmentBuilder currentFilter" />
				</span>
				<span class="text-text-quaternary truncate text-[0.65rem] uppercase">hash evidence</span>
			</div>
		</div>
		{#if civicGeographyConditionCount > 0}
			<p class="text-text-tertiary text-xs leading-relaxed md:col-span-2">
				Action-district hashes remain evidence filters; imported and action-time labels do not prove
				materialized local or special-district membership.
			</p>
		{/if}
	</div>

	<!-- Saved segments list -->
	{#if showSavedList}
		<div class="space-y-2 rounded-lg border border-zinc-800/60 bg-zinc-900/50 p-3">
			{#if savedSegments.length === 0}
				<p class="py-2 text-center text-xs text-zinc-500">No saved segments yet</p>
			{:else}
				{#each savedSegments as segment (segment.id)}
					<div class="flex items-center justify-between gap-2 rounded-md bg-zinc-800/50 px-3 py-2">
						<button
							type="button"
							class="flex-1 truncate text-left text-sm text-zinc-200 transition-colors hover:text-teal-400"
							onclick={() => loadSegment(segment)}
						>
							{segment.name}
						</button>
						<button
							type="button"
							class="flex-shrink-0 text-xs text-zinc-600 transition-colors hover:text-red-400"
							onclick={() => deleteSegment(segment.id)}
						>
							<svg
								class="h-3.5 w-3.5"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
								/>
							</svg>
						</button>
					</div>
				{/each}
			{/if}
		</div>
	{/if}

	<!-- Logic toggle (only show with 2+ conditions) -->
	{#if conditions.length >= 2}
		<div class="flex items-center gap-2">
			<span class="text-xs text-zinc-500">Match</span>
			<div class="flex items-center gap-0.5 rounded-lg border border-zinc-800/60 p-0.5">
				<button
					type="button"
					class="rounded-md px-3 py-1 text-xs transition-colors {logic === 'AND'
						? 'bg-zinc-700 text-zinc-100'
						: 'text-zinc-500 hover:text-zinc-300'}"
					onclick={() => (logic = 'AND')}
				>
					ALL
				</button>
				<button
					type="button"
					class="rounded-md px-3 py-1 text-xs transition-colors {logic === 'OR'
						? 'bg-zinc-700 text-zinc-100'
						: 'text-zinc-500 hover:text-zinc-300'}"
					onclick={() => (logic = 'OR')}
				>
					ANY
				</button>
			</div>
			<span class="text-xs text-zinc-500">conditions</span>
		</div>
	{/if}

	<!-- Conditions -->
	<div class="space-y-3">
		{#each conditions as condition, i (condition.id)}
			{@const fieldMeta = FIELD_OPTIONS.find((f) => f.value === condition.field)}
			<div class="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3">
				<div class="flex items-start gap-2">
					<!-- Condition number + logic label -->
					<div class="flex-shrink-0 pt-1.5">
						{#if i === 0}
							<span class="font-mono text-xs text-zinc-600">WHERE</span>
						{:else}
							<span class="font-mono text-xs text-zinc-600">{logic}</span>
						{/if}
					</div>

					<!-- Field + operator + value -->
					<div class="flex-1 space-y-2">
						<div class="flex flex-wrap items-center gap-2">
							<!-- Field selector -->
							<select
								class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								value={condition.field}
								onchange={(e) =>
									changeField(
										condition.id,
										(e.target as HTMLSelectElement).value as ConditionField
									)}
							>
								{#each FIELD_OPTIONS as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>

							<!-- Operator selector -->
							<select
								class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
								value={condition.operator}
								onchange={(e) =>
									updateCondition(condition.id, {
										operator: (e.target as HTMLSelectElement).value as ConditionOperator
									})}
							>
								{#each getOperatorsForField(condition.field) as op}
									<option value={op.value}>{op.label}</option>
								{/each}
							</select>
						</div>

						<!-- Value input (varies by field) -->
						<div class="pl-0">
							{#if condition.field === 'tag'}
								<!-- Multi-select tag chips -->
								{#if tags.length === 0}
									<p class="text-xs text-zinc-600 italic">No tags created yet</p>
								{:else}
									<div class="flex flex-wrap gap-1.5">
										{#each tags as tag (tag.id)}
											{@const selected =
												Array.isArray(condition.value) && condition.value.includes(tag.id)}
											<button
												type="button"
												class="rounded-md border px-2 py-1 text-xs transition-colors {selected
													? 'border-teal-500/30 bg-teal-500/20 text-teal-400'
													: 'border-zinc-700 bg-zinc-800/50 text-zinc-400 hover:border-zinc-600'}"
												onclick={() => {
													const current = Array.isArray(condition.value) ? condition.value : [];
													const next = selected
														? current.filter((id: string) => id !== tag.id)
														: [...current, tag.id];
													updateCondition(condition.id, { value: next });
												}}
											>
												{tag.name}
											</button>
										{/each}
									</div>
								{/if}
							{:else if condition.field === 'verification'}
								<select
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									value={String(condition.value)}
									onchange={(e) =>
										updateCondition(condition.id, { value: (e.target as HTMLSelectElement).value })}
								>
									<option value="">Select...</option>
									{#each VERIFICATION_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else if condition.field === 'engagementTier'}
								<select
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									value={String(condition.value)}
									onchange={(e) =>
										updateCondition(condition.id, {
											value: Number((e.target as HTMLSelectElement).value)
										})}
								>
									{#each TIER_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else if condition.field === 'source'}
								<select
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									value={String(condition.value)}
									onchange={(e) =>
										updateCondition(condition.id, { value: (e.target as HTMLSelectElement).value })}
								>
									<option value="">Select...</option>
									{#each SOURCE_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else if condition.field === 'emailStatus'}
								<select
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									value={String(condition.value)}
									onchange={(e) =>
										updateCondition(condition.id, { value: (e.target as HTMLSelectElement).value })}
								>
									<option value="">Select...</option>
									{#each EMAIL_STATUS_OPTIONS as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{:else if condition.field === 'dateRange'}
								{@const rangeVal =
									typeof condition.value === 'object' &&
									condition.value !== null &&
									!Array.isArray(condition.value)
										? (condition.value as { from?: string; to?: string })
										: { from: '', to: '' }}
								<div class="flex items-center gap-2">
									{#if condition.operator === 'between'}
										<input
											type="date"
											class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
											value={rangeVal.from ?? ''}
											onchange={(e) =>
												updateCondition(condition.id, {
													value: { ...rangeVal, from: (e.target as HTMLInputElement).value }
												})}
										/>
										<span class="text-xs text-zinc-500">to</span>
										<input
											type="date"
											class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
											value={rangeVal.to ?? ''}
											onchange={(e) =>
												updateCondition(condition.id, {
													value: { ...rangeVal, to: (e.target as HTMLInputElement).value }
												})}
										/>
									{:else}
										<input
											type="date"
											class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
											value={String(condition.value || '')}
											onchange={(e) =>
												updateCondition(condition.id, {
													value: (e.target as HTMLInputElement).value
												})}
										/>
									{/if}
								</div>
							{:else if condition.field === 'campaignParticipation'}
								{#if campaigns.length === 0}
									<p class="text-xs text-zinc-600 italic">No campaigns available</p>
								{:else}
									<select
										class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
										value={String(condition.value)}
										onchange={(e) =>
											updateCondition(condition.id, {
												value: (e.target as HTMLSelectElement).value
											})}
									>
										<option value="">Select campaign...</option>
										{#each campaigns as campaign}
											<option value={campaign.id}>{campaign.title}</option>
										{/each}
									</select>
								{/if}
							{:else if condition.field === 'actionDistrict'}
								<input
									type="text"
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 placeholder-zinc-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									placeholder="district hash"
									value={String(condition.value || '')}
									onchange={(e) =>
										updateCondition(condition.id, {
											value: (e.target as HTMLInputElement).value.trim().toLowerCase()
										})}
								/>
							{:else if condition.field === 'actionDistrictLabel'}
								<input
									type="text"
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 uppercase placeholder-zinc-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									placeholder="CA-11"
									maxlength="32"
									value={String(condition.value || '')}
									onchange={(e) =>
										updateCondition(condition.id, {
											value: (e.target as HTMLInputElement).value
												.trim()
												.replace(/\s+/g, ' ')
												.toUpperCase()
										})}
								/>
							{:else if condition.field === 'postalCode'}
								<input
									type="text"
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									placeholder={condition.operator === 'startsWith' ? '941' : '94110'}
									value={String(condition.value || '')}
									onchange={(e) =>
										updateCondition(condition.id, {
											value: (e.target as HTMLInputElement).value.trim().toUpperCase()
										})}
								/>
							{:else if condition.field === 'stateCode'}
								<input
									type="text"
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 uppercase placeholder-zinc-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									placeholder="CA"
									maxlength="8"
									value={String(condition.value || '')}
									onchange={(e) =>
										updateCondition(condition.id, {
											value: (e.target as HTMLInputElement).value.trim().toUpperCase()
										})}
								/>
							{:else if condition.field === 'congressionalDistrict'}
								<input
									type="text"
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 uppercase placeholder-zinc-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									placeholder="CA-11"
									maxlength="32"
									value={String(condition.value || '')}
									onchange={(e) =>
										updateCondition(condition.id, {
											value: (e.target as HTMLInputElement).value
												.trim()
												.replace(/\s+/g, ' ')
												.toUpperCase()
										})}
								/>
							{:else if condition.field === 'country'}
								<input
									type="text"
									class="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-200 uppercase placeholder-zinc-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
									placeholder="US"
									maxlength="2"
									value={String(condition.value || '')}
									onchange={(e) =>
										updateCondition(condition.id, {
											value: (e.target as HTMLInputElement).value.trim().toUpperCase()
										})}
								/>
							{/if}
						</div>
					</div>

					<!-- Remove button -->
					<button
						type="button"
						class="flex-shrink-0 rounded p-1 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
						onclick={() => removeCondition(condition.id)}
						aria-label="Remove condition"
					>
						<svg
							class="h-4 w-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
						>
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>
		{/each}
	</div>

	<!-- Add condition button -->
	<button
		type="button"
		class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-300"
		onclick={addCondition}
	>
		<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
			<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
		</svg>
		Add condition
	</button>

	<!-- Match count preview -->
	{#if conditions.length > 0}
		<div class="rounded-lg bg-zinc-800/50 px-4 py-3 text-center">
			{#if countLoading}
				<div class="flex items-center justify-center gap-2">
					<svg class="h-4 w-4 animate-spin text-zinc-500" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
						></circle>
						<path
							class="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						></path>
					</svg>
					<span class="text-sm text-zinc-500">Counting...</span>
				</div>
			{:else if matchCount !== null}
				<p class="font-mono text-2xl text-zinc-100 tabular-nums">
					{matchCountPartial ? '\u2265 ' : ''}{matchCount.toLocaleString()}
				</p>
				<p class="mt-0.5 text-xs text-zinc-500">supporter{matchCount === 1 ? '' : 's'} match</p>
				{#if matchCountPartial}
					<p class="mt-1 text-xs text-amber-300">
						Count hit the page cap; this is a lower bound, not a full cohort total.
					</p>
				{/if}
			{/if}
		</div>
	{/if}

	<!-- Save controls -->
	{#if showSaveControls && conditions.length > 0}
		<div class="flex items-center gap-2">
			<input
				type="text"
				placeholder="Segment name..."
				bind:value={segmentName}
				class="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
				maxlength={100}
			/>
			<button
				type="button"
				class="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
				disabled={!segmentName.trim() || saveLoading}
				onclick={saveSegment}
			>
				{saveLoading ? 'Saving...' : editingSegmentId ? 'Update' : 'Save'}
			</button>
		</div>
	{/if}

	<!-- Bulk actions -->
	{#if showBulkActions && conditions.length > 0}
		<div class="space-y-3 rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3">
			<h4 class="text-xs font-medium text-zinc-400">Bulk Actions</h4>

			<!-- Tag selector for apply/remove -->
			{#if tags.length > 0}
				<div class="flex items-center gap-2">
					<select
						class="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
						bind:value={bulkTagId}
					>
						<option value="">Select tag...</option>
						{#each tags as tag (tag.id)}
							<option value={tag.id}>{tag.name}</option>
						{/each}
					</select>
					<button
						type="button"
						class="rounded-md border border-teal-500/30 bg-teal-600/20 px-3 py-1.5 text-xs text-teal-400 transition-colors hover:bg-teal-600/30 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={bulkDisabled || !bulkTagId || bulkActionLoading}
						onclick={() => promptBulkTag('apply_tag')}
					>
						Apply Tag
					</button>
					<button
						type="button"
						class="rounded-md border border-red-500/20 bg-red-600/10 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-600/20 disabled:cursor-not-allowed disabled:opacity-40"
						disabled={bulkDisabled || !bulkTagId || bulkActionLoading}
						onclick={() => promptBulkTag('remove_tag')}
					>
						Remove Tag
					</button>
				</div>
			{/if}

			<!-- Export CSV -->
			<button
				type="button"
				class="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
				disabled={bulkDisabled || bulkActionLoading}
				onclick={exportCsv}
			>
				<svg
					class="h-3.5 w-3.5"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
					/>
				</svg>
				Export CSV
			</button>

			<!-- Confirmation dialog -->
			{#if bulkConfirm}
				<div class="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
					<p class="text-xs text-amber-200">
						{bulkConfirm.action === 'apply_tag' ? 'Apply' : 'Remove'} tag "{bulkConfirm.tagName}" {bulkConfirm.action ===
						'apply_tag'
							? 'to'
							: 'from'}
						{matchCountPartial ? 'at least ' : ''}{matchCount?.toLocaleString()} supporter{matchCount ===
						1
							? ''
							: 's'}?
					</p>
					{#if matchCountPartial}
						<p class="mt-1 text-xs text-amber-300">
							This action may stop at the page cap; rerun it to continue through the remaining
							matching rows.
						</p>
					{/if}
					<div class="mt-2 flex items-center gap-2">
						<button
							type="button"
							class="rounded-md bg-amber-600 px-3 py-1 text-xs text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
							disabled={bulkActionLoading}
							onclick={executeBulkTag}
						>
							{bulkActionLoading ? 'Processing...' : 'Confirm'}
						</button>
						<button
							type="button"
							class="rounded-md px-3 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
							onclick={() => (bulkConfirm = null)}
						>
							Cancel
						</button>
					</div>
				</div>
			{/if}

			<!-- Result message -->
			{#if bulkResult}
				<p class="text-xs {bulkResult.type === 'success' ? 'text-teal-400' : 'text-red-400'}">
					{bulkResult.message}
				</p>
			{/if}
		</div>
	{/if}

	<!-- Apply button (for integration) -->
	{#if onApply && conditions.length > 0 && matchCount !== null && matchCount > 0}
		<button
			type="button"
			class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500"
			onclick={handleApply}
		>
			Apply segment ({matchCountPartial ? 'at least ' : ''}{matchCount.toLocaleString()} supporter{matchCount ===
			1
				? ''
				: 's'})
		</button>
	{/if}
</div>
