<!--
  BaseSpace — People: proof-weighted reach.

  People renders the verification pipeline as signal-weight: people in ledger,
  address evidence, district evidence, identity evidence, plus email deliverability
  health. Its data is loaded ONCE by the org layout
  (`+layout.server.ts` → `data.spaces.base`, reusing `supporters.getSummaryStats`)
  and threaded in as a prop, so switching into People is a pure state toggle — the
  pipeline numbers persist across space switches with no route load.

  The full supporter ledger — paginated, filterable, with client-side PII
  decryption — stays on the `/supporters` deep route (still resolvable). People is
  the pipeline VIEW; the ledger is the deep tool. We link in rather than duplicate
  the table here so the PII-decryption boundary stays exactly where it is.

  HONESTY RULE: only REAL pipeline counts render. An org with no supporters gets
  an honest empty state (handled inside VerificationPipeline), not faked zeros. A
  null slice renders a dormant state.
-->
<script lang="ts">
	import VerificationPipeline from '$lib/components/org/VerificationPipeline.svelte';
	import { formatCapabilityClusters } from '$lib/data/capability-clusters';
	import {
		buildEmailListHealthReadiness,
		buildPeopleSegmentationReadiness,
		buildPeopleSourceProvenanceReadiness,
		formatGateEvidence,
		getDataHonestyEvidence,
		getGateEvidence,
		type CapabilityState,
		type PeopleSegmentationReadinessRow
	} from '$lib/data/capability-hypergraph';
	import {
		operatorCapabilityActionLabel,
		operatorCapabilityStateLabel,
		operatorCapabilityStateVerbLabel
	} from '$lib/data/capability-state-labels';
	import { formatPeopleSourceLabel } from '$lib/data/platform-export-profiles';
	import { Datum } from '$lib/design';
	import { TIMING, EASING } from '$lib/design/motion';
	import WorkspaceCapabilityStrip from './WorkspaceCapabilityStrip.svelte';
	import type { BaseSpaceData } from './spaces';

	type WorkspaceCapabilityItem = {
		label: string;
		state: CapabilityState;
		phase: string;
		cluster: string;
		action: string;
		detail: string;
		unlock: string;
		href: string;
		metric?: {
			value: number | null;
			label: string;
			cite: string;
		};
	};

	type PeopleHeaderMetric = {
		value: number | null;
		label: string;
		cite: string;
	};

	let {
		data,
		base
	}: {
		/** People slice from the layout load. Null when the summary read failed. */
		data: BaseSpaceData | null;
		/** `/org/[slug]` — for the deep link into the full supporter ledger. */
		base: string;
	} = $props();

	function fmt(n: number): string {
		return n.toLocaleString('en-US');
	}

	function sourceLabel(source: string): string {
		if (source === 'unknown') return 'Unknown source';
		return formatPeopleSourceLabel(source, {
			style: 'record',
			fallback: source.replace(/_/g, ' ')
		});
	}

	const hasSupporters = $derived((data?.total ?? 0) > 0);
	const peopleHeaderMetrics = $derived<PeopleHeaderMetric[]>([
		{
			value: data?.total ?? null,
			label: 'people loaded',
			cite: 'supporters.getSummaryStats total'
		},
		{
			value: data?.postalResolved ?? null,
			label: 'address evidence',
			cite: 'supporters.getSummaryStats postalResolved'
		},
		{
			value: data?.districtVerified ?? null,
			label: 'district signal',
			cite: 'supporters.getSummaryStats districtVerified'
		},
		{
			value: data?.identityVerified ?? null,
			label: 'identity verified',
			cite: 'supporters.getSummaryStats identityVerified'
		},
		{
			value: data?.emailHealth.subscribed ?? null,
			label: 'subscribed reach',
			cite: 'supporters.getSummaryStats emailHealth.subscribed'
		}
	]);
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
	const visibleSourceRows = $derived(sourceRows.slice(0, 4));
	const verificationTrustGate = getGateEvidence('CP-mainnet-deployment', ['T3-6', 'T5-3'], {
		name: 'Mainnet + TEE verification trust',
		dependency: 'DistrictRegistry mainnet deployment + TEE attestation'
	});
	const platformApiGate = getGateEvidence('CP-platform-api-sync', ['T1-3'], {
		name: 'Direct platform sync',
		downstream: 1,
		dependency: 'Encrypted credential custody + direct sync execution'
	});
	const emailProxyGate = getGateEvidence('CP-2', ['T2-2'], {
		name: 'Email send proxy',
		dependency: 'AWS Lambda deploy + BLAST receipts secret sync'
	});
	const listUnsubscribeGate = getGateEvidence('CP-list-unsubscribe', ['T2-4'], {
		name: 'List-Unsubscribe headers',
		downstream: 2,
		dependency: 'SES v2 Simple.Headers + per-recipient HMAC URL on the Convex path'
	});
	const listUnsubscribeProviderGate = getGateEvidence(
		'CP-list-unsubscribe-provider-rendering',
		['T2-4b'],
		{
			name: 'Mailbox unsubscribe rendering',
			downstream: 1,
			dependency: 'Production Gmail/Yahoo seed sends confirming one-click affordance rendering'
		}
	);
	const softBounceGate = getGateEvidence('CP-soft-bounce-categorization', ['T2-5'], {
		name: 'Soft-bounce suppression',
		downstream: 1,
		dependency: '3-strike transient bounce threshold + suppressedEmails TTL'
	});
	const customDomainGate = getGateEvidence('CP-custom-domain-dkim', ['T2-6'], {
		name: 'Sender domain authentication',
		downstream: 2,
		dependency: 'Per-org SES identity, DKIM, DMARC, and From-domain verification'
	});
	const civicGeographyLabelsGate = getGateEvidence('CP-civic-geography-labels', ['T1-8c'], {
		name: 'Civic geography labels',
		downstream: 1,
		dependency: 'Supporter civic-label materialization/backfill'
	});
	const softBounceHonesty = getDataHonestyEvidence('V-7', null, {
		live: 'Soft-bounce threshold evidence is verified against webhook and suppression rows.',
		gated: 'Soft-bounce threshold evidence is unresolved.',
		gate: 'Verify soft-bounce threshold handling before claiming suppression integrity.'
	});
	const peopleSourceProvenanceReadiness = $derived(
		buildPeopleSourceProvenanceReadiness({
			base,
			sourceCounts: data?.sourceCounts ?? null,
			totalPeople: data?.total ?? null,
			platformApiGate
		})
	);
	const peopleLedgerHandoffMetrics = $derived<PeopleHeaderMetric[]>([
		{
			value: data?.total ?? null,
			label: 'ledger rows',
			cite: 'supporters.getSummaryStats total'
		},
		{
			value: data?.identityVerified ?? null,
			label: 'proof-weight rows',
			cite: 'supporters.getSummaryStats identityVerified'
		},
		{
			value: peopleSourceProvenanceReadiness.metric.value,
			label: peopleSourceProvenanceReadiness.metric.label,
			cite: peopleSourceProvenanceReadiness.metric.cite
		},
		{
			value: data?.emailHealth.subscribed ?? null,
			label: 'reachable rows',
			cite: 'supporters.getSummaryStats emailHealth.subscribed'
		}
	]);
	const peopleLedgerHandoffHref = $derived(
		hasSupporters
			? `${base}/supporters#people-ledger-boundary`
			: `${base}/supporters/import#csv-intake`
	);
	const peopleLedgerHandoffAction = $derived(
		actionLabel(
			peopleSourceProvenanceReadiness.state,
			hasSupporters ? 'open People ledger' : 'import people'
		)
	);
	const peopleSegmentation = $derived(data?.segmentation ?? null);
	const peopleSegmentationReadiness = $derived(
		buildPeopleSegmentationReadiness({
			base,
			segmentation: {
				loaded: Boolean(peopleSegmentation),
				segmentCount: peopleSegmentation?.segmentCount ?? null,
				conditionCount: peopleSegmentation?.conditionCount ?? null,
				tagConditionCount: peopleSegmentation?.tagConditionCount ?? null,
				verificationConditionCount: peopleSegmentation?.verificationConditionCount ?? null,
				sourceConditionCount: peopleSegmentation?.sourceConditionCount ?? null,
				emailStatusConditionCount: peopleSegmentation?.emailStatusConditionCount ?? null,
				dateConditionCount: peopleSegmentation?.dateConditionCount ?? null,
				postalCountryConditionCount: peopleSegmentation?.postalCountryConditionCount ?? null,
				stateCodeConditionCount: peopleSegmentation?.stateCodeConditionCount ?? null,
				congressionalDistrictConditionCount:
					peopleSegmentation?.congressionalDistrictConditionCount ?? null,
				campaignParticipationConditionCount:
					peopleSegmentation?.campaignParticipationConditionCount ?? null,
				actionDistrictHashConditionCount:
					peopleSegmentation?.actionDistrictHashConditionCount ?? null,
				actionDistrictLabelConditionCount:
					peopleSegmentation?.actionDistrictLabelConditionCount ?? null,
				engagementTierConditionCount: peopleSegmentation?.engagementTierConditionCount ?? null,
				humanReadableGeographyConditionCount:
					peopleSegmentation?.humanReadableGeographyConditionCount ?? null
			},
			gates: {
				civicGeographyLabelsGate,
				platformApiGate
			}
		})
	);
	const peopleSegmentationRows = $derived<PeopleSegmentationReadinessRow[]>(
		peopleSegmentationReadiness.rows
	);
	const emailListHealthReadiness = $derived(
		buildEmailListHealthReadiness({
			base,
			emailHealth: {
				loaded: Boolean(data),
				subscribed: data?.emailHealth.subscribed ?? null,
				unsubscribed: data?.emailHealth.unsubscribed ?? null,
				bounced: data?.emailHealth.bounced ?? null,
				complained: data?.emailHealth.complained ?? null,
				consentEvidenceCount: data?.consentEvidence.email ?? null,
				subscribedConsentEvidenceCount: data?.consentEvidence.emailSubscribed ?? null
			},
			gates: {
				emailProxyGate,
				listUnsubscribeGate,
				listUnsubscribeProviderGate,
				softBounceGate,
				customDomainGate
			},
			honesty: {
				softBounceThreshold: softBounceHonesty
			}
		})
	);
	const verificationSignalState = $derived<CapabilityState>(
		data && verificationTrustGate.state === 'live' ? 'live' : data ? 'partial' : 'gated'
	);
	const capabilityItems = $derived<WorkspaceCapabilityItem[]>([
		{
			label: 'People verification signal',
			state: verificationSignalState,
			phase: 'GROUND',
			cluster: 'C-verification / C-data-sovereignty',
			action: data ? 'read verification weight' : 'read verification boundary',
			detail: data
				? `${fmt(data.postalResolved)} address-resolved, ${fmt(data.districtVerified)} district-verified, and ${fmt(data.identityVerified)} identity-verified people are loaded as aggregate signal.`
				: 'People verification signal is unread; reach and verification-weight claims remain unclaimed and uncounted in this read.',
			unlock: formatGateEvidence(verificationTrustGate, {
				prefix: 'Mainnet registry and TEE attestation still bound stronger identity trust.'
			}),
			href: `${base}/supporters`,
			metric: {
				value: data?.identityVerified ?? null,
				label: 'identity verified',
				cite: 'supporters.getSummaryStats'
			}
		},
		{
			label: 'People source custody',
			state: peopleSourceProvenanceReadiness.state,
			phase: 'GROUND',
			cluster: 'C-data-sovereignty / C-reach',
			action: peopleSourceProvenanceReadiness.action,
			detail: peopleSourceProvenanceReadiness.effect,
			unlock: peopleSourceProvenanceReadiness.gate,
			href: peopleSourceProvenanceReadiness.href,
			metric: peopleSourceProvenanceReadiness.metric
		},
		{
			label: 'People segmentation posture',
			state: peopleSegmentationReadiness.state,
			phase: 'AUTHOR / GROUND',
			cluster: 'C-reach / C-data-sovereignty',
			action: peopleSegmentationReadiness.action,
			detail: peopleSegmentationReadiness.effect,
			unlock: formatGateEvidence(peopleSegmentationReadiness.nextGate, {
				prefix: peopleSegmentationReadiness.detail,
				density: 'operator'
			}),
			href: peopleSegmentationReadiness.href,
			metric: peopleSegmentationReadiness.metric
		},
		{
			label: 'Consent-bound reach',
			state: emailListHealthReadiness.state,
			phase: 'GROUND / SEND',
			cluster: 'C-reach / C-data-sovereignty',
			action: emailListHealthReadiness.action,
			detail: emailListHealthReadiness.effect,
			unlock: formatGateEvidence(emailListHealthReadiness.nextGate, {
				prefix: emailListHealthReadiness.detail,
				density: 'operator'
			}),
			href: emailListHealthReadiness.href,
			metric: emailListHealthReadiness.metric
		}
	]);

	function stateLabel(state: CapabilityState): string {
		return operatorCapabilityStateLabel(state);
	}

	function stateVerbLabel(state: CapabilityState): string {
		return operatorCapabilityStateVerbLabel(state);
	}

	function actionLabel(state: CapabilityState, action: string): string {
		return operatorCapabilityActionLabel(state, action, { appendReadyArrow: true });
	}
</script>

<div class="base" style="--timing-slow: {TIMING.SLOW}ms; --easing: {EASING};">
	<header class="base-head">
		<div class="base-head-copy">
			<h1 class="base-title">People</h1>
			<p class="base-sub">
				People you can reach — verification as signal-weight, not a contact table.
			</p>
		</div>
		<div class="base-head-instrument">
			<div class="base-proof-counts" aria-label="People verification evidence counts">
				{#each peopleHeaderMetrics as metric (metric.label)}
					<span class="base-proof-count">
						<Datum value={metric.value} cite={metric.cite} />
						<span>{metric.label}</span>
					</span>
				{/each}
			</div>
			<a class="base-deep" href="{base}/supporters" data-sveltekit-preload-data="off"
				>People ledger →</a
			>
		</div>
	</header>

	{#if !data}
		<p class="base-dormant">
			This shell did not attach People evidence; reach, source-custody, and verification-weight
			claims remain unclaimed and uncounted in this read.
		</p>
	{:else}
		<WorkspaceCapabilityStrip label="People capability" items={capabilityItems} />

		<!-- Pipeline — the strong center. Reuses the supporters-route component. -->
		<VerificationPipeline
			total={data.total}
			postalResolved={data.postalResolved}
			districtVerified={data.districtVerified}
			identityVerified={data.identityVerified}
		/>

		{#if hasSupporters}
			<section id="people-source-provenance" class="source" aria-label="People source custody">
				<div class="source-head">
					<span class="source-label">Source custody</span>
					<span class="source-summary">{peopleSourceProvenanceReadiness.signal}</span>
				</div>
				{#if visibleSourceRows.length > 0}
					<div class="source-list">
						{#each visibleSourceRows as row (row.source)}
							<div class="source-row">
								<span class="source-name">{row.label}</span>
								<span class="source-count">
									<Datum value={row.count} class="source-num" />
									<span>people</span>
								</span>
							</div>
						{/each}
					</div>
					<p class="source-note">{peopleSourceProvenanceReadiness.detail}</p>
				{:else}
					<p class="source-empty">No source-origin evidence is present yet.</p>
				{/if}
			</section>

			<section id="people-segments" class="segments" aria-label="People segmentation posture">
				<div class="segments-head">
					<span class="segments-label">People Segmentation</span>
					<span class="segments-summary">{peopleSegmentationReadiness.signal}</span>
				</div>
				<p class="segments-note">{peopleSegmentationReadiness.effect}</p>
				<div class="segments-list" aria-label="People segmentation readiness rows">
					{#each peopleSegmentationRows as row (row.id)}
						<a class="segments-row" href={row.href} data-sveltekit-preload-data="off">
							<span class="segments-main">
								<span class="segments-name">{row.label}</span>
								<span class="segments-meta"
									>{row.phase} / {formatCapabilityClusters(row.clusters)}</span
								>
							</span>
							<span class="segments-state">{stateLabel(row.state)}</span>
							<span class="segments-count">
								<Datum value={row.metric.value} cite={row.metric.cite} class="segments-num" />
								<span>{row.metric.label}</span>
							</span>
						</a>
					{/each}
				</div>
			</section>

			<!-- Email deliverability health — real status counts only. -->
			<section id="email-health" class="health" aria-label="Consent-bound reach">
				<div class="health-head">
					<span class="health-label">Consent-bound Reach</span>
					<span class="health-summary">{emailListHealthReadiness.signal}</span>
				</div>
				<div class="health-row">
					<span class="health-stat">
						<span class="health-dot health-dot--ok"></span>
						<Datum value={data.emailHealth.subscribed} class="health-num" />
						<span class="health-key">subscribed</span>
					</span>
					<span class="health-stat">
						<span class="health-dot health-dot--warn"></span>
						<Datum value={data.emailHealth.unsubscribed} class="health-num" />
						<span class="health-key">unsubscribed</span>
					</span>
					<span class="health-stat">
						<span class="health-dot health-dot--err"></span>
						<Datum value={data.emailHealth.bounced} class="health-num" />
						<span class="health-key">bounced</span>
					</span>
					<span class="health-stat">
						<span class="health-dot health-dot--err-strong"></span>
						<Datum value={data.emailHealth.complained} class="health-num" />
						<span class="health-key">complained</span>
					</span>
				</div>
				<p class="health-note">{emailListHealthReadiness.effect}</p>
			</section>

			<section
				id="people-ledger-handoff"
				class="ledger-handoff"
				data-state={peopleSourceProvenanceReadiness.state}
				aria-label="People ledger capability handoff"
			>
				<div class="ledger-handoff-head">
					<span class="ledger-handoff-label">People ledger handoff</span>
					<span class="ledger-handoff-state">
						<span>{stateLabel(peopleSourceProvenanceReadiness.state)}</span>
						<span>{stateVerbLabel(peopleSourceProvenanceReadiness.state)}</span>
					</span>
				</div>
				<div class="ledger-handoff-grid" aria-label="People ledger handoff evidence">
					{#each peopleLedgerHandoffMetrics as metric (metric.label)}
						<span class="ledger-handoff-cell">
							<Datum value={metric.value} cite={metric.cite} />
							<span>{metric.label}</span>
						</span>
					{/each}
				</div>
				<p class="ledger-handoff-copy">
					Encrypted person rows are operational drilldown below aggregate proof weight; source
					custody and consent stay visible before row work.
				</p>
				<a
					class="ledger-handoff-action"
					href={peopleLedgerHandoffHref}
					data-sveltekit-preload-data="off"
					aria-label="People ledger handoff. {stateLabel(
						peopleSourceProvenanceReadiness.state
					)}. {peopleLedgerHandoffAction}. {peopleSourceProvenanceReadiness.gate}"
				>
					{peopleLedgerHandoffAction}
				</a>
				<p class="ledger-handoff-gate">
					<span>Next</span>
					<span>{peopleSourceProvenanceReadiness.gate}</span>
				</p>
			</section>
		{:else}
			<p class="base-empty">
				No people yet. <a class="base-empty-link" href="{base}/supporters/import">Upload CSV</a> to begin
				building reach. Direct platform sync is not yet armed.
			</p>
		{/if}
	{/if}
</div>

<style>
	.base {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		width: 100%;
	}

	/* ─── Head ─── */
	.base-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}
	.base-head-copy {
		min-width: 0;
	}
	.base-head-instrument {
		display: flex;
		flex-shrink: 0;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.625rem;
	}
	.base-proof-counts {
		display: flex;
		max-width: 38rem;
		flex-wrap: wrap;
		justify-content: flex-start;
		gap: 0.5rem 0.875rem;
	}
	.base-proof-count {
		display: inline-flex;
		align-items: baseline;
		gap: 0.25rem;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 0.6875rem;
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-secondary, oklch(0.42 0.015 60));
		white-space: nowrap;
	}
	.base-title {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: 0;
		color: var(--text-primary, oklch(0.25 0.01 60));
		margin: 0;
	}
	.base-sub {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.875rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0.25rem 0 0;
		max-width: 36rem;
	}
	.base-deep {
		flex-shrink: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		padding-top: 0.5rem;
		transition: color var(--timing-slow) var(--easing);
	}
	.base-deep:hover,
	.base-deep:focus-visible {
		text-decoration: underline;
		outline: none;
	}

	.base-dormant,
	.base-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
		max-width: 40rem;
	}
	.base-dormant {
		font-style: italic;
	}
	.base-empty-link {
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
	}
	.base-empty-link:hover {
		text-decoration: underline;
	}

	/* ─── Source custody ─── */
	.source {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1rem 1.125rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.source-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.source-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.55 0.01 250);
	}
	.source-summary,
	.source-note,
	.source-empty {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
	}
	.source-summary {
		white-space: nowrap;
	}
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
	.source :global(.source-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.source-note {
		line-height: 1.4;
	}

	/* ─── Segmentation posture ─── */
	.segments {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1rem 1.125rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.segments-head,
	.health-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.segments-label,
	.health-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.55 0.01 250);
	}
	.segments-summary,
	.segments-note,
	.health-summary,
	.health-note {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
		margin: 0;
	}
	.segments-summary,
	.health-summary {
		white-space: nowrap;
	}
	.segments-note,
	.health-note {
		line-height: 1.4;
	}
	.segments-list {
		display: grid;
		gap: 0.375rem;
	}
	.segments-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(8rem, auto);
		align-items: center;
		gap: 0.75rem;
		min-height: 2rem;
		padding-block: 0.25rem;
		color: inherit;
		text-decoration: none;
	}
	.segments-row:hover .segments-name,
	.segments-row:focus-visible .segments-name {
		color: var(--coord-route-solid, #3bc4b8);
	}
	.segments-row:focus-visible {
		outline: 2px solid var(--coord-route-solid, #3bc4b8);
		outline-offset: 3px;
	}
	.segments-main {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}
	.segments-name {
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-secondary, oklch(0.4 0.01 60));
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color var(--timing-slow) var(--easing);
	}
	.segments-meta,
	.segments-state,
	.segments-count {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary, #6b7280);
	}
	.segments-state {
		color: var(--text-secondary, oklch(0.4 0.01 60));
		white-space: nowrap;
	}
	.segments-count {
		display: inline-flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: 0.35rem;
		white-space: nowrap;
	}
	.segments :global(.segments-num) {
		font-size: 0.75rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	/* ─── Email health ─── */
	.health {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		padding: 1rem 1.125rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.health-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
	}
	.health-stat {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		color: var(--text-tertiary, #6b7280);
	}
	.health-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		flex-shrink: 0;
		transform: translateY(1px);
	}
	.health-dot--ok {
		background: var(--coord-verified, #10b981);
	}
	.health-dot--warn {
		background: oklch(0.75 0.15 85);
	}
	.health-dot--err {
		background: oklch(0.6 0.18 25);
	}
	.health-dot--err-strong {
		background: oklch(0.5 0.18 25);
	}
	.health :global(.health-num) {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}

	/* ─── Ledger handoff ─── */
	.ledger-handoff {
		display: grid;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: 8px;
		border: 1px solid var(--surface-border, oklch(0.9 0.008 60 / 0.8));
		background: var(--surface-base, oklch(0.993 0.003 60));
	}
	.ledger-handoff-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}
	.ledger-handoff-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: oklch(0.55 0.01 250);
	}
	.ledger-handoff-state {
		display: inline-flex;
		align-items: baseline;
		gap: 0.45rem;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--text-tertiary, #6b7280);
		white-space: nowrap;
	}
	.ledger-handoff-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.5rem;
	}
	.ledger-handoff-cell {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary, #6b7280);
	}
	.ledger-handoff-cell :global(.datum) {
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--text-primary, oklch(0.25 0.01 60));
	}
	.ledger-handoff-copy,
	.ledger-handoff-gate {
		margin: 0;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.75rem;
		line-height: 1.45;
		color: var(--text-tertiary, #6b7280);
	}
	.ledger-handoff-action {
		justify-self: start;
		font-family: 'Satoshi', ui-sans-serif, system-ui, sans-serif;
		font-size: 0.8125rem;
		color: var(--coord-route-solid, #3bc4b8);
		text-decoration: none;
		transition: color var(--timing-slow) var(--easing);
	}
	.ledger-handoff-action:hover,
	.ledger-handoff-action:focus-visible {
		text-decoration: underline;
		outline: none;
	}
	.ledger-handoff-gate {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.5rem;
	}
	.ledger-handoff-gate > span:first-child {
		font-family: 'JetBrains Mono', monospace;
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: oklch(0.55 0.01 250);
	}

	@media (max-width: 760px) {
		.base-head {
			flex-direction: column;
		}
		.source-head,
		.segments-head,
		.health-head,
		.ledger-handoff-head {
			align-items: flex-start;
			flex-direction: column;
			gap: 0.25rem;
		}
		.source-summary,
		.segments-summary,
		.health-summary {
			white-space: normal;
		}
		.segments-row {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.25rem;
		}
		.segments-state,
		.segments-count {
			justify-content: flex-start;
		}
		.ledger-handoff-grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	@media (min-width: 860px) {
		.base-head-instrument {
			align-items: flex-end;
		}
		.base-proof-counts {
			justify-content: flex-end;
		}
	}
</style>
