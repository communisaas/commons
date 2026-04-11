<script lang="ts">
	import SkeletonText from './SkeletonText.svelte';

	let {
		animate = true,
		variant: variantProp = 'list',
		classNames = ''
	}: {
		animate?: boolean;
		variant?: 'list' | 'preview' | 'compact';
		classNames?: string;
	} = $props();
</script>

{#if variantProp === 'list'}
	<!-- Template List Item Skeleton -->
	<div
		class="template-skeleton rounded-md p-3 md:p-4 {classNames}"
	>
		<div class="flex items-start justify-between gap-3">
			<div class="min-w-0 flex-1">
				<!-- Target badge row (icon + label) -->
				<div class="mb-1.5 flex items-center gap-1.5">
					<div class="h-3.5 w-3.5 shrink-0 rounded bg-slate-200 {animate ? 'animate-pulse' : ''}"></div>
					<div class="h-3 w-28 rounded bg-slate-200 {animate ? 'animate-pulse' : ''}"></div>
				</div>

				<!-- Title -->
				<SkeletonText lines={1} width="70%" lineHeight="h-5" {animate} />

				<!-- Description (2-line clamp) -->
				<div class="mb-2 mt-1 md:mb-3">
					<SkeletonText lines={2} width={['100%', '80%']} lineHeight="h-3 md:h-3.5" spacing="mb-1" {animate} />
				</div>

				<!-- MessageMetrics: 2 rows (send count + secondary metric) -->
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<div class="h-4 w-4 shrink-0 rounded bg-slate-200 {animate ? 'animate-pulse' : ''}"></div>
						<div class="h-3.5 w-16 rounded bg-slate-100 {animate ? 'animate-pulse' : ''}"></div>
					</div>
					<div class="flex items-center gap-2">
						<div class="h-4 w-4 shrink-0 rounded bg-slate-200 {animate ? 'animate-pulse' : ''}"></div>
						<div class="h-3.5 w-24 rounded bg-slate-100 {animate ? 'animate-pulse' : ''}"></div>
					</div>
				</div>

				<!-- Domain tag -->
				<div class="mt-1.5 h-3 w-16 rounded bg-slate-100 {animate ? 'animate-pulse' : ''}"></div>
			</div>

			<!-- Mobile chevron -->
			<div class="shrink-0 md:hidden">
				<div class="h-5 w-5 rounded bg-slate-200 {animate ? 'animate-pulse' : ''}"></div>
			</div>
		</div>
	</div>
{:else if variantProp === 'preview'}
	<!-- Template Preview Skeleton -->
	<div
		class="template-skeleton-preview rounded-md border border-slate-200 bg-white p-6 {classNames}"
	>
		<!-- Header -->
		<div class="mb-6">
			<SkeletonText lines={1} width="66%" lineHeight="h-7" {animate} />
			<div class="mt-3">
				<SkeletonText lines={1} width="40%" lineHeight="h-4" {animate} />
			</div>
		</div>

		<!-- Body -->
		<div class="mb-6 space-y-3">
			<SkeletonText lines={5} width={['100%', '95%', '100%', '80%', '90%']} {animate} />
		</div>

		<!-- Action Button -->
		<div class="h-12 w-32 rounded-lg bg-blue-100 {animate ? 'animate-pulse' : ''}"></div>
	</div>
{:else if variantProp === 'compact'}
	<!-- Compact Template Skeleton -->
	<div
		class="template-skeleton-compact flex items-center gap-3 rounded-lg bg-slate-50 p-3 {classNames}"
	>
		<div class="flex-1">
			<SkeletonText lines={1} width="60%" lineHeight="h-4" {animate} />
			<div class="mt-1 flex items-center gap-2">
				<div class="h-5 w-16 rounded bg-slate-200 {animate ? 'animate-pulse' : ''}"></div>
				<SkeletonText lines={1} width="30%" lineHeight="h-3" {animate} />
			</div>
		</div>
		<div class="h-8 w-16 rounded bg-slate-200 {animate ? 'animate-pulse' : ''}"></div>
	</div>
{/if}

<style>
	.template-skeleton {
		border: 1px solid oklch(0.9 0.01 250);
		background: oklch(0.98 0.005 250 / 0.5);
	}
</style>
