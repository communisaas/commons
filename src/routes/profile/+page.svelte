<script lang="ts">
	/**
	 * Profile Page — The Document
	 *
	 * A civic passport that inhabits the viewport.
	 * Mobile: stacked, intimate. Desktop: zones spread, space composed.
	 * The signal bar is the visual spine. Everything else is typography and space.
	 */
	import {
		User as UserIcon,
		ExternalLink,
		ChevronRight,
		Edit3,
		Download,
		Trash2
	} from '@lucide/svelte';
	import { spring } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { onMount } from 'svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ProfileEditModal from '$lib/components/profile/ProfileEditModal.svelte';
	import GroundCard from '$lib/components/profile/GroundCard.svelte';
	import GroundSpatialProof from '$lib/components/profile/GroundSpatialProof.svelte';
	import { EntityCluster } from '$lib/design';
	import VerificationGate from '$lib/components/auth/VerificationGate.svelte';
	import AddressChangeFlow from '$lib/components/auth/AddressChangeFlow.svelte';
	import AddressRestoreFlow from '$lib/components/auth/AddressRestoreFlow.svelte';
	import { invalidateAll } from '$app/navigation';
	import { FEATURES, isAnyMdlProtocolEnabled } from '$lib/config/features';
	import { decryptedUser } from '$lib/stores/decryptedUser.svelte';
	import { getConstituentAddress } from '$lib/core/identity/constituent-address';
	import { getOfficialsFromBrowser } from '$lib/core/shadow-atlas/browser-client';
	import type { PageData } from './$types';

	interface ProfileRepresentative {
		name: string;
		party?: string;
		chamber?: string;
		state?: string;
		district?: string;
	}

	let { data }: { data: PageData } = $props();

	type EditSection = 'basic' | 'profile';
	let avatarEl = $state<HTMLImageElement | null>(null);
	let avatarError = $state(false);
	let showEditModal = $state(false);
	let editingSection = $state<EditSection>('basic');
	let showVerificationGate = $state(false);
	let showAddressChange = $state(false);
	let showAddressRestore = $state(false);
	let groundCardKey = $state(0);
	let currentReps = $state<ProfileRepresentative[]>([]);
	let localRepresentatives = $state<ProfileRepresentative[]>([]);
	let localGroundDistrict = $state<string | null>(null);
	// Tracks the re-grounding phase so we can block the close control once the
	// retirement ceremony is underway. Retired credentials cannot be un-retired.
	let addressChangePhase = $state<'capture' | 'witnessing' | 'complete'>('capture');

	const user = $derived(data.user);
	const displayName = $derived(decryptedUser.name ?? user?.name ?? null);
	const displayEmail = $derived(decryptedUser.email ?? user?.email ?? null);
	const userDetailsPromise = $derived(data.streamed?.userDetails);
	const templatesDataPromise = $derived(data.streamed?.templatesData);
	const representativesPromise = $derived(data.streamed?.representatives);
	const groundState = $derived(data.groundState);
	const groundDistrict = $derived(
		localGroundDistrict ?? groundState?.credential?.district ?? null
	);
	const groundH3Cell = $derived(groundState?.cell?.h3Cell ?? null);

	const trustTier = $derived(user?.trust_tier ?? 0);
	const tier = $derived(Math.max(0, Math.min(4, Math.floor(trustTier))));
	const serverAddressVerified = $derived(Boolean(user?.district_verified));

	const levels = [
		{
			signal: 'Not verified',
			arrives: 'General delivery. No district proof yet.',
			weight: 8,
			gradientFrom: '#cbd5e1',
			gradientTo: '#94a3b8',
			textClass: 'text-slate-600',
			accentClass: 'text-slate-700'
		},
		{
			signal: 'Signed in',
			arrives: 'Named sender. Verify your address for district delivery.',
			weight: 18,
			gradientFrom: '#93c5fd',
			gradientTo: '#3b82f6',
			textClass: 'text-blue-600',
			accentClass: 'text-blue-700'
		},
		{
			signal: 'Address verified',
			arrives: 'Your district is verified for official delivery.',
			weight: 62,
			gradientFrom: '#34d399',
			gradientTo: '#10b981',
			textClass: 'text-emerald-600',
			accentClass: 'text-emerald-700'
		},
		{
			signal: 'Identity checked',
			arrives: 'Government ID verified. Adds a stronger proof for supported actions.',
			weight: 82,
			gradientFrom: '#c084fc',
			gradientTo: '#a855f7',
			textClass: 'text-emerald-600',
			accentClass: 'text-emerald-700'
		},
		{
			signal: 'Proof ready',
			arrives: 'Residency proof ready for official delivery.',
			weight: 100,
			gradientFrom: '#818cf8',
			gradientTo: '#6366f1',
			textClass: 'text-indigo-600',
			accentClass: 'text-indigo-700'
		}
	];

	const current = $derived(levels[tier]);
	const signalWidth = spring(0, { stiffness: 0.06, damping: 0.65 });

	$effect(() => {
		signalWidth.set(current.weight);
	});

	// CSP-safe avatar error handling — also catches already-failed images
	$effect(() => {
		if (avatarEl) {
			if (avatarEl.complete && avatarEl.naturalWidth === 0) {
				avatarError = true;
				return;
			}
			const handler = () => (avatarError = true);
			avatarEl.addEventListener('error', handler);
			return () => avatarEl?.removeEventListener('error', handler);
		}
	});

	function formatDate(date: string | number | Date) {
		return new Date(date).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function openEditModal(section: EditSection) {
		editingSection = section;
		showEditModal = true;
	}

	function handleProfileSave(_data: import('$lib/types/any-replacements.js').ProfileUpdateData) {
		showEditModal = false;
		invalidateAll();
	}

	function normalizeRepresentatives(reps: Array<{
		name: string;
		party?: string | null;
		chamber?: string;
		state?: string | null;
		district?: string | null;
	}>): ProfileRepresentative[] {
		return reps.map((rep) => ({
			name: rep.name,
			party: rep.party ?? undefined,
			chamber: rep.chamber,
			state: rep.state ?? undefined,
			district: rep.district ?? undefined
		}));
	}

	function repChamberLabel(chamber: string | undefined): string {
		const c = chamber?.toLowerCase();
		if (c === 'senate') return 'Senate';
		if (c === 'house') return 'House';
		return 'Representative';
	}

	function repSubline(rep: ProfileRepresentative): string {
		const partyShort = rep.party ? rep.party.charAt(0).toUpperCase() : '';
		const chamberLower = rep.chamber?.toLowerCase();
		// House: state-district (e.g. CA-11). Senate: state. Falls back gracefully
		// if either piece is missing.
		const scope =
			chamberLower === 'house'
				? rep.state && rep.district
					? `${rep.state}-${rep.district}`
					: (rep.district ?? rep.state)
				: rep.state;
		if (partyShort && scope) return `${partyShort} · ${scope}`;
		return scope ?? (partyShort ? `(${partyShort})` : '');
	}

	const CHAMBER_ORDER: Record<string, number> = { house: 0, senate: 1 };

	function sortedRepresentatives(reps: ProfileRepresentative[]): ProfileRepresentative[] {
		return [...reps].slice(0, 3).sort((a, b) => {
			const aOrd = CHAMBER_ORDER[a.chamber?.toLowerCase() ?? ''] ?? 9;
			const bOrd = CHAMBER_ORDER[b.chamber?.toLowerCase() ?? ''] ?? 9;
			if (aOrd !== bOrd) return aOrd - bOrd;
			return a.name.localeCompare(b.name);
		});
	}

	async function refreshLocalRepresentatives(): Promise<void> {
		if (!user?.id) {
			return;
		}
		try {
			const address = await getConstituentAddress(user.id);
			const district = address?.district?.trim() || groundState?.credential?.district?.trim();
			localGroundDistrict = district || null;
			if (!district) {
				localRepresentatives = [];
				return;
			}
			const officials = await getOfficialsFromBrowser(district);
			localRepresentatives =
				officials?.officials.map((official) => ({
					name: official.name,
					party: official.party ?? undefined,
					chamber: official.chamber,
					state: official.state,
					district: official.district ?? undefined
				})) ?? [];
		} catch (error) {
			console.warn('[Profile] Failed to load local representatives:', error);
		}
	}

	onMount(() => {
		refreshLocalRepresentatives();
	});

	function handleVerifyAddress(): void {
		showVerificationGate = true;
	}

	function handleRestoreAddress(): void {
		showAddressRestore = true;
	}

	async function handleChangeAddress(): Promise<void> {
		// Snapshot the current representatives BEFORE opening the flow so the
		// consequential diff can compare "was" vs "is" — the page `representatives`
		// promise will be invalidated by the re-grounding and only reflect the new
		// coordinates after invalidateAll() fires on close.
		try {
			const reps = await representativesPromise;
			if (Array.isArray(reps)) {
				currentReps = normalizeRepresentatives(reps);
			}
		} catch (e) {
			console.warn('[Profile] Failed to snapshot current reps:', e);
		}
		addressChangePhase = 'capture';
		showAddressChange = true;
	}

	function handleAddressChangeClose(): void {
		// Guard: do not close during the witnessing phase — retired credentials
		// cannot be restored, and closing mid-ceremony would leave partial state.
		if (addressChangePhase === 'witnessing') return;
		showAddressChange = false;
		addressChangePhase = 'capture';
		groundCardKey += 1;
		refreshLocalRepresentatives();
		invalidateAll();
	}

	function handleAddressRestoreClose(): void {
		showAddressRestore = false;
		groundCardKey += 1;
		refreshLocalRepresentatives();
		invalidateAll();
	}

	function handleAddressChangePhaseChange(phase: 'capture' | 'witnessing' | 'complete'): void {
		addressChangePhase = phase;
	}

	function handleVerificationComplete() {
		showVerificationGate = false;
		invalidateAll();
	}

	// ─── Witnessing guard ───
	// During the retirement ceremony the user's credentials are being cleared
	// and rewritten. Closing the tab / hitting back / pressing ESC mid-flight
	// can leave the identity in a half-retired state (old credentials gone,
	// new not yet issued). Guard all three exits while phase is 'witnessing'.
	function handleBeforeUnload(e: BeforeUnloadEvent) {
		if (addressChangePhase === 'witnessing') {
			e.preventDefault();
			// Most modern browsers ignore custom strings and show their own prompt,
			// but setting returnValue is still required to trigger the prompt.
			e.returnValue = '';
			return '';
		}
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && addressChangePhase === 'witnessing') {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	$effect(() => {
		if (!showAddressChange) return;
		// Only attach during an open address-change session; detach otherwise.
		window.addEventListener('beforeunload', handleBeforeUnload);
		window.addEventListener('keydown', handleWindowKeydown, true);
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			window.removeEventListener('keydown', handleWindowKeydown, true);
		};
	});
</script>

<svelte:head>
	<title>Profile | Commons</title>
	<meta name="description" content="Your civic identity and advocacy impact" />
</svelte:head>

<!-- ═══ ZONE 1: IDENTITY + SIGNAL ═══ -->
<section in:fly={{ y: 12, duration: 400 }}>
	<!-- Avatar + Name — larger on desktop -->
	<div class="flex items-center gap-4 lg:gap-5">
		{#if user?.avatar && !avatarError}
			<img
				bind:this={avatarEl}
				src={user.avatar}
				alt=""
				class="h-12 w-12 rounded-full lg:h-14 lg:w-14"
				style="box-shadow: 0 0 0 2.5px oklch(0.94 0.01 60)"
			/>
		{:else}
			<div
				class="bg-participation-primary-100 flex h-12 w-12 items-center justify-center rounded-full lg:h-14 lg:w-14"
				style="box-shadow: 0 0 0 2.5px oklch(0.94 0.01 60)"
			>
				<UserIcon class="text-participation-primary-600 h-5 w-5 lg:h-6 lg:w-6" />
			</div>
		{/if}
		<div>
			{#if displayName}
				<h1
					class="text-xl font-bold text-slate-900 sm:text-2xl lg:text-3xl"
					style="font-family: 'Satoshi', system-ui, sans-serif"
				>
					{displayName}
				</h1>
			{:else if decryptedUser.decrypting}
				<div class="h-7 w-48 animate-pulse rounded bg-slate-200/40 sm:h-8 lg:h-9"></div>
			{:else}
				<h1
					class="text-xl font-bold text-slate-900 sm:text-2xl lg:text-3xl"
					style="font-family: 'Satoshi', system-ui, sans-serif"
				>
					Your Profile
				</h1>
			{/if}
			{#if displayEmail}
				<p class="text-sm text-slate-500 lg:text-base">{displayEmail}</p>
			{:else if decryptedUser.decrypting}
				<div class="mt-1 h-4 w-36 animate-pulse rounded bg-slate-200/30"></div>
			{/if}
		</div>
	</div>

	<!-- Signal statement -->
	<div class="mt-6 sm:mt-8 lg:mt-10">
		<p class="text-base text-slate-700 lg:text-lg">
			Verification level:
			<span class="font-bold {current.accentClass}">{current.signal}</span>.
		</p>
	</div>

	<!-- Signal bar — the visual spine, full container width -->
	<div class="mt-3">
		<div
			class="relative h-2 overflow-hidden rounded-full lg:h-2.5"
			style="background: oklch(0.90 0.008 60)"
		>
			<div
				class="absolute inset-y-0 left-0 rounded-full"
				style="width: {$signalWidth}%;
				       background: linear-gradient(90deg, {current.gradientFrom}, {current.gradientTo});
				       transition: background 700ms ease"
			></div>
			<div
				class="absolute inset-y-0 left-0 rounded-full"
				style="width: {$signalWidth}%;
				       background: linear-gradient(180deg, rgba(255,255,255,0.25), transparent)"
			></div>
		</div>
	</div>

	<!-- What the recipient sees -->
	{#key tier}
		<p
			class="mt-3 max-w-prose text-sm leading-relaxed text-slate-600 lg:text-base"
			in:fly={{ y: 4, duration: 300, delay: 50 }}
		>
			{current.arrives}
		</p>
	{/key}

	<!-- Next step -->
	{#if tier === 1}
		<p class="mt-2.5 text-sm lg:text-base">
			<button
				class="font-medium text-emerald-600 transition-colors hover:text-emerald-800"
				onclick={handleVerifyAddress}
			>
				Verify your address &rarr;
			</button>
		</p>
	{:else if (tier === 2 || tier === 3) && isAnyMdlProtocolEnabled()}
		<p class="mt-2.5 text-sm lg:text-base">
			<button
				class="font-medium text-indigo-600 transition-colors hover:text-indigo-800"
				onclick={handleVerifyAddress}
			>
				Verify with Government ID &rarr;
			</button>
		</p>
	{:else if tier >= 4 && isAnyMdlProtocolEnabled()}
		<p class="mt-2.5 text-sm lg:text-base">
			<button
				class="font-medium text-indigo-600 transition-colors hover:text-indigo-800"
				onclick={handleVerifyAddress}
			>
				Re-verify identity &rarr;
			</button>
		</p>
	{:else if tier >= 2 && !isAnyMdlProtocolEnabled()}
		<!--
			Government-ID verification is protocol-gated. If all lanes are closed,
			name what's gated rather than dispatch into a flow that 404s.
		-->
		<p class="mt-2.5 text-xs leading-relaxed text-slate-500 lg:text-sm">
			Government-ID verification is coming soon for this device.
		</p>
	{/if}
</section>

<hr class="section-rule" />

<!-- ═══ ZONE 2: OFFICIAL DELIVERY ═══ -->
<section in:fly={{ y: 12, duration: 400, delay: 100 }}>
	<span class="section-label">Your ground</span>
	<div class="mt-4 grid gap-8 lg:grid-cols-12 lg:items-start lg:gap-10">
		<div class="lg:col-span-5">
			{#if user}
				{#key groundCardKey}
					<GroundCard
						userId={user.id}
						{trustTier}
						{serverAddressVerified}
						{groundState}
						embedded={true}
						budget={data.reverificationBudget}
						onVerifyAddress={handleVerifyAddress}
						onRestoreAddress={handleRestoreAddress}
						onChangeAddress={handleChangeAddress}
					/>
				{/key}
			{/if}
		</div>

		<div class="lg:col-span-7 space-y-10">
			<GroundSpatialProof districtCode={groundDistrict} h3Cell={groundH3Cell} />

			{#await representativesPromise}
				{#if localRepresentatives.length > 0}
					<EntityCluster as="ul" density="tight">
						{#each sortedRepresentatives(localRepresentatives) as rep (`${rep.chamber ?? ''}-${rep.name}`)}
							<li>
								<span class="ground-rep__chamber">{repChamberLabel(rep.chamber)}</span>
								<h4 class="ground-rep__name">{rep.name}</h4>
								{#if repSubline(rep)}
									<p class="ground-rep__subline">{repSubline(rep)}</p>
								{/if}
							</li>
						{/each}
					</EntityCluster>
				{/if}
			{:then representatives}
				{@const reps =
					localRepresentatives.length > 0
						? localRepresentatives
						: normalizeRepresentatives(representatives ?? [])}
				{#if reps.length > 0}
					<EntityCluster as="ul" density="tight">
						{#each sortedRepresentatives(reps) as rep (`${rep.chamber ?? ''}-${rep.name}`)}
							<li>
								<span class="ground-rep__chamber">{repChamberLabel(rep.chamber)}</span>
								<h4 class="ground-rep__name">{rep.name}</h4>
								{#if repSubline(rep)}
									<p class="ground-rep__subline">{repSubline(rep)}</p>
								{/if}
							</li>
						{/each}
					</EntityCluster>
				{/if}
			{/await}
		</div>
	</div>
</section>

<hr class="section-rule" />

<!-- ═══ ZONE 3: RECORD ═══ -->
<section in:fly={{ y: 12, duration: 400, delay: 200 }}>
	<span class="section-label">Your record</span>

	{#await templatesDataPromise}
		<div
			class="mt-5 grid grid-cols-2 gap-y-5 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-12 lg:gap-x-16"
		>
			{#each Array(4) as _}
				<div class="animate-pulse">
					<div class="h-9 w-12 rounded bg-slate-200/40 lg:h-10"></div>
					<div class="mt-1 h-3 w-10 rounded bg-slate-200/30"></div>
				</div>
			{/each}
		</div>
	{:then templatesData}
		{#if templatesData}
			<!-- Impact numbers — spread across the width on large screens -->
			<div
				class="mt-5 grid grid-cols-2 gap-y-5 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-12 lg:gap-x-16"
			>
				{#if FEATURES.ENGAGEMENT_METRICS}
					<div>
						<span class="text-participation-primary-600 font-mono text-3xl font-bold lg:text-4xl">
							{templatesData.templateStats.totalSent}
						</span>
						<span class="block text-xs font-medium text-slate-500">sent</span>
					</div>
					<div>
						<span class="font-mono text-3xl font-bold text-emerald-600 lg:text-4xl">
							{templatesData.templateStats.totalDelivered}
						</span>
						<span class="block text-xs font-medium text-slate-500">delivered</span>
					</div>
				{/if}
				<div>
					<span class="font-mono text-3xl font-bold text-slate-800 lg:text-4xl">
						{templatesData.templateStats.total}
					</span>
					<span class="block text-xs font-medium text-slate-500">templates</span>
				</div>
				<div>
					<span class="font-mono text-3xl font-bold text-emerald-600 lg:text-4xl">
						{templatesData.templateStats.totalUses}
					</span>
					<span class="block text-xs font-medium text-slate-500">adopted</span>
				</div>
			</div>

			<!-- Template list — readable width, left-aligned -->
			{#if templatesData.templates.length > 0}
				<div class="mt-8 max-w-2xl">
					{#each templatesData.templates.slice(0, 5) as template, i}
						<div
							class="flex items-center justify-between py-3 {i > 0
								? 'border-t border-dotted border-slate-200'
								: ''}"
						>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2.5">
									<span class="truncate text-sm font-medium text-slate-800">
										{template.title}
									</span>
									<Badge
										variant={template.status === 'published' ? 'success' : 'warning'}
										size="sm"
									>
										{template.status}
									</Badge>
								</div>
								<div class="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
									<span>{formatDate(template.createdAt)}</span>
									<span>{template.useCount} uses</span>
								</div>
							</div>
							<a
								href="/s/{template.slug}"
								class="ml-3 flex-shrink-0 text-slate-400 transition-colors hover:text-slate-600"
							>
								<ExternalLink class="h-3.5 w-3.5" />
							</a>
						</div>
					{/each}

					{#if templatesData.templates.length > 5}
						<div class="border-t border-dotted border-slate-200 pt-3">
							<a
								href="/browse"
								class="group text-participation-primary-600 hover:text-participation-primary-700 inline-flex items-center gap-1 text-sm font-medium transition-colors"
							>
								View all templates
								<ChevronRight
									class="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
								/>
							</a>
						</div>
					{/if}
				</div>
			{:else}
				<p class="mt-6 text-sm text-slate-500 lg:text-base">
					No messages sent yet.
					<a
						href="/?create=true"
						class="text-participation-primary-600 hover:text-participation-primary-700 font-medium transition-colors"
					>
						Create a template to start &rarr;
					</a>
				</p>
			{/if}
		{/if}
	{/await}
</section>

<hr class="section-rule" />

<!-- ═══ ZONE 4: COLOPHON ═══ -->
<section in:fly={{ y: 12, duration: 400, delay: 300 }}>
	{#await userDetailsPromise}
		<div class="animate-pulse space-y-2">
			<div class="h-[1.125rem] w-52 rounded bg-slate-200/40 lg:h-5"></div>
			<div class="h-3 w-36 rounded bg-slate-200/30"></div>
		</div>
	{:then userDetails}
		{#if userDetails?.profile?.role || userDetails?.profile?.organization || userDetails?.profile?.connection}
			<p class="text-sm text-slate-700 lg:text-base">
				{#if userDetails.profile.role}
					<span class="text-slate-500">Role</span>
					<span class="ml-1 font-medium text-slate-800">{userDetails.profile.role}</span>
				{/if}
				{#if userDetails.profile.organization}
					{#if userDetails.profile.role}<span class="mx-2 text-slate-300">&middot;</span>{/if}
					<span class="text-slate-500">Org</span>
					<span class="ml-1 font-medium text-slate-800">{userDetails.profile.organization}</span>
				{/if}
				{#if userDetails.profile.connection}
					{#if userDetails.profile.role || userDetails.profile.organization}<span
							class="mx-2 text-slate-300">&middot;</span
						>{/if}
					<span class="text-slate-500">Connection</span>
					<span class="ml-1 font-medium text-slate-800">{userDetails.profile.connection}</span>
				{/if}
			</p>
		{:else}
			<p class="text-sm text-slate-500 lg:text-base">No profile details yet.</p>
		{/if}

		{#if userDetails?.timestamps?.created_at}
			<p class="mt-2 text-xs text-slate-500">
				Member since {formatDate(userDetails.timestamps.created_at)}
			</p>
		{/if}
	{/await}

	<!-- Actions -->
	<div class="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
		<button
			class="font-medium text-slate-600 transition-colors hover:text-slate-900"
			onclick={() => openEditModal('profile')}
		>
			<Edit3 class="mr-1 inline h-3.5 w-3.5" />Edit profile
		</button>
		<button class="font-medium text-slate-600 transition-colors hover:text-slate-900">
			<Download class="mr-1 inline h-3.5 w-3.5" />Export data
		</button>
		<button class="font-medium text-red-500/80 transition-colors hover:text-red-600">
			<Trash2 class="mr-1 inline h-3.5 w-3.5" />Delete account
		</button>
	</div>
</section>

{#if showEditModal}
	<ProfileEditModal
		{user}
		section={editingSection}
		onclose={() => (showEditModal = false)}
		onsave={handleProfileSave}
	/>
{/if}

{#if user}
	<VerificationGate
		userId={user.id}
		bind:showModal={showVerificationGate}
		minimumTier={2}
		userTrustTier={trustTier}
		onverified={handleVerificationComplete}
		oncancel={() => (showVerificationGate = false)}
	/>
{/if}

{#if user && showAddressChange}
	<div
		class="fixed inset-0 z-[1010] overflow-y-auto backdrop-blur-sm"
		style="background: oklch(0.995 0.004 55 / 0.96)"
		role="dialog"
		aria-modal="true"
		aria-label="Address re-grounding"
	>
		<div class="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-5 sm:px-6 lg:px-8">
			<div class="flex items-center justify-between border-b border-dotted border-slate-300 pb-3">
				<p class="font-mono text-[11px] font-semibold text-slate-500 uppercase">
					Address re-grounding
				</p>
				<!--
					Close is disabled during the witnessing phase. Retirement clears
					credentials; leaving mid-ceremony would orphan them without new
					issuance. Once `addressChangePhase === 'complete'` or still
					'capture' the user may dismiss freely.
				-->
				<button
					type="button"
					onclick={handleAddressChangeClose}
					disabled={addressChangePhase === 'witnessing'}
					class="font-mono text-[11px] font-semibold text-slate-500 uppercase transition-colors hover:text-slate-800 disabled:cursor-not-allowed disabled:text-slate-300"
					aria-label={addressChangePhase === 'witnessing'
						? 'Cannot close during re-grounding'
						: 'Close address re-grounding'}
					aria-disabled={addressChangePhase === 'witnessing'}
					title={addressChangePhase === 'witnessing'
						? 'Please wait — prior credentials are being retired.'
						: 'Close'}
				>
					Close
				</button>
			</div>
			<div class="flex flex-1 items-start justify-center py-6 sm:items-center">
				<AddressChangeFlow
					userId={user.id}
					onClose={handleAddressChangeClose}
					onPhaseChange={handleAddressChangePhaseChange}
					initialRepresentatives={currentReps}
					budget={data.reverificationBudget}
					refreshRepresentatives={async () => {
						await invalidateAll();
						try {
							const reps = await representativesPromise;
							return Array.isArray(reps) ? normalizeRepresentatives(reps) : [];
						} catch {
							return [];
						}
					}}
				/>
			</div>
		</div>
	</div>
{/if}

{#if user && showAddressRestore}
	<div
		class="fixed inset-0 z-[1010] overflow-y-auto backdrop-blur-sm"
		style="background: oklch(0.995 0.004 55 / 0.96)"
		role="dialog"
		aria-modal="true"
		aria-label="Address restore"
	>
		<div class="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 py-5 sm:px-6 lg:px-8">
			<div class="flex items-center justify-between border-b border-dotted border-slate-300 pb-3">
				<p class="font-mono text-[11px] font-semibold text-slate-500 uppercase">
					Address restore
				</p>
				<button
					type="button"
					onclick={handleAddressRestoreClose}
					class="font-mono text-[11px] font-semibold text-slate-500 uppercase transition-colors hover:text-slate-800"
					aria-label="Close address restore"
					title="Close"
				>
					Close
				</button>
			</div>
			<div class="flex flex-1 items-start justify-center py-6 sm:items-center">
				<AddressRestoreFlow
					userId={user.id}
					onComplete={handleAddressRestoreClose}
					onCancel={handleAddressRestoreClose}
				/>
			</div>
		</div>
	</div>
{/if}

<style>
	.section-rule {
		border: none;
		border-top: 1px dotted oklch(0.82 0.01 60 / 0.6);
		margin: 2rem 0;
	}

	@media (min-width: 1024px) {
		.section-rule {
			margin: 2.75rem 0;
		}
	}

	.section-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: oklch(0.55 0.02 250);
	}

	.ground-rep__chamber {
		font-family:
			'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
			'Liberation Mono', 'Courier New', monospace;
		font-size: 0.625rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: oklch(0.56 0.02 250);
		display: block;
		line-height: 1;
		margin-bottom: 0.25rem;
	}

	.ground-rep__name {
		font-size: 1.25rem;
		line-height: 1.15;
		font-weight: 700;
		color: oklch(0.18 0.02 250);
		letter-spacing: -0.01em;
	}

	.ground-rep__subline {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		line-height: 1.3;
		color: oklch(0.55 0.02 250);
	}
</style>
