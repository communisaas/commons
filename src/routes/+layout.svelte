<script lang="ts">
	console.log('[LAYOUT] client script loaded');

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import '../app.css';
	import { setupConvex } from 'convex-sveltekit';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { syncDecryptedUser } from '$lib/stores/decryptedUser.svelte';

	// Initialize Convex context for convexQuery/convexForm/convexLoad in child components.
	if (PUBLIC_CONVEX_URL) {
		setupConvex(PUBLIC_CONVEX_URL);
	}
	import Footer from '$lib/components/layout/Footer.svelte';
	import HeaderSystem from '$lib/components/layout/HeaderSystem.svelte';
	import NavigationProgress from '$lib/components/layout/NavigationProgress.svelte';
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
	const isVerificationPage = $derived($page.url?.pathname?.startsWith('/v/') ?? false);

	let {
		children,
		data
	}: {
		children: Snippet;
		data: LayoutData;
	} = $props();

	// Decrypted PII — local reactive state, triggers re-render in child components
	let piiEmail: string | null = $state(null);
	let piiName: string | null = $state(null);

	// Reactive user object with decrypted PII overlaid
	const user = $derived(data.user ? {
		...(data.user as Record<string, unknown>),
		email: piiEmail ?? (data.user as Record<string, unknown>).email,
		name: piiName ?? (data.user as Record<string, unknown>).name,
	} : null);

	// Hydrate wallet state
	$effect(() => {
		walletState.initFromPageData(data.user as PageUser | null);
	});

	// ── Decrypt PII from client-custodied blobs ──
	// Feeds the decryptedUser store (available to all components) AND local state (for layout user).
	$effect(() => {
		const u = data.user as Record<string, unknown> | null;
		if (!browser) return;

		syncDecryptedUser(u ? {
			id: u.id as string,
			email: u.email as string | null,
			name: u.name as string | null,
			encryptedEmail: u.encryptedEmail as string | null,
			encryptedName: u.encryptedName as string | null,
		} : null);
	});

	// Bridge store → local state for layout's derived user object
	import { decryptedUser } from '$lib/stores/decryptedUser.svelte';

	$effect(() => {
		if (decryptedUser.email) piiEmail = decryptedUser.email;
		if (decryptedUser.name) piiName = decryptedUser.name;
	});

	// ── Legacy PII custody: encrypt from OAuth seed (un-migrated users only) ──
	// Once email is stored plaintext (Phase 1+), this effect is a no-op because
	// oauthPiiSeed is null when plaintext email exists on the user record.
	$effect(() => {
		const authUser = data.user as Record<string, unknown> | null;
		if (!browser || !authUser?.id) return;

		const oauthSeed = authUser.oauthPiiSeed as { email: string; name: string | null } | null;
		if (!oauthSeed?.email) return;

		// Plaintext migration: write email directly instead of encrypting
		const userId = authUser.id as string;
		fetch('/api/pii/migrate', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: oauthSeed.email, name: oauthSeed.name }),
		}).then(async (res) => {
			if (res.ok) {
				const { invalidate } = await import('$app/navigation');
				invalidate('data:user');
			}
		}).catch((err) => {
			console.error('[PII Migration] Plaintext write failed:', err);
		});
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

<NavigationProgress />

{#if isEmbedPage || isCampaignPage}
	<!-- Embed and campaign pages: Own layout, no root chrome -->
	{@render children()}
{:else}
	{#if !isOrgPage}
		<!-- HeaderSystem handles context-aware header rendering -->
		<!-- HeaderTemplate is a structural subset of Template — handler only reads common fields at runtime -->
		<HeaderSystem user={user as HeaderUser | null} template={(data as Record<string, unknown>).template as HeaderTemplate | null} onTemplateUse={handleTemplateUse} />

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
	{:else if isVerificationPage}
		<!-- Verification certificate: standalone, no wrapper padding, no footer -->
		<div class="pt-[48px]">
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

