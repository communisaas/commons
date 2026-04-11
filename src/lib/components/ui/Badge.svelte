<script lang="ts">
	interface Props {
		variant?:
			| 'congressional'
			| 'direct'
			| 'certified'
			| 'success'
			| 'warning'
			| 'error'
			| 'neutral';
		size?: 'sm' | 'md';
		pulse?: boolean;
		children?: import('svelte').Snippet;
	}

	let { variant = 'neutral', size = 'sm', pulse = false, children }: Props = $props();

	const variants: Record<string, string> = {
		congressional: 'text-emerald-700 bg-emerald-50/60',
		direct: 'text-slate-700 bg-slate-100/60',
		certified: 'text-green-700 bg-green-50/60',
		success: 'text-emerald-700 bg-emerald-50/60',
		warning: 'text-amber-700 bg-amber-50/60',
		error: 'text-red-700 bg-red-50/60',
		neutral: 'text-slate-600 bg-slate-50/60'
	};

	const sizes: Record<string, string> = {
		sm: 'px-1.5 py-0.5 text-xs',
		md: 'px-2 py-0.5 text-sm'
	};

	const pulseColors: Record<string, string> = {
		congressional: 'bg-emerald-500',
		direct: 'bg-slate-500',
		certified: 'bg-green-500',
		success: 'bg-emerald-500',
		warning: 'bg-amber-500',
		error: 'bg-red-500',
		neutral: 'bg-slate-400'
	};
</script>

<span
	class="inline-flex items-center gap-1 rounded font-medium {variants[variant]} {sizes[size]}"
	role="status"
>
	{#if pulse}
		<div
			class="h-1.5 w-1.5 animate-save-pulse rounded-full {pulseColors[variant]}"
			aria-hidden="true"
		></div>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</span>
