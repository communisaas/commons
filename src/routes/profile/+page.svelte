<script lang="ts">
	/**
	 * Profile Page — The Document
	 *
	 * A civic passport that inhabits the viewport.
	 * Mobile: stacked, intimate. Desktop: zones spread, space composed.
	 * The signal bar is the visual spine. Everything else is typography and space.
	 */
	import { User as UserIcon, ExternalLink, ChevronRight, Edit3, Download, Trash2 } from '@lucide/svelte';
	import { spring } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ProfileEditModal from '$lib/components/profile/ProfileEditModal.svelte';
	import GroundCard from '$lib/components/profile/GroundCard.svelte';
	import VerificationGate from '$lib/components/auth/VerificationGate.svelte';
	import { invalidateAll } from '$app/navigation';
	import { FEATURES } from '$lib/config/features';
	import type { PageData } from './$types';

	interface ProfileRepresentative {
		name: string;
		party: string;
		chamber: string;
		state: string;
		district: string;
	}

	let { data }: { data: PageData } = $props();

	type EditSection = 'basic' | 'profile';
	let avatarEl = $state<HTMLImageElement | null>(null);
	let avatarError = $state(false);
	let showEditModal = $state(false);
	let editingSection = $state<EditSection>('basic');
	let showVerificationGate = $state(false);

	const user = $derived(data.user);
	const userDetailsPromise = $derived(data.streamed?.userDetails);
	const templatesDataPromise = $derived(data.streamed?.templatesData);
	const representativesPromise = $derived(data.streamed?.representatives);

	const trustTier = $derived((user as Record<string, unknown>)?.trust_tier as number ?? 0);
	const tier = $derived(Math.max(0, Math.min(4, Math.floor(trustTier))));

	const levels = [
		{
			signal: 'Noise',
			arrives: 'General inbox. No constituent status. Likely unread.',
			weight: 8,
			gradientFrom: '#cbd5e1', gradientTo: '#94a3b8',
			textClass: 'text-slate-600',
			accentClass: 'text-slate-700',
		},
		{
			signal: 'Weak',
			arrives: 'Named sender. No district proof. Low priority.',
			weight: 18,
			gradientFrom: '#93c5fd', gradientTo: '#3b82f6',
			textClass: 'text-blue-600',
			accentClass: 'text-blue-700',
		},
		{
			signal: 'Constituent',
			arrives: 'Confirmed constituent. Flagged for your district. Gets read.',
			weight: 62,
			gradientFrom: '#34d399', gradientTo: '#10b981',
			textClass: 'text-emerald-600',
			accentClass: 'text-emerald-700',
		},
		{
			signal: 'Verified',
			arrives: 'Government ID verified. Cryptographic proof. Cannot be faked or botted.',
			weight: 82,
			gradientFrom: '#c084fc', gradientTo: '#a855f7',
			textClass: 'text-purple-600',
			accentClass: 'text-purple-700',
		},
		{
			signal: 'Undeniable',
			arrives: 'Zero-knowledge proof of residency. Mathematically verified. Maximum weight.',
			weight: 100,
			gradientFrom: '#818cf8', gradientTo: '#6366f1',
			textClass: 'text-indigo-600',
			accentClass: 'text-indigo-700',
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

	function formatDate(date: string | Date) {
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

	function partyColor(party: string): string {
		const p = party?.toLowerCase() || '';
		if (p.startsWith('d')) return 'text-blue-700';
		if (p.startsWith('r')) return 'text-red-700';
		return 'text-slate-600';
	}

	function chamberLabel(chamber: string): string {
		return chamber === 'senate' ? 'Sen.' : 'Rep.';
	}

	function handleVerifyAddress(): void {
		showVerificationGate = true;
	}

	function handleVerificationComplete() {
		showVerificationGate = false;
		invalidateAll();
	}
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
				class="flex h-12 w-12 items-center justify-center rounded-full bg-participation-primary-100 lg:h-14 lg:w-14"
				style="box-shadow: 0 0 0 2.5px oklch(0.94 0.01 60)"
			>
				<UserIcon class="h-5 w-5 text-participation-primary-600 lg:h-6 lg:w-6" />
			</div>
		{/if}
		<div>
			<h1 class="text-xl font-bold text-slate-900 sm:text-2xl lg:text-3xl" style="font-family: 'Satoshi', system-ui, sans-serif">
				{user?.name || 'Your Profile'}
			</h1>
			<p class="text-sm text-slate-500 lg:text-base">{user?.email}</p>
		</div>
	</div>

	<!-- Signal statement -->
	<div class="mt-6 sm:mt-8 lg:mt-10">
		<p class="text-base text-slate-700 lg:text-lg">
			Signal strength:
			<span class="font-bold {current.accentClass}">{current.signal}</span>.
		</p>
	</div>

	<!-- Signal bar — the visual spine, full container width -->
	<div class="mt-3">
		<div class="relative h-2 overflow-hidden rounded-full lg:h-2.5" style="background: oklch(0.90 0.008 60)">
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
			<button class="font-medium text-emerald-600 transition-colors hover:text-emerald-800" onclick={handleVerifyAddress}>
				Verify your address &rarr;
			</button>
		</p>
	{:else if tier === 2 || tier === 3}
		<p class="mt-2.5 text-sm lg:text-base">
			<button class="font-medium text-indigo-600 transition-colors hover:text-indigo-800" onclick={handleVerifyAddress}>
				Verify with Government ID &rarr;
			</button>
		</p>
	{:else if tier >= 4}
		<p class="mt-2.5 text-sm lg:text-base">
			<button class="font-medium text-indigo-600 transition-colors hover:text-indigo-800" onclick={handleVerifyAddress}>
				Re-verify identity &rarr;
			</button>
		</p>
	{/if}
</section>


<hr class="section-rule" />


<!-- ═══ ZONE 2: GROUND + REPRESENTATIVES ═══ -->
<!-- Side by side on large screens: ground anchors left, representatives float right -->
<section in:fly={{ y: 12, duration: 400, delay: 100 }}>
	<div class="lg:grid lg:grid-cols-5 lg:gap-12">
		<!-- Ground — left column, wider -->
		<div class="lg:col-span-3">
			<span class="section-label">Your ground</span>
			<div class="mt-3">
				{#if user}
					<GroundCard userId={user.id} {trustTier} embedded={true} onVerifyAddress={handleVerifyAddress} />
				{/if}
			</div>
		</div>

		<!-- Representatives — right column -->
		<div class="mt-8 lg:col-span-2 lg:mt-0">
			<span class="section-label">Your representatives</span>

			{#await representativesPromise}
				<div class="mt-3 animate-pulse">
					<div class="h-5 w-48 rounded bg-slate-200/40"></div>
				</div>
			{:then representatives}
				{#if representatives && representatives.length > 0}
					<div class="mt-3 space-y-1.5">
						{#each representatives as rep}
							{@const r = rep as unknown as ProfileRepresentative}
							<div class="text-sm text-slate-700">
								<span class="font-medium">{chamberLabel(r.chamber)} {r.name}</span>
								<span class="font-semibold {partyColor(r.party)}">({r.party})</span>
								{#if r.chamber !== 'senate' && r.district}
									<span class="text-slate-400">{r.state}-{r.district}</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<p class="mt-3 text-sm text-slate-500">
						Your representatives appear after address verification.
					</p>
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
		<div class="mt-5 flex gap-8 sm:gap-12">
			{#each Array(4) as _}
				<div class="animate-pulse">
					<div class="h-9 w-10 rounded bg-slate-200/40"></div>
					<div class="mt-2 h-3 w-14 rounded bg-slate-200/30"></div>
				</div>
			{/each}
		</div>
	{:then templatesData}
		{#if templatesData}
			<!-- Impact numbers — spread across the width on large screens -->
			<div class="mt-5 grid grid-cols-2 gap-y-5 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-12 lg:gap-x-16">
				{#if FEATURES.ENGAGEMENT_METRICS}
					<div>
						<span class="font-mono text-3xl font-bold text-participation-primary-600 lg:text-4xl">
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
					<span class="font-mono text-3xl font-bold text-violet-600 lg:text-4xl">
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
							class="flex items-center justify-between py-3 {i > 0 ? 'border-t border-dotted border-slate-200' : ''}"
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
									<span>{template.template_campaign?.length || 0} uses</span>
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
								class="group inline-flex items-center gap-1 text-sm font-medium text-participation-primary-600 transition-colors hover:text-participation-primary-700"
							>
								View all templates
								<ChevronRight class="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
							</a>
						</div>
					{/if}
				</div>
			{:else}
				<p class="mt-6 text-sm text-slate-500 lg:text-base">
					No messages sent yet.
					<a
						href="/?create=true"
						class="font-medium text-participation-primary-600 transition-colors hover:text-participation-primary-700"
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
			<div class="h-5 w-52 rounded bg-slate-200/40"></div>
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
					{#if userDetails.profile.role || userDetails.profile.organization}<span class="mx-2 text-slate-300">&middot;</span>{/if}
					<span class="text-slate-500">Connection</span>
					<span class="ml-1 font-medium text-slate-800">{userDetails.profile.connection}</span>
				{/if}
			</p>
		{:else}
			<p class="text-sm text-slate-500 lg:text-base">No profile details yet.</p>
		{/if}

		{#if userDetails?.timestamps}
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
</style>
