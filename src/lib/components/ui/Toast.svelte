<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { CheckCircle, XCircle, AlertTriangle, Info, X } from '@lucide/svelte';
	import { formatErrorMessage } from '$lib/utils/error-formatting';

	interface Props {
		type?: 'success' | 'error' | 'warning' | 'info';
		title?: string;
		message: string | unknown;
		duration?: number;
		dismissible?: boolean;
		onDismiss?: () => void;
	}

	const {
		type = 'info',
		title,
		message,
		duration = 5000,
		dismissible = true,
		onDismiss
	}: Props = $props();

	let visible = $state(true);

	const typeConfig = {
		success: {
			icon: CheckCircle,
			bgColor: 'bg-green-50',
			borderColor: 'border-green-200',
			iconColor: 'text-green-500',
			titleColor: 'text-green-800',
			messageColor: 'text-green-700'
		},
		error: {
			icon: XCircle,
			bgColor: 'bg-red-50',
			borderColor: 'border-red-200',
			iconColor: 'text-red-500',
			titleColor: 'text-red-800',
			messageColor: 'text-red-700'
		},
		warning: {
			icon: AlertTriangle,
			bgColor: 'bg-yellow-50',
			borderColor: 'border-yellow-200',
			iconColor: 'text-yellow-500',
			titleColor: 'text-yellow-800',
			messageColor: 'text-yellow-700'
		},
		info: {
			icon: Info,
			bgColor: 'bg-blue-50',
			borderColor: 'border-blue-200',
			iconColor: 'text-blue-500',
			titleColor: 'text-blue-800',
			messageColor: 'text-blue-700'
		}
	};

	const config = $derived(typeConfig[type]);
	const IconComponent = $derived(config.icon);

	// Safely format the message to handle objects
	const formattedMessage = $derived(formatErrorMessage(message, 'An error occurred'));

	function dismiss() {
		visible = false;
		setTimeout(() => {
			onDismiss?.();
		}, 150); // Match fade out duration
	}

	onMount(() => {
		if (duration > 0) {
			const timer = setTimeout(dismiss, duration);
			return () => clearTimeout(timer);
		}
	});
</script>

{#if visible}
	<div
		class="flex items-start gap-3 rounded-md border p-3 {config.bgColor} {config.borderColor}"
		transition:fly={{ y: -20, duration: 200 }}
	>
		<IconComponent class="h-5 w-5 flex-shrink-0 {config.iconColor}" />

		<div class="min-w-0 flex-1">
			{#if title}
				<h4 class="text-sm font-medium {config.titleColor}">
					{title}
				</h4>
			{/if}
			<p class="text-sm {config.messageColor} {title ? 'mt-1' : ''}">
				{formattedMessage}
			</p>
		</div>

		{#if dismissible}
			<button
				type="button"
				class="flex-shrink-0 p-1 hover:bg-black/5 focus:outline-none"
				onclick={dismiss}
			>
				<X class="h-4 w-4 {config.iconColor}" />
			</button>
		{/if}
	</div>
{/if}
