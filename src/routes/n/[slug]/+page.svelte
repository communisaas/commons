<script lang="ts">
	import type { PageData } from './$types';
	import { Datum, RegistryMark } from '$lib/design';

	let { data }: { data: PageData } = $props();

	function formatDate(ts: number | null): string | null {
		if (!ts) return null;
		return new Date(ts).toISOString().slice(0, 10);
	}
</script>

<svelte:head>
	<title>{data.network.name} — Founding charter</title>
	<meta
		name="description"
		content={data.network.mission ?? `Founding charter of ${data.network.name}, a coalition on Commons.`}
	/>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-12">
	<header class="mb-10 border-b border-slate-200 pb-8">
		<p class="font-mono text-xs uppercase tracking-wide text-slate-500">
			Founding charter
		</p>
		<h1 class="mt-2 font-brand text-3xl font-bold text-slate-900">
			{data.network.name}
		</h1>
		<dl class="mt-6 flex flex-wrap gap-x-8 gap-y-2 font-brand text-sm">
			<div>
				<dt class="font-mono text-xs uppercase tracking-wide text-slate-500">
					Founded
				</dt>
				<dd class="mt-1 font-mono tabular-nums text-slate-800">
					{formatDate(data.network.charterPublishedAt) ?? '—'}
				</dd>
			</div>
			<div>
				<dt class="font-mono text-xs uppercase tracking-wide text-slate-500">
					Founders
				</dt>
				<dd class="mt-1">
					<Datum
						value={data.network.founders.length}
						class="font-mono tabular-nums text-slate-800"
					/>
				</dd>
			</div>
			{#if data.network.applicableCountries.length > 0}
				<div>
					<dt class="font-mono text-xs uppercase tracking-wide text-slate-500">
						Jurisdictions
					</dt>
					<dd class="mt-1 font-mono tabular-nums text-slate-800">
						{data.network.applicableCountries.join(' · ')}
					</dd>
				</div>
			{/if}
		</dl>
	</header>

	{#if data.network.mission}
		<section class="mb-10">
			<h2 class="font-brand text-base font-semibold text-slate-900">
				Mission
			</h2>
			<p class="mt-3 font-brand text-base leading-relaxed text-slate-800">
				{data.network.mission}
			</p>
		</section>
	{/if}

	{#if data.network.principles.length > 0}
		<section class="mb-10">
			<h2 class="font-brand text-base font-semibold text-slate-900">
				Principles
			</h2>
			<ol class="mt-3 space-y-3">
				{#each data.network.principles as principle, i (i)}
					<li class="flex gap-3 font-brand text-base leading-relaxed text-slate-800">
						<span class="shrink-0 font-mono text-sm tabular-nums text-slate-500">
							{i + 1}.
						</span>
						<span class="min-w-0 flex-1">{principle}</span>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if data.network.charterText}
		<section class="mb-10">
			<h2 class="font-brand text-base font-semibold text-slate-900">
				Charter
			</h2>
			<div class="mt-3 whitespace-pre-line font-brand text-base leading-relaxed text-slate-800">
				{data.network.charterText}
			</div>
		</section>
	{/if}

	<section class="mb-10 border-t border-slate-200 pt-8">
		<h2 class="font-brand text-base font-semibold text-slate-900">
			Founding signatories
		</h2>
		{#if data.network.founders.length === 0}
			<p class="mt-3 font-brand text-sm text-slate-600">
				No founding members on record.
			</p>
		{:else}
			<ul class="mt-3 divide-y divide-slate-100">
				{#each data.network.founders as founder (founder.orgSlug)}
					<li class="flex items-baseline justify-between gap-4 py-3">
						<div class="min-w-0 flex-1">
							<a
								href="/org/{founder.orgSlug}"
								class="font-brand text-base font-medium text-indigo-600 hover:text-indigo-800"
							>
								{founder.orgName}
							</a>
							{#if founder.role === 'admin'}
								<span class="ml-2 font-mono text-[11px] uppercase tracking-wide text-slate-500">
									admin
								</span>
							{/if}
						</div>
						<span class="shrink-0 font-mono text-xs tabular-nums text-slate-500">
							{formatDate(founder.joinedAt)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<footer class="mt-12 border-t border-slate-200 pt-6">
		<p class="font-brand text-xs text-slate-500">
			Founding charter — public record on Commons.
		</p>
		<p class="mt-2">
			<RegistryMark
				variant="sha256"
				value={data.network.charterHash}
				truncate
				class="text-[11px] text-slate-500"
			/>
		</p>
	</footer>
</main>
