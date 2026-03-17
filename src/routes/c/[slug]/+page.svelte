<script lang="ts">
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import { isDigitalCredentialsSupported } from '$lib/core/identity/digital-credentials-api';
	import { FEATURES } from '$lib/config/features';
	import DebateMarketCard from '$lib/components/debate/DebateMarketCard.svelte';
	import DebateParticipationPanel from '$lib/components/wallet/debate/DebateParticipationPanel.svelte';
	import { buildArgumentStanceMap } from '$lib/utils/debate-stats';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// ── Feature checks ──
	const districtEnabled = FEATURES.ADDRESS_SPECIFICITY === 'district';

	// ── Step management ──
	type Step = 'info' | 'identify' | 'district' | 'compose' | 'success';
	let currentStep = $state<Step>('info');

	// ── Form state ──
	let name = $state('');
	let email = $state('');
	let postalCode = $state('');
	let message = $state(data.campaign.type === 'LETTER' ? (data.campaign.body ?? '') : '');
	let submitting = $state(false);

	// ── Postal code state ──
	let postalCodeResolved = $state(false);

	// ── District verification state (ADDRESS_SPECIFICITY='district') ──
	let districtStreet = $state('');
	let districtCity = $state('');
	let districtState = $state('');
	let districtZip = $state('');
	let districtCode = $state(''); // e.g. "CA-12"
	let districtVerified = $state(false);
	let districtVerifying = $state(false);
	let districtError = $state('');

	// ── mDL verification state ──
	let mdlSupported = $state(false);
	let mdlVerifying = $state(false);
	let mdlVerified = $state(false);
	let verificationTier = $state(0); // 0=unverified, 1=postal, 2=district, 3=mDL

	// ── Debate signal (read-only, no wallet needed) ──
	const debateStanceMap = $derived(
		data.debateSignal?.arguments
			? buildArgumentStanceMap(data.debateSignal.arguments)
			: undefined
	);
	const debateHref = $derived(
		data.debateSignal?.templateSlug
			? `/s/${data.campaign.orgSlug}/debate/${data.debateSignal.id}`
			: undefined
	);

	// ── Live verified count (optimistic + polled) ──
	let displayCount = $state(data.stats.verifiedActions);

	// Check mDL support on mount
	$effect(() => {
		if (browser) {
			mdlSupported = isDigitalCredentialsSupported();
		}
	});

	// Poll verified count every 30s (Phase 0: simple polling, no WebSocket)
	$effect(() => {
		if (!browser) return;
		const interval = setInterval(async () => {
			try {
				const res = await fetch(`/api/c/${data.campaign.id}/stats`);
				if (res.ok) {
					const stats = await res.json();
					if (typeof stats.verifiedActions === 'number') {
						displayCount = stats.verifiedActions;
					}
				}
			} catch { /* ignore polling failures */ }
		}, 30_000);

		return () => clearInterval(interval);
	});

	// Handle form success from server
	$effect(() => {
		if (form?.success) {
			currentStep = 'success';
			if (typeof form.actionCount === 'number') {
				displayCount = form.actionCount;
			}
		}
	});

	// ── Postal code validation ──
	// Mark postal code as provided for UI feedback.
	// District hash is computed server-side with a salt (not client-side).
	function validatePostalCode() {
		const code = postalCode.trim();
		if (code.length >= 3) {
			postalCodeResolved = true;
			verificationTier = 1;
		}
	}

	// ── mDL verification ──
	async function startMdlVerification() {
		if (!mdlSupported || mdlVerifying) return;
		mdlVerifying = true;

		try {
			const { requestCredential, getSupportedProtocols } = await import(
				'$lib/core/identity/digital-credentials-api'
			);

			const protocols = await getSupportedProtocols();
			if (!protocols.mdoc && !protocols.openid4vp) {
				mdlVerifying = false;
				return;
			}

			const requests: Array<{ protocol: string; data: unknown }> = [];
			if (protocols.mdoc) {
				requests.push({
					protocol: 'org-iso-mdoc',
					data: {
						docType: 'org.iso.18013.5.1.mDL',
						nameSpaces: {
							'org.iso.18013.5.1': {
								resident_postal_code: { intentToRetain: false },
								resident_city: { intentToRetain: false },
								resident_state: { intentToRetain: false }
							}
						}
					}
				});
			}

			const result = await requestCredential({ requests });

			if (result.success) {
				mdlVerified = true;
				verificationTier = 3;
			}
		} catch {
			// User cancelled or error — non-blocking
		} finally {
			mdlVerifying = false;
		}
	}

	// ── District verification ──
	async function verifyDistrict() {
		if (districtVerifying) return;
		if (!districtStreet.trim() || !districtCity.trim() || !districtState.trim() || !districtZip.trim()) {
			districtError = 'Please fill in all address fields.';
			return;
		}

		districtVerifying = true;
		districtError = '';

		try {
			// Use the campaign-specific public endpoint (no auth required)
			const res = await fetch(`/api/c/${data.campaign.id}/verify-district`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					street: districtStreet.trim(),
					city: districtCity.trim(),
					state: districtState.trim().toUpperCase(),
					zip: districtZip.trim()
				})
			});

			const result = await res.json();

			if (!res.ok || !result.resolved) {
				districtError = result.error || 'Unable to verify address. Please check and try again.';
				return;
			}

			if (!result.district?.code) {
				districtError = 'Congressional district could not be determined. Please verify your address.';
				return;
			}

			districtCode = result.district.code;
			districtVerified = true;
			verificationTier = 2;

			// Store encrypted address client-side (privacy: never reaches server)
			if (browser) {
				try {
					const { storeConstituentAddress } = await import('$lib/core/identity/constituent-address');
					await storeConstituentAddress(email, {
						street: districtStreet.trim(),
						city: districtCity.trim(),
						state: districtState.trim().toUpperCase(),
						zip: districtZip.trim(),
						district: districtCode
					});
				} catch {
					// Non-blocking — address storage is best-effort
				}
			}
		} catch {
			districtError = 'Verification service temporarily unavailable. Please try again.';
		} finally {
			districtVerifying = false;
		}
	}

	function skipDistrict() {
		currentStep = 'compose';
	}

	// ── Step transitions ──
	function goToIdentify() {
		currentStep = 'identify';
	}

	function goToDistrict() {
		if (!name.trim() || !email.trim()) return;
		currentStep = 'district';
	}

	function goToCompose() {
		if (!name.trim() || !email.trim()) return;
		currentStep = 'compose';
	}

	function goBack() {
		if (currentStep === 'compose' && districtEnabled) currentStep = 'district';
		else if (currentStep === 'compose') currentStep = 'identify';
		else if (currentStep === 'district') currentStep = 'identify';
		else if (currentStep === 'identify') currentStep = 'info';
	}

	// ── Share ──
	const shareUrl = $derived(browser ? window.location.href : '');

	function shareAction() {
		if (!browser) return;
		const text = `I just took action on "${data.campaign.title}" with ${data.campaign.orgName}. Join me:`;
		if (navigator.share) {
			navigator.share({ title: data.campaign.title, text, url: shareUrl }).catch(() => {});
		} else {
			navigator.clipboard.writeText(`${text} ${shareUrl}`).catch(() => {});
		}
	}
</script>

<svelte:head>
	<title>{data.campaign.title} | {data.campaign.orgName}</title>
	<meta name="description" content={data.campaign.body || `Take action: ${data.campaign.title}`} />
	<meta property="og:title" content={data.campaign.title} />
	<meta property="og:description" content={data.campaign.body || `Take action with ${data.campaign.orgName}`} />
	<meta property="og:type" content="website" />
</svelte:head>

<div class="mx-auto min-h-[80vh] max-w-lg px-4 py-6 sm:py-10">

	{#if currentStep === 'success'}
		<!-- ═══════════ SUCCESS ═══════════ -->
		<div class="text-center">
			<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
				<svg class="h-8 w-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
				</svg>
			</div>

			<h1 class="text-2xl font-bold text-slate-900 sm:text-3xl">Action Recorded</h1>

			{#if form?.verified}
				<p class="mt-2 text-lg text-emerald-700">
					You are verified constituent #{displayCount}
				</p>
			{:else}
				<p class="mt-2 text-lg text-slate-600">
					You are participant #{displayCount + 1}
				</p>
			{/if}

			<p class="mt-1 text-sm text-slate-500">
				Thank you for taking action with {data.campaign.orgName}.
			</p>

			{#if form?.alreadySubmitted}
				<p class="mt-3 text-xs text-amber-600">
					You already took action on this campaign. Your voice is counted.
				</p>
			{/if}

			<!-- Verification tier badge -->
			<div class="mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm
				{verificationTier >= 3 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
				 verificationTier >= 2 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' :
				 verificationTier >= 1 ? 'border-blue-200 bg-blue-50 text-blue-700' :
				 'border-slate-200 bg-slate-50 text-slate-600'}">
				{#if verificationTier >= 3}
					<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
					</svg>
					Identity Verified
				{:else if verificationTier >= 2}
					<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
					</svg>
					District Verified
				{:else if verificationTier >= 1}
					<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
					</svg>
					Location Verified
				{:else}
					Participation Recorded
				{/if}
			</div>

			<!-- Proof card -->
			<div class="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
				<p class="text-xs font-medium uppercase tracking-wider text-slate-400">Verified Action</p>
				<h3 class="mt-1 text-base font-bold text-slate-900">{data.campaign.title}</h3>
				<p class="text-sm text-slate-500">via {data.campaign.orgName}</p>
				<div class="mt-3 border-t border-slate-200 pt-3">
					<p class="font-mono text-3xl font-bold text-slate-900">{displayCount}</p>
					<p class="text-sm text-slate-500">verified actions taken</p>
					{#if data.stats.uniqueDistricts > 0}
						<p class="mt-1 text-xs text-slate-400">
							across {data.stats.uniqueDistricts} {data.stats.uniqueDistricts === 1 ? 'district' : 'districts'}
						</p>
					{/if}
				</div>
			</div>

			<!-- Share -->
			<button
				onclick={shareAction}
				class="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
			>
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
				</svg>
				Share This Campaign
			</button>
		</div>

	{:else if currentStep === 'info'}
		<!-- ═══════════ INFO (Landing) ═══════════ -->
		<div class="mb-4 flex items-center gap-2">
			{#if data.campaign.orgAvatar}
				<img
					src={data.campaign.orgAvatar}
					alt={data.campaign.orgName}
					class="h-8 w-8 rounded-full object-cover"
				/>
			{:else}
				<div class="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
					{data.campaign.orgName.charAt(0).toUpperCase()}
				</div>
			{/if}
			<span class="text-sm font-medium text-slate-600">{data.campaign.orgName}</span>
		</div>

		<h1 class="text-2xl font-bold text-slate-900 sm:text-3xl">
			{data.campaign.title}
		</h1>

		{#if data.campaign.body}
			<p class="mt-3 text-base leading-relaxed text-slate-600">
				{data.campaign.body}
			</p>
		{/if}

		<!-- Social proof bar -->
		<div class="mt-6 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
			<div class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
				<svg class="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128H5.228A2 2 0 015 17.128V15.5a4.5 4.5 0 014.5-4.5h0a4.5 4.5 0 014.5 4.5v1.628M12 11.25h.008v.008H12v-.008zM12 7.5a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5z" />
				</svg>
			</div>
			<div>
				<p class="font-mono text-lg font-bold text-slate-900">{displayCount}</p>
				<p class="text-xs text-slate-500">
					verified {displayCount === 1 ? 'action' : 'actions'} taken
					{#if data.stats.uniqueDistricts > 0}
						<span class="ml-1 text-slate-400">
							across {data.stats.uniqueDistricts} {data.stats.uniqueDistricts === 1 ? 'district' : 'districts'}
						</span>
					{/if}
				</p>
			</div>
		</div>

		<!-- Debate signal (read-only market consensus) -->
		{#if FEATURES.DEBATE && data.debateSignal}
			<div class="mt-4">
				<DebateMarketCard
					debateId={data.debateSignal.id}
					propositionText={data.debateSignal.propositionText}
					status={data.debateSignal.status === 'active' ? 'active' : 'resolved'}
					argumentCount={data.debateSignal.argumentCount}
					totalStake={data.debateSignal.totalStake}
					uniqueParticipants={data.debateSignal.uniqueParticipants}
					deadline={data.debateSignal.deadline}
					prices={data.debateSignal.currentPrices ?? undefined}
					argumentStances={debateStanceMap}
					currentEpoch={data.debateSignal.currentEpoch ?? undefined}
					href={debateHref}
				/>
				<DebateParticipationPanel
					debateId={data.debateSignal.id}
					debateStatus={data.debateSignal.status}
					arguments={data.debateSignal.arguments ?? []}
					debateIdOnchain={data.debateSignal.debateIdOnchain}
				/>
			</div>
		{/if}

		<button
			onclick={goToIdentify}
			class="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 active:bg-slate-700"
		>
			Take Action
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
			</svg>
		</button>

	{:else if currentStep === 'identify'}
		<!-- ═══════════ IDENTIFY ═══════════ -->
		<button
			onclick={goBack}
			class="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
			aria-label="Go back"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
			</svg>
			Back
		</button>

		<h2 class="text-xl font-bold text-slate-900">Your Information</h2>
		<p class="mt-1 text-sm text-slate-500">
			Identify yourself to take action on this campaign.
		</p>

		<div class="mt-5 space-y-4">
			<div>
				<label for="name" class="block text-sm font-medium text-slate-700">
					Full Name <span class="text-red-500" aria-hidden="true">*</span>
				</label>
				<input
					type="text"
					id="name"
					bind:value={name}
					required
					autocomplete="name"
					placeholder="Your full name"
					class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
			</div>

			<div>
				<label for="email" class="block text-sm font-medium text-slate-700">
					Email <span class="text-red-500" aria-hidden="true">*</span>
				</label>
				<input
					type="email"
					id="email"
					bind:value={email}
					required
					autocomplete="email"
					placeholder="you@example.com"
					class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
				/>
			</div>

			<div>
				<label for="postalCode" class="block text-sm font-medium text-slate-700">
					Postal Code
					<span class="font-normal text-slate-400">(strengthens verification)</span>
				</label>
				<div class="relative mt-1">
					<input
						type="text"
						id="postalCode"
						bind:value={postalCode}
						autocomplete="postal-code"
						placeholder="e.g. 90210"
						onblur={validatePostalCode}
						class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
					/>
				</div>
				{#if postalCodeResolved}
					<p class="mt-1.5 flex items-center gap-1 text-xs text-emerald-600">
						<svg class="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
							<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
						</svg>
						Postal code recorded for verification
					</p>
				{/if}
			</div>

			<!-- mDL verification upgrade (only if browser supports it) -->
			{#if mdlSupported && !mdlVerified}
				<div class="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
					<div class="flex items-start gap-3">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100">
							<svg class="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
							</svg>
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-medium text-blue-900">Strengthen your verification</p>
							<p class="mt-0.5 text-xs text-blue-700">
								Use your digital ID to cryptographically verify your identity. Takes about 5 seconds.
							</p>
							<button
								onclick={startMdlVerification}
								disabled={mdlVerifying}
								class="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
							>
								{mdlVerifying ? 'Verifying...' : 'Verify with Digital ID'}
							</button>
						</div>
					</div>
				</div>
			{/if}

			{#if mdlVerified}
				<div class="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
					<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
					</svg>
					Identity verified via Digital ID
				</div>
			{/if}

			<button
				onclick={districtEnabled ? goToDistrict : goToCompose}
				disabled={!name.trim() || !email.trim()}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
			>
				Continue
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
				</svg>
			</button>
		</div>

	{:else if districtEnabled && currentStep === 'district'}
		<!-- ═══════════ DISTRICT VERIFICATION (optional) ═══════════ -->
		<button
			onclick={goBack}
			class="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
			aria-label="Go back"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
			</svg>
			Back
		</button>

		<h2 class="text-xl font-bold text-slate-900">Verify Your District</h2>
		<p class="mt-1 text-sm text-slate-500">
			Enter your street address to verify your congressional district. This strengthens your action.
		</p>

		<!-- Privacy note -->
		<div class="mt-4 flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
			<svg class="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			</svg>
			<p class="text-xs text-blue-700">
				Your address is used once to find your district, then discarded. Only the district is recorded — never your address.
			</p>
		</div>

		{#if districtVerified}
			<!-- District verified success state -->
			<div class="mt-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
				<svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
					<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
				</svg>
				District verified: {districtCode}
			</div>

			<button
				onclick={goToCompose}
				class="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
			>
				Continue
				<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
				</svg>
			</button>
		{:else}
			<!-- Address collection form -->
			<div class="mt-5 space-y-4">
				<div>
					<label for="districtStreet" class="block text-sm font-medium text-slate-700">
						Street Address
					</label>
					<input
						type="text"
						id="districtStreet"
						bind:value={districtStreet}
						autocomplete="street-address"
						placeholder="123 Main Street"
						class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
					/>
				</div>

				<div>
					<label for="districtCity" class="block text-sm font-medium text-slate-700">
						City
					</label>
					<input
						type="text"
						id="districtCity"
						bind:value={districtCity}
						autocomplete="address-level2"
						placeholder="City"
						class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
					/>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="districtStateInput" class="block text-sm font-medium text-slate-700">
							State
						</label>
						<input
							type="text"
							id="districtStateInput"
							bind:value={districtState}
							autocomplete="address-level1"
							placeholder="CA"
							maxlength="2"
							class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
						/>
					</div>
					<div>
						<label for="districtZipInput" class="block text-sm font-medium text-slate-700">
							ZIP Code
						</label>
						<input
							type="text"
							id="districtZipInput"
							bind:value={districtZip}
							autocomplete="postal-code"
							placeholder="90210"
							maxlength="10"
							class="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
						/>
					</div>
				</div>

				{#if districtError}
					<div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
						{districtError}
					</div>
				{/if}

				<button
					onclick={verifyDistrict}
					disabled={districtVerifying || !districtStreet.trim() || !districtCity.trim() || !districtState.trim() || !districtZip.trim()}
					class="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{#if districtVerifying}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						Verifying...
					{:else}
						Verify My District
					{/if}
				</button>

				<button
					onclick={skipDistrict}
					class="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
				>
					Skip for now
				</button>
			</div>
		{/if}

	{:else if currentStep === 'compose'}
		<!-- ═══════════ COMPOSE / CONFIRM ═══════════ -->
		<button
			onclick={goBack}
			class="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
			aria-label="Go back"
		>
			<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
			</svg>
			Back
		</button>

		<h2 class="text-xl font-bold text-slate-900">
			{data.campaign.type === 'LETTER' ? 'Your Message' : 'Confirm Your Action'}
		</h2>
		<p class="mt-1 text-sm text-slate-500">
			{data.campaign.type === 'LETTER'
				? 'Customize the message below or submit as-is.'
				: `You are taking action as ${name}.`}
		</p>

		{#if form?.error}
			<div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
				{form.error}
			</div>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				displayCount = displayCount + 1;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
			class="mt-5 space-y-4"
		>
			<input type="hidden" name="name" value={name} />
			<input type="hidden" name="email" value={email} />
			<input type="hidden" name="postalCode" value={postalCode} />
			{#if districtEnabled && districtVerified}
				<input type="hidden" name="districtCode" value={districtCode} />
			{/if}

			<!-- Summary card -->
			<div class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
				<div class="flex items-center justify-between">
					<span class="text-slate-500">Name</span>
					<span class="font-medium text-slate-900">{name}</span>
				</div>
				<div class="mt-2 flex items-center justify-between">
					<span class="text-slate-500">Email</span>
					<span class="font-medium text-slate-900">{email}</span>
				</div>
				{#if postalCode}
					<div class="mt-2 flex items-center justify-between">
						<span class="text-slate-500">Postal Code</span>
						<span class="font-medium text-slate-900">{postalCode}</span>
					</div>
				{/if}
				{#if districtEnabled && districtVerified}
					<div class="mt-2 flex items-center justify-between">
						<span class="text-slate-500">District</span>
						<span class="font-medium text-emerald-600">{districtCode}</span>
					</div>
				{/if}
				{#if verificationTier >= 1}
					<div class="mt-2 flex items-center justify-between">
						<span class="text-slate-500">Verification</span>
						<span class="font-medium {verificationTier >= 2 ? 'text-emerald-600' : 'text-blue-600'}">
							{verificationTier >= 3 ? 'Identity Verified' : verificationTier >= 2 ? 'District Verified' : 'Location Verified'}
						</span>
					</div>
				{/if}
			</div>

			{#if data.campaign.type === 'LETTER'}
				<div>
					<label for="message" class="block text-sm font-medium text-slate-700">
						Your Message
						<span class="font-normal text-slate-400">(optional)</span>
					</label>
					<textarea
						id="message"
						name="message"
						rows="5"
						bind:value={message}
						placeholder="Add a personal message..."
						class="mt-1 block w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm transition-colors focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
					></textarea>
				</div>
			{/if}

			{#if data.campaign.targets && data.campaign.targets.length > 0}
				<div class="rounded-lg border border-slate-200 p-4">
					<p class="text-xs font-medium uppercase tracking-wider text-slate-400">
						Your action will reach
					</p>
					<ul class="mt-2 space-y-1.5">
						{#each data.campaign.targets as target}
							<li class="flex items-center gap-2 text-sm text-slate-700">
								<div class="h-1.5 w-1.5 rounded-full bg-slate-400"></div>
								<span class="font-medium">{target.name}</span>
								{#if target.title}
									<span class="text-slate-400">{target.title}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<button
				type="submit"
				disabled={submitting}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60"
			>
				{#if submitting}
					<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Submitting...
				{:else if data.campaign.type === 'LETTER'}
					Send Letter
				{:else if data.campaign.type === 'EVENT'}
					RSVP
				{:else}
					Take Action
				{/if}
			</button>

			<p class="text-center text-xs text-slate-400">
				Your information is used only for this campaign action.
			</p>
		</form>
	{/if}

	<!-- Step indicator -->
	{#if currentStep === 'identify' || currentStep === 'district' || currentStep === 'compose'}
		{@const steps = districtEnabled ? ['identify', 'district', 'compose'] : ['identify', 'compose']}
		{@const currentIndex = steps.indexOf(currentStep)}
		<div class="mt-8 flex items-center justify-center gap-2" role="progressbar" aria-label="Step {currentIndex + 1} of {steps.length}">
			{#each steps as _, i}
				<div class="h-1.5 w-8 rounded-full {i <= currentIndex ? 'bg-slate-900' : 'bg-slate-200'}"></div>
			{/each}
		</div>
	{/if}
</div>
