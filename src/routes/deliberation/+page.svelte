<script lang="ts">
	import type { PageData } from './$types';
	import { Datum, RegistryMark } from '$lib/design';

	let { data }: { data: PageData } = $props();

	const ON_CHAIN_HASH = /^0x[0-9a-fA-F]{64}$/;
	const STANCE_LABELS: Record<string, string> = {
		SUPPORT: 'Support',
		OPPOSE: 'Oppose',
		AMEND: 'Amendment'
	};

	function deadlineLabel(deadlineMs: number): string {
		const now = Date.now();
		const deltaMs = deadlineMs - now;
		if (deltaMs <= 0) return 'closed';
		const days = Math.floor(deltaMs / (24 * 60 * 60 * 1000));
		if (days >= 1) return `${days} day${days === 1 ? '' : 's'} remaining`;
		const hours = Math.floor(deltaMs / (60 * 60 * 1000));
		if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
		const minutes = Math.max(1, Math.floor(deltaMs / (60 * 1000)));
		return `${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
	}

	function formatResolvedAt(ts: number | null): string | null {
		if (!ts) return null;
		return new Date(ts).toISOString().slice(0, 10);
	}

	function stanceLabel(stance: string): string {
		return STANCE_LABELS[stance] ?? stance;
	}
</script>

<svelte:head>
	<title>Open deliberations — Commons</title>
	<meta
		name="description"
		content="Public index of debates running on Commons templates. Each debate is a proposition the substrate is settling."
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-12">
	<header class="mb-10">
		<h1 class="font-brand text-3xl font-bold text-slate-900">
			Open deliberations
		</h1>
		<p class="mt-2 max-w-2xl font-brand text-base text-slate-600">
			Each entry below is a proposition recorded on chain. Stake-weighted
			arguments and AI scoring resolve the outcome at the deadline.
		</p>
		<nav class="mt-6 flex gap-1 border-b border-slate-200" aria-label="Filter by status">
			<a
				href="/deliberation?status=active"
				class="border-b-2 px-3 py-2 font-brand text-sm font-medium {data.status === 'active'
					? 'border-slate-900 text-slate-900'
					: 'border-transparent text-slate-500 hover:text-slate-700'}"
				aria-current={data.status === 'active' ? 'page' : undefined}
			>
				Active
			</a>
			<a
				href="/deliberation?status=resolved"
				class="border-b-2 px-3 py-2 font-brand text-sm font-medium {data.status === 'resolved'
					? 'border-slate-900 text-slate-900'
					: 'border-transparent text-slate-500 hover:text-slate-700'}"
				aria-current={data.status === 'resolved' ? 'page' : undefined}
			>
				Resolved
			</a>
		</nav>
	</header>

	{#if data.debates.length === 0}
		<section class="my-10 border-y border-slate-200 py-10 text-center">
			<p class="font-brand text-base font-medium text-slate-700">
				{data.status === 'active'
					? 'No deliberations are open right now.'
					: 'No deliberation has resolved yet.'}
			</p>
			{#if data.status === 'active'}
				<p class="mx-auto mt-2 max-w-md font-brand text-sm text-slate-500">
					A campaign opens a deliberation once its verified-action count crosses
					the threshold the campaign sets. Open deliberations appear here.
				</p>
			{:else}
				<p class="mx-auto mt-2 max-w-md font-brand text-sm text-slate-500">
					Resolution lands at the deadline, after stake-weighted arguments and
					AI panel scoring. Decisions appear here when that happens.
				</p>
			{/if}
		</section>
	{:else}
		<ul class="divide-y divide-slate-100">
			{#each data.debates as debate (debate._id)}
				<li class="py-6">
					<div class="flex items-baseline justify-between gap-4">
						<p class="line-clamp-3 min-w-0 flex-1 font-brand text-base font-medium text-slate-900">
							{debate.propositionText}
						</p>
						{#if data.status === 'active'}
							<span class="shrink-0 font-mono text-xs text-slate-600">
								{deadlineLabel(debate.deadline)}
							</span>
						{:else}
							<span class="shrink-0 font-mono text-xs text-slate-600">
								{formatResolvedAt(debate.resolvedAt) ?? 'resolved'}
							</span>
						{/if}
					</div>

					{#if debate.template}
						<p class="mt-2 font-brand text-sm text-slate-600">
							From template <a
								href="/s/{debate.template.slug}"
								class="font-medium text-indigo-600 hover:text-indigo-800"
							>
								{debate.template.title}
							</a>
						</p>
					{/if}

					<dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-brand text-xs text-slate-600">
						<div class="flex items-baseline gap-1.5">
							<dt class="text-slate-500">Arguments</dt>
							<dd>
								<Datum
									value={debate.argumentCount}
									class="font-mono tabular-nums text-slate-800"
								/>
							</dd>
						</div>
						<div class="flex items-baseline gap-1.5">
							<dt class="text-slate-500">Participants</dt>
							<dd>
								<Datum
									value={debate.uniqueParticipants}
									class="font-mono tabular-nums text-slate-800"
								/>
							</dd>
						</div>
						{#if data.status === 'resolved' && debate.winningStance}
							<div class="flex items-baseline gap-1.5">
								<dt class="text-slate-500">Outcome</dt>
								<dd class="font-brand text-slate-800">
									{stanceLabel(debate.winningStance)}
								</dd>
							</div>
						{/if}
					</dl>

					{#if ON_CHAIN_HASH.test(debate.propositionHash)}
						<p class="mt-3">
							<RegistryMark
								variant="keccak256"
								value={debate.propositionHash}
								truncate
								class="text-[11px] text-slate-500"
							/>
						</p>
					{/if}

					{#if debate.template}
						<p class="mt-2">
							<a
								href="/s/{debate.template.slug}/debate/{debate.debateIdOnchain ||
									debate._id}"
								class="inline-flex items-center gap-1 font-brand text-sm font-medium text-indigo-600 hover:text-indigo-800"
							>
								Read the arguments →
							</a>
						</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.hasMore}
		<p class="mt-8 text-center font-brand text-xs text-slate-500">
			Showing the first 30 entries. Older deliberations are reachable from each
			template page until the index gains explicit pagination.
		</p>
	{/if}

	<footer class="mt-12 border-t border-slate-200 pt-6 text-center">
		<p class="font-brand text-xs text-slate-500">
			Public deliberation index — debate substrate is on chain.
		</p>
	</footer>
</main>
