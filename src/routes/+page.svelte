<script lang="ts">
	/**
	 * Landing Page - Activation Surface Pattern
	 *
	 * Perceptual Engineering Principles:
	 * - Recognition > Recall: Both primary affordances (create/browse) immediately visible
	 * - Spatial encoding: Left = create (your voice), Right = join (together)
	 * - Progressive disclosure: "How it works" available but not blocking action
	 * - Direct manipulation: No abstract buttons, visible writing surface
	 */

	import { templateStore } from '$lib/stores/templates.svelte';
	import TemplatePreview from '$lib/components/template-browser/TemplatePreview.svelte';
	import TemplateList from '$lib/components/template-browser/TemplateList.svelte';
	import SkeletonTemplate from '$lib/components/ui/SkeletonTemplate.svelte';
	import TouchModal from '$lib/components/ui/TouchModal.svelte';
	import SimpleModal from '$lib/components/modals/SimpleModal.svelte';
	import TemplateSuccessModal from '$lib/components/modals/TemplateSuccessModal.svelte';
	import { modalActions } from '$lib/stores/modalSystem.svelte';
	import { isMobile, navigateTo } from '$lib/utils/browserUtils';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto, preloadData, onNavigate } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import type { Template, TemplateCreationContext, TemplateGroup } from '$lib/types/template';
	import type { PageData } from './$types';
	import { coordinated } from '$lib/utils/timerCoordinator';
	import { analyzeEmailFlow } from '$lib/services/emailService';
	import { toEmailServiceUser } from '$lib/types/user';
	import type { ModalComponent } from '$lib/types/component-props';

	import TemplateCreator from '$lib/components/template/TemplateCreator.svelte';
	import { CreationSpark, CoordinationExplainer } from '$lib/components/activation';
	import LocationScopeBar from '$lib/components/template-browser/LocationScopeBar.svelte';
	import { guestState } from '$lib/stores/guestState.svelte';
	import { z } from 'zod';
	import { FEATURES } from '$lib/config/features';
	import type { GeoScope } from '$lib/core/agents/types';
	import {
		scoreTemplatesByRelevance,
		geoScopeToInferredLocation,
		inferredLocationToGeoScope,
		groupByPrecision,
		type GeographicScope
	} from '$lib/core/location/template-filter';
	import { getUserLocation } from '$lib/core/location/inference-engine';
	import type { TemplateWithJurisdictions } from '$lib/core/location/types';
	import { scoreTemplate, sortTemplatesByScore } from '$lib/utils/template-scoring';

	let { data }: { data: PageData } = $props();

	const componentId = 'HomePage_' + Math.random().toString(36).substr(2, 9);

	// Create derived values from the store using Svelte 5 runes
	const selectedTemplate = $derived(
		templateStore.templates.find((t) => t.id === templateStore.selectedId)
	);
	const isLoading = $derived(templateStore.loading || !templateStore.initialized);
	const hasError = $derived(!!templateStore.error);

	let showMobilePreview = $state(false);
	let showTemplateCreator = $state(false);
	let personalConnectionValue = $state('');
	let showTemplateAuthModal = $state(false);
	let showTemplateSuccess = $state(false);
	let modalComponent = $state<ModalComponent>();
	let creationContext: TemplateCreationContext | null = $state(null);
	let creationInitialText = $state<string>('');
	let resumeDraftId = $state<string>('');
	let pendingTemplateToSave: Record<string, unknown> | null = $state(null);
	let savedTemplate = $state<Template | null>(null);
	let templateSaveError = $state<string | null>(null);
	let isSubmitting = $state(false);
	let templatePublishing = $state(false);
	let templatePublishError = $state<string | null>(null);
	let pendingPublishData = $state<Omit<Template, 'id'> | null>(null);
	let userInitiatedSelection = $state(false);

	// Location scope state (user-selected geographic filter for templates)
	const SCOPE_KEY = 'commons_location_scope';
	const SCOPE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

	let selectedScope = $state<GeoScope | null>(null);
	let scopeIsInferred = $state(false); // true when auto-resolved from IP/timezone

	function geoScopeToGeographicScope(scope: GeoScope | null): GeographicScope {
		if (!scope) return null;
		if (scope.type === 'nationwide') return 'nationwide';
		if (scope.type === 'subnational') {
			return scope.locality ? 'city' : 'state';
		}
		return null;
	}

	function handleScopeChange(scope: GeoScope | null) {
		selectedScope = scope;
		scopeIsInferred = false; // User explicitly selected/cleared — no longer inferred
		if (browser) {
			if (scope) {
				localStorage.setItem(
					SCOPE_KEY,
					JSON.stringify({ scope, timestamp: Date.now() })
				);
			} else {
				localStorage.removeItem(SCOPE_KEY);
			}
		}
	}

	// Handle OAuth return for template creation and URL parameter initialization
	onMount(() => {
		if (browser && $page.url.searchParams.get('template_saved') === 'pending') {
			const pendingData = sessionStorage.getItem('pending_template_save');
			if (pendingData) {
				try {
					// Validate stored template data
					const PendingTemplateSchema = z.object({
						templateData: z.unknown(),
						creatorInfo: z.object({ name: z.string(), email: z.string() }).optional(),
						timestamp: z.number()
					});

					const parsed = JSON.parse(pendingData);
					const result = PendingTemplateSchema.safeParse(parsed);

					if (result.success) {
						// Zod-validated from sessionStorage — runtime shape matches Template
						const { templateData } = result.data;
						templateStore
							.addTemplate(templateData as Omit<Template, 'id'>)
							.then(() => {
								sessionStorage.removeItem('pending_template_save');
							})
							.catch((_error) => {
								// Template save failed - user can retry later
							});
					} else {
						console.warn('[HomePage] Invalid pending template data:', result.error.flatten());
						sessionStorage.removeItem('pending_template_save');
					}
				} catch (error) {
					console.warn('[HomePage] Failed to parse pending template data:', error);
					sessionStorage.removeItem('pending_template_save');
				}
			}
		}

		// Hydrate template store from SSR data (no client-side fetch needed)
		if (data.templates && data.templates.length > 0) {
			templateStore.hydrateFromSSR(data.templates);
		} else {
			// Fallback: SSR returned empty, try client-side fetch
			templateStore.fetchTemplates();
		}

		// Restore location scope from localStorage
		let restoredFromStorage = false;
		try {
			const stored = localStorage.getItem(SCOPE_KEY);
			if (stored) {
				const { scope, timestamp } = JSON.parse(stored);
				if (Date.now() - timestamp < SCOPE_MAX_AGE_MS && scope?.type) {
					selectedScope = scope as GeoScope;
					restoredFromStorage = true;
				} else {
					localStorage.removeItem(SCOPE_KEY);
				}
			}
		} catch {
			// Corrupted data — ignore
		}

		// Auto-infer location from IP + timezone if no stored scope
		// Silent, no permission prompts — IP geolocation is automatic
		if (!restoredFromStorage) {
			getUserLocation().then((inferred) => {
				// Only apply if user hasn't selected something in the meantime
				if (!selectedScope && inferred.country_code && inferred.confidence > 0) {
					const autoScope = inferredLocationToGeoScope(inferred);
					if (autoScope) {
						selectedScope = autoScope;
						scopeIsInferred = true;
						// Don't persist auto-inferred to localStorage — only user selections persist
					}
				}
			}).catch(() => {
				// Silent failure — location inference is best-effort
			});
		}

		// Check for template creation parameter (including auth return with draft)
		const createTemplate = $page.url.searchParams.get('create');
		const resumeDraftParam = $page.url.searchParams.get('resumeDraft');

		if (createTemplate === 'true') {
			// Extract draft ID for seamless auth return flow
			if (resumeDraftParam) {
				resumeDraftId = decodeURIComponent(resumeDraftParam);
			}

			coordinated.setTimeout(
				() => {
					creationContext = {
						channelId: 'direct',
						channelTitle: 'Direct Outreach',
						isCongressional: false
					};
					showTemplateCreator = true;
					window.history.replaceState({}, '', '/');
				},
				100,
				'open-creator',
				componentId
			);
		}
	});

	// Enable smooth page transitions (browser only)
	if (browser) {
		onNavigate((navigation) => {
			if (!document.startViewTransition || !navigation.to?.url.pathname.includes('/s/')) {
				return;
			}
			return new Promise((resolve) => {
				document.startViewTransition(async () => {
					resolve();
				});
			});
		});
	}

	function handleTemplateSelect(id: string) {
		userInitiatedSelection = true;
		templateStore.selectTemplate(id);

		if (isMobile()) {
			showMobilePreview = true;
		} else {
			// Scroll the template preview into view on desktop
			tick().then(() => {
				document
					.querySelector('.template-preview-column')
					?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			});
		}
	}

	function handleSparkActivate(data: { initialText: string; draftId?: string }) {
		creationInitialText = data.initialText;
		// If draft ID provided, use it for seamless continuation
		if (data.draftId) {
			resumeDraftId = data.draftId;
		}
		creationContext = {
			channelId: 'direct',
			channelTitle: 'Direct Outreach',
			isCongressional: false
		};
		showTemplateCreator = true;
	}

	interface AuthEventDetail {
		name: string;
		email: string;
	}

	async function handlePublishRetry() {
		if (!pendingPublishData) return;
		templatePublishing = true;
		templatePublishError = null;
		try {
			const newTemplate = await templateStore.addTemplate(pendingPublishData);
			savedTemplate = newTemplate;
		} catch (err) {
			templatePublishError =
				err instanceof Error ? err.message : 'Failed to publish template';
		} finally {
			templatePublishing = false;
		}
	}

	function handleTemplateCreatorAuth(_event: CustomEvent<AuthEventDetail>) {
		const { name, email } = _event.detail;

		if (typeof window !== 'undefined') {
			sessionStorage.setItem(
				'pending_template_save',
				JSON.stringify({
					templateData: pendingTemplateToSave,
					creatorInfo: { name, email },
					timestamp: Date.now()
				})
			);
		}

		fetch('/auth/prepare', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ returnTo: '/?template_saved=pending' })
		}).finally(() => {
			navigateTo(`/auth/google`);
		});
	}

	// Show templates filtered by feature flags
	const allTemplates = $derived(
		templateStore.templates.filter(
			(t) =>
				(FEATURES.CONGRESSIONAL && t.deliveryMethod === 'cwc') ||
				t.deliveryMethod === 'email' ||
				t.deliveryMethod === 'direct'
		)
	);

	// Sort templates within a group by display score (send_count, recency)
	// so the homepage order matches what TemplateList renders
	function sortGroupTemplates(templates: Template[]): Template[] {
		const now = new Date();
		const scored = templates.map((t) => ({
			...t,
			...scoreTemplate(
				{
					send_count: t.send_count || 0,
					created_at: new Date(t.createdAt),
					updated_at: new Date((t as Record<string, unknown>).updatedAt as string || t.createdAt)
				},
				now
			)
		}));
		return sortTemplatesByScore(scored);
	}

	const filteredGroups = $derived.by(() => {
		// No scope or international → show all templates in one group
		if (!selectedScope || selectedScope.type === 'international') {
			return [
				{
					title: 'All Templates',
					templates: sortGroupTemplates(allTemplates),
					minScore: 0,
					level: 'nationwide' as const,
					coordinationCount: allTemplates.reduce((sum, t) => sum + (t.send_count || 0), 0)
				}
			];
		}

		const inferredLocation = geoScopeToInferredLocation(selectedScope);
		if (!inferredLocation) {
			return [
				{
					title: 'All Templates',
					templates: sortGroupTemplates(allTemplates),
					minScore: 0,
					level: 'nationwide' as const,
					coordinationCount: allTemplates.reduce((sum, t) => sum + (t.send_count || 0), 0)
				}
			];
		}

		// Score templates against the selected location
		const scored = scoreTemplatesByRelevance(
			allTemplates as unknown as TemplateWithJurisdictions[],
			inferredLocation,
			geoScopeToGeographicScope(selectedScope)
		);

		const groups = groupByPrecision(scored);

		// If scoring produced groups, use them (with display-score sorting within each)
		if (groups.length > 0) {
			return groups.map((g) => ({ ...g, templates: sortGroupTemplates(g.templates) }));
		}

		return [
			{
				title: 'All Templates',
				templates: sortGroupTemplates(allTemplates),
				minScore: 0,
				level: 'nationwide' as const,
				coordinationCount: allTemplates.reduce((sum, t) => sum + (t.send_count || 0), 0)
			}
		];
	});

	// Handle URL parameter initialization when templates load
	// Sync selection to URL param or first visible template after filtering
	$effect(() => {
		if (browser && templateStore.templates.length > 0 && !userInitiatedSelection) {
			const templateParam = $page.url.searchParams.get('template');
			if (templateParam) {
				const targetTemplate = templateStore.templates.find((t) => t.slug === templateParam);
				if (targetTemplate && targetTemplate.id !== templateStore.selectedId) {
					templateStore.selectTemplateBySlug(templateParam);
				}
			} else {
				// Default: select first template in the first visible group
				const firstTemplate = filteredGroups[0]?.templates[0];
				if (firstTemplate && firstTemplate.id !== templateStore.selectedId) {
					templateStore.selectTemplate(firstTemplate.id);
				}
			}
		}
	});

	interface OnCompleteDetail {
		address?: string;
		[key: string]: unknown;
	}

	async function handleSendMessage(template: Template) {
		if (!data.user) {
			modalActions.openModal('onboarding-modal', 'onboarding', {
				template,
				source: 'featured',
				onComplete: async (detail: OnCompleteDetail) => {
					// If address was collected during onboarding (unlikely but possible depending on flow), save it
					if (detail?.address) {
						// Client-side caching only - Cypherpunk ethos
						guestState.setAddress(detail.address);
					}

					const templateUrl = `/s/${template.slug}`;
					preloadData(templateUrl);
					setTimeout(() => {
						goto(templateUrl);
					}, 500);
				}
			});
			return;
		}

		const trustTier = (data.user as Record<string, unknown> | null)?.trust_tier as number ?? 0;
		const flow = analyzeEmailFlow(template, toEmailServiceUser(data.user as Record<string, unknown> | null), { trustTier });

		if (flow.nextAction === 'address') {
			modalActions.openModal('address-modal', 'address', {
				template,
				source: 'featured',
				user: data.user,
				onComplete: async (detail: OnCompleteDetail) => {
					if (detail?.address) {
						guestState.setAddress(detail.address);
					}

					// Verify address (ZKP commitment or fallback) before navigating
					if (data.user) {
						try {
							if ((detail as Record<string, unknown>).districtCommitment) {
								await fetch('/api/identity/verify-address', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										district_commitment: (detail as Record<string, unknown>).districtCommitment,
										slot_count: (detail as Record<string, unknown>).commitmentSlotCount,
										verification_method: 'shadow_atlas',
									})
								});
							} else if (detail?.address) {
								// Fallback: resolve + verify with plaintext
								const resolveRes = await fetch('/api/location/resolve-address', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										street: (detail as Record<string, unknown>).streetAddress,
										city: (detail as Record<string, unknown>).city,
										state: (detail as Record<string, unknown>).state,
										zip: (detail as Record<string, unknown>).zip
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
							}
						} catch {
							// Non-fatal: navigate anyway
						}
					}

					const templateUrl = `/s/${template.slug}`;
					preloadData(templateUrl);
					goto(templateUrl);
				}
			});
		} else {
			const templateUrl = `/s/${template.slug}`;
			preloadData(templateUrl);
			setTimeout(() => {
				goto(templateUrl);
			}, 500);
		}
	}
</script>

<svelte:head>
	<title>Commons</title>
	<meta
		name="description"
		content="Write once, share the link, everyone can send it. Coordinated messages make impact."
	/>
</svelte:head>

<!-- Activation Surface - Primary Affordances Immediately Visible -->
<section class="activation-page">
	<!-- Main Content: Split Layout -->
	<div class="activation-container">
		<!-- Left Column: Creation Spark + Minimal Footer -->
		<div class="creation-column">
			<CreationSpark onactivate={handleSparkActivate}>
				{#snippet context()}
					<footer class="creation-footer">
						<a href="mailto:hello@commons.email" class="contact-link contact-link--mailto">
							<span class="link-text">hello@commons.email</span>
						</a>
						<span class="creation-footer__sep" aria-hidden="true"></span>
						<a href="/org" class="contact-link contact-link--org">
							<span class="link-text">Organization tools</span>
							<svg
								class="link-arrow"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<line x1="5" y1="12" x2="19" y2="12"></line>
								<polyline points="12 5 19 12 12 19"></polyline>
							</svg>
						</a>
					</footer>
				{/snippet}
			</CreationSpark>
		</div>

		<!-- Right Column: Template Stream + Preview -->
		<div class="stream-column">
			<!-- How It Works - Spatially Adjacent to Coordination Signals -->
			<div class="stream-explainer">
				<CoordinationExplainer />
			</div>

			<!-- Location Scope Bar -->
			<div class="location-scope-row">
				<LocationScopeBar scope={selectedScope} inferred={scopeIsInferred} onScopeChange={handleScopeChange} />
			</div>

			<!-- Template Browser: List + Preview Grid -->
			<div class="template-browser" id="template-browser">
				<!-- Template List -->
				<div class="template-list-column">
					<TemplateList
						groups={filteredGroups}
						selectedId={templateStore.selectedId}
						onSelect={handleTemplateSelect}
						loading={isLoading}
					/>
				</div>

				<!-- Template Preview (desktop only) -->
				<div class="template-preview-column">
					{#if hasError}
						<div class="rounded-md border border-orange-200 bg-orange-50 p-6 text-center">
							<div class="mb-4 flex justify-center">
								<div class="flex h-16 w-16 items-center justify-center rounded-full bg-orange-100">
									<svg
										class="h-8 w-8 text-orange-600"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M12 8v4m0 4h.01M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z"
										/>
									</svg>
								</div>
							</div>
							<h3 class="mb-2 text-lg font-medium text-gray-900">
								Templates temporarily unavailable
							</h3>
							<p class="mb-4 text-sm text-gray-600">
								We're having trouble loading templates right now.
							</p>
							<button
								onclick={() => templateStore.fetchTemplates()}
								data-testid="retry-templates-button"
								class="inline-flex items-center rounded-lg bg-orange-600 px-4 py-2 text-white transition-colors hover:bg-orange-700"
							>
								Try Again
							</button>
						</div>
					{:else if isLoading && !selectedTemplate}
						<SkeletonTemplate variant="preview" animate={true} />
					{:else if selectedTemplate}
						<TemplatePreview
							template={selectedTemplate}
							user={data.user as { id: string; name: string | null; trust_tier?: number } | null}
							bind:personalConnectionValue
							onSendMessage={async () => handleSendMessage(selectedTemplate)}
						/>
					{:else}
						<div class="rounded-md border border-slate-200 bg-slate-50 p-12 text-center">
							<div class="mb-4 text-slate-400">
								<svg
									class="mx-auto h-16 w-16"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="1.5"
										d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
									/>
								</svg>
							</div>
							<h3 class="mb-2 text-lg font-medium text-slate-900">No campaigns running yet</h3>
							<p class="text-slate-600">Someone has to move first. Start one.</p>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>

<!-- Mobile Preview Modal -->
{#if showMobilePreview && selectedTemplate}
	<TouchModal
		onclose={() => (showMobilePreview = false)}
	>
		<div class="h-full">
			<TemplatePreview
				template={selectedTemplate}
				inModal={true}
				context="modal"
				user={data.user as { id: string; name: string | null; trust_tier?: number } | null}
				bind:personalConnectionValue
				onSendMessage={async () => {
					if (!data.user) {
						modalActions.openModal('onboarding-modal', 'onboarding', {
							template: selectedTemplate,
							source: 'mobile'
						});
						showMobilePreview = false;
						return;
					}

					const mobileTrustTier = (data.user as Record<string, unknown> | null)?.trust_tier as number ?? 0;
					const flow = analyzeEmailFlow(selectedTemplate, toEmailServiceUser(data.user as Record<string, unknown> | null), { trustTier: mobileTrustTier });

					if (flow.nextAction === 'address') {
						modalActions.openModal('address-modal', 'address', {
							template: selectedTemplate,
							source: 'mobile',
							user: data.user,
							onComplete: async (detail: OnCompleteDetail) => {
								if (data.user && (detail as Record<string, unknown>).districtCommitment) {
									try {
										await fetch('/api/identity/verify-address', {
											method: 'POST',
											headers: { 'Content-Type': 'application/json' },
											body: JSON.stringify({
												district_commitment: (detail as Record<string, unknown>).districtCommitment,
												slot_count: (detail as Record<string, unknown>).commitmentSlotCount,
												verification_method: 'shadow_atlas',
											})
										});
									} catch { /* non-fatal */ }
								}
								const templateUrl = `/s/${selectedTemplate.slug}`;
								preloadData(templateUrl);
								goto(templateUrl);
							}
						});
						showMobilePreview = false;
					} else {
						const templateUrl = `/s/${selectedTemplate.slug}`;
						preloadData(templateUrl);
						setTimeout(() => {
							goto(templateUrl);
						}, 1200);
					}
				}}
			/>
		</div>
	</TouchModal>
{/if}

<!-- Template Creator Modal -->
{#if showTemplateCreator && creationContext}
	<SimpleModal
		maxWidth="max-w-4xl"
		showClose={false}
		closeOnBackdrop={false}
		onclose={() => {
			showTemplateCreator = false;
			creationContext = null;
			creationInitialText = '';
		}}
	>
		<TemplateCreator
			context={creationContext}
			{isSubmitting}
			initialText={creationInitialText}
			initialDraftId={resumeDraftId}
			bind:onSaveError={templateSaveError}
			onclose={() => {
				showTemplateCreator = false;
				creationContext = null;
				creationInitialText = '';
				resumeDraftId = '';
				templateSaveError = null;
			}}
			onsave={async (templateData) => {
				if (data.user) {
					templateSaveError = null;
					isSubmitting = true;

					// Optimistic: show share surface immediately
					// The slug is known — the URL is shareable from this moment
					showTemplateCreator = false;
					creationContext = null;
					creationInitialText = '';
					pendingPublishData = templateData;
					savedTemplate = { ...templateData, id: 'optimistic' } as Template;
					templatePublishing = true;
					templatePublishError = null;
					showTemplateSuccess = true;

					try {
						const newTemplate = await templateStore.addTemplate(templateData);
						savedTemplate = newTemplate;
					} catch (error) {
						templatePublishError =
							error instanceof Error ? error.message : 'Failed to publish template';
						console.error('Template save failed:', error);
					} finally {
						templatePublishing = false;
						isSubmitting = false;
					}
				} else {
					pendingTemplateToSave = templateData;
					showTemplateAuthModal = true;
				}
			}}
		/>
	</SimpleModal>
{/if}

<!-- Template Success Modal -->
{#if showTemplateSuccess && savedTemplate}
	<TemplateSuccessModal
		template={savedTemplate}
		publishing={templatePublishing}
		error={templatePublishError}
		onretry={handlePublishRetry}
		onsend={() => {
			const slug = savedTemplate?.slug;
			if (slug) {
				showTemplateSuccess = false;
				goto(`/s/${slug}`, { state: { fromPublish: true } });
			}
		}}
		onclose={() => {
			showTemplateSuccess = false;
			savedTemplate = null;
			templatePublishing = false;
			templatePublishError = null;
			pendingPublishData = null;
		}}
	/>
{/if}

<style>
	/*
	 * Activation Surface Layout
	 *
	 * Perceptual Engineering:
	 * - Split layout puts both affordances in immediate view
	 * - Creation on left (your voice), templates on right (together)
	 * - "How it works" below as progressive disclosure
	 *
	 * Responsive:
	 * - Desktop (>=1280px): Side-by-side split with full preview
	 * - Tablet/Mobile (<1280px): Stacked layout with full-width stream
	 *
	 * Key insight: Nested grids (activation-container > template-browser)
	 * need room to breathe. At 1024px, splitting creates cramped columns.
	 * Solution: delay split until 1280px where both grids have room.
	 */

	/*
	 * STICKY FIX: Container top padding for mobile/tablet only.
	 * Desktop (>=1280px): NO top padding - creation-column sticky locks at viewport edge.
	 * Mobile/tablet (<1280px): Top padding matches horizontal padding at each breakpoint.
	 */
	.activation-page {
		display: flex;
		flex-direction: column;
		gap: 3rem;
		min-height: 100vh;
		padding: 1rem 1rem 0; /* Top matches horizontal (1rem); no bottom padding */
		max-width: 1600px;
		margin: 0 auto;
	}

	@media (min-width: 640px) {
		.activation-page {
			padding: 1.5rem 1.5rem 0; /* Top matches horizontal (1.5rem) */
			gap: 4rem;
		}
	}

	@media (min-width: 1024px) {
		.activation-page {
			padding: 2rem 2rem 0; /* Top matches horizontal (2rem) */
		}
	}

	@media (min-width: 1280px) {
		.activation-page {
			padding: 0 2rem 0; /* NO top padding - sticky sidebar takes over */
		}
	}

	/* Main Container: Split Layout
	 *
	 * Key insight: The nested grids (activation-container > template-browser)
	 * need room to breathe. At tablet widths (1024-1279px), the split creates
	 * cramped nested columns. Solution: delay split until 1280px.
	 *
	 * Breakpoints:
	 * - <1280px: Stacked (mobile/tablet)
	 * - >=1280px: Side-by-side split
	 */
	.activation-container {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	@media (min-width: 1280px) {
		.activation-container {
			display: grid;
			grid-template-columns: minmax(340px, 420px) 1fr;
			gap: 3rem;
			align-items: start;
		}
	}

	@media (min-width: 1440px) {
		.activation-container {
			grid-template-columns: minmax(380px, 480px) 1fr;
			gap: 4rem;
		}
	}

	/* Creation Column */
	.creation-column {
		/* Container queries: children size relative to column width, not viewport */
		container-type: inline-size;
		container-name: creation;
		/* Mobile/Tablet: show as expandable card */
		padding: 1.5rem;
		border-radius: 16px;
		border: 1px solid oklch(0.9 0.02 250);
		background: white;
		box-shadow:
			0 1px 3px oklch(0 0 0 / 0.05),
			0 10px 30px -10px oklch(0.3 0.05 250 / 0.1);
	}

	@media (min-width: 1280px) {
		.creation-column {
			/* Desktop: sticky sidebar - locks immediately at viewport edge */
			position: sticky;
			top: 0;
			padding: 3rem 0 2rem 0; /* Top spacing + bottom for absolutely positioned footer */
			border: none;
			background: transparent;
			box-shadow: none;
			z-index: 10; /* Stay above scrolling content */
			overflow: visible; /* Allow RelayLoom expanded nodes to overflow */
		}
	}

	/* Stream Column */
	.stream-column {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
		container-type: inline-size;
		container-name: stream;
	}

	@media (min-width: 1280px) {
		.stream-column {
			padding-top: 3rem; /* Desktop: Match creation-column top spacing */
		}
	}

	/* Location Scope Row */
	.location-scope-row {
		padding: 0 0 0.5rem 0;
	}

	/* Template Browser Grid */
	.template-browser {
		display: grid;
		gap: 1.5rem;
		padding-bottom: 1.5rem;
	}

	@media (min-width: 768px) {
		.template-browser {
			grid-template-columns: 1fr 1.5fr;
			gap: 2rem;
			padding-bottom: 2rem;
		}
	}

	@media (min-width: 1024px) {
		.template-browser {
			grid-template-columns: minmax(280px, 340px) 1fr;
		}
	}

	.template-list-column {
		min-width: 0;
		position: relative;
		z-index: 1;
	}

	.template-preview-column {
		display: none;
	}

	@media (min-width: 768px) {
		.template-preview-column {
			display: block;
			min-width: 0;
			position: relative;
			z-index: 2;
		}
	}

	/* Stream Explainer - Spatially adjacent to coordination signals */
	.stream-explainer {
		margin-bottom: 0.5em;
		/* Mobile/Tablet (stacked layout): No top padding - creation column above provides clearance */
		padding-top: 0;
	}

	@media (min-width: 640px) {
		.stream-explainer {
			margin-bottom: 1.5rem;
		}
	}

	@media (min-width: 1280px) {
		.stream-explainer {
			/* Desktop side-by-side: Add padding for floating pill clearance
			 * (stream-column has 3rem + this 2.5rem = 5.5rem total clearance) */
			margin-bottom: 1.5rem;
			padding-top: 2.5rem;
		}
	}

	/* Creation Footer & Contact Link */
	.creation-footer {
		margin-top: auto;
		padding-top: 0.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	@media (min-width: 1280px) {
		.creation-footer {
			padding-top: 1.5rem;
			justify-content: flex-start;
		}
	}

	.creation-footer__sep {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: oklch(0.7 0.02 250);
		margin: 0 12px;
		flex-shrink: 0;
	}

	.contact-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: oklch(0.55 0.02 250);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		transition: color 200ms ease-out;
	}

	@media (min-width: 1280px) {
		.contact-link {
			font-size: 0.875rem;
		}
	}

	/* Org link: teal, arrow reveals on hover */
	.contact-link--org {
		color: oklch(0.5 0.04 180);
	}

	.contact-link--org:hover {
		color: oklch(0.38 0.08 180);
	}

	.link-arrow {
		width: 0;
		height: 1em;
		opacity: 0;
		transform: translateX(-4px);
		transition:
			opacity 200ms ease-out,
			transform 200ms ease-out,
			width 200ms ease-out;
		overflow: hidden;
	}

	.contact-link--org:hover .link-arrow {
		width: 1em;
		opacity: 1;
		transform: translateX(0);
	}

	/* Email link: underline reveals on hover */
	.contact-link--mailto .link-text {
		background-image: linear-gradient(currentColor, currentColor);
		background-size: 0% 1px;
		background-position: 0% 100%;
		background-repeat: no-repeat;
		transition: background-size 300ms ease-out;
	}

	.contact-link--mailto:hover {
		color: oklch(0.45 0.02 250);
	}

	.contact-link--mailto:hover .link-text {
		background-size: 100% 1px;
	}
</style>
