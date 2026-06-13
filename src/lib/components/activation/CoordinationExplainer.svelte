<script lang="ts">
	/**
	 * CoordinationExplainer — collapsed teaser, expanded RelayLoom + steps.
	 *
	 * The visible header is the entry point. Expansion reveals the full
	 * RelayLoom visualization and a three-step description of how a send
	 * enters the public record.
	 */

	import { ChevronDown } from '@lucide/svelte';
	import RelayLoom from '$lib/components/visualization/RelayLoom.svelte';

	let isExpanded = $state(false);
	let shouldRenderLoom = $state(false);
	let loomEpoch = $state(0);

	function toggleExpanded() {
		const willExpand = !isExpanded;
		isExpanded = willExpand;

		if (willExpand) {
			// Expanding: render loom immediately, then expand
			shouldRenderLoom = true;
			loomEpoch += 1;
		} else {
			// Collapsing: delay unmount until after 400ms collapse animation
			setTimeout(() => {
				shouldRenderLoom = false;
			}, 400);
		}
	}
</script>

<section class="coordination-explainer" class:expanded={isExpanded}>
	<button
		type="button"
		class="explainer-header"
		onclick={toggleExpanded}
		aria-expanded={isExpanded}
		aria-controls="explainer-content"
	>
		<div class="header-content">
			<h2 class="header-title">How sends are recorded</h2>
			<p class="header-teaser">
				{isExpanded
					? 'Hover any node for detail.'
					: 'Alone, your send is one voice. Joined with your district, it’s a record.'}
			</p>
		</div>
		<div class="header-toggle">
			<span class="toggle-label">{isExpanded ? 'Hide' : 'Show'}</span>
			<ChevronDown class="toggle-icon {isExpanded ? 'rotated' : ''}" />
		</div>
	</button>

	<div
		id="explainer-content"
		class="explainer-content"
		class:visible={isExpanded}
		aria-hidden={!isExpanded}
	>
		<div class="content-inner">
			<div class="loom-container">
				{#if shouldRenderLoom}
					{#key loomEpoch}
						<RelayLoom embedded={true} />
					{/key}
				{/if}
			</div>

			<ol class="summary-points">
				<li class="point">
					<span class="point-index" aria-hidden="true">1.</span>
					<div class="point-content">
						<strong>Write once.</strong>
						<span>Describe your message. Pick who decides.</span>
					</div>
				</li>
				<li class="point">
					<span class="point-index" aria-hidden="true">2.</span>
					<div class="point-content">
						<strong>Share the link.</strong>
						<span>Anyone who shares your problem can send it too.</span>
					</div>
				</li>
				<li class="point">
					<span class="point-index" aria-hidden="true">3.</span>
					<div class="point-content">
						<strong>It joins the record.</strong>
						<span
							>Verified sends from one district arrive together. The volume is the evidence.</span
						>
					</div>
				</li>
			</ol>

			<div class="org-whisper">
				<p class="org-whisper__text">
					Organizations assemble proof, verify constituents, and deliver evidence to
					decision-makers.
				</p>
				<a href="/org" class="org-whisper__link">
					Organization tools <span class="org-whisper__arrow" aria-hidden="true">→</span>
				</a>
			</div>
		</div>
	</div>
</section>

<style>
	.coordination-explainer {
		border-radius: 8px;
		border: 1px solid oklch(0.9 0.02 250);
		overflow: hidden;
		transition: border-color 200ms ease-out;
	}

	.coordination-explainer:has(:global(.is-expanded)) {
		overflow: visible;
	}

	.coordination-explainer.expanded {
		border-color: oklch(0.85 0.04 250);
	}

	.explainer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 1rem 1.25rem;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 200ms ease-out;
	}

	.explainer-header:hover {
		background: oklch(0.97 0.005 55);
	}

	.header-content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.header-title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1rem;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
		margin: 0;
	}

	.header-teaser {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		color: oklch(0.5 0.02 250);
		margin: 0;
	}

	.header-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
	}

	.toggle-label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.5 0.15 195);
	}

	.header-toggle :global(.toggle-icon) {
		width: 1.25rem;
		height: 1.25rem;
		color: oklch(0.5 0.15 195);
		transition: transform 300ms ease-out;
	}

	.header-toggle :global(.toggle-icon.rotated) {
		transform: rotate(180deg);
	}

	.explainer-content {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows 400ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 300ms ease-out;
	}

	.explainer-content.visible {
		grid-template-rows: 1fr;
		opacity: 1;
	}

	.content-inner {
		overflow: hidden;
	}

	.content-inner:has(:global(.is-expanded)) {
		overflow: visible;
	}

	.loom-container {
		padding: 0 0.75rem;
	}

	@media (min-width: 640px) {
		.loom-container {
			padding: 0 1rem;
		}
	}

	.summary-points {
		display: grid;
		gap: 1rem;
		padding: 1.25rem 1.25rem;
		margin: 0;
		list-style: none;
		border-top: 1px solid oklch(0.92 0.01 250);
	}

	@media (min-width: 640px) {
		.summary-points {
			grid-template-columns: repeat(3, 1fr);
			gap: 1.5rem;
		}
	}

	.point {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}

	.point-index {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-feature-settings: 'tnum';
		font-size: 0.875rem;
		font-weight: 500;
		color: oklch(0.55 0.02 250);
		flex-shrink: 0;
	}

	.point-content {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.point-content strong {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		font-weight: 600;
		color: oklch(0.25 0.02 250);
	}

	.point-content span {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 250);
		line-height: 1.5;
	}

	.org-whisper {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.25rem;
		border-top: 1px solid oklch(0.92 0.01 250);
	}

	.org-whisper__text {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.02 250);
		line-height: 1.5;
		margin: 0;
	}

	.org-whisper__link {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: oklch(0.45 0.08 180);
		text-decoration: none;
		white-space: nowrap;
		flex-shrink: 0;
		transition: color 150ms ease-out;
	}

	.org-whisper__link:hover {
		color: oklch(0.35 0.12 180);
	}

	.org-whisper__arrow {
		display: inline-block;
		transition: transform 150ms ease-out;
	}

	.org-whisper__link:hover .org-whisper__arrow {
		transform: translateX(2px);
	}

	@media (prefers-reduced-motion: reduce) {
		.coordination-explainer,
		.explainer-content,
		.header-toggle :global(.toggle-icon),
		.org-whisper__link,
		.org-whisper__link:hover .org-whisper__arrow {
			transition: none;
		}
	}
</style>
