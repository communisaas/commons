<script lang="ts">
	import { FEATURES } from '$lib/config/features';
	import { page } from '$app/stores';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';
	import OrgMantle from '$lib/components/org/OrgMantle.svelte';
	import OrgShell from '$lib/components/org/os/OrgShell.svelte';
	import Spotlight, { type SpotlightDestination } from '$lib/components/org/os/Spotlight.svelte';
	import {
		setOrgOS,
		spaceForPath,
		pathForSpace,
		rendersSpaceForUrl,
		fullViewHref
	} from '$lib/components/org/os/orgOS.svelte';
	import type { WorkspaceMark } from '$lib/components/org/WorkspaceSwitcher.svelte';
	import type { WatermarkTier } from '$lib/components/org/MantleWatermark.svelte';
	import { orgLimitSentence, PLATFORM_SYNC_PATH_SENTENCE } from '$lib/data/org-limit-sentences';

	let {
		children,
		data
	}: {
		children: Snippet;
		data: LayoutData;
	} = $props();

	const base = $derived(`/org/${data.org.slug}`);

	// ─── The OS kernel ────────────────────────────────────────────────
	// Created HERE, at the layout, so both the Mantle (WorkspaceSwitcher) and
	// the OrgShell (the four mounted spaces) read the SAME instance via context.
	// The layout persists across every /org/[slug]/* child navigation, so the OS
	// — and the in-flight STUDIO authoring process it holds — survives navigating
	// to deep routes and switching spaces. It is the persistent kernel.
	//
	// setContext must run during component init (not in an effect), so we seed the
	// initial space from the SSR-resolved pathname. The slug is fixed for the life
	// of this mounted layout (a slug change remounts it), so reading it once at
	// init is correct — this is intentionally NOT the reactive `base`.
	const initialBase = `/org/${data.org.slug}`;
	const os = setOrgOS(spaceForPath($page.url.pathname, initialBase), initialBase);

	// A canonical space path (/studio, /supporters, /representatives, org root) is
	// OWNED by a mounted OrgShell space — we show the shell and suppress the
	// redundant route page. A deep route (/campaigns, /settings, /legislation, …)
	// is a full page the OS hasn't absorbed yet: we render its children() instead,
	// while OrgShell stays mounted (hidden) so the STUDIO process keeps streaming.
	// `?view=full` is the explicit opt-out: it renders the full page at a
	// canonical space path (the supporter table at /supporters, the
	// decision-maker directory at /representatives) — the spaces link through it
	// so the deep tools they summarize stay reachable.
	const onSpacePath = $derived(rendersSpaceForUrl($page.url, base));

	// Role gates the STUDIO Send affordance (display only; not enforcement).
	const canPublish = $derived(
		data.membership.role === 'owner' || data.membership.role === 'editor'
	);

	// ─── Limit sentences for bounded actions ──────────────────────────
	// One plain-language sentence per bounded action, conditioned on the real
	// env probes in the operating slice. An unloaded slice carries no note —
	// unread is not a boundary reading.
	const emailDelivery = $derived(data.spaces.operating?.emailDelivery ?? null);
	const textDelivery = $derived(data.spaces.operating?.textDelivery ?? null);
	const callRouting = $derived(data.spaces.operating?.callRouting ?? null);

	const emailHeldNote = $derived(
		emailDelivery && !emailDelivery.serverDispatchRuntimeReady
			? orgLimitSentence('email_server_dispatch_dependency_missing')
			: undefined
	);
	const textHeldNote = $derived(
		textDelivery && !textDelivery.dispatchRuntimeReady
			? orgLimitSentence('text_dispatch_not_armed')
			: undefined
	);
	const callsHeldNote = $derived(
		callRouting && !callRouting.initiationRuntimeReady
			? orgLimitSentence('call_initiation_not_armed')
			: undefined
	);

	// ─── Four workspaces, not thirteen links ──────────────────────────
	// The four marks fold the existing routes into the OS dock: primary
	// destinations on the marks, folded routes in Spotlight, so every route
	// stays reachable. Feature-gated routes render as plain links when the
	// feature is on and are absent when it is off. Count badges read real
	// loaded slices; a null slice renders no badge — null is unread, not zero.
	// The Studio badge is the kernel's live count of running authoring
	// processes, read inside the switcher itself.
	const marks = $derived<WorkspaceMark[]>([
		{
			id: 'studio',
			// STUDIO owns the bare org URL — the authoring front door. The mark's
			// href is the canonical space path so open-in-new-tab / no-JS land here.
			label: 'Studio',
			href: pathForSpace('studio', base),
			secondary: [
				{
					href: `${base}/campaigns`,
					label: 'Action records',
					count: data.spaces.return?.stats.activeCampaigns ?? null
				},
				{ href: `${base}/emails`, label: 'Email delivery', note: emailHeldNote },
				...(FEATURES.SMS
					? [
							{ href: `${base}/sms`, label: 'Texts', note: textHeldNote },
							{ href: `${base}/calls`, label: 'Calls', note: callsHeldNote }
						]
					: []),
				...(FEATURES.EVENTS ? [{ href: `${base}/events`, label: 'Events' }] : []),
				...(FEATURES.FUNDRAISING ? [{ href: `${base}/fundraising`, label: 'Fundraising' }] : []),
				...(FEATURES.AUTOMATION ? [{ href: `${base}/workflows`, label: 'Workflows' }] : [])
			]
		},
		{
			id: 'base',
			label: 'People',
			href: `${base}/supporters`,
			count: data.spaces.base?.total ?? null,
			secondary: [
				{
					href: fullViewHref(`${base}/supporters`),
					label: 'Supporter list',
					count: data.spaces.base?.total ?? null
				},
				{
					href: `${base}/supporters/import#csv-intake`,
					label: 'Import people',
					note: PLATFORM_SYNC_PATH_SENTENCE
				},
				{
					href: `${fullViewHref(`${base}/supporters`)}#people-segments`,
					label: 'Segments',
					count: data.spaces.base?.segmentation?.segmentCount ?? null
				},
				{
					href: `${fullViewHref(`${base}/supporters`)}#email-health`,
					label: 'Email reach',
					count: data.spaces.base?.emailHealth.subscribed ?? null
				}
			]
		},
		{
			id: 'landscape',
			label: 'Power',
			href: `${base}/representatives`,
			count: data.spaces.landscape?.followedCount ?? null,
			secondary: [
				{
					href: fullViewHref(`${base}/representatives`),
					label: 'Decision-maker directory'
				},
				...(FEATURES.LEGISLATION
					? [
							{
								href: `${base}/legislation`,
								label: 'Bills',
								count: data.spaces.landscape?.bills.length ?? null
							},
							{
								href: `${base}/scorecards`,
								label: 'Scorecards',
								count: data.spaces.landscape?.scorecardSnapshotCount ?? null
							}
						]
					: [])
			]
		},
		{
			id: 'return',
			label: 'Results',
			// Results is the destination at `/results`, where delivery metrics,
			// responses, and the Verification Packet live as artifact — demoted from
			// the front door so authoring leads.
			href: pathForSpace('return', base),
			count: data.spaces.return?.stats.activeCampaigns ?? null,
			secondary: [
				{
					href: data.spaces.return?.topCampaignId
						? `${base}/campaigns/${data.spaces.return.topCampaignId}/report#proof-preview`
						: `${pathForSpace('return', base)}#results-packet`,
					label: 'Proof packet'
				}
			]
		}
	]);

	// ─── Substrate — ambient, not a workspace ─────────────────────────
	const substrateLinks = $derived<{ href: string; label: string }[]>([
		{ href: `${base}/settings#org-authority`, label: 'Org authority' },
		...(FEATURES.PUBLIC_API
			? [{ href: `${base}/settings/webhooks#signed-event-ground`, label: 'Signed webhooks' }]
			: []),
		...(FEATURES.NETWORKS ? [{ href: `${base}/networks`, label: 'Coalition' }] : [])
	]);

	// Spotlight index — the recognition-over-recall navigation that replaces the
	// rail's old link cabinet. The four spaces SWITCH; folded routes and the
	// Substrate links NAVIGATE.
	const destinations = $derived<SpotlightDestination[]>([
		...marks.map((m) => ({
			id: `space-${m.id}`,
			label: m.label,
			group: 'Workspaces',
			kind: 'space' as const,
			spaceId: m.id
		})),
		...marks.flatMap((m) =>
			(m.secondary ?? []).map((s) => ({
				id: `route-${m.id}-${s.href}`,
				label: s.label,
				group: m.label,
				kind: 'route' as const,
				href: s.href,
				count: s.count ?? null,
				note: s.note
			}))
		),
		...substrateLinks.map((s) => ({
			id: `sub-${s.href}`,
			label: s.label,
			group: 'Substrate',
			kind: 'route' as const,
			href: s.href
		}))
	]);

	// Watermark — verified-live only (growth + tiers from getDashboardStats),
	// dormant when the layout query was unavailable. Never a fabricated zero.
	const watermark = $derived<{
		thisWeek: number | null;
		lastWeek: number | null;
		tiers: WatermarkTier[];
	}>(
		data.watermark
			? {
					thisWeek: data.watermark.thisWeek,
					lastWeek: data.watermark.lastWeek,
					tiers: data.watermark.tiers
				}
			: { thisWeek: null, lastWeek: null, tiers: [] }
	);

	const orgIdentity = $derived({
		name: data.org.name,
		slug: data.org.slug,
		avatar: data.org.avatar
	});

	// The Mantle's authoring command binds to one readiness boolean from the
	// real env probe in load data — not a derived capability summary.
	const authoringReady = $derived(data.spaces.operating?.authoring?.runtimeReady === true);

	// Measured height of the fixed mobile header, so the main content clears it
	// exactly — no magic spacer that clips a tall header or over-pads a short one.
	let mobileHeaderHeight = $state(0);

	// Single global Spotlight keybinding (⌘K / Ctrl-K). One owner — the layout —
	// so the two Mantle variants (rail + mobile header) never double-toggle it.
	function onSpotlightKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			os.toggleSpotlight();
		}
	}
</script>

<svelte:window onkeydown={onSpotlightKey} />

<div class="flex min-h-screen">
	<!-- Mantle — desktop rail (persistent authoring-first frame) -->
	<aside class="hidden md:block">
		<OrgMantle
			org={orgIdentity}
			role={data.membership.role}
			{marks}
			{substrateLinks}
			signalEvents={data.signalEvents}
			{authoringReady}
			{watermark}
			variant="rail"
		/>
	</aside>

	<!-- Mantle — mobile header (same instrument, reduced density) -->
	<div class="fixed top-0 right-0 left-0 z-40 md:hidden" bind:clientHeight={mobileHeaderHeight}>
		<OrgMantle
			org={orgIdentity}
			role={data.membership.role}
			{marks}
			{substrateLinks}
			signalEvents={data.signalEvents}
			{authoringReady}
			{watermark}
			variant="header"
		/>
	</div>

	<!-- Main content — warm cream ground (design system surface). Mobile pad
	     clears the fixed header by its measured height (0 on desktop, where the
	     header is hidden and the rail is in-flow). -->
	<main
		class="min-w-0 flex-1"
		style="padding-top: {mobileHeaderHeight}px; background: oklch(0.995 0.004 55);"
	>
		<div class="org-main-frame" class:org-main-frame--space={onSpacePath}>
			<!--
			  OrgShell holds the four spaces MOUNTED at once; switching is an instant
			  state toggle (no remount), so the in-flight STUDIO authoring process
			  keeps streaming across space switches. It stays mounted across every
			  deep-route navigation too. On a canonical space path we show the shell;
			  on a deep route we render that route's page below it (shell hidden, state
			  preserved) so every existing route stays reachable.
			-->
			<div class:org-shell-hidden={!onSpacePath}>
				<OrgShell {base} {canPublish} role={data.membership.role} spaces={data.spaces} />
			</div>
			{#if !onSpacePath}
				{@render children()}
			{/if}
		</div>
	</main>
</div>

<!-- Spotlight — one palette, shell-level (outside the hideable OrgShell so it is
     reachable from every space AND every deep route). Carries the navigation the
     rail's link cabinet used to. -->
<Spotlight {destinations} {base} />

<style>
	/* Keep OrgShell MOUNTED (state + STUDIO process alive) but visually out of the
	   way when the operator is on a deep route. Not removed — hidden. */
	.org-shell-hidden {
		display: none;
	}

	main {
		overflow-x: clip;
	}

	.org-main-frame {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		max-width: 64rem;
		overflow-x: clip;
		padding: 1.5rem;
	}

	.org-main-frame--space {
		max-width: none;
	}

	@media (min-width: 768px) {
		.org-main-frame {
			padding: 2rem;
		}

		.org-main-frame--space {
			max-width: 88rem;
		}
	}
</style>
