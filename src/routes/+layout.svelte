<script lang="ts">
	console.log('[LAYOUT] client script loaded');

	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import '../app.css';
	import { setupConvex } from 'convex-sveltekit';
	import { env as publicEnv } from '$env/dynamic/public';
	import { syncDecryptedUser } from '$lib/stores/decryptedUser.svelte';

	// Bind the exact artifact's client to the current deployment realm rather
	// than baking the production Convex URL into its browser chunks.
	if (publicEnv.PUBLIC_CONVEX_URL) {
		setupConvex(publicEnv.PUBLIC_CONVEX_URL);
	}
	import Footer from '$lib/components/layout/Footer.svelte';
	import HeaderSystem from '$lib/components/layout/HeaderSystem.svelte';
	import NavigationProgress from '$lib/components/layout/NavigationProgress.svelte';
	import CredentialExpiryNudge from '$lib/components/identity/CredentialExpiryNudge.svelte';
	import ErrorBoundary from '$lib/components/error/ErrorBoundary.svelte';
	import ToastContainer from '$lib/components/ui/ToastContainer.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import ModalRegistry from '$lib/components/modals/ModalRegistry.svelte';
	import { modalActions } from '$lib/stores/modalSystem.svelte';
	import { walletState } from '$lib/stores/walletState.svelte';
	import { analyzeEmailFlow } from '$lib/services/emailService';
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
	const isOrgPage = $derived(
		($page.url?.pathname === '/org' || $page.url?.pathname?.startsWith('/org/')) ?? false
	);
	const isEmbedPage = $derived($page.url?.pathname?.startsWith('/embed/') ?? false);
	const isCampaignPage = $derived($page.url?.pathname?.startsWith('/c/') ?? false);
	const isVerificationPage = $derived($page.url?.pathname?.startsWith('/v/') ?? false);
	// Public-record routes are reading-room artifacts. They render as bare
	// documents on a plain-white ground plane: no header, no footer, no
	// global gradient, no marketing affordances. Treated like /embed and /c.
	const isRecordPage = $derived($page.url?.pathname?.startsWith('/record/') ?? false);

	let {
		children,
		data
	}: {
		children: Snippet;
		data: LayoutData;
	} = $props();

	// Hydrate wallet state
	$effect(() => {
		walletState.initFromPageData(data.user as PageUser | null);
	});

	// Scope template drafts to the active user. Drafts saved by another user on
	// the same device become invisible after login — protects against shared-device
	// cross-account leakage when one user doesn't explicitly log out.
	$effect(() => {
		if (!browser) return;
		const userId = (data.user as Record<string, unknown> | null)?.id as string | undefined;
		let cancelled = false;
		(async () => {
			const { templateDraftStore, deriveOwnerHash } = await import('$lib/stores/templateDraft');
			if (cancelled) return;
			if (!userId) {
				templateDraftStore.setOwner(null);
				return;
			}
			const hash = await deriveOwnerHash(userId);
			if (!cancelled) templateDraftStore.setOwner(hash);
		})().catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	// Sync plaintext email/name to reactive store (consumed by child components)
	import { decryptedUser } from '$lib/stores/decryptedUser.svelte';
	$effect(() => {
		const u = data.user as Record<string, unknown> | null;
		if (!browser) return;
		syncDecryptedUser(
			u
				? {
						id: u.id as string,
						email: u.email as string | null,
						name: u.name as string | null
					}
				: null
		);
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
		import('$lib/core/identity/session-credentials')
			.then(async ({ getSessionCredential }) => {
				const cred = await getSessionCredential(userId);
				if (cancelled) return;
				layoutCredential = cred
					? {
							userId: cred.userId,
							createdAt: cred.createdAt,
							expiresAt: cred.expiresAt,
							congressionalDistrict: cred.congressionalDistrict
						}
					: null;
			})
			.catch(() => {
				if (!cancelled) layoutCredential = null;
			});

		return () => {
			cancelled = true;
		};
	});

	// Handle template use from header/bottom bar
	function handleTemplateUse(__event: TemplateUseEvent): void {
		const { template } = __event;

		const layoutTrustTier =
			((data.user as Record<string, unknown> | null)?.trust_tier as number) ?? 0;
		const flow = analyzeEmailFlow(
			template,
			toEmailServiceUser(data.user as Record<string, unknown> | null),
			{ trustTier: layoutTrustTier }
		);

		if (flow.nextAction === 'auth') {
			// Navigate to auth or show modal
			window.location.href = `/auth/google?returnTo=${encodeURIComponent($page.url.pathname)}`;
		} else if (flow.nextAction === 'address') {
			// Handle address requirement
			// For now, redirect to auth flow which will handle address collection
			window.location.href = `/auth/google?returnTo=${encodeURIComponent($page.url.pathname)}`;
		} else if (flow.nextAction === 'email' && flow.mailtoUrl) {
			// One send surface for everyone. The guest fork used to fire a bare mailto
			// with nothing watching it and no receipt, while every other guest surface
			// opened this same modal; the modal handles guests on its own guest arms.
			// This path carries no personal connection, so there is no sender text here
			// for `laneCarriesSenderText` to have to protect.
			modalActions.openModal('template-modal', 'template_modal', { template, user: data.user });
		} else {
			// No URL to hand over. Without this the button is simply inert and the
			// reader is told nothing at all.
			toast.error(flow.error?.message ?? 'This message could not be prepared for your email app.');
		}
	}
</script>

<NavigationProgress />

{#if isEmbedPage || isCampaignPage || isRecordPage}
	<!-- Embed, campaign, and public-record pages: Own layout, no root chrome -->
	{@render children()}
{:else}
	{#if !isOrgPage}
		<!-- HeaderSystem handles context-aware header rendering -->
		<!-- HeaderTemplate is a structural subset of Template — handler only reads common fields at runtime -->
		<HeaderSystem
			user={data.user as HeaderUser | null}
			template={(data as Record<string, unknown>).template as HeaderTemplate | null}
			onTemplateUse={handleTemplateUse}
		/>

		<!-- Credential expiry nudge: fixed banner below header, shows when credential nears expiration -->
		<CredentialExpiryNudge credential={layoutCredential} onReverify={() => goto('/profile')} />
	{/if}

	{#if (data.user as Record<string, unknown> | null)?.id === 'user-seed-1'}
		<div
			class="pointer-events-none fixed top-0 right-0 left-0 z-[9999] bg-amber-500/10 py-1 text-center font-mono text-xs tracking-wide text-amber-200"
		>
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
		<!-- Homepage: no wrapper padding, the page manages its own spacing for
		     sticky behaviour. The footer still renders: the disclosure it carries
		     has to be reachable from the front door, which is the one page a
		     stranger is guaranteed to see. The page's own `creation-footer` is
		     part of the composer, not site chrome, and carries no legal link. -->
		<div class="relative min-h-screen">
			<ErrorBoundary fallback="detailed" showRetry={true}>
				{@render children()}
			</ErrorBoundary>
			<Footer />
		</div>
	{:else if isVerificationPage}
		<!-- Verification certificate: standalone, no wrapper padding. The footer
		     is the exception to that standalone framing, and deliberately: this is
		     the page an outside party lands on to check someone else's claim, so
		     it is where knowing how their data is handled matters most. -->
		<div class="pt-[48px]">
			<ErrorBoundary fallback="detailed" showRetry={true}>
				{@render children()}
			</ErrorBoundary>
			<Footer />
		</div>
	{:else}
		<!-- Other pages: Header padding for fixed IdentityStrip -->
		<div class="relative min-h-screen pt-[48px]">
			<div
				class="p-6 md:p-10"
				class:pb-24={isTemplatePage}
				class:sm:pb-10={isTemplatePage}
				class:max-w-7xl={isTemplatePage}
				class:mx-auto={isTemplatePage}
			>
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
