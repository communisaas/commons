<script lang="ts">
	import WorkspaceCapabilityStrip from '$lib/components/org/os/WorkspaceCapabilityStrip.svelte';
	import { FEATURES } from '$lib/config/features';
	import {
		buildCoalitionReadiness,
		getGateEvidence,
		type CoalitionReadinessRow
	} from '$lib/data/capability-hypergraph';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type CapabilityItem = {
		label: string;
		state: 'live' | 'partial' | 'draft-only' | 'gated';
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

	let name = $state('');
	let slug = $state('');
	let description = $state('');
	let slugManual = $state(false);
	let saving = $state(false);
	let errorMsg = $state('');

	const coalitionStatsGate = getGateEvidence('CP-coalition-aggregate-stats', ['T7-1'], {
		name: 'Coalition aggregate stats',
		downstream: 1,
		dependency: 'Network member aggregate query'
	});
	const crossBorderCoalitionGate = getGateEvidence(
		'CP-cross-border-coalition',
		['T7-4', 'T7-6', 'T6-2'],
		{
			name: 'Cross-border coalition routing',
			downstream: 3,
			dependency: 'International Phase 2 + mainnet settlement'
		}
	);
	const coalitionArtifactGate = getGateEvidence('CP-coalition-artifact', ['T6-1', 'T6-2', 'T7-6'], {
		name: 'Durable coalition artifact',
		downstream: 4,
		dependency: 'Receipt anchoring + cross-border delivery path'
	});
	const draftNetworkCount = $derived(name.trim() || slug.trim() || description.trim() ? 1 : 0);
	const coalitionReadiness = $derived(
		buildCoalitionReadiness({
			base: `/org/${data.org.slug}`,
			context: 'creation',
			coalition: {
				enabled: FEATURES.NETWORKS,
				loaded: true,
				activeNetworkCount: 0,
				pendingInviteCount: 0,
				activeMemberRows: 0,
				topActiveNetworkId: null,
				draftNetworkCount,
				creationAuthority: true
			},
			gates: {
				coalitionStatsGate,
				crossBorderCoalitionGate,
				coalitionArtifactGate
			},
			hrefs: {
				'network-memberships': '#coalition-definition',
				'invite-response-queue': '#coalition-authority',
				'member-roster-aggregate': '#coalition-member-path',
				'aggregate-proof-detail': '#coalition-member-path',
				'cross-border-routing': '#coalition-member-path',
				'durable-coalition-artifact': '#coalition-artifact-boundary'
			}
		})
	);
	const coalitionRows = $derived<CoalitionReadinessRow[]>(coalitionReadiness.rows);
	const capabilityItems = $derived<CapabilityItem[]>(
		coalitionRows.map((row) => ({
			label: row.label,
			state: row.state,
			phase: row.phase,
			cluster: row.clusters,
			action: row.action,
			detail: row.ground,
			unlock: row.boundary,
			href: row.href,
			metric: row.metric
		}))
	);

	function toSlug(input: string): string {
		return input
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/[\s_]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 50);
	}

	function onNameInput() {
		if (!slugManual) {
			slug = toSlug(name);
		}
	}

	function onSlugInput() {
		slugManual = true;
	}

	async function submit() {
		const trimmedName = name.trim();
		const trimmedSlug = slug.trim();

		if (trimmedName.length < 3 || trimmedName.length > 100) {
			errorMsg = 'Name must be between 3 and 100 characters';
			return;
		}
		if (trimmedSlug.length < 3 || trimmedSlug.length > 50) {
			errorMsg = 'Slug must be between 3 and 50 characters';
			return;
		}

		saving = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/networks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: trimmedName,
					slug: trimmedSlug,
					description: description.trim() || null
				})
			});

			if (res.ok) {
				const result = await res.json();
				const networkId = result?.data?.id;
				if (!networkId) {
					errorMsg = 'Network created but response did not include a network id';
					return;
				}
				window.location.href = `/org/${data.org.slug}/networks/${networkId}`;
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to create network (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Create coalition network | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl space-y-6 px-4 py-8">
		<!-- Back link -->
		<a
			href="/org/{data.org.slug}/networks"
			class="text-text-tertiary hover:text-text-primary inline-block text-sm"
		>
			&larr; Coalition layer
		</a>

		<div>
			<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
				<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
					Studio
				</a>
				<span aria-hidden="true">/</span>
				<a href="/org/{data.org.slug}/networks" class="hover:text-text-secondary transition-colors">
					Coalition layer
				</a>
				<span aria-hidden="true">/</span>
				<span>Create</span>
			</nav>
			<h1 class="text-text-primary text-xl font-semibold">Create coalition network</h1>
			<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
				Define the coalition record with an explicit proof handoff. Invitations, aggregate stats,
				and durable artifacts stay on post-save routes and gates.
			</p>
		</div>

		<WorkspaceCapabilityStrip label="Coalition creation capability" items={capabilityItems} />

		<!-- Error -->
		{#if errorMsg}
			<div class="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<div
			id="coalition-authority"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Creation authority</p>
			<p class="text-text-tertiary mt-1 text-sm">
				Rendering this form is route evidence that coalition subscription and owner-role gates
				passed. Saving only creates the coordination record; invites and proof stay on the detail
				route.
			</p>
		</div>

		<div
			id="coalition-member-path"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Member proof path</p>
			<p class="text-text-tertiary mt-1 text-sm">
				After creation, the network detail route owns invites, active member rows, and live
				aggregate stats. This page does not invent proof posture before any member record exists.
			</p>
		</div>

		<!-- Form -->
		<div
			id="coalition-definition"
			class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5"
		>
			<div>
				<p class="text-text-tertiary font-mono text-xs font-semibold tracking-wider uppercase">
					Coalition definition
				</p>
				<p class="text-text-tertiary mt-1 text-sm">
					The saved network record is the live capability; proof posture starts on the detail route.
				</p>
			</div>
			<div>
				<label for="net-name" class="text-text-secondary mb-1 block text-sm font-medium">
					Name
				</label>
				<input
					id="net-name"
					type="text"
					bind:value={name}
					oninput={onNameInput}
					placeholder="e.g. Climate Action Coalition"
					maxlength="100"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
				/>
				<p class="text-text-tertiary mt-1 text-xs">{name.trim().length}/100 characters</p>
			</div>

			<div>
				<label for="net-slug" class="text-text-secondary mb-1 block text-sm font-medium">
					Slug
				</label>
				<input
					id="net-slug"
					type="text"
					bind:value={slug}
					oninput={onSlugInput}
					placeholder="climate-action-coalition"
					maxlength="50"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none"
				/>
				<p class="text-text-tertiary mt-1 text-xs">
					URL-friendly identifier ({slug.trim().length}/50)
				</p>
			</div>

			<div>
				<label for="net-desc" class="text-text-secondary mb-1 block text-sm font-medium">
					Description (optional)
				</label>
				<textarea
					id="net-desc"
					bind:value={description}
					placeholder="What is this network for?"
					rows="3"
					maxlength="500"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
				></textarea>
				<p class="text-text-tertiary mt-1 text-xs">{description.trim().length}/500 characters</p>
			</div>
		</div>

		<div
			id="coalition-artifact-boundary"
			class="border-surface-border bg-surface-base rounded-md border px-4 py-3"
		>
			<p class="text-text-primary text-sm font-medium">Artifact boundary</p>
			<p class="text-text-tertiary mt-1 text-sm">
				A created record can coordinate member organizations. Archive-grade coalition packets,
				receipt anchoring, and cross-border settlement remain outside this creation action.
			</p>
		</div>

		<!-- Actions -->
		<div class="flex items-center justify-end gap-3">
			<a
				href="/org/{data.org.slug}/networks"
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-4 py-2 text-sm"
			>
				Cancel
			</a>
			<button
				onclick={submit}
				disabled={saving}
				class="bg-surface-overlay text-text-primary hover:bg-surface-raised rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
			>
				{saving ? 'Creating...' : 'Create coalition network'}
			</button>
		</div>
	</div>
</div>
