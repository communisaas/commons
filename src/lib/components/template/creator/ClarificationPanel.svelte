<script lang="ts">
	/**
	 * ClarificationPanel: Conversational clarification UI
	 *
	 * PERCEPTUAL ENGINEERING:
	 * - Feels like a conversation turn, not a form
	 * - Agent formulates questions in natural language
	 * - Three input types: multiple_choice (recognition), location_picker (structured), open_text (free-form)
	 * - Multiple-choice uses checkboxes — user can select multiple interpretations at once
	 * - "Something else" is a checkbox too; when checked, text input must be non-empty
	 * - Smooth transitions, consistent timing
	 *
	 * COGNITIVE LOAD:
	 * - Maximum 2 questions (4±1 working memory chunks)
	 * - Multiple-choice: recognition > recall (user picks from interpretations, doesn't have to formulate)
	 * - Pre-filled values reduce recall burden
	 * - Skip option respects user agency
	 */

	import type {
		ClarificationQuestion,
		InferredContext
	} from '$lib/core/agents/types/clarification';
	import LocationAutocomplete from '../../template-browser/LocationAutocomplete.svelte';
	import type { LocationHierarchy } from '$lib/core/location/location-search';
	import { slide, fade } from 'svelte/transition';

	interface Props {
		questions: ClarificationQuestion[];
		inferredContext: InferredContext;
		onSubmit: (answers: Record<string, string>) => void;
		onSkip: () => void;
	}

	let { questions, inferredContext, onSubmit, onSkip }: Props = $props();

	// Answer state - keyed by question ID
	let answers = $state<Record<string, string>>({});

	// Track which questions are in "Other" mode (showing search instead of buttons)
	let showSearchMode = $state<Record<string, boolean>>({});

	// Track which multiple_choice questions have "Something else" checked
	let otherChecked = $state<Record<string, boolean>>({});

	// Track "Something else" text input per question
	let otherText = $state<Record<string, string>>({});

	// Track selected option IDs as a Set for multi-select (checkbox behavior)
	let selectedOptionSets = $state<Record<string, Set<string>>>({});

	// Initialize with any prefilled values
	$effect(() => {
		const initialAnswers: Record<string, string> = {};
		questions.forEach((question) => {
			if (question.type === 'location_picker' && question.prefilled_location) {
				initialAnswers[question.id] = question.prefilled_location;
			}
		});
		answers = initialAnswers;
	});

	const ANSWER_DELIMITER = '|||';

	// Build answer string from multi-select state for a given question
	function buildAnswer(questionId: string, question: ClarificationQuestion): string {
		if (question.type !== 'multiple_choice') return answers[questionId] || '';

		const selected = selectedOptionSets[questionId];
		const parts: string[] = [];

		if (selected?.size) {
			for (const optId of selected) {
				const opt = question.options?.find((o) => o.id === optId);
				if (opt) parts.push(opt.label);
			}
		}
		if (otherChecked[questionId] && otherText[questionId]?.trim()) {
			parts.push(otherText[questionId].trim());
		}
		return parts.join(ANSWER_DELIMITER);
	}

	// Sync answers whenever selections change
	$effect(() => {
		for (const question of questions) {
			if (question.type === 'multiple_choice') {
				// Touch reactive deps
				const _set = selectedOptionSets[question.id];
				const _other = otherChecked[question.id];
				const _text = otherText[question.id];
				answers[question.id] = buildAnswer(question.id, question);
			}
		}
	});

	// Check if all required questions are answered
	// For multiple_choice: at least one option selected, and if "something else" is checked, text must be non-empty
	const canSubmit = $derived(
		questions.every((q) => {
			if (!q.required) return true;
			if (q.type === 'multiple_choice') {
				const hasOption = (selectedOptionSets[q.id]?.size ?? 0) > 0;
				const hasValidOther = otherChecked[q.id] ? (otherText[q.id]?.trim().length ?? 0) > 0 : false;
				const otherNeedsText = otherChecked[q.id] && !hasValidOther;
				return (hasOption || hasValidOther) && !otherNeedsText;
			}
			return answers[q.id]?.trim().length > 0;
		})
	);

	function handleLocationSelect(questionId: string, location: LocationHierarchy) {
		let locationString = location.display_name;

		if (location.city?.name) {
			locationString = `${location.city.name}, ${location.state?.code || location.country.code}`;
		} else if (location.state?.name) {
			locationString = `${location.state.name}, ${location.country.code}`;
		} else if (location.country?.name) {
			locationString = location.country.name;
		}

		answers[questionId] = locationString;
	}

	function handleSuggestionClick(questionId: string, suggestion: string) {
		answers[questionId] = suggestion;
	}

	function handleOptionToggle(questionId: string, option: { id: string; label: string }) {
		const current = selectedOptionSets[questionId] ?? new Set<string>();
		const next = new Set(current);
		if (next.has(option.id)) {
			next.delete(option.id);
		} else {
			next.add(option.id);
		}
		selectedOptionSets[questionId] = next;
	}

	function handleOtherToggle(questionId: string) {
		otherChecked[questionId] = !otherChecked[questionId];
		if (!otherChecked[questionId]) {
			otherText[questionId] = '';
		}
	}

	function handleOtherInput(questionId: string, event: Event) {
		const target = event.target as HTMLInputElement;
		otherText[questionId] = target.value;
	}

	function toggleSearchMode(questionId: string) {
		showSearchMode[questionId] = true;
	}

	function handleTextInput(questionId: string, event: Event) {
		const target = event.target as HTMLInputElement | HTMLTextAreaElement;
		answers[questionId] = target.value;
	}

	function handleSubmit() {
		if (canSubmit) {
			onSubmit(answers);
		}
	}

	// Keyboard shortcuts: Enter to submit (when not in textarea), Escape to skip
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canSubmit && !(e.target instanceof HTMLTextAreaElement)) {
			e.preventDefault();
			handleSubmit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onSkip();
		}
	}

	// Map location_level to LocationAutocomplete level prop
	function getLocationLevel(level?: 'city' | 'state' | 'country'): 'country' | 'state' | 'city' {
		return level || 'city';
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class="clarification-panel rounded-md border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-6 shadow-sm"
	transition:slide={{ duration: 250 }}
>
	<!-- Conversational Header -->
	<header class="mb-6">
		<div class="flex items-start gap-3">
			<!-- Agent avatar indicator -->
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-participation-primary-100"
			>
				<svg
					class="h-4 w-4 text-participation-primary-600"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
					></path>
				</svg>
			</div>
			<div>
				<p class="text-base font-medium text-slate-900">I want to make sure I understand</p>
				<p class="mt-0.5 text-sm text-slate-500">Select everything that applies</p>
			</div>
		</div>
	</header>

	<!-- Questions (conversational flow) -->
	<div class="space-y-5">
		{#each questions as question, index}
			<div class="question-block" transition:fade={{ duration: 150, delay: index * 50 }}>
				<!-- Question text (agent's voice) -->
				<label for={question.id} class="mb-2 block text-sm font-medium text-slate-800">
					{question.question}
					{#if !question.required}
						<span class="ml-1 font-normal text-slate-400">(optional)</span>
					{/if}
				</label>

				{#if question.type === 'multiple_choice' && question.options}
					<!-- Multiple Choice: checkboxes — user can select multiple interpretations -->
					<div class="space-y-2" role="group" aria-labelledby={question.id}>
						{#each question.options as option}
							{@const isChecked = selectedOptionSets[question.id]?.has(option.id) ?? false}
							<button
								type="button"
								onclick={() => handleOptionToggle(question.id, option)}
								class="w-full rounded-lg border-2 px-4 py-3 text-left text-sm leading-relaxed transition-all duration-150
									{isChecked
									? 'border-participation-primary-500 bg-participation-primary-50 text-participation-primary-800 shadow-sm ring-1 ring-participation-primary-500/30'
									: 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}"
								role="checkbox"
								aria-checked={isChecked}
							>
								<span class="flex items-start gap-3">
									<!-- Checkbox indicator -->
									<span
										class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors
											{isChecked
											? 'border-participation-primary-500 bg-participation-primary-500'
											: 'border-slate-300'}"
									>
										{#if isChecked}
											<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" transition:fade={{ duration: 100 }}>
												<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
											</svg>
										{/if}
									</span>
									<span>{option.label}</span>
								</span>
							</button>
						{/each}

						<!-- "Something else" checkbox -->
						{#if question.allow_other !== false}
							{@const otherIsChecked = otherChecked[question.id] ?? false}
							<button
								type="button"
								onclick={() => handleOtherToggle(question.id)}
								class="w-full rounded-lg border-2 px-4 py-3 text-left text-sm transition-all duration-150
									{otherIsChecked
									? 'border-participation-primary-500 bg-participation-primary-50 text-participation-primary-800 ring-1 ring-participation-primary-500/30'
									: 'border-dashed border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'}"
								role="checkbox"
								aria-checked={otherIsChecked}
							>
								<span class="flex items-start gap-3">
									<span
										class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors
											{otherIsChecked
											? 'border-participation-primary-500 bg-participation-primary-500'
											: 'border-slate-300'}"
									>
										{#if otherIsChecked}
											<svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" transition:fade={{ duration: 100 }}>
												<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
											</svg>
										{/if}
									</span>
									<span>Something else</span>
								</span>
							</button>

							{#if otherIsChecked}
								<div transition:slide={{ duration: 150 }} class="pl-7">
									<input
										type="text"
										placeholder={question.placeholder || 'Tell me what I\'m missing...'}
										value={otherText[question.id] || ''}
										oninput={(e) => handleOtherInput(question.id, e)}
										class="w-full rounded-lg border-2 bg-white px-4 py-2.5
											text-sm text-slate-900 transition-all duration-150
											placeholder:text-slate-400
											focus:border-participation-primary-500 focus:bg-white focus:outline-none
											focus:ring-2 focus:ring-participation-primary-500/20
											{otherIsChecked && !(otherText[question.id]?.trim())
											? 'border-amber-300'
											: 'border-slate-200'}"
									/>
									{#if otherIsChecked && !(otherText[question.id]?.trim())}
										<p class="mt-1 text-xs text-amber-600" transition:fade={{ duration: 100 }}>Tell us what's on your mind</p>
									{/if}
								</div>
							{/if}
						{/if}
					</div>
				{:else if question.type === 'location_picker'}
					<!-- Location Autocomplete -->
					<div class="location-input-wrapper">
						{#if question.suggested_locations && question.suggested_locations.length > 0 && !showSearchMode[question.id]}
							<!-- Suggested Locations Buttons -->
							<div class="mb-3 flex flex-wrap gap-2">
								{#each question.suggested_locations as suggestion}
									<button
										type="button"
										onclick={() => handleSuggestionClick(question.id, suggestion)}
										class="rounded-lg border px-4 py-2 text-sm font-medium transition-all
											{answers[question.id] === suggestion
											? 'border-participation-primary-500 bg-participation-primary-50 text-participation-primary-700 ring-1 ring-participation-primary-500'
											: 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'}"
									>
										{suggestion}
									</button>
								{/each}

								<!-- "Other" Button -->
								<button
									type="button"
									onclick={() => toggleSearchMode(question.id)}
									class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500
										transition-colors hover:bg-slate-50 hover:text-slate-700"
								>
									Other...
								</button>
							</div>
						{:else}
							<!-- Location Autocomplete (Search) -->
							<LocationAutocomplete
								label={answers[question.id] ||
									question.prefilled_location ||
									'Search for a city or state...'}
								level={getLocationLevel(question.location_level)}
								isSelected={!!answers[question.id]}
								suggestedLocations={question.suggested_locations}
								onselect={(location) => handleLocationSelect(question.id, location)}
							/>
							{#if question.suggested_locations && question.suggested_locations.length > 0}
								<button
									onclick={() => (showSearchMode[question.id] = false)}
									class="mt-2 text-xs text-participation-primary-600 hover:underline"
								>
									Show suggestions
								</button>
							{/if}
						{/if}
					</div>
				{:else}
					<!-- Open Text Input -->
					<div class="relative">
						<input
							type="text"
							id={question.id}
							value={answers[question.id] || ''}
							placeholder={question.placeholder || 'Type your answer...'}
							oninput={(e) => handleTextInput(question.id, e)}
							class="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3
								text-base text-slate-900 transition-all duration-150
								placeholder:text-slate-400
								focus:border-participation-primary-500 focus:bg-white focus:outline-none
								focus:ring-2 focus:ring-participation-primary-500/20"
						/>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Agent reasoning (collapsed, for transparency) -->
	{#if inferredContext.reasoning}
		<details class="mt-5">
			<summary class="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
				Why am I asking?
			</summary>
			<p class="mt-2 text-xs leading-relaxed text-slate-500">
				{inferredContext.reasoning}
			</p>
		</details>
	{/if}

	<!-- Actions -->
	<footer class="mt-6 flex items-center justify-between border-t border-slate-100 pt-5">
		<button
			type="button"
			onclick={onSkip}
			class="text-sm font-medium text-slate-500 transition-colors duration-150 hover:text-slate-700"
		>
			Skip — use your best guess
		</button>

		<button
			type="button"
			onclick={handleSubmit}
			disabled={!canSubmit}
			class="inline-flex items-center gap-2 rounded-lg bg-participation-primary-600 px-5 py-2.5
				text-sm font-semibold text-white shadow-sm transition-all duration-150
				hover:bg-participation-primary-700 hover:shadow
				disabled:cursor-not-allowed disabled:opacity-50"
		>
			Continue
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
			</svg>
		</button>
	</footer>
</div>

<style>
	/* Subtle focus enhancement for the whole panel */
	.clarification-panel:focus-within {
		box-shadow: 0 0 0 2px rgba(var(--participation-primary-500), 0.1);
	}

	/* Location picker wrapper styling */
	.location-input-wrapper :global(.location-autocomplete) {
		width: 100%;
	}
</style>
