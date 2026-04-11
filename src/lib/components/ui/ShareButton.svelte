<script lang="ts">
	import { Share2, CheckCircle } from '@lucide/svelte';
	import SimpleTooltip from './SimpleTooltip.svelte';

	let {
		url,
		_title = 'Share',
		message = '',
		variant = 'primary',
		size = 'default',
		classNames = ''
	}: {
		url: string;
		_title?: string;
		/** Optional share text for navigator.share(). When provided, mobile triggers native share sheet instead of clipboard copy. */
		message?: string;
		variant?: 'primary' | 'secondary';
		size?: 'sm' | 'default' | 'lg';
		classNames?: string;
	} = $props();

	let copied = $state(false);
	let hovered = $state(false);

	async function handleShare() {
		// Native share sheet when message is provided and platform supports it
		if (message && typeof navigator !== 'undefined' && navigator.share) {
			const shareData = { title: _title, text: message, url };
			try {
				if (navigator.canShare?.(shareData)) {
					await navigator.share(shareData);
					return;
				}
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') return;
				// Fall through to clipboard copy
			}
		}
		await copyToClipboard();
	}

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
			hovered = false;

			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (error) {
			console.error('[ShareButton] copyToClipboard failed:', error instanceof Error ? error.message : String(error));
		}
	}

	// Size classes
	const sizeClasses = {
		sm: 'px-3 py-1.5 text-sm gap-1.5',
		default: 'px-4 py-2 text-base gap-2',
		lg: 'px-6 py-3 text-lg gap-2.5'
	};

	const iconSizes = {
		sm: 'h-3.5 w-3.5',
		default: 'h-4 w-4',
		lg: 'h-5 w-5'
	};

	const variantClasses = {
		primary: `
			bg-participation-primary-500 hover:bg-participation-primary-600
			text-white border border-participation-primary-600
			transition-colors duration-150
		`,
		secondary: `
			bg-white hover:bg-slate-50
			text-slate-700 hover:text-slate-900
			border border-slate-200 hover:border-slate-300
			transition-colors duration-150
		`
	};
</script>

<div class="relative inline-block">
	<button
		onclick={handleShare}
		onmouseenter={() => !copied && (hovered = true)}
		onmouseleave={() => (hovered = false)}
		class="
			relative inline-flex cursor-pointer items-center
			justify-center rounded-md
			font-brand font-medium
			{sizeClasses[size]}
			{variantClasses[variant]}
			{classNames}
		"
		aria-label={copied ? 'Link copied!' : 'Share this template'}
	>
		<div class="relative flex items-center gap-2">
			<!-- Icon container — morphing transition -->
			<div
				class="relative inline-flex items-center justify-center"
				style="width: 18px; height: 18px;"
			>
				<div
					class="absolute inset-0 flex items-center justify-center"
					style="
						opacity: {copied ? 0 : 1};
						transform: scale({copied ? 0.3 : 1});
						transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
					"
				>
					<Share2 class="{iconSizes[size]} text-current" />
				</div>

				<div
					class="absolute inset-0 flex items-center justify-center"
					style="
						opacity: {copied ? 1 : 0};
						transform: scale({copied ? 1 : 1.5});
						transition: all 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55);
					"
				>
					<CheckCircle class="{iconSizes[size]} text-current" />
				</div>
			</div>

			<!-- Text -->
			<div class="relative inline-flex items-center justify-center" style="min-width: 65px;">
				<span
					class="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
					style="opacity: {copied ? 0 : 1};"
				>
					Share
				</span>
				<span
					class="absolute inset-0 flex items-center justify-center transition-opacity duration-200"
					style="opacity: {copied ? 1 : 0};"
				>
					Copied!
				</span>
			</div>
		</div>
	</button>

	<SimpleTooltip content="Copy link" placement="bottom" show={hovered && !copied} />
</div>
