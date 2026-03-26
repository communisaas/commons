<script lang="ts">

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	// Note: `browser` import restored — needed for credential loading (not route detection)
	import '../app.css';
	import { setupConvex } from 'convex-sveltekit';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';

	// Initialize Convex context for convexQuery/convexForm/convexLoad in child components.
	if (PUBLIC_CONVEX_URL) {
		setupConvex(PUBLIC_CONVEX_URL);
	}
	import Footer from '$lib/components/layout/Footer.svelte';
	import HeaderSystem from '$lib/components/layout/HeaderSystem.svelte';
	import CredentialExpiryNudge from '$lib/components/identity/CredentialExpiryNudge.svelte';
	import ErrorBoundary from '$lib/components/error/ErrorBoundary.svelte';
	import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
	import ModalRegistry from '$lib/components/modals/ModalRegistry.svelte';
	import { modalActions } from '$lib/stores/modalSystem.svelte';
	import { walletState } from '$lib/stores/walletState.svelte';
	import { analyzeEmailFlow, launchEmail } from '$lib/services/emailService';
	import { toEmailServiceUser } from '$lib/types/user';
	import type { HeaderUser, HeaderTemplate, TemplateUseEvent } from '$lib/types/any-replacements';
	import type { SessionCredentialForPolicy } from '$lib/core/identity/credential-policy';
	import type { PageUser } from '$lib/stores/walletState.svelte';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	/*
	 * CLS FIX: Remove `browser &&` guard from route detection.
	 *
	 * PROBLEM: `browser` is false during SSR, so ALL derived values were false.
	 * SSR always rendered the {:else} branch with pt-[48px] padding.
	 * On hydration, `browser` becomes true, correct branch renders, 48px disappears = CLS.
	 *
	 * SOLUTION: `$page` IS available during SSR via SvelteKit's load functions.
	 * Use it directly - no browser guard needed for route detection.
	 */
	const isProfilePage = $derived($page.url?.pathname?.startsWith('/profile') ?? false);
	const isHomepage = $derived($page.url?.pathname === '/');
	const isTemplatePage = $derived($page.route?.id === '/s/[slug]');
	const isOrgPage = $derived(($page.url?.pathname === '/org' || $page.url?.pathname?.startsWith('/org/')) ?? false);
	const isEmbedPage = $derived($page.url?.pathname?.startsWith('/embed/') ?? false);
	const isCampaignPage = $derived($page.url?.pathname?.startsWith('/c/') ?? false);

	let {
		children,
		data
	}: {
		children: Snippet;
		data: LayoutData;
	} = $props();

	// Hydrate wallet state from server-provided user data.
	// Runs reactively so wallet state updates if the user changes (login/logout).
	$effect(() => {
		walletState.initFromPageData(data.user as PageUser | null);
	});

	// ── Session credential for CredentialExpiryNudge (async, client-only) ──
	let layoutCredential: SessionCredentialForPolicy | null = $state(null);

	$effect(() => {
		const userId = (data.user as Record<string, unknown> | null)?.id as string | undefined;
		if (!browser || !userId) {
			layoutCredential = null;
			return;
		}

		let cancelled = false;
		import('$lib/core/identity/session-credentials').then(async ({ getSessionCredential }) => {
			const cred = await getSessionCredential(userId);
			if (cancelled) return;
			layoutCredential = cred ? {
				userId: cred.userId,
				createdAt: cred.createdAt,
				expiresAt: cred.expiresAt,
				congressionalDistrict: cred.congressionalDistrict
			} : null;
		}).catch(() => {
			if (!cancelled) layoutCredential = null;
		});

		return () => { cancelled = true; };
	});

	// Handle template use from header/bottom bar
	function handleTemplateUse(__event: TemplateUseEvent): void {
		const { template } = __event;

		const layoutTrustTier = (data.user as Record<string, unknown> | null)?.trust_tier as number ?? 0;
		const flow = analyzeEmailFlow(template, toEmailServiceUser(data.user as Record<string, unknown> | null), { trustTier: layoutTrustTier });

		if (flow.nextAction === 'auth') {
			// Navigate to auth or show modal
			window.location.href = `/auth/google?returnTo=${encodeURIComponent($page.url.pathname)}`;
		} else if (flow.nextAction === 'address') {
			// Handle address requirement
			// For now, redirect to auth flow which will handle address collection
			window.location.href = `/auth/google?returnTo=${encodeURIComponent($page.url.pathname)}`;
		} else if (flow.nextAction === 'email' && flow.mailtoUrl) {
			if (data.user) {
				// Show template modal for authenticated users
				modalActions.openModal('template-modal', 'template_modal', { template, user: data.user });
			} else {
				// Direct mailto launch for guests
				launchEmail(flow.mailtoUrl);
			}
		}
	}
</script>

{#if isEmbedPage || isCampaignPage}
	<!-- Embed and campaign pages: Own layout, no root chrome -->
	{@render children()}
{:else}
	{#if !isOrgPage}
		<!-- HeaderSystem handles context-aware header rendering -->
		<!-- HeaderTemplate is a structural subset of Template — handler only reads common fields at runtime -->
		<HeaderSystem user={data.user as HeaderUser | null} template={(data as Record<string, unknown>).template as HeaderTemplate | null} onTemplateUse={handleTemplateUse} />

		<!-- Credential expiry nudge: fixed banner below header, shows when credential nears expiration -->
		<CredentialExpiryNudge
			credential={layoutCredential}
			onReverify={() => goto('/profile')}
		/>
	{/if}

	{#if (data.user as Record<string, unknown> | null)?.id === 'user-seed-1'}
		<div class="pointer-events-none fixed top-0 left-0 right-0 z-[9999] bg-amber-500/10 text-amber-200 text-center text-xs py-1 font-mono tracking-wide">
			DEMO MODE — commons.email
		</div>
	{/if}

	{#if isOrgPage}
		<!-- Org pages: Own sidebar layout, no root chrome -->
		{@render children()}
	{:else if isProfilePage}
		<!-- Profile pages: No header padding, full control -->
		<div class="relative min-h-screen">
			<ErrorBoundary fallback="detailed" showRetry={true}>
				{@render children()}
			</ErrorBoundary>
			<Footer />
		</div>
	{:else if isHomepage}
		<!-- Homepage: No wrapper padding - page manages its own spacing for sticky behavior -->
		<div class="relative min-h-screen">
			<ErrorBoundary fallback="detailed" showRetry={true}>
				{@render children()}
			</ErrorBoundary>
		</div>
	{:else}
		<!-- Other pages: Header padding for fixed IdentityStrip -->
		<div class="relative min-h-screen pt-[48px]">
			<div class="p-6 md:p-10" class:pb-24={isTemplatePage} class:sm:pb-10={isTemplatePage} class:max-w-7xl={isTemplatePage} class:mx-auto={isTemplatePage}>
				<ErrorBoundary fallback="detailed" showRetry={true}>
					{@render children()}
				</ErrorBoundary>
			</div>
			<Footer />
		</div>
	{/if}

	<!-- Global UI components (always present for non-embed pages) -->
	<ToastContainer />
	<ModalRegistry />
{/if}

