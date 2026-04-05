<script lang="ts">
	/// <reference types="dom" />
	import { Mail, Sparkles, User, Edit3, ExternalLink } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import AnimatedPopover from '$lib/components/ui/AnimatedPopover.svelte';
	import type { Template } from '$lib/types/template';
	import { popover as popoverStore } from '$lib/stores/popover.svelte';
	import { coordinated, useTimerCleanup } from '$lib/utils/timerCoordinator';
	import { resolveTemplate } from '$lib/utils/templateResolver';
	import { toEmailServiceUser } from '$lib/types/user';
	import { getSourceTypeBadge } from '$lib/utils/message-processing';

	let {
		preview,
		template = undefined,
		user = null,
		context = 'list',
		onScroll,
		onscrollStateChange,
		ontouchStateChange,
		onvariableSelect,
		onvariableChange,
		expandToContent = false,
		initialVariableValues = {}
	}: {
		preview: string;
		template?: Template | undefined;
		user?: {
			id: string;
			name: string | null;
			email?: string;
			street?: string;
			city?: string;
			state?: string;
			zip?: string;
			is_verified?: boolean;
			verification_method?: string;
			representatives?: Array<{
				name: string;
				party: string;
				chamber: 'house' | 'senate' | string;
				state: string;
				district: string;
			}>;
		} | null;
		context?: 'list' | 'page' | 'modal';
		onScroll: (isAtBottom: boolean, scrollProgress?: number) => void;
		onscrollStateChange?: (scrollState: unknown) => void;
		ontouchStateChange?: (touchState: unknown) => void;
		onvariableSelect?: (__event: { variableName: string; active: boolean }) => void;
		onvariableChange?: (__event: { name: string; value: string }) => void;
		expandToContent?: boolean;
		initialVariableValues?: Record<string, string>;
	} = $props();
	let scrollContainer: HTMLDivElement;
	let isAtTop = $state(true);
	let isAtBottom = $state(false);
	let isScrollable = $state(false);
	let variableValues: Record<string, string | null> = $state({});

	// Define which variables are system-populated vs user-editable
	// Based on templateResolver.ts - these get auto-filled with user data
	const systemVariables = new Set([
		'Name',
		'Your Name',
		'Address',
		'Your Address',
		'City',
		'State',
		'ZIP',
		'Zip Code',
		'Representative Name',
		'Rep Name',
		'Representative',
		'Senator Name',
		'Senator',
		'Senior Senator',
		'Junior Senator'
	]);

	// These require user input and remain editable
	const userEditableVariables = new Set([
		'Personal Connection',
		'Phone',
		'Phone Number',
		'Your Phone',
		'Your Story',
		'Your Experience',
		'Personal Story'
	]);

	// Use centralized template resolver for comprehensive variable resolution
	const resolvedTemplate = $derived(() => {
		if (!template) return { body: preview };

		// Convert user to EmailServiceUser format if available
		const emailServiceUser = user ? toEmailServiceUser(user) : null;

		try {
			// Use preserveVariables option to keep variables for interactive display
			return resolveTemplate(template, emailServiceUser, { preserveVariables: true });
		} catch {
			return { body: preview };
		}
	});

	// For variable parsing, use the original template text (not resolved)
	// This ensures we can create interactive buttons for all variables
	const originalTemplateText = $derived(() => {
		if (template) {
			return template.message_body || template.preview || preview;
		}
		return preview;
	});

	// For display, we'll show a hybrid: resolved text with interactive variable buttons
	// where variables still exist in the original template
	const _resolvedPreview = $derived(resolvedTemplate().body);

	// Contextual hints and suggestions
	const variableHints: Record<string, { prompt: string; placeholder: string }> = {
		'Personal Connection': {
			prompt: 'Your voice',
			placeholder: 'Why this matters to you — your experience, your reasoning...'
		}
	};

	const systemVariableHints: Record<string, { title: string; description: string }> = {
		Name: {
			title: 'Your Profile Name',
			description: 'This will be replaced with your name from your profile.'
		},
		'Your Name': {
			title: 'Your Profile Name',
			description: 'This will be replaced with your name from your profile.'
		},
		Address: {
			title: 'Your Full Address',
			description: 'This will be replaced with your complete address from your profile.'
		},
		'Your Address': {
			title: 'Your Full Address',
			description: 'This will be replaced with your complete address from your profile.'
		},
		City: {
			title: 'Your City',
			description: 'This will be replaced with your city from your profile.'
		},
		State: {
			title: 'Your State',
			description: 'This will be replaced with your state from your profile.'
		},
		ZIP: {
			title: 'Your ZIP Code',
			description: 'This will be replaced with your ZIP code from your profile.'
		},
		'Zip Code': {
			title: 'Your ZIP Code',
			description: 'This will be replaced with your ZIP code from your profile.'
		},
		'Representative Name': {
			title: 'Auto-filled Variable',
			description: "This will be replaced with your representative's name based on your address."
		},
		'Rep Name': {
			title: 'Auto-filled Variable',
			description: "This will be replaced with your representative's name based on your address."
		},
		Representative: {
			title: 'Auto-filled Variable',
			description: "This will be replaced with your representative's title and name."
		},
		'Senator Name': {
			title: 'Auto-filled Variable',
			description: "This will be replaced with your senator's name based on your address."
		},
		Senator: {
			title: 'Auto-filled Variable',
			description: "This will be replaced with your senator's title and name."
		},
		'Senior Senator': {
			title: 'Auto-filled Variable',
			description: "This will be replaced with your state's senior senator."
		},
		'Junior Senator': {
			title: 'Auto-filled Variable',
			description: "This will be replaced with your state's junior senator."
		}
	};

	interface Segment {
		type: 'text' | 'variable' | 'citation';
		content: string;
		name?: string;
		instanceId?: string;
		citationNum?: number;
	}

	interface DismissStateEvent {
		isDismissing: boolean;
	}

	let modalDismissing = false;

	// Component ID for timer coordination
	const componentId = 'message-preview-' + Math.random().toString(36).substring(2, 15);

	// Parse template content into segments
	function parseTemplate(text: string): Segment[] {
		const segments: Segment[] = [];
		let currentIndex = 0;
		const variablePattern = /\[(.*?)\]/g;
		let match: RegExpExecArray | null;
		const instanceCounts = new Map<string, number>();

		while ((match = variablePattern.exec(text)) !== null) {
			// Add text before variable if exists
			if (match.index > currentIndex) {
				segments.push({
					type: 'text',
					content: text.slice(currentIndex, match.index)
				});
			}

			const innerText = match[1];

			// Purely numeric → citation marker [1], [2], etc.
			if (/^\d+$/.test(innerText)) {
				segments.push({
					type: 'citation',
					content: match[0],
					citationNum: parseInt(innerText, 10)
				});
			} else {
				// Track instances of each variable type
				const variableName = innerText;
				const currentCount = instanceCounts.get(variableName) || 0;
				const instanceNumber = currentCount + 1;
				instanceCounts.set(variableName, instanceNumber);

				// Add variable with unique instance ID
				segments.push({
					type: 'variable',
					name: variableName,
					content: match[0],
					instanceId: `${variableName}-${instanceNumber}`
				});
			}

			currentIndex = match.index + match[0].length;
		}

		// Add remaining text if exists
		if (currentIndex < text.length) {
			segments.push({
				type: 'text',
				content: text.slice(currentIndex)
			});
		}

		// Normalize whitespace around long-form variables:
		// The letter container is whitespace-pre-wrap, so any "\n" in text segments
		// adjacent to the voice card stacks with the card's own margin.
		// Strip all trailing/leading newlines — the card's my-* handles spacing.
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			if (seg.type === 'variable' && seg.name && isLongFormVariable(seg.name)) {
				if (i > 0 && segments[i - 1].type === 'text') {
					segments[i - 1].content = segments[i - 1].content.replace(/\n+$/, '');
				}
				if (i < segments.length - 1 && segments[i + 1].type === 'text') {
					segments[i + 1].content = segments[i + 1].content.replace(/^\n+/, '');
				}
			}
		}

		return segments;
	}

	// Build a lookup map from citation number to source
	const sourceMap = $derived(
		new Map((template?.sources || []).map((s) => [s.num, s]))
	);

	// Parse segments from original template to ensure variables are detected
	// Then render them with resolved content where appropriate
	const templateSegments = $derived(parseTemplate(originalTemplateText()));

	// Get resolved values for variables from the template resolver
	const resolvedValues = $derived(
		(() => {
			const emailServiceUser = user ? toEmailServiceUser(user) : null;

			// Create a map of variable name to resolved value
			const resolvedValues: Record<string, string | null> = {};

			if (emailServiceUser) {
				// These match the replacements in templateResolver.ts
				resolvedValues['Name'] = emailServiceUser.name || '';
				resolvedValues['Your Name'] = emailServiceUser.name || '';
				resolvedValues['Address'] =
					emailServiceUser.street &&
					emailServiceUser.city &&
					emailServiceUser.state &&
					emailServiceUser.zip
						? `${emailServiceUser.street}, ${emailServiceUser.city}, ${emailServiceUser.state} ${emailServiceUser.zip}`
						: null;
				resolvedValues['Your Address'] = resolvedValues['Address'];
				resolvedValues['City'] = emailServiceUser.city || null;
				resolvedValues['State'] = emailServiceUser.state || null;
				resolvedValues['ZIP'] = emailServiceUser.zip || null;
				resolvedValues['Zip Code'] = emailServiceUser.zip || null;

				// Representative values
				if (emailServiceUser.representatives && emailServiceUser.representatives.length > 0) {
					const primaryRep =
						emailServiceUser.representatives.find((r) => r.chamber === 'house') ||
						emailServiceUser.representatives[0];
					if (primaryRep) {
						resolvedValues['Representative Name'] = primaryRep.name;
						resolvedValues['Rep Name'] = primaryRep.name;
						resolvedValues['Representative'] = `Rep. ${primaryRep.name}`;
					}

					const senators = emailServiceUser.representatives.filter((r) => r.chamber === 'senate');
					if (senators.length > 0) {
						resolvedValues['Senator Name'] = senators[0].name;
						resolvedValues['Senator'] = `Sen. ${senators[0].name}`;
					}
					if (senators.length > 1) {
						resolvedValues['Senior Senator'] = `Sen. ${senators[0].name}`;
						resolvedValues['Junior Senator'] = `Sen. ${senators[1].name}`;
					}
				} else {
					// Default values when no representative data
					resolvedValues['Representative Name'] = 'Representative';
					resolvedValues['Rep Name'] = 'Representative';
					resolvedValues['Representative'] = 'Representative';
					resolvedValues['Senator Name'] = 'Senator';
					resolvedValues['Senator'] = 'Senator';
					resolvedValues['Senior Senator'] = 'Senior Senator';
					resolvedValues['Junior Senator'] = 'Junior Senator';
				}
			}

			return resolvedValues;
		})()
	);

	// Initialize variable values when segments change
	$effect(() => {
		const segments = templateSegments;
		if (Object.keys(variableValues).length === 0) {
			for (const segment of segments) {
				if (segment.type === 'variable' && segment.name) {
					if (userEditableVariables.has(segment.name)) {
						variableValues[segment.name] = initialVariableValues[segment.name] || null;
					} else {
						const resolvedValue = resolvedValues[segment.name];
						variableValues[segment.name] =
							resolvedValue && typeof resolvedValue === 'string' && resolvedValue.trim() !== ''
								? resolvedValue
								: null;
					}
				}
			}
		}
	});

	// Sync external initial values into editable variables (handles async restore from sessionStorage)
	$effect(() => {
		for (const [name, value] of Object.entries(initialVariableValues)) {
			if (value && userEditableVariables.has(name) && variableValues[name] !== value) {
				variableValues[name] = value;
			}
		}
	});

	onMount(() => {
		const handleDismissState = (e: CustomEvent<DismissStateEvent>) => {
			modalDismissing = e.detail.isDismissing;
		};

		const handleTouchEnd = () => {
			if (modalDismissing) {
				modalDismissing = false;
			}
		};

		document.addEventListener('dismissStateChange', handleDismissState as (event: Event) => void);
		document.addEventListener('touchend', handleTouchEnd);

		return () => {
			document.removeEventListener(
				'dismissStateChange',
				handleDismissState as (event: Event) => void
			);
			document.removeEventListener('touchend', handleTouchEnd);
			useTimerCleanup(componentId)();
			if (inlineBlurTimeout) clearTimeout(inlineBlurTimeout);
		};
	});

	function updateScrollState() {
		if (!scrollContainer) return;

		const { scrollHeight, clientHeight, scrollTop } = scrollContainer;
		isScrollable = scrollHeight > clientHeight;
		isAtTop = scrollTop <= 0;
		isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 1;

		const detail = {
			isScrollable,
			isAtTop,
			isAtBottom,
			scrollProgress: scrollTop / (scrollHeight - clientHeight)
		};
		// Dispatch custom event so modal can intercept
		scrollContainer.dispatchEvent(new CustomEvent('scrollStateChange', { detail, bubbles: true }));
		onscrollStateChange?.(detail);
	}

	function handleScroll() {
		updateScrollState();
		onScroll(isAtBottom);

		// Close any open popovers when scrolling
		if (popoverStore.popover) {
			popoverStore.close(popoverStore.popover.id);
		}
	}

	let touchStartY = 0;

	function handleTouchStart(__event: TouchEvent) {
		touchStartY = __event.touches[0].clientY;
		handleTouch(__event);
	}

	function handleTouch(__event: TouchEvent) {
		if (!scrollContainer) return;

		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		const touchY = __event.touches[0].clientY;

		const touchState = {
			touchY,
			touchStartY,
			isScrollable: scrollHeight > clientHeight,
			isAtTop: scrollTop <= 0,
			isAtBottom: Math.abs(scrollHeight - clientHeight - scrollTop) < 1,
			scrollPosition: scrollTop,
			maxScroll: scrollHeight - clientHeight,
			isDismissing: modalDismissing
		};

		if (
			!modalDismissing &&
			touchState.isScrollable &&
			!(
				(touchState.isAtTop && touchY > touchStartY) ||
				(touchState.isAtBottom && touchY < touchStartY)
			)
		) {
			__event.stopPropagation();
		}

		// Dispatch custom event so modal can adjust gesture handling
		scrollContainer.dispatchEvent(
			new CustomEvent('touchStateChange', { detail: touchState, bubbles: true })
		);
		ontouchStateChange?.(touchState);
	}

	function handleTouchEnd() {
		if (modalDismissing) {
			modalDismissing = false;
		}
	}

	function handleVariableClick(variableName: string) {
		// The popover handles opening/closing automatically
		// We just need to notify the parent component
		if (userEditableVariables.has(variableName)) {
			onvariableSelect?.({ variableName: variableName, active: true });
		}
	}

	function handleInput(e: Event, name: string) {
		const target = e.target as HTMLInputElement | HTMLTextAreaElement;
		variableValues[name] = target.value;

		// Bubble variable changes up to parent for JS-land template updates
		onvariableChange?.({ name, value: target.value });

		// Automatically resize textarea
		if (target.tagName.toLowerCase() === 'textarea') {
			target.style.height = 'auto';
			target.style.height = `${target.scrollHeight}px`;
		}

		// No heuristics here – personalization is purely user-driven.
	}

	// ── Inline editing for long-form variables ──
	// Personal Connection asks for emotional truth — a paragraph, not a form field.
	// Instead of a disconnected popover, the letter opens up in-place:
	// the surrounding sentences stay visible as context for what you're writing.
	let activeInlineEditor: string | null = $state(null);
	let inlineBlurTimeout: ReturnType<typeof setTimeout> | null = null;

	function isLongFormVariable(name: string): boolean {
		const lower = name.toLowerCase();
		return (
			lower.includes('connection') ||
			lower.includes('story') ||
			lower.includes('experience') ||
			lower.includes('reasoning')
		);
	}

	function openInlineEditor(instanceId: string) {
		activeInlineEditor = instanceId;
	}

	function handleInlineBlur() {
		inlineBlurTimeout = setTimeout(() => {
			activeInlineEditor = null;
		}, 150);
	}

	function handleInlineFocus() {
		if (inlineBlurTimeout) {
			clearTimeout(inlineBlurTimeout);
			inlineBlurTimeout = null;
		}
	}

	function handleInlineKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			activeInlineEditor = null;
		}
	}

	function handleInlineInput(e: Event, name: string) {
		handleInput(e, name);
	}

	function autofocusAction(node: HTMLTextAreaElement) {
		requestAnimationFrame(() => {
			node.focus();
			const len = node.value.length;
			node.setSelectionRange(len, len);
			node.style.height = 'auto';
			node.style.height = `${Math.max(node.scrollHeight, 72)}px`;
			node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		});
	}

	// Close inline editor when template changes (segments re-derive from template text)
	const _segmentsForEditorReset = $derived(originalTemplateText());
	$effect(() => {
		_segmentsForEditorReset; // track template text changes
		return () => {
			// Runs before re-execution — i.e., when template text changes
			activeInlineEditor = null;
		};
	});

	$effect(() => {
		if (browser && preview) {
			coordinated.setTimeout(
				() => {
					updateScrollState();
				},
				0,
				'dom',
				componentId
			);
		}
	});

	// Variable styling: variables are parts of a letter, not code tokens.
	// System variables blend into the text with subtle personalization cues.
	// User-editable variables invite contribution with warm affordances.
	function getVariableClasses(variableName: string): string {
		const isSystemVariable = systemVariables.has(variableName);
		const isUserEditable = userEditableVariables.has(variableName);
		const isEmpty =
			!variableValues[variableName] ||
			(typeof variableValues[variableName] === 'string' &&
				variableValues[variableName]!.trim() === '');

		if (isSystemVariable) {
			// Resolved system variables — generous hover target, hint cursor signals tooltip
			return `
				inline-flex items-center gap-1
				px-1.5 py-0.5 rounded-md
				text-sm leading-none
				transition-colors duration-150
				text-emerald-800 bg-emerald-50/60 border-b border-dotted border-emerald-300/70
				hover:bg-emerald-100/80
				cursor-help align-baseline
			`;
		} else if (isUserEditable) {
			if (isEmpty) {
				// Empty: warm invitation to contribute — spacious, not a code token
				return `
					inline-flex items-center gap-1.5
					px-2 py-0.5 rounded-md
					text-sm leading-none
					cursor-pointer transition-all duration-200
					bg-participation-primary-50 text-participation-primary-600
					border border-dashed border-participation-primary-300/70
					hover:bg-participation-primary-100 hover:border-participation-primary-400
					align-baseline
				`;
			} else {
				// Filled: flows naturally into the letter with subtle underline
				return `
					inline-flex items-center gap-0.5
					px-0.5 rounded
					text-sm leading-none
					cursor-pointer transition-all duration-200
					text-participation-primary-800 border-b border-participation-primary-300/60
					hover:bg-participation-primary-50
					align-baseline
				`;
			}
		} else {
			// Unknown variables: subtle inline treatment
			return `
				inline-flex items-center
				px-0.5 rounded
				text-sm leading-none
				cursor-pointer transition-colors duration-150
				text-slate-600 border-b border-dotted border-slate-300
				align-baseline
			`;
		}
	}
</script>

<div class="relative flex h-full cursor-text flex-col">
	<!-- Subject/Title Header - Hide on template page to avoid duplication -->
	{#if context !== 'page'}
		{#if template?.subject || template?.title}
			<div class="mb-5 sm:mb-6">
				<h2 class="font-brand text-xl font-bold leading-snug tracking-tight text-[var(--text-primary)] sm:text-2xl">
					{template.title || template.subject}
				</h2>
				<div class="card-rule mt-3"></div>
			</div>
		{:else}
			<div class="mb-4 flex shrink-0 items-center gap-2">
				<Mail class="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
				<h3 class="font-brand text-base font-medium text-[var(--text-primary)]">Message Preview</h3>
			</div>
		{/if}
	{/if}

	<div class="relative {expandToContent ? '' : 'flex-1'} min-h-[16rem]">
		<div
			class="correspondence-scroll {expandToContent
				? 'overflow-visible'
				: 'absolute inset-0 overflow-y-auto'} max-w-[65ch] whitespace-pre-wrap"
			bind:this={scrollContainer}
			onscroll={expandToContent ? undefined : handleScroll}
			ontouchstart={expandToContent ? undefined : handleTouchStart}
			ontouchmove={expandToContent ? undefined : handleTouch}
			ontouchend={expandToContent ? undefined : handleTouchEnd}
			data-scrollable={expandToContent ? false : isScrollable}
		>
			<div class="min-h-[12rem] font-sans text-sm leading-relaxed text-[var(--text-secondary)] sm:text-[15px] sm:leading-7">
				{#each templateSegments as segment}
					{#if segment.type === 'text'}
						{segment.content}
					{:else if segment.type === 'citation'}
						{@const source = segment.citationNum != null ? sourceMap.get(segment.citationNum) : undefined}
						{#if source}
							{@const badge = getSourceTypeBadge(source.type)}
							{@const domain = (() => { try { return new URL(source.url).hostname.replace('www.', ''); } catch { return source.url; } })()}
							<a
								href={source.url}
								target="_blank"
								rel="noopener noreferrer"
								class="citation-ref group/cite relative inline-flex items-center"
								aria-label="Source {source.num}: {source.title}"
							>
								<span
									class="inline-flex items-center justify-center rounded px-[3px] py-[1px]
										text-[11px] font-semibold leading-none tracking-tight
										text-participation-primary-600 bg-participation-primary-50/80
										border border-participation-primary-200/60
										transition-all duration-150
										group-hover/cite:bg-participation-primary-100 group-hover/cite:border-participation-primary-300
										group-hover/cite:text-participation-primary-700 group-hover/cite:shadow-sm
										align-super cursor-pointer"
								>
									{segment.citationNum}
								</span>
								<!-- Hover tooltip -->
								<span
									class="pointer-events-none absolute bottom-full left-0 z-50 mb-2
										sm:left-1/2 sm:-translate-x-1/2
										opacity-0 transition-opacity duration-150
										group-hover/cite:pointer-events-auto group-hover/cite:opacity-100"
								>
									<span
										class="flex w-max max-w-[min(280px,calc(100vw-3rem))] flex-col gap-1 rounded-lg border border-slate-200
											bg-white px-3 py-2.5 shadow-lg"
									>
										<span class="flex items-center gap-1.5">
											<span
												class="inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none {badge.bg} {badge.text} {badge.border}"
											>
												{source.type}
											</span>
										</span>
										<span class="text-xs font-medium leading-snug text-slate-900">{source.title}</span>
										<span class="flex items-center gap-1 text-[10px] text-slate-400">
											<ExternalLink class="h-2.5 w-2.5" />
											{domain}
										</span>
									</span>
									<!-- Arrow -->
									<span
										class="absolute left-4 top-full sm:left-1/2 sm:-translate-x-1/2 border-4 border-transparent border-t-white drop-shadow-sm"
									></span>
								</span>
							</a>
						{:else}
							<span class="text-slate-400">{segment.content}</span>
						{/if}
					{:else if segment.name && isLongFormVariable(segment.name)}
						<!--
							Voice card — one persistent element, three intensities.
							No mount/unmount between states. The card deepens when
							activated, settles when filled. CSS transitions handle the
							morphing so the person experiences continuity, not replacement.
						-->
						{@const isEditing = activeInlineEditor === segment.instanceId}
						{@const isFilled = !!(segment.name && variableValues[segment.name])}
						<div
							class="voice-card my-3 whitespace-normal rounded-xl px-5 py-4
								{isEditing
									? 'voice-card--active'
									: isFilled
										? 'voice-card--spoken cursor-pointer'
										: 'voice-card--resting cursor-pointer'
								}"
							role={isEditing ? undefined : 'button'}
							tabindex={isEditing ? undefined : 0}
							onclick={isEditing ? undefined : () => openInlineEditor(segment.instanceId || '')}
							onkeydown={isEditing ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInlineEditor(segment.instanceId || ''); } }}
							aria-label={isEditing ? undefined : isFilled ? `Edit your ${segment.name}` : `Add your ${segment.name}`}
						>
							<!-- Gradient accent bar — topic-colored -->
							<div class="voice-card__bar h-[3px] w-12 rounded-full mb-3"></div>

							<!-- Label — persistent across resting/editing, hidden when spoken -->
							{#if !isFilled || isEditing}
								<div class="mb-2 flex items-center gap-1.5">
									<Edit3 class="h-3.5 w-3.5 {isEditing ? 'voice-card__label--active' : 'voice-card__label'}" />
									<span class="text-[11px] font-semibold uppercase tracking-wider
										{isEditing ? 'voice-card__label--active' : 'voice-card__label'}">
										{(segment.name && variableHints[segment.name]?.prompt) || 'Your voice'}
									</span>
								</div>
							{/if}

							<!-- Content swaps instantly — the card shell's CSS transition is the animation -->
							{#if isEditing}
								<textarea
									use:autofocusAction
									value={variableValues[segment.name] || ''}
									oninput={(e) => handleInlineInput(e, segment.name || '')}
									onfocusout={handleInlineBlur}
									onfocusin={handleInlineFocus}
									onkeydown={handleInlineKeydown}
									placeholder={(segment.name && variableHints[segment.name]?.placeholder) ||
										`Why this matters to you — your experience, your reasoning...`}
									class="w-full resize-none border-0 bg-transparent p-0
										font-sans text-sm leading-relaxed sm:text-[15px] sm:leading-7
										text-[var(--text-primary)]
										placeholder:text-[var(--text-tertiary)]
										focus:ring-0 focus:outline-none"
									rows="3"
								></textarea>
							{:else if isFilled}
								<span class="text-[var(--text-primary)]">{variableValues[segment.name]}</span>
							{:else}
								<span class="text-sm text-[var(--text-secondary)]">
									Your perspective — why this matters to you
								</span>
							{/if}
						</div>
					{:else if segment.name}
						<span class="relative inline-block">
							<AnimatedPopover id={segment.instanceId || ''}>
								{#snippet trigger(_params)}
									<button
										class={getVariableClasses(segment.name || '')}
										onclick={() => handleVariableClick(segment.name || '')}
										aria-label={`Edit ${segment.name} variable`}
										type="button"
									>
										<!-- Variable type indicator -->
										{#if segment.name && systemVariables.has(segment.name)}
											<User class="h-3 w-3 text-emerald-600/70" />
										{:else if segment.name && userEditableVariables.has(segment.name)}
											<Edit3 class="h-3 w-3 text-participation-primary-500" />
										{/if}

										<!-- Resolved value, user input, or placeholder -->
										<span>
											{#if segment.name && resolvedValues[segment.name]}
												{resolvedValues[segment.name]}
											{:else if segment.name && variableValues[segment.name]}
												{variableValues[segment.name]}
											{:else}
												{segment.name || ''}
											{/if}
										</span>
									</button>
								{/snippet}

								{#snippet children(_props)}
									<!-- User-editable variables with input in popover -->
									{#if segment.name && userEditableVariables.has(segment.name)}
										<div class="mb-2 flex items-center gap-1.5">
											<Sparkles class="h-3 w-3 text-purple-500" />
											<span class="text-[11px] font-medium tracking-tight text-slate-700">
												{(segment.name && variableHints[segment.name]?.prompt) ||
													segment.name ||
													''}
											</span>
										</div>

										{#if segment.name && (segment.name
												.toLowerCase()
												.includes('connection') || segment.name
													.toLowerCase()
													.includes('story') || segment.name.toLowerCase().includes('reasoning'))}
											<textarea
												value={segment.name ? variableValues[segment.name] || '' : ''}
												oninput={(e) => handleInput(e, segment.name || '')}
												placeholder={(segment.name && variableHints[segment.name]?.placeholder) ||
													`Enter your ${segment.name || 'value'}...`}
												class="w-full min-w-[280px] resize-none rounded-lg border border-slate-300 bg-white p-3
														font-sans text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500 focus:ring-opacity-20"
												rows="4"
											></textarea>
											<!-- Character count and encouragement -->
											{#if segment.name && variableValues[segment.name] && typeof variableValues[segment.name] === 'string' && (variableValues[segment.name] as string).length > 10}
												<div class="mt-1 text-xs text-purple-600">
													{(variableValues[segment.name] as string).length} characters • Looking great!
												</div>
											{/if}
										{:else}
											<input
												value={segment.name ? variableValues[segment.name] || '' : ''}
												oninput={(e) => handleInput(e, segment.name || '')}
												placeholder={`Enter ${segment.name || 'value'}...`}
												class="w-full min-w-[240px] rounded-lg border border-slate-300 bg-white px-3 py-2
														font-sans text-sm focus:border-purple-500 focus:ring-2 focus:ring-purple-500 focus:ring-opacity-20"
											/>
										{/if}
									{/if}

									<!-- System-populated hint popup -->
									{#if segment.name && systemVariables.has(segment.name) && systemVariableHints[segment.name]}
										<div class="mb-1 flex items-center gap-1.5">
											<User class="h-3 w-3 text-emerald-500" />
											<span class="text-[11px] font-medium tracking-tight text-slate-700">
												{segment.name ? systemVariableHints[segment.name]?.title || '' : ''}
											</span>
										</div>
										<p class="text-[11px] leading-tight text-slate-500">
											{segment.name ? systemVariableHints[segment.name]?.description || '' : ''}
										</p>
									{/if}
								{/snippet}
							</AnimatedPopover>
						</span>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Scroll fades — the letter trails off at edges -->
		{#if !expandToContent && isScrollable && !isAtTop}
			<div
				class="pointer-events-none absolute inset-x-0 top-0 z-10 h-12
					bg-gradient-to-b from-[oklch(0.98_0.03_var(--card-hue)_/_0.95)] to-transparent"
				aria-hidden="true"
			></div>
		{/if}
		{#if !expandToContent && isScrollable && !isAtBottom}
			<div
				class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16
					bg-gradient-to-t from-[oklch(0.98_0.03_var(--card-hue)_/_0.95)] to-transparent"
				aria-hidden="true"
			></div>
		{/if}
	</div>
</div>
