<script lang="ts">
	/**
	 * Jurisdiction ladder — the boundary types an address falls inside.
	 *
	 * This is a BOUNDARY LOOKUP over a public map. It is not civic proof and not
	 * identity verification, so it carries no affirmation chrome of any kind: no
	 * marks, no colour that encodes quality, no aggregate, no rating, no tally.
	 * Coverage is disclosed as the server's own two neutral machine words,
	 * `national` and `partial`, printed literally.
	 *
	 * Absence is not proof of nonexistence: a `partial` type may simply be missing
	 * from the current ingest. Every coverage note is therefore rendered VERBATIM —
	 * never paraphrased, truncated, or summarized — and the disclosure below the
	 * list states plainly which rows carry an officeholder roster and which do not.
	 */

	// Type-only imports: value-importing the atlas client would drag the whole
	// resolver (and its fetch layer) into the browser bundle. district-format.ts
	// has zero imports of its own, so US_SLOT_NAMES is safe to import as a value.
	import type { ResolvedDistrictEntry } from '$lib/core/shadow-atlas/client';
	import type { ResolveCoverage } from '$lib/core/shadow-atlas/coverage';
	import { US_SLOT_NAMES } from '$lib/core/shadow-atlas/district-format';

	let {
		districts,
		coverage,
		class: className = ''
	}: {
		districts: ResolvedDistrictEntry[];
		coverage: ResolveCoverage;
		class?: string;
	} = $props();

	const LABEL_BY_JURISDICTION = new Map<string, string>(
		US_SLOT_NAMES.map((slot) => [slot.jurisdiction, slot.label] as [string, string])
	);

	/** Canonical label, falling back to the raw wire slug when the slug is unknown. */
	function labelFor(entry: ResolvedDistrictEntry): string {
		return LABEL_BY_JURISDICTION.get(entry.jurisdiction) ?? entry.district_type;
	}

	// Derived from the server's disclosure, never hardcoded: whatever the response
	// says carries a roster is exactly what this component names.
	const officialsLabels = $derived(
		coverage.officialsTypes.map((type) => LABEL_BY_JURISDICTION.get(type) ?? type)
	);
</script>

<section class="overflow-hidden rounded-md border border-slate-200 bg-white {className}">
	<div class="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
		<p class="text-xs font-semibold uppercase tracking-wider text-slate-500">
			Boundaries at this address
		</p>
	</div>

	{#if districts.length === 0}
		<p class="px-4 py-4 text-sm leading-relaxed text-slate-600">
			No boundary rows — this address is outside current boundary coverage.
		</p>
	{:else}
		<ul class="divide-y divide-slate-100">
			{#each districts as entry (entry.district_type + ':' + entry.id)}
				{@const typeCoverage = coverage.boundaryTypes[entry.district_type]}
				<li class="px-4 py-3">
					<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
						<div class="min-w-0">
							<p class="text-xs uppercase tracking-wider text-slate-500">{labelFor(entry)}</p>
							<p class="text-sm text-slate-900">{entry.name}</p>
						</div>
						<div class="flex items-baseline gap-3">
							<span class="font-mono text-xs text-slate-500">{entry.id}</span>
							{#if typeCoverage}
								<span class="text-xs text-slate-500">{typeCoverage.coverage}</span>
							{/if}
						</div>
					</div>
					{#if typeCoverage?.note}
						<!-- Verbatim scope note from the server disclosure. Never summarized. -->
						<p class="mt-1.5 text-xs leading-relaxed text-slate-500">{typeCoverage.note}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div
		class="space-y-1.5 border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-xs leading-relaxed text-slate-600"
	>
		<p>
			Officeholder rosters exist only for {officialsLabels.join(', ')}. Any other row is a boundary
			this address falls in, with no roster attached.
		</p>
		<p>
			A type not listed here is either not served or has no such district at this address; where a
			row is marked partial, an absence is not proof that no such district exists.
		</p>
	</div>
</section>
