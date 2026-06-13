<!--
	Quiet notice for an org action that works today within a real limit.
	Renders the one plain-language sentence, an optional preserved-artifact
	reassurance in secondary type, and the operator runtime detail collapsed
	behind an administrator affordance. Neutral by design: amber is reserved
	for true warnings, and this is not one.
-->
<script lang="ts">
	import type { OrgLimitNotice } from '$lib/data/org-limit-sentences';

	let { notice }: { notice: OrgLimitNotice } = $props();

	const detailLines = $derived(
		notice.operatorDetail
			? [
					...(notice.operatorDetail.message ? [notice.operatorDetail.message] : []),
					...(notice.operatorDetail.dependency
						? [`Depends on: ${notice.operatorDetail.dependency}`]
						: []),
					...(notice.operatorDetail.missing.length > 0
						? [`Missing: ${notice.operatorDetail.missing.join(', ')}`]
						: [])
				]
			: []
	);
</script>

<div class="limit-notice">
	<p class="limit-sentence">{notice.sentence}</p>
	{#if notice.reassurance}
		<p class="limit-reassurance">{notice.reassurance}</p>
	{/if}
	{#if detailLines.length > 0}
		<details class="limit-admin">
			<summary>Details for your administrator</summary>
			<ul>
				{#each detailLines as line (line)}
					<li>{line}</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

<style>
	.limit-notice {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	.limit-sentence {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}
	.limit-reassurance {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--text-tertiary, oklch(0.55 0.01 250));
	}
	.limit-admin summary {
		cursor: pointer;
		width: fit-content;
		/* 44px minimum touch target; padding keeps the quiet type size. */
		min-height: 44px;
		box-sizing: border-box;
		padding: 0.8125rem 0.25rem 0.8125rem 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, oklch(0.55 0.01 250));
		transition: color 150ms ease-out;
	}
	.limit-admin summary:hover {
		color: var(--text-secondary, oklch(0.42 0.015 60));
	}
	.limit-admin ul {
		margin: 0.375rem 0 0;
		padding-left: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.limit-admin li {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		line-height: 1.5;
		color: var(--text-tertiary, oklch(0.55 0.01 250));
		overflow-wrap: anywhere;
	}
</style>
