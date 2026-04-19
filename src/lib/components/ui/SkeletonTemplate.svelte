<script lang="ts">
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
	<!--
		List skeleton — mirrors TemplateList button.template-card.
		Outer: card-topic flex w-full items-start justify-between gap-3 rounded-md p-3 md:p-4
		Inner: target badge → title (h3 text-base, line-height 24px) → description (text-xs/md:text-sm, 2 lines)
		       → domain tag (.topic-ground)
		MessageMetrics is conditional on engagement (most templates have none pre-launch) — omitted.
	-->
	<div
		class="card-topic card-weight-light relative flex w-full items-start justify-between gap-3 rounded-md p-3 text-left md:p-4 {classNames}"
		style="--card-hue: 220"
	>
		<div class="min-w-0 flex-1">
			<!-- Target badge: mb-1.5 flex items-center gap-1.5; icon h-3.5 + label text-xs -->
			<div class="mb-1.5 flex items-center gap-1.5">
				<div class="skel h-3.5 w-3.5 shrink-0 rounded {animate ? 'skel-animate' : ''}"></div>
				<div class="skel h-3 w-28 rounded {animate ? 'skel-animate' : ''}"></div>
			</div>

			<!-- Title: h3 inherits text-base (16px font, 24px line-height = h-6 line box) -->
			<div class="skel h-6 w-[70%] rounded {animate ? 'skel-animate' : ''}"></div>

			<!-- Description: p.mb-2.line-clamp-2.text-xs(12px/16px).md:text-sm(14px/20px), no margin-top -->
			<!-- 2 lines: mobile 2×16px=32px, desktop 2×20px=40px -->
			<div class="mb-2 md:mb-3">
				<div class="skel h-3 w-full rounded md:h-3.5 {animate ? 'skel-animate' : ''}"></div>
				<div class="skel mt-2 h-3 w-[80%] rounded md:mt-3 md:h-3.5 {animate ? 'skel-animate' : ''}"></div>
			</div>

			<!-- Domain tag: span.topic-ground — display:block, font-size:0.6875rem, margin-top:0.375rem -->
			<div class="skel-light h-[0.6875rem] w-16 rounded" style="margin-top: 0.375rem"></div>
		</div>

		<!-- Mobile chevron: div.shrink-0.md:hidden, ChevronRight h-5 w-5 -->
		<div class="shrink-0 md:hidden">
			<div class="skel h-5 w-5 rounded {animate ? 'skel-animate' : ''}"></div>
		</div>
	</div>
{:else if variantProp === 'preview'}
	<!--
		Preview skeleton — mirrors TemplatePreview (non-modal list context).
		Outer: card-topic card-weight-heavy rounded-md p-4 sm:p-5 md:p-6 lg:p-8
		       flex flex-col h-[calc(100vh-4rem)] sm:sticky sm:top-8 overflow-hidden
		Inner wrapper: flex flex-1 flex-col overflow-visible (non-modal)
		Inside:
		  - Target header (shrink-0, mb-4)
		  - PreviewContent wrapper (flex-1, min-h-0, overflow-hidden via touch-pan-y)
		    - MessagePreview (h-full flex-col):
		      - Subject (mb-5 sm:mb-6): h2 text-xl sm:text-2xl + card-rule mt-3
		      - Body (relative flex-1 min-h-[16rem]): absolute inset-0 overflow-y-auto max-w-[65ch]
		  - ActionBar (shrink-0, mt-4): full-width Button size="lg" (py-3 + text-base = ~48px, rounded-md)
	-->
	<div
		class="card-topic card-weight-heavy flex flex-col overflow-hidden rounded-md
		       p-4 sm:sticky sm:top-8 sm:p-5 md:p-6 lg:p-8
		       h-[calc(100vh-4rem)] {classNames}"
		style="--card-hue: 220"
	>
		<!-- Inner wrapper: flex flex-1 flex-col overflow-visible -->
		<div class="flex flex-1 flex-col overflow-visible">

			<!-- Target header: mb-4 flex shrink-0 items-center gap-2 text-sm -->
			<div class="mb-4 flex shrink-0 items-center gap-2">
				<div class="skel h-4 w-4 shrink-0 rounded {animate ? 'skel-animate' : ''}"></div>
				<div class="skel h-3.5 w-32 rounded {animate ? 'skel-animate' : ''}"></div>
				<div class="skel-light h-3 w-14 rounded {animate ? 'skel-animate' : ''}"></div>
				<div class="skel-light ml-auto h-3 w-12 rounded {animate ? 'skel-animate' : ''}"></div>
			</div>

			<!-- PreviewContent scroll wrapper: min-h-0 flex-1 touch-pan-y overflow-hidden -->
			<div class="min-h-0 flex-1 overflow-hidden">
				<!-- MessagePreview root: relative flex h-full flex-col -->
				<div class="relative flex h-full flex-col">

					<!-- Subject header: mb-5 sm:mb-6 -->
					<div class="mb-5 shrink-0 sm:mb-6">
						<!-- h2 text-xl(20px/28px) sm:text-2xl(24px/32px) -->
						<div class="skel h-7 w-[65%] rounded sm:h-8 {animate ? 'skel-animate' : ''}"></div>
						<!-- card-rule mt-3 -->
						<div class="skel-light mt-3 h-px w-full"></div>
					</div>

					<!-- Body: relative flex-1 min-h-[16rem] -->
					<div class="relative min-h-[16rem] flex-1">
						<!-- Scroll container: absolute inset-0 overflow-y-auto max-w-[65ch] -->
						<div class="absolute inset-0 overflow-hidden" style="max-width: 65ch">
							<!-- Text: text-sm leading-relaxed(22.4px) sm:text-[15px] sm:leading-7(28px) -->
							<div class="space-y-[0.55rem] sm:space-y-[0.85rem]">
								<div class="skel h-3.5 w-full rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="skel h-3.5 w-[92%] rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="skel h-3.5 w-full rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="skel h-3.5 w-[78%] rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="skel h-3.5 w-[88%] rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="h-3"></div>
								<div class="skel h-3.5 w-full rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="skel h-3.5 w-[95%] rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="skel h-3.5 w-full rounded {animate ? 'skel-animate' : ''}"></div>
								<div class="skel h-3.5 w-[68%] rounded {animate ? 'skel-animate' : ''}"></div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- ActionBar: mt-4 flex shrink-0 flex-col items-center gap-2 -->
			<div class="mt-4 flex shrink-0 flex-col items-center gap-2">
				<!-- Button size="lg": px-6 py-3 text-base = ~48px height, rounded-md, w-full -->
				<div class="skel h-12 w-full rounded-md {animate ? 'skel-animate' : ''}"></div>
			</div>
		</div>
	</div>
{:else if variantProp === 'compact'}
	<!-- Compact Template Skeleton -->
	<div
		class="card-topic card-weight-light flex items-center gap-3 rounded-md p-3 {classNames}"
		style="--card-hue: 220"
	>
		<div class="flex-1">
			<div class="skel h-4 w-[60%] rounded {animate ? 'skel-animate' : ''}"></div>
			<div class="mt-1 flex items-center gap-2">
				<div class="skel h-5 w-16 rounded {animate ? 'skel-animate' : ''}"></div>
				<div class="skel-light h-3 w-[30%] rounded {animate ? 'skel-animate' : ''}"></div>
			</div>
		</div>
		<div class="skel h-8 w-16 rounded {animate ? 'skel-animate' : ''}"></div>
	</div>
{/if}

<style>
	/* Skeleton fill — matches card surface tones via --card-hue */
	.skel {
		background: oklch(0.88 0.012 var(--card-hue, 220) / 0.5);
	}
	.skel-light {
		background: oklch(0.92 0.008 var(--card-hue, 220) / 0.4);
	}
	.skel-animate {
		animation: shimmer 1.8s ease-in-out infinite;
		background-size: 200% 100%;
		background-image: linear-gradient(
			90deg,
			oklch(0.88 0.012 var(--card-hue, 220) / 0.5) 0%,
			oklch(0.93 0.006 var(--card-hue, 220) / 0.4) 50%,
			oklch(0.88 0.012 var(--card-hue, 220) / 0.5) 100%
		);
	}
	@keyframes shimmer {
		0% { background-position: -200% 0; }
		100% { background-position: 200% 0; }
	}
</style>
