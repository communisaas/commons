<script lang="ts">
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	function alignmentLabel(a: number): string {
		if (a >= 0.7) return 'aligned';
		if (a >= 0.3) return 'mixed';
		return 'opposed';
	}

	function alignmentClass(a: number): string {
		if (a >= 0.7) return 'aligned';
		if (a >= 0.3) return 'mixed';
		return 'opposed';
	}

	function fmtDate(iso: string): string {
		return new Date(iso).toLocaleDateString();
	}
</script>

<svelte:head>
	<title>Your receipts · Commons</title>
</svelte:head>

<section class="receipts">
	<header>
		<h1>Your receipts</h1>
		<p class="lede">
			Records of verified actions you've taken and the decision-makers' responses.
			Only receipts meeting the platform's K-anonymity floor (≥ 5 verified
			contributors) appear here.
		</p>
	</header>

	{#if data.total === 0}
		<div class="empty">
			<p>No receipts yet. Once your verified actions are delivered and
			a decision-maker responds, the receipt appears here.</p>
		</div>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Decision-maker</th>
					<th>Bill</th>
					<th>Alignment</th>
					<th>Causality</th>
					<th>Delivered</th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as item (item.receiptId)}
					<tr>
						<td>{item.dmName}</td>
						<td class="mono">{item.billId.slice(0, 8)}…</td>
						<td>
							<span class="alignment alignment-{alignmentClass(item.alignment)}">
								{alignmentLabel(item.alignment)}
							</span>
						</td>
						<td>{item.causalityClass}</td>
						<td>{fmtDate(item.proofDeliveredAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.receipts {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	header h1 {
		margin: 0 0 0.5rem 0;
	}
	.lede {
		color: var(--zinc-500, #71717a);
		font-size: 0.95rem;
		margin: 0 0 1.5rem 0;
	}
	.empty {
		padding: 2rem;
		text-align: center;
		color: var(--zinc-500, #71717a);
		background: var(--zinc-50, #fafafa);
		border-radius: 0.4rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.6rem;
		border-bottom: 1px solid var(--zinc-200, #e4e4e7);
	}
	th {
		font-weight: 600;
		color: var(--zinc-700, #3f3f46);
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
	}
	.alignment {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 0.2rem;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.alignment-aligned {
		background: var(--green-100, #dcfce7);
		color: var(--green-800, #166534);
	}
	.alignment-mixed {
		background: var(--amber-100, #fef3c7);
		color: var(--amber-800, #92400e);
	}
	.alignment-opposed {
		background: var(--red-100, #fee2e2);
		color: var(--red-800, #991b1b);
	}
</style>
