<script lang="ts">
	/**
	 * Decision-Maker Entity — typographic presence, not a card.
	 *
	 * Figure-ground through proximity ratio:
	 * - Tight internal clustering (name + title + action = one dense island)
	 * - Generous void between entities (parent handles this via space-y)
	 * - Name at text-xl creates a topographic peak for scanning
	 * - Action link latent at rest, activates on hover
	 *
	 * The entity is a cluster, not a container.
	 */
	import { Mail, ChevronRight, ExternalLink } from '@lucide/svelte';
	import type { LandscapeMember } from '$lib/utils/landscapeMerge';
	import { routeEvidenceFor } from '$lib/core/agents/target-order';
	import { describeMeasuredRoute } from '$lib/core/agents/reach-census';

	function extractDomain(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	const ROLE_SHORT: Record<string, string> = {
		votes: 'Votes',
		executes: 'Executes',
		shapes: 'Shapes',
		funds: 'Funds',
		oversees: 'Oversees'
	};

	let {
		member,
		contacted = false,
		departing = false,
		priorContact = false,
		onWriteTo,
		showRoleBadge = false,
		canReportBounce = false,
		reported = false,
		reporting = false,
		onReportBounce
	}: {
		member: LandscapeMember;
		contacted: boolean;
		departing: boolean;
		/**
		 * This viewer told us, on an earlier visit, that they wrote to this person.
		 * Nobody observed that send — it is their own claim, so the copy attributes
		 * it to them and never reads as a receipt. It annotates the write
		 * affordance; it deliberately does not gate it (see `isActive`).
		 */
		priorContact?: boolean;
		onWriteTo: (member: LandscapeMember) => void;
		showRoleBadge?: boolean;
		canReportBounce?: boolean;
		reported?: boolean;
		reporting?: boolean;
		onReportBounce?: (email: string) => void;
	} = $props();

	const canAct = $derived(member.deliveryRoute !== 'recorded' && member.deliveryRoute !== 'phone_only');
	const isActive = $derived(canAct && !contacted && !departing);

	// A bounce only means something for a direct email route; CWC/form delivery
	// has no email to bounce. Tier gate is enforced by the parent (server too).
	const canFlagBounce = $derived(
		canReportBounce && member.deliveryRoute === 'email' && !!member.email
	);

	/**
	 * How this address was published, said in one sentence.
	 *
	 * Both halves are reused, not authored here: `routeEvidenceFor`
	 * (`$lib/core/agents/target-order`) derives the two measured facts, and
	 * `describeMeasuredRoute` (`$lib/core/agents/reach-census`) picks the sentence
	 * from the census's own closed label vocabulary, so a row and the census can
	 * never describe the same measurement in two different words.
	 *
	 * A delivery tier is deliberately NOT read, and the identifier is deliberately
	 * absent from this file. The public detail reader's key allowlist for a
	 * recipient row (`convex/lib/publicTemplateDiscoverySource.ts`) rejects the
	 * whole projection when that key appears, and
	 * `convex/lib/publicRecipientProvenance.ts` never signs it — so on the
	 * anonymous path no such field exists, and rendering off it would be reading a
	 * value nobody attested.
	 *
	 * The sentence is rendered unconditionally because every row that reaches this
	 * file has a measured route, and that is enforced upstream, not here:
	 *
	 * (a) The public detail reader admits no ungrounded or sourceless recipient row
	 *     (`convex/lib/publicTemplateDiscoverySource.ts:757-768`): the whole
	 *     projection is rejected unless `emailGrounded === true` and `emailSource`
	 *     round-trips through `publicHttpUrl` (https only, `:261-271`). Pinned by
	 *     `tests/unit/routes/public-detail-route-evidence.test.ts`.
	 * (b) District rows never arrive here at all: `RoleGroup.svelte:60` sends every
	 *     `member.source === 'district'` row to `DistrictOfficialCard`. Pinned by
	 *     `tests/unit/components/landscape-card-measured-route.test.ts`.
	 *
	 * A branch on the unrouted provenance class would therefore be a guard that
	 * cannot fire — an assertion that cannot fail. If the projection ever loosened, the
	 * census's own `route-unmeasured` label ('Address publication route not
	 * established this run') is the correct, honest output for a template row that
	 * went through a resolution run without a route being established; silence
	 * would hide the loosening rather than report it.
	 *
	 * This is copy. It gates nothing: no affordance, count, ordering or send path
	 * reads it.
	 */
	const routeEvidence = $derived(
		routeEvidenceFor({
			name: member.name,
			email: member.email ?? undefined,
			emailGrounded: member.emailGrounded,
			emailSource: member.emailSource ?? undefined
		})
	);
	const measuredRoute = $derived(describeMeasuredRoute(routeEvidence));

	function handleClick() {
		if (isActive) {
			onWriteTo(member);
		}
	}

	function reportBounce(e: MouseEvent) {
		e.stopPropagation();
		if (member.email) onReportBounce?.(member.email);
	}
</script>

{#snippet entityContent()}
	<!-- Name + role badge -->
	<div class="flex items-baseline gap-2">
		<h4 class="text-xl font-bold text-slate-900 font-brand leading-tight">{member.name}</h4>
		{#if showRoleBadge && member.roleCategory}
			<span class="role-badge shrink-0">{ROLE_SHORT[member.roleCategory] || member.roleCategory}</span>
		{/if}
	</div>

	<!-- Title — org is now in the group header -->
	<p class="mt-0.5 text-sm text-slate-500 leading-snug">
		{member.title || ''}
	</p>

	<!-- Actions: receded row — clearly subordinate to title -->
	<div class="mt-1.5 flex items-center gap-3">
		{#if canAct}
			{#if departing}
				<span class="departing-pulse text-xs text-slate-400">
					Opening mail&hellip;
				</span>
			{:else if contacted}
				<span class="flex items-center gap-1 text-xs text-slate-400">
					<Mail class="h-3 w-3" />
					Email started
				</span>
				{#if canFlagBounce}
					{#if reported}
						<span class="text-xs text-[var(--coord-verified)]">Reported</span>
					{:else}
						<button
							type="button"
							class="bounce-flag text-xs text-slate-400 underline decoration-dotted underline-offset-2 py-2 -my-2 hover:text-slate-600"
							disabled={reporting}
							onclick={reportBounce}
						>
							didn't arrive?
						</button>
					{/if}
				{/if}
			{:else}
				<span class="action-link flex items-center gap-0.5 text-xs text-slate-400 transition-colors duration-150">
					Write to them
					<ChevronRight class="h-3.5 w-3.5 transition-all duration-150 opacity-0 -translate-x-1" />
				</span>
				{#if priorContact}
					<!-- Their own past claim, beside the still-live affordance — never
					     instead of it, and never phrased as a delivery we observed. -->
					<span class="text-xs text-slate-400">You said you wrote to them</span>
				{/if}
			{/if}
		{/if}

		{#if member.emailGrounded && member.emailSource}
			<a
				href={member.emailSource}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
				onclick={(e) => e.stopPropagation()}
			>
				{extractDomain(member.emailSource)}
				<ExternalLink class="h-2.5 w-2.5" />
			</a>
		{/if}

		<span class="text-xs text-slate-400">{measuredRoute}</span>
	</div>
{/snippet}

{#if isActive}
	<button
		type="button"
		aria-label="Write to {member.name}"
		class="entity group w-full text-left min-h-[44px] cursor-pointer"
		onclick={handleClick}
	>
		{@render entityContent()}
	</button>
{:else}
	<div
		class="entity group min-h-[44px]
			{departing ? 'departing-entity' : contacted ? 'entity--contacted' : ''}"
	>
		{@render entityContent()}
	</div>
{/if}

<style>
	/* Hover activates the action link — the entity comes alive through its text */
	:global(.group:hover) .action-link {
		color: var(--coord-route-solid);
	}
	:global(.group:hover) .action-link :global(svg) {
		opacity: 1;
		transform: translateX(0);
	}
	/* Role badge — functional power annotation, subordinate to name */
	.role-badge {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-slate-400);
		line-height: 1;
	}
	/* Contacted: the entity settles — quieter, done */
	.entity--contacted :global(h4) { color: var(--color-slate-400); }
	.entity--contacted :global(p) { color: var(--color-slate-300); }

	/* Bounce flag — subsidiary inquiry affordance (dotted underline = inquiry,
	   not a primary action). Recedes until the entity is hovered/focused on
	   pointer devices; stays quietly visible on touch where there is no hover. */
	.bounce-flag {
		transition: opacity 150ms ease-out;
	}
	@media (hover: hover) and (pointer: fine) {
		.bounce-flag {
			opacity: 0;
		}
		:global(.group:hover) .bounce-flag,
		.bounce-flag:focus-visible {
			opacity: 1;
		}
	}
	/* Submitting cue — scoped (unlayered) so it wins over the reveal rules above
	   on pointer devices, where a Tailwind disabled: utility would not. */
	.bounce-flag:disabled {
		opacity: 0.5;
	}

	/* Departing */
	.departing-entity { position: relative; }
	.departing-pulse {
		animation: breathe 1.5s ease-in-out infinite;
	}
	@keyframes breathe {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.departing-pulse { animation: none; opacity: 0.7; }
	}
</style>
