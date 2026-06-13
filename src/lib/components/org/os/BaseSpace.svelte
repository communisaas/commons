<!--
  BaseSpace — People: who you have, whether you can reach them, what
  permission is on file, and how you slice them.

  Four sections answer the org's questions in plain words: YOUR LIST (the
  total and the verification funnel), WHERE THEY CAME FROM (import origins),
  CAN YOU REACH THEM (email and text reach), PERMISSION ON FILE (consent
  records), and SAVED SEGMENTS (how the list is sliced).

  This is a MOUNTED space: the org-OS shell holds all four spaces at once and
  toggles visibility. Its data is loaded ONCE by the org layout
  (`+layout.server.ts` → `data.spaces.base`, reusing `supporters.getSummaryStats`
  and the saved-segment read) and threaded in as a prop, so switching into
  People is a pure state toggle — never a re-run of a SvelteKit load.

  The full supporter list — paginated, filterable, with client-side PII
  decryption — stays on the `/supporters` deep route. People answers the
  questions; the list is the deep tool. We link in rather than duplicate the
  table here so the PII-decryption boundary stays exactly where it is.

  HONESTY RULE: only real counts render. An org with no people gets an honest
  empty sentence, a null slice renders as unavailable — never a fabricated
  zero. Consent records are shown as where permission came from, not as
  permission to send.
-->
<script lang="ts">
	import VerificationPipeline from '$lib/components/org/VerificationPipeline.svelte';
	import { PLATFORM_SYNC_PATH_SENTENCE } from '$lib/data/org-limit-sentences';
	import { formatPeopleSourceLabel } from '$lib/data/platform-export-profiles';
	import { Datum, Ratio } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import { fullViewHref } from './orgOS.svelte';
	import {
		CONSENT_SCOPE_SENTENCE,
		NO_PEOPLE_SENTENCE,
		NO_SOURCE_RECORDS_SENTENCE,
		PEOPLE_UNAVAILABLE_SENTENCE,
		SEGMENTS_UNAVAILABLE_SENTENCE,
		describeEmailConsent,
		describeEmailReach,
		describePeopleOnFile,
		describeSavedSegments,
		describeTextConsent,
		describeTextReach
	} from './people-reach';
	import type { BaseSpaceData } from './spaces';

	let {
		data,
		base
	}: {
		/** People slice from the layout load. Null when the summary read failed. */
		data: BaseSpaceData | null;
		/** `/org/[slug]` — for the deep link into the full people list. */
		base: string;
	} = $props();

	function sourceLabel(source: string): string {
		if (source === 'unknown') return 'Unknown source';
		return formatPeopleSourceLabel(source, {
			style: 'record',
			fallback: source.replace(/_/g, ' ')
		});
	}

	const hasPeople = $derived((data?.total ?? 0) > 0);
	const peopleOnFile = $derived(data ? describePeopleOnFile(data) : null);

	const sourceRows = $derived(
		Object.entries(data?.sourceCounts ?? {})
			.filter(([, count]) => count > 0)
			.map(([source, count]) => ({
				source,
				count,
				label: sourceLabel(source)
			}))
			.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
	);
	const visibleSourceRows = $derived(sourceRows.slice(0, 6));

	const emailReach = $derived(data ? describeEmailReach(data.emailHealth) : null);
	const emailReachTotal = $derived(
		data
			? data.emailHealth.subscribed +
					data.emailHealth.unsubscribed +
					data.emailHealth.bounced +
					data.emailHealth.complained
			: 0
	);
	const emailReachSegments = $derived(
		data
			? [
					{
						value: data.emailHealth.subscribed,
						color: 'var(--coord-verified, #10b981)',
						label: 'reachable by email'
					},
					{
						value: data.emailHealth.unsubscribed,
						color: 'oklch(0.78 0.01 250)',
						label: 'unsubscribed'
					},
					{
						value: data.emailHealth.bounced + data.emailHealth.complained,
						color: 'oklch(0.6 0.16 25 / 0.6)',
						label: 'bounced or complained'
					}
				]
			: []
	);

	const textReach = $derived(data ? describeTextReach(data.smsHealth) : null);
	const textOptedOut = $derived(
		data ? data.smsHealth.unsubscribed + data.smsHealth.stopped : 0
	);
	const textReachSegments = $derived(
		data
			? [
					{
						value: data.smsHealth.subscribed,
						color: 'var(--coord-verified, #10b981)',
						label: 'opted in to texts'
					},
					{ value: textOptedOut, color: 'oklch(0.78 0.01 250)', label: 'opted out' },
					{
						value: data.smsHealth.none,
						color: 'oklch(0.93 0.004 60)',
						label: 'no answer recorded'
					}
				]
			: []
	);

	const emailConsent = $derived(data ? describeEmailConsent(data.consentEvidence) : null);
	const textConsent = $derived(data ? describeTextConsent(data.consentEvidence) : null);
	const savedSegments = $derived(
		data?.segmentation ? describeSavedSegments(data.segmentation) : null
	);
</script>

<div class="people" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="people-head">
		<div class="people-head-copy">
			<h1 class="people-title">People</h1>
			<p class="people-sub">
				Who you have, whether you can reach them, and what permission is on file.
			</p>
		</div>
		<div class="people-head-instrument">
			{#if hasPeople && peopleOnFile}
				<p class="people-headline">{peopleOnFile}</p>
			{/if}
			<a
				class="people-deep"
				href={fullViewHref(`${base}/supporters`)}
				data-sveltekit-preload-data="off">Your people list →</a
			>
		</div>
	</header>

	{#if !data}
		<!-- Unavailable, not zero: the summary read failed for this page view. -->
		<p class="people-dormant">{PEOPLE_UNAVAILABLE_SENTENCE}</p>
	{:else if !hasPeople}
		<div class="people-empty">
			<p class="people-empty-text">{NO_PEOPLE_SENTENCE}</p>
			<div class="people-empty-links">
				<a class="people-link" href="{base}/supporters/import">Import a CSV →</a>
				<a class="people-link" href="{base}/supporters/import/platform-api">Connect a platform →</a
				>
			</div>
			<p class="people-quiet">{PLATFORM_SYNC_PATH_SENTENCE}</p>
		</div>
	{:else}
		<!-- YOUR LIST — the total and the verification funnel. -->
		<section class="list" aria-label="Your list">
			<span class="section-label">Your list</span>
			<VerificationPipeline
				total={data.total}
				postalResolved={data.postalResolved}
				districtVerified={data.districtVerified}
				identityVerified={data.identityVerified}
			/>
		</section>

		<div class="questions">
			<!-- WHERE THEY CAME FROM — import origins, kept with each person. -->
			<section class="card" aria-label="Where your people came from">
				<span class="section-label">Where they came from</span>
				{#if visibleSourceRows.length === 0}
					<p class="people-quiet">{NO_SOURCE_RECORDS_SENTENCE}</p>
				{:else}
					<div class="source-list">
						{#each visibleSourceRows as row (row.source)}
							<div class="source-row">
								<span class="source-name">{row.label}</span>
								<span class="source-count">
									<Datum value={row.count} class="source-num" />
									<span>{row.count === 1 ? 'person' : 'people'}</span>
								</span>
							</div>
						{/each}
					</div>
				{/if}
				<p class="people-quiet">{PLATFORM_SYNC_PATH_SENTENCE}</p>
				<div class="card-links">
					<a class="people-link" href="{base}/supporters/import">Import a CSV →</a>
					<a class="people-link" href="{base}/supporters/import/platform-api"
						>Connect a platform →</a
					>
				</div>
			</section>

			<!-- CAN YOU REACH THEM — email and text reach as sentences. -->
			<section class="card" aria-label="Can you reach them">
				<span class="section-label">Can you reach them</span>
				<div class="reach-block">
					<p class="card-sentence">{emailReach}</p>
					{#if emailReachTotal > 0}
						<Ratio segments={emailReachSegments} height={5} />
					{/if}
				</div>
				<div class="reach-block">
					<p class="card-sentence">{textReach}</p>
					{#if data.smsHealth.subscribed + textOptedOut > 0}
						<Ratio segments={textReachSegments} height={5} />
					{/if}
				</div>
			</section>

			<!-- PERMISSION ON FILE — consent records and their honest scope. -->
			<section class="card" aria-label="Permission on file">
				<span class="section-label">Permission on file</span>
				<p class="card-sentence">{emailConsent}</p>
				{#if textConsent}
					<p class="card-sentence">{textConsent}</p>
				{/if}
				<p class="people-quiet">{CONSENT_SCOPE_SENTENCE}</p>
			</section>

			<!-- SAVED SEGMENTS — how the list is sliced today. -->
			<section class="card" aria-label="Saved segments">
				<span class="section-label">Saved segments</span>
				{#if savedSegments === null}
					<!-- Unavailable, not zero: the saved-segment read failed. -->
					<p class="people-quiet">{SEGMENTS_UNAVAILABLE_SENTENCE}</p>
				{:else}
					<p class="card-sentence">{savedSegments}</p>
				{/if}
				<div class="card-links">
					<a class="people-link" href="{fullViewHref(`${base}/supporters`)}#people-segments"
						>Open segments →</a
					>
				</div>
			</section>
		</div>
	{/if}
</div>

<style>
	.people {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		width: 100%;
	}

	/* ─── Head ─── */
	.people-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		flex-direction: column;
		gap: 1rem;
	}
	@media (min-width: 860px) {
		.people-head {
			flex-direction: row;
		}
	}
	.people-head-copy {
		min-width: 0;
	}
	.people-head-instrument {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.375rem;
	}
	@media (min-width: 860px) {
		.people-head-instrument {
			align-items: flex-end;
		}
	}
	.people-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}
	.people-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0.25rem 0 0;
		max-width: 36rem;
	}
	.people-headline {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		margin: 0;
		max-width: 34rem;
	}
	@media (min-width: 860px) {
		.people-headline {
			text-align: right;
		}
	}
	.people-deep {
		flex-shrink: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		transition: color var(--timing-slow) var(--easing);
	}
	.people-deep:hover,
	.people-deep:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	/* ─── Dormant + empty ─── */
	.people-dormant {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		font-style: italic;
		margin: 0;
		max-width: 40rem;
	}
	.people-empty {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		max-width: 40rem;
	}
	.people-empty-text {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		margin: 0;
	}
	.people-empty-links {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	/* ─── Shared ─── */
	.section-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.55 0.01 250);
	}
	.people-quiet {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
	}
	.people-link {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		transition: color var(--timing-slow) var(--easing);
	}
	.people-link:hover,
	.people-link:focus-visible {
		text-decoration: underline;
		outline: none;
	}
	.card-sentence {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		margin: 0;
	}

	/* ─── Your list ─── */
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	/* ─── Question cards ─── */
	.questions {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	@media (min-width: 1024px) {
		.questions {
			grid-template-columns: 1fr 1fr;
			align-items: start;
		}
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem 1.125rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.card-links {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
	}

	/* ─── Sources ─── */
	.source-list {
		display: grid;
		gap: 0.375rem;
	}
	.source-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		min-height: 1.5rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
	}
	.source-name {
		min-width: 0;
		color: var(--text-secondary, oklch(0.4 0.01 60));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.source-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35rem;
		color: var(--text-tertiary, #6b7280);
		white-space: nowrap;
	}
	.source-list :global(.source-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	/* ─── Reach ─── */
	.reach-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
