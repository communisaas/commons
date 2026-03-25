<script lang="ts">
	import { page } from '$app/stores';
	import { onMount as _onMount, tick } from 'svelte';
	import { Users, Eye } from '@lucide/svelte';
	import TemplatePreview from '$lib/components/template-browser/TemplatePreview.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import VerificationBadge from '$lib/components/ui/VerificationBadge.svelte';
	// import { extractRecipientEmails } from '$lib/types/templateConfig';
	import { modalActions, modalSystem } from '$lib/stores/modalSystem.svelte';
	import { guestState } from '$lib/stores/guestState.svelte';
	import { analyzeEmailFlow, generatePersonalizedMailto } from '$lib/services/emailService';
	import { resolveTemplate } from '$lib/utils/templateResolver';
	import { trackTemplateView, trackDeliveryAttempt } from '$lib/core/analytics/client';
	import ShareButton from '$lib/components/ui/ShareButton.svelte';
	import ActionBar from '$lib/components/template-browser/parts/ActionBar.svelte';
	import TrustJourney from '$lib/components/trust/TrustJourney.svelte';
	import DebateSurface from '$lib/components/debate/DebateSurface.svelte';
	import DebateSignal from '$lib/components/debate/DebateSignal.svelte';
	import MobileDebateBanner from '$lib/components/debate/MobileDebateBanner.svelte';
	import type { DebateData } from '$lib/stores/debateState.svelte';
	import StanceRegistration from '$lib/components/action/StanceRegistration.svelte';
	import PowerLandscape from '$lib/components/action/PowerLandscape.svelte';
	import { positionState } from '$lib/stores/positionState.svelte';
	import CommunityEngagementCard from '$lib/components/action/CommunityEngagementCard.svelte';
	import type { EngagementData } from '$lib/components/action/CommunityEngagementCard.svelte';
	import { mergeLandscape, slugify, type LandscapeMember, type DistrictOfficialInput } from '$lib/utils/landscapeMerge';
	import type { ProcessedDecisionMaker } from '$lib/types/template';
	import { generateShareMessage } from '$lib/utils/share-messages';

	import { spring } from 'svelte/motion';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { Template as TemplateType } from '$lib/types/template';
	import { FEATURES } from '$lib/config/features';

	let { data }: { data: PageData } = $props();

	// Simple modal state
	let _isUpdatingAddress = $state(false);

	// ActionBar state
	let personalConnectionValue = $state('');
	let actionProgress = $state(spring(0));

	// Template modal reference

	const template: TemplateType = $derived(data.template as unknown as TemplateType);
	// Simplified - no query parameters needed, default to direct-link
	const source = 'direct-link';
	const shareUrl = $derived(
		(() => {
			try {
				return $page.url?.href ?? '';
			} catch {
				return '';
			}
		})()
	);

	// Enhanced description with social proof for Open Graph
	const socialProofDescription = $derived((() => {
		const sent = template.metrics?.sent || 0;
		if (sent > 1000) {
			return `Join ${sent.toLocaleString()}+ constituents who took action. ${template.description}`;
		} else if (sent > 100) {
			return `${sent.toLocaleString()} people have taken action. ${template.description}`;
		}
		return template.description;
	})());

	// Check if user has complete address for congressional templates
	// Note: Address fields removed from User model per CYPHERPUNK-ARCHITECTURE.md
	const hasCompleteAddress = $derived(
		guestState.state?.address
	);
	const isCongressional = $derived(
		FEATURES.CONGRESSIONAL && (
			template.deliveryMethod === 'cwc' ||
			!!(data as unknown as PowerLandscapeData).recipientConfig?.cwcRouting
		)
	);
	const addressRequired = $derived(
		FEATURES.ADDRESS_SPECIFICITY === 'district' && isCongressional && !hasCompleteAddress && (data.user?.trust_tier ?? 0) < 2
	);

	// Debate resolution signal for message preview banner
	const debateResolution = $derived(
		FEATURES.DEBATE && data.debate && (data.debate as DebateData).status === 'resolved' && (data.debate as DebateData).winningStance
			? {
					winningStance: (data.debate as DebateData).winningStance as string,
					participants: (data.debate as DebateData).uniqueParticipants
				}
			: null
	);

	_onMount(() => {
		// Clean up OAuth redirect hash fragment from Facebook
		if (browser && window.location.hash === '#_=_') {
			history.replaceState(null, '', window.location.pathname + window.location.search);
		}

		// Track template view (aggregated, no source tracking - that's surveillance)
		trackTemplateView(template.id);

		// Store template context for guest users
		if (!data.user) {
			const safeSlug = (template.slug ?? template.id) as string;
			guestState.setTemplate(
				safeSlug,
				template.title,
				source as 'social-link' | 'direct-link' | 'share'
			);
			return;
		}

		// Clean up OAuth completion cookie if present — user lands on the page
		// and chooses who to write to via the Power Landscape, no auto-send
		const oauthCompletion = getOAuthCompletionCookie();
		if (oauthCompletion) {
			clearOAuthCompletionCookie();
		}
	});

	/**
	 * Get OAuth completion cookie if it exists
	 * This cookie is set by oauth-callback-handler after successful auth
	 */
	function getOAuthCompletionCookie(): {
		provider: string;
		returnTo: string;
		completed: boolean;
		timestamp: number;
	} | null {
		if (!browser) return null;

		const cookie = document.cookie.split('; ').find((row) => row.startsWith('oauth_completion='));

		if (!cookie) return null;

		try {
			const value = decodeURIComponent(cookie.split('=')[1]);
			return JSON.parse(value);
		} catch (error) {
			console.error('[Template Page] Failed to parse oauth_completion cookie:', error);
			return null;
		}
	}

	/**
	 * Clear OAuth completion cookie after use
	 */
	function clearOAuthCompletionCookie(): void {
		if (!browser) return;
		document.cookie = 'oauth_completion=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
	}

	interface AddressModalDetail {
		address: string;
		streetAddress?: string;
		city?: string;
		state?: string;
		zip?: string;
		[key: string]: unknown;
	}

	function handlePostAuthFlow() {
		const trustTier = data.user?.trust_tier ?? 0;

		// CWC templates: TemplateModal handles tier-based routing in onMount
		// (trust-upgrade for Tier 1-2, ZKP flow for Tier 3+)
		// Skip address gate — it shows the old NFC/Gov ID modal which is wrong here
		if (FEATURES.CONGRESSIONAL && template.deliveryMethod === 'cwc' && data.user) {
			modalActions.openModal('template-modal', 'template_modal', { template, user: data.user });
			return;
		}

		// Tier 2+ already verified — skip address gate entirely
		// guestState address also counts (Cypherpunk: no PII on User model)
		if (trustTier >= 2 || guestState.state?.address) {
			modalActions.openModal('template-modal', 'template_modal', { template, user: data.user });
			return;
		}

		const flow = analyzeEmailFlow(template, data.user, { trustTier });

		if (flow.nextAction === 'address') {
			// Need address collection (non-CWC templates only)
			modalActions.openModal('address-modal', 'address', {
				template,
				source,
				mode: 'collection',
				onComplete: async (detail: AddressModalDetail) => {
					await _handleAddressSubmit(detail);
				}
			});
		} else {
			// Ready to send (or any other state) — open template modal
			modalActions.openModal('template-modal', 'template_modal', { template, user: data.user });
		}
	}

	// === Power Landscape state ===

	// Access server data with proper types (PageData doesn't include PL fields yet)
	interface PowerLandscapeData {
		positionCounts?: { support: number; oppose: number; districts: number };
		existingPosition?: { stance: string; registrationId: string } | null;
		deliveredRecipients?: string[];
		districtOfficials?: DistrictOfficialInput[];
		recipientConfig?: { decisionMakers?: ProcessedDecisionMaker[]; personalPrompt?: string; cwcRouting?: boolean };
		engagementByDistrict?: EngagementData | null;
		userDistrictCode?: string | null;
	}
	const pl = $derived(data as unknown as PowerLandscapeData);

	// Landscape computation
	const landscape = $derived(
		mergeLandscape(
			pl.recipientConfig?.decisionMakers ?? [],
			pl.districtOfficials ?? []
		)
	);

	// Identity commitment for position registration
	const identityCommitment = $derived(
		data.user?.identity_commitment ?? null
	);

	// UI state
	let landscapeRevealed = $state(false);
	let contactedRecipients = $state(new Set<string>());
	let departingRecipients = $state(new Set<string>());
	let batchRegistrationState = $state<'idle' | 'registering' | 'complete'>('idle');

	// Bounce reporting state
	let reportedBounces = $state(new Set<string>());
	let reportingBounce = $state<string | null>(null);

	// Contextual share message — shifts from recruiting to movement-building after email handoff
	const shareMessage = $derived(
		generateShareMessage(
			{
				template: {
					title: template.title,
					category: template.category || 'advocacy',
					description: template.description
				},
				contactedNames: [...contactedRecipients]
					.map(id => {
						const allMembers = [
							...landscape.roleGroups.flatMap(g => g.members),
							...(landscape.districtGroup?.members ?? [])
						];
						return allMembers.find(m => m.id === id)?.name;
					})
					.filter((n): n is string => !!n),
				totalRecipients: landscape.totalCount,
				shareUrl
			},
			'medium'
		)
	);

	// Mail app handoff detection — settle departing cards when user returns
	$effect(() => {
		if (departingRecipients.size === 0 || !browser) return;

		const settle = () => {
			if (departingRecipients.size > 0) {
				// Promote departing → contacted, then clear departing
				contactedRecipients = new Set([...contactedRecipients, ...departingRecipients]);
				departingRecipients = new Set();
				// Complete batch registration if it was in progress
				if (batchRegistrationState === 'registering') {
					batchRegistrationState = 'complete';
				}
			}
		};

		const onFocus = () => settle();
		const onVisible = () => { if (!document.hidden) settle(); };

		window.addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisible);
		const timer = setTimeout(settle, 3000);

		return () => {
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisible);
			clearTimeout(timer);
		};
	});

	// Initialize positionState from server data on template change
	$effect(() => {
		const tmplId = template.id;
		const existing = pl.existingPosition ?? null;
		const counts = pl.positionCounts;
		const isCreatorArrival = browser && ($page.state as Record<string, unknown>)?.fromPublish;

		const hasDirectRecipients = (pl.recipientConfig?.decisionMakers ?? []).length > 0 && !isCongressional;
		if (!FEATURES.STANCE_POSITIONS || isCreatorArrival || hasDirectRecipients) {
			// No stance gate — show decision-makers immediately.
			// Creator arrivals skip the gate: they authored this template.
			// Direct outreach templates show named recipients without requiring a stance.
			landscapeRevealed = true;
		} else if (existing) {
			// Returning user — restore registered state, skip stance buttons
			positionState.restore(
				tmplId,
				existing.stance as 'support' | 'oppose',
				existing.registrationId,
				counts ?? { support: 0, oppose: 0, districts: 0 }
			);
			landscapeRevealed = true;
		} else {
			positionState.init(tmplId, counts);
			landscapeRevealed = false;
		}

		// Restore sent recipients from delivery records
		// Server stores raw recipient_name; client keys by slugify(name)
		contactedRecipients = new Set((pl.deliveredRecipients ?? []).map(slugify));
	});

	// Auto-scroll to PowerLandscape on creator arrival (separate effect for reactivity isolation)
	$effect(() => {
		if (browser && ($page.state as Record<string, unknown>)?.fromPublish && landscapeRevealed) {
			tick().then(() => {
				document.getElementById('power-landscape')?.scrollIntoView({
					behavior: 'smooth',
					block: 'start'
				});
			});
		}
	});

	function handleRegistered(stance: 'support' | 'oppose') {
		if (stance === 'support') {
			// Support → reveal Power Landscape for direct action
			landscapeRevealed = true;
		} else {
			// Oppose → route into deliberation
			landscapeRevealed = true;
			const userTier = data.user?.trust_tier ?? 0;
			const hasDebate = !!(data.debate as DebateData | null);

			if (userTier >= 3 && !hasDebate) {
				// Tier 3+ with no debate: spark one immediately
				modalActions.openModal('debate-modal', 'debate', {
					template,
					user: data.user,
					mode: 'initiate'
				});
			} else if (hasDebate) {
				// Debate exists: scroll to it
				tick().then(() => {
					document.querySelector('[data-debate-surface]')?.scrollIntoView({
						behavior: 'smooth',
						block: 'start'
					});
				});
			}
			// Tier < 3 with no debate: StanceRegistration shows verify CTA inline
		}
	}

	function handleWriteTo(member: LandscapeMember) {
		if (member.deliveryRoute === 'cwc') {
			// Congressional officials: route through existing CWC modal infrastructure
			// TemplateModal handles tier-based routing (mailto for T1-2, ZKP for T3+)
			modalActions.openModal('template-modal', 'template_modal', {
				template,
				user: data.user
			});
		} else if (member.deliveryRoute === 'email' && member.email) {
			// Direct mailto — opener + resolved template body, no intermediate compose view
			const districtName = data.userDistrictCode ?? '';
			const subject = template.subject || template.title;

			const trustTier = data.user?.trust_tier ?? 0;
			const attestation = trustTier >= 2
				? `Verified resident, ${districtName}\nCryptographic proof of residency`
				: undefined;

			// Inject personal connection before resolveTemplate strips the placeholder
			const pc = personalConnectionValue?.trim();
			const templateWithPC = pc
				? { ...template, message_body: (template.message_body || '').replace(/\[Personal Connection\]/g, pc) }
				: template;
			const resolved = resolveTemplate(templateWithPC as any, data.user as any ?? null);
			const resolvedBody = resolved.body.replace(/\[District\]/g, districtName);

			const result = generatePersonalizedMailto({
				recipient: {
					name: member.name,
					email: member.email,
					title: member.title,
					organization: member.organization
				},
				subject,
				opener: member.accountabilityOpener ?? '',
				templateBody: resolvedBody,
				attestation
			});

			if ('url' in result) {
				// Track email handoff — we know the mail app was opened, not that it was sent
				contactedRecipients = new Set([...contactedRecipients, member.id]);
				departingRecipients = new Set([...departingRecipients, member.id]);
				trackDeliveryAttempt(template.id, 'email');

				// Persist outreach record (fire-and-forget)
				if (positionState.registrationId) {
					fetch('/api/positions/batch-register', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							registrationId: positionState.registrationId,
							recipients: [{
								name: member.name,
								email: member.email,
								deliveryMethod: 'email'
							}]
						}),
						keepalive: true
					}).catch(() => {}); // Fire-and-forget — UI already updated
				}

				window.location.href = result.url;
			}
		} else if (member.deliveryRoute === 'form' && member.contactFormUrl) {
			// Web contact form: open in new tab
			window.open(member.contactFormUrl, '_blank', 'noopener,noreferrer');
		}
	}

	function handleBatchRegister(memberIds: string[]) {
		if (batchRegistrationState === 'registering') return;
		batchRegistrationState = 'registering';

		const allMembers = [
			...landscape.roleGroups.flatMap((g) => g.members),
			...(landscape.districtGroup?.members ?? [])
		];

		const members = memberIds
			.map((id) => allMembers.find((m) => m.id === id))
			.filter((m): m is LandscapeMember => m != null);

		// Build single mailto with all email-bearing members in To:
		const emailMembers = members.filter(m => m.email && m.deliveryRoute === 'email');
		if (emailMembers.length > 0) {
			const districtName = data.userDistrictCode ?? '';
			const subject = template.subject || template.title;

			const trustTier = data.user?.trust_tier ?? 0;
			const attestation = trustTier >= 2
				? `Verified resident, ${districtName}\nCryptographic proof of residency`
				: undefined;

			const resolved = resolveTemplate(template as any, data.user as any ?? null);
			const resolvedBody = resolved.body.replace(/\[District\]/g, districtName).trim();

			const bodyParts: string[] = [];
			const pc = personalConnectionValue?.trim();
			if (pc) bodyParts.push(pc);
			if (resolvedBody) bodyParts.push(resolvedBody);
			if (attestation?.trim()) {
				bodyParts.push('---');
				bodyParts.push(attestation.trim());
			}

			const emails = emailMembers.map(m => m.email!).join(',');
			const url = `mailto:${encodeURIComponent(emails)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyParts.join('\n\n'))}`;

			if (url.length <= 8000) {
				// Set departing only — settle handler promotes to contacted when user returns
				departingRecipients = new Set([...departingRecipients, ...emailMembers.map(m => m.id)]);
				trackDeliveryAttempt(template.id, 'email');

				// Persist delivery records only for members who actually got a mailto (fire-and-forget)
				if (positionState.registrationId) {
					fetch('/api/positions/batch-register', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							registrationId: positionState.registrationId,
							recipients: emailMembers.map((m) => ({
								name: m.name,
								email: m.email ?? undefined,
								deliveryMethod: 'email' as const
							}))
						}),
						keepalive: true
					}).catch(() => {});
				}

				// Stay in 'registering' — settle handler transitions to 'complete' on return
				window.location.href = url;
				return;
			}
		}

		batchRegistrationState = 'idle';
	}

	// Resolve contacted members with emails for bounce reporting
	const contactedMembers = $derived((() => {
		if (contactedRecipients.size === 0) return [];
		const allMembers = [
			...landscape.roleGroups.flatMap(g => g.members),
			...(landscape.districtGroup?.members ?? [])
		];
		return allMembers.filter(m => contactedRecipients.has(m.id) && m.email && !reportedBounces.has(m.email));
	})());

	async function handleReportBounce(email: string) {
		if (reportingBounce || reportedBounces.has(email)) return;
		reportingBounce = email;
		try {
			const res = await fetch('/api/emails/report-bounce', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email })
			});
			if (res.ok) {
				reportedBounces = new Set([...reportedBounces, email]);
			}
		} catch {
			// Silently fail — not critical
		} finally {
			reportingBounce = null;
		}
	}

	async function _handleAddressSubmit(detail: AddressModalDetail) {
		try {
			_isUpdatingAddress = true;

			// Invalidate stale location caches before setting new address
			// Pass userId so encrypted constituent address + session tree state are cleared
			const { invalidateLocationCaches } = await import('$lib/core/identity/cache-invalidation');
			await invalidateLocationCaches(data.user?.id);

			// Cache address locally (Cypherpunk: no PII on User model)
			guestState.setAddress(detail.address);

			// Bump trust_tier to 2 (Constituent) on the server via real address verification
			if (data.user && detail.streetAddress && detail.city && detail.state && detail.zip) {
				try {
					// Resolve address to get district code
					const resolveRes = await fetch('/api/location/resolve-address', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							street: detail.streetAddress,
							city: detail.city,
							state: detail.state,
							zip: detail.zip
						})
					});
					if (resolveRes.ok) {
						const resolved = await resolveRes.json();
						if (resolved.resolved && resolved.district?.code) {
							await fetch('/api/identity/verify-address', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({
									district: resolved.district.code,
									verification_method: 'civic_api',
									officials: resolved.officials ?? []
								})
							});
						}
					}
				} catch {
					// Non-fatal: tier bump failed, proceed with local cache
				}
			}

			// Close address modal and proceed to template modal
			modalActions.closeModal('address-modal');
			modalActions.openModal('template-modal', 'template_modal', {
				template,
				user: data.user
			});

			// Refresh page data so trust tier updates everywhere
			await invalidateAll();
		} catch (error) {
			console.error('[TemplateFlow] Error in _handleAddressSubmit:', error);
			// Proceed anyway — address is cached locally
			modalActions.closeModal('address-modal');
			modalActions.openModal('template-modal', 'template_modal', { template, user: data.user });
		} finally {
			_isUpdatingAddress = false;
		}
	}
</script>

<svelte:head>
	<title>{template.title} | Commons</title>
	<meta name="description" content={template.description} />

	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:url" content={shareUrl} />
	<meta property="og:title" content={template.title} />
	<meta property="og:description" content={socialProofDescription} />
	<meta property="og:site_name" content="Commons" />
	<meta property="og:image" content="{shareUrl.split('?')[0]}/og-image" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="{template.title} - Join the movement on Commons" />

	<!-- Twitter -->
	<meta property="twitter:card" content="summary_large_image" />
	<meta property="twitter:url" content={shareUrl} />
	<meta property="twitter:title" content={template.title} />
	<meta property="twitter:description" content={socialProofDescription} />
	<meta property="twitter:image" content="{shareUrl.split('?')[0]}/og-image" />
	<meta property="twitter:image:alt" content="{template.title} - Join the movement on Commons" />
</svelte:head>

<!-- Template content with zoned layout: Orient → Commit → Act -->
<div class="py-6">
	<!-- ORIENT: Template header (single column, clean context) -->
	<div class="mb-6">
		<h1 class="mb-3 text-3xl font-bold text-slate-900 sm:text-4xl">
			{template.title}
		</h1>
		<p class="mb-3 text-lg text-slate-600">{template.description}</p>

		<!-- Template metadata — single scannable line -->
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
			<ShareButton url={shareUrl} _title={template.title} message={shareMessage} variant="secondary" size="sm" />
			<Badge variant={isCongressional ? 'congressional' : 'direct'}>
				{isCongressional ? 'Congressional Delivery' : 'Direct Outreach'}
			</Badge>
			<span class="text-slate-500">{template.category}</span>
			{#if FEATURES.CONGRESSIONAL && (data.user?.trust_tier ?? 0) >= 2 && template.deliveryMethod === 'cwc'}
				<span class="flex items-center gap-1 text-green-600">
					<VerificationBadge showText={false} />
					Enhanced Credibility
				</span>
			{/if}
			{#if (template.metrics?.sent || 0) >= 5}
				<span class="flex items-center gap-1.5 text-slate-400">
					<Users class="h-3.5 w-3.5" />
					{template.metrics.sent.toLocaleString()} acted on this
				</span>
			{/if}
			{#if (template.metrics?.views || 0) >= 20}
				<span class="flex items-center gap-1.5 text-slate-400">
					<Eye class="h-3.5 w-3.5" />
					{template.metrics.views.toLocaleString()} views
				</span>
			{/if}
		</div>
	</div>

	<!-- COMMIT: Stance registration / action — the page's experiential pivot -->
	{#if FEATURES.DEBATE && FEATURES.STANCE_POSITIONS}
		<div class="border-y border-slate-200/80 py-4 my-6">
			<!-- Debate signal — contextualizes the support/oppose decision -->
			{#if FEATURES.DEBATE}
				<DebateSignal debate={(data.debate as DebateData) ?? null} variant="inline" />
			{/if}

			{#if data.user && identityCommitment}
				<!-- Authenticated: real stance registration -->
				<StanceRegistration
					templateId={template.id}
					onRegistered={handleRegistered}
					recipientCount={landscape.totalCount}
					{isCongressional}
					debateExists={!!(data.debate as DebateData | null)}
					canInitiateDebate={(data.user?.trust_tier ?? 0) >= 3 && !(data.debate as DebateData | null)}
					onChallenge={() => {
						const hasDebate = !!(data.debate as DebateData | null);
						if (hasDebate) {
							// Join existing debate
							modalActions.openModal('debate-modal', 'debate', {
								template,
								user: data.user,
								debate: data.debate,
								mode: 'participate'
							});
						} else {
							// Initiate new debate
							modalActions.openModal('debate-modal', 'debate', {
								template,
								user: data.user,
								mode: 'initiate'
							});
						}
					}}
					onVerifyForChallenge={data.user ? () => {
						if ((data.user!.trust_tier ?? 0) < 2) {
							modalActions.openModal('address-modal', 'address', {
								template,
								user: data.user,
								context: 'debate'
							});
						} else {
							modalActions.openModal('identity-verification-modal', 'identity-verification', {
								userId: data.user!.id,
								templateSlug: template.slug,
								onComplete: async () => {
									await invalidateAll();
								}
							});
						}
					} : undefined}
				/>
			{:else}
				<!-- Guest / no identity: stance-first framing that routes to auth -->
				{@const rcLabel = landscape.totalCount > 0
					? isCongressional
						? landscape.totalCount === 1 ? '1 representative' : `${landscape.totalCount} representatives`
						: landscape.totalCount === 1 ? '1 decision-maker' : `${landscape.totalCount} decision-makers`
					: isCongressional
						? 'your representatives'
						: 'decision-makers'}
				<div class="space-y-3">
					<p class="flex items-center gap-1.5 text-sm text-slate-600">
						<span>Contact {rcLabel}</span>
						<span class="text-slate-400">&rarr;</span>
						<span class="text-slate-500">first, where do you stand?</span>
					</p>
					<div class="flex flex-wrap items-center gap-3">
						<button
							class="flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-participation-primary-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-participation-primary-700 sm:flex-none"
							onclick={() => {
								if (!data.user) {
									modalActions.openModal('template-modal', 'template_modal', { template, user: null });
								} else {
									handlePostAuthFlow();
								}
							}}
						>
							I support this
						</button>
						<button
							class="flex min-h-[44px] flex-1 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 sm:flex-none"
							onclick={() => {
								if (!data.user) {
									modalActions.openModal('template-modal', 'template_modal', { template, user: null });
								} else {
									handlePostAuthFlow();
								}
							}}
						>
							I oppose this
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- ACT: Two-column field — message as sticky reference, landscape as primary workspace -->
	<div class="lg:grid lg:grid-cols-[2fr_3fr] lg:gap-8 lg:items-start overflow-x-clip">
		<!-- LEFT: Message preview — sticky reference while landscape scrolls -->
		<div class="min-w-0 lg:sticky lg:top-6 lg:self-start">
			<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
				{#if addressRequired && !landscapeRevealed}
					<!-- Address Required Notice -->
					<div class="border-b border-amber-200 bg-amber-50 px-6 py-4">
						<div class="flex items-center gap-3">
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100">
								<svg class="h-4 w-4 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
									<path
										fill-rule="evenodd"
										d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-sm font-semibold text-amber-900">Address Required</h3>
								<p class="text-xs text-amber-700">
									They only count messages from their district. No address = no impact.
								</p>
							</div>
							<Button
								variant="secondary"
								onclick={() =>
									modalActions.openModal('address-modal', 'address', {
										template,
										source,
										mode: 'collection',
										onComplete: async (detail: AddressModalDetail) => {
											await _handleAddressSubmit(detail);
										}
									})}
								classNames="ml-auto"
							>
								Add Address
							</Button>
						</div>
					</div>
				{/if}

				<TemplatePreview
					{template}
					context="page"
					user={data.user as { id: string; name: string | null; trust_tier?: number } | null}
					showEmailModal={false}
					{debateResolution}
					bind:personalConnectionValue
					onEmailModalClose={() => {
						/* Intentionally empty - modal close handled elsewhere */
					}}
					onScroll={() => {
						/* Intentionally empty - scroll handling not needed */
					}}
					expandToContent={true}
					onOpenModal={() => {
						const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
						if (isMobile) {
							modalActions.openModal('mobile-preview', 'mobile_preview', { template, user: data.user });
						}
					}}
					onSendMessage={async () => {
						// Reveal the Power Landscape and scroll to it — no batch mailto
						landscapeRevealed = true;
						await tick();
						document.getElementById('power-landscape')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}}
				/>
			</div>
		</div>

		<!-- RIGHT (PRIMARY): Power Landscape + Signal strength + Deliberation -->
		<div class="mt-8 lg:mt-0 space-y-8 min-w-0">
			<!-- Trust Journey — signal strength contextualizes the action space below -->
			{#if FEATURES.STANCE_POSITIONS && data.user}
				<TrustJourney
					trustTier={data.user.trust_tier ?? 1}
					onVerifyAddress={FEATURES.ADDRESS_SPECIFICITY === 'district' ? () => {
					modalActions.openModal('address-modal', 'address', {
						template,
						source,
						mode: 'collection',
						onComplete: async (detail: AddressModalDetail) => {
							await _handleAddressSubmit(detail);
						}
					});
				} : undefined}
				onVerifyIdentity={data.user ? () => {
					modalActions.openModal('identity-verification-modal', 'identity-verification', {
						userId: data.user!.id,
						templateSlug: template.slug,
						onComplete: async () => {
							await invalidateAll();
						}
					});
				} : undefined}
					onGenerateProof={FEATURES.CONGRESSIONAL ? () => {
						modalActions.openModal('template-modal', 'template_modal', {
							template,
							user: data.user,
							initialState: 'cwc-submission'
						});
					} : undefined}
				/>
			{/if}

			<!-- Coordination field — "{N} coordinating across {M} districts" -->
			<CommunityEngagementCard
				engagement={pl.engagementByDistrict ?? null}
				userDistrict={data.userDistrictCode}
				onAddPosition={!positionState.isRegistered ? () => {
					const stanceSection = document.querySelector('.border-y.border-slate-200\\/80');
					stanceSection?.scrollIntoView({ behavior: 'smooth', block: 'center' });
				} : undefined}
			/>

			<!-- Power Landscape: visible after position registration -->
			{#if landscapeRevealed}
				<div id="power-landscape">
				<PowerLandscape
					{template}
					decisionMakers={pl.recipientConfig?.decisionMakers ?? []}
					districtOfficials={pl.districtOfficials ?? []}
					{contactedRecipients}
					{departingRecipients}
					onWriteTo={handleWriteTo}
					onBatchRegister={handleBatchRegister}
					{isCongressional}
					onVerifyAddress={addressRequired ? () => {
						modalActions.openModal('address-modal', 'address', {
							template,
							source,
							mode: 'collection',
							onComplete: async (detail: AddressModalDetail) => {
								await _handleAddressSubmit(detail);
							}
						});
					} : undefined}
					registrationState={batchRegistrationState}
				/>

				{#if contactedMembers.length > 0}
					<div class="mt-3 text-xs text-slate-400">
						<span>Did an email bounce?</span>
						{#each contactedMembers as member}
							<button
								class="ml-2 underline hover:text-slate-600 disabled:opacity-50 disabled:no-underline"
								disabled={reportingBounce === member.email}
								onclick={() => member.email && handleReportBounce(member.email)}
							>
								{member.name}
							</button>
						{/each}
					</div>
				{/if}

				{#if reportedBounces.size > 0}
					<p class="mt-1 text-xs text-green-600">
						Noted — {reportedBounces.size === 1 ? 'this address' : 'these addresses'} won't appear in future results.
					</p>
				{/if}
				</div>
			{/if}

			<!-- Debate surface -->
			{#if FEATURES.DEBATE}
				<DebateSurface
					debate={(data.debate as DebateData) ?? null}
					userTrustTier={data.user?.trust_tier ?? 0}
					userOpposed={positionState.isRegistered && positionState.stance === 'oppose'}
					onInitiateDebate={() => {
						modalActions.openModal('debate-modal', 'debate', {
							template,
							user: data.user,
							mode: 'initiate'
						});
					}}
					onParticipate={() => {
						modalActions.openModal('debate-modal', 'debate', {
							template,
							user: data.user,
							debate: data.debate,
							mode: 'participate'
						});
					}}
					onCoSign={(argumentIndex) => {
						modalActions.openModal('debate-modal', 'debate', {
							template,
							user: data.user,
							debate: data.debate,
							mode: 'cosign',
							cosignArgumentIndex: argumentIndex
						});
					}}
					onVerifyIdentity={data.user ? () => {
						if (data.user!.trust_tier != null && data.user!.trust_tier < 2) {
							// Tier 0-1: need address first
							modalActions.openModal('address-modal', 'address', {
								template,
								user: data.user,
								context: 'debate'
							});
						} else {
							// Tier 2+: open real mDL identity verification
							modalActions.openModal('identity-verification-modal', 'identity-verification', {
								userId: data.user!.id,
								templateSlug: template.slug,
								onComplete: async () => {
									await invalidateAll();
								}
							});
						}
					} : undefined}
				/>
			{/if}
		</div>
	</div>
</div>

<!-- Mobile debate awareness — sticky banner below lg: breakpoint -->
{#if FEATURES.DEBATE}
	<MobileDebateBanner debate={(data.debate as DebateData) ?? null} />
{/if}
