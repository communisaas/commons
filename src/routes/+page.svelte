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
	import { persistAddressCompletion } from '$lib/core/identity/address-completion-persistence';
	import { persistGroundVaultForAddress } from '$lib/core/identity/ground-vault-persistence';
	import type { ClientCellProofResult } from '$lib/core/shadow-atlas/browser-client';

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
				localStorage.setItem(SCOPE_KEY, JSON.stringify({ scope, timestamp: Date.now() }));
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
			getUserLocation()
				.then((inferred) => {
					// Only apply if user hasn't selected something in the meantime
					if (!selectedScope && inferred.country_code && inferred.confidence > 0) {
						const autoScope = inferredLocationToGeoScope(inferred);
						if (autoScope) {
							selectedScope = autoScope;
							scopeIsInferred = true;
							// Don't persist auto-inferred to localStorage — only user selections persist
						}
					}
				})
				.catch(() => {
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
			templatePublishError = err instanceof Error ? err.message : 'Failed to publish template';
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
		const scored = templates.map((t) => {
			const templateRecord = t as unknown as Record<string, unknown>;
			return {
				...t,
				...scoreTemplate(
					{
						send_count: t.send_count || 0,
						created_at: new Date(t.createdAt),
						updated_at: new Date((templateRecord.updatedAt as string) || t.createdAt)
					},
					now
				)
			};
		});
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
		streetAddress?: string;
		city?: string;
		state?: string;
		zip?: string;
		representatives?: unknown;
		districtCommitment?: string;
		commitmentSlotCount?: number;
		coordinates?: { lat: number; lng: number } | null;
		cellProof?: ClientCellProofResult | null;
		[key: string]: unknown;
	}

	function normalizeAddressDistrict(
		rawDistrict: string | null | undefined,
		state: string
	): string | null {
		if (!rawDistrict) return null;
		const district = rawDistrict.toUpperCase();
		if (/^[A-Z]{2}-(\d{1,2}|AL)$/.test(district)) {
			const [prefix, suffix] = district.split('-');
			return `${prefix}-${suffix === 'AL' ? 'AL' : suffix.padStart(2, '0')}`;
		}
		if (/^\d{1,2}$/.test(district)) return `${state}-${district.padStart(2, '0')}`;
		if (district === 'AL') return `${state}-AL`;
		return null;
	}

	function houseDistrictFromDetail(detail: OnCompleteDetail): string | null {
		if (!Array.isArray(detail.representatives)) return null;
		const state = typeof detail.state === 'string' ? detail.state.trim().toUpperCase() : '';
		for (const representative of detail.representatives) {
			if (!representative || typeof representative !== 'object') continue;
			const record = representative as Record<string, unknown>;
			const chamber = typeof record.chamber === 'string' ? record.chamber.toLowerCase() : '';
			const title = typeof record.title === 'string' ? record.title.toLowerCase() : '';
			const isHouse =
				chamber === 'house' ||
				(title.length > 0 && !title.includes('senator') && !title.includes('senate'));
			if (!isHouse) continue;
			const district = normalizeAddressDistrict(
				typeof record.district === 'string' ? record.district : null,
				state
			);
			if (district) return district;
		}
		return null;
	}

	function addressFromDetail(
		detail: OnCompleteDetail,
		districtOverride?: string | null
	): { street: string; city: string; state: string; zip: string; district?: string } | null {
		const street = detail.streetAddress?.trim();
		const city = detail.city?.trim();
		const state = detail.state?.trim().toUpperCase();
		const zip = detail.zip?.trim();
		if (!street || !city || !state || !zip) return null;
		const district =
			normalizeAddressDistrict(districtOverride, state) ?? houseDistrictFromDetail(detail);
		return {
			street,
			city,
			state,
			zip,
			...(district ? { district } : {})
		};
	}

	async function persistAttestedGround(
		userId: string,
		detail: OnCompleteDetail,
		verifyResult: { ground?: { source?: string | null } } | null,
		districtOverride?: string | null
	) {
		const address = addressFromDetail(detail, districtOverride);
		if (!address) return;
		const persisted = await persistGroundVaultForAddress({
			userId,
			address,
			ground: verifyResult?.ground ?? {},
			verificationMethod: verifyResult?.ground?.source ?? 'civic_api',
			coordinates: detail.coordinates,
			cellProof: detail.cellProof,
			migrationSource: 'address-modal'
		});
		if (!persisted) throw new Error('GROUND_VAULT_NOT_PERSISTED');
		await persistAddressCompletion(userId, detail, districtOverride);
	}

	function showGroundPersistenceFailure(error: unknown) {
		console.error('[HomePage] encrypted ground persistence failed:', error);
		if (browser) {
			window.alert(
				'Address verification could not finish because encrypted ground was not saved. Re-enter your address before sending.'
			);
		}
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

		const trustTier = ((data.user as Record<string, unknown> | null)?.trust_tier as number) ?? 0;
		const flow = analyzeEmailFlow(
			template,
			toEmailServiceUser(data.user as Record<string, unknown> | null),
			{ trustTier }
		);

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
							// H1 — trust-context spread shared across both branches below.
							const { readH1TrustContext } = await import(
								'$lib/core/identity/session-credentials'
							);
							const h1TrustContext = await readH1TrustContext(data.user.id);
							if (detail.districtCommitment) {
								const verifyRes = await fetch('/api/identity/verify-address', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({
										district_commitment: detail.districtCommitment,
										slot_count: detail.commitmentSlotCount,
										verification_method: 'shadow_atlas',
										// FU-1.1: forward coordinates so the server can recompute
										// the expected commitment from IPFS cell data.
										coordinates: detail.coordinates ?? undefined,
										...h1TrustContext
									})
								});
								const verifyResult = await verifyRes.json().catch(() => ({}));
								if (verifyRes.ok) {
									await persistAttestedGround(data.user.id, detail, verifyResult);
								} else {
									throw new Error(
										typeof verifyResult.error === 'string'
											? verifyResult.error
											: 'Address verification failed'
									);
								}
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
										const verifyRes = await fetch('/api/identity/verify-address', {
											method: 'POST',
											headers: { 'Content-Type': 'application/json' },
											body: JSON.stringify({
												district: resolved.district.code,
												verification_method: 'civic_api',
												officials: resolved.officials ?? [],
												...h1TrustContext
											})
										});
										const verifyResult = await verifyRes.json().catch(() => ({}));
										if (verifyRes.ok) {
											await persistAttestedGround(
												data.user.id,
												detail,
												verifyResult,
												resolved.district.code
											);
										} else {
											throw new Error(
												typeof verifyResult.error === 'string'
													? verifyResult.error
													: 'Address verification failed'
											);
										}
									}
								}
							}
						} catch (groundErr) {
							showGroundPersistenceFailure(groundErr);
							return;
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
	<title>Commons — public record for civic communication</title>
	<meta
		name="description"
		content="Commons is a public-record substrate for civic messages. Write a template, share a link, send to your representatives or other decision-makers. Sends are recorded; outcomes are not promised."
	/>
</svelte:head>

<section class="activation-page">
	<!-- Main Content: Split Layout -->
	<div class="activation-container">
		<!-- Left Column: Creation Spark + Minimal Footer -->
		<div class="creation-column">
			<CreationSpark onactivate={handleSparkActivate}>
				{#snippet context()}
					<footer class="creation-footer">
						<div class="creation-footer__row">
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
						</div>
						<a
							href="https://github.com/communisaas/commons"
							target="_blank"
							rel="noopener noreferrer"
							class="contact-link contact-link--source"
							aria-label="View the commons source code on GitHub"
						>
							<svg
								class="source-mark"
								viewBox="0 0 16 16"
								aria-hidden="true"
								focusable="false"
							>
								<path
									fill="currentColor"
									d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
								/>
							</svg>
							<span class="link-text">the commons is open source</span>
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
				<LocationScopeBar
					scope={selectedScope}
					inferred={scopeIsInferred}
					onScopeChange={handleScopeChange}
				/>
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
						<div class="border-y border-slate-200 px-6 py-8 text-center">
							<p class="font-brand text-base font-semibold text-slate-800">
								Templates aren't loading right now.
							</p>
							<p class="mt-2 font-brand text-sm text-slate-500">
								The list will return when the server responds.
							</p>
							<button
								type="button"
								onclick={() => templateStore.fetchTemplates()}
								data-testid="retry-templates-button"
								class="mt-4 rounded-lg border border-teal-500 px-4 py-2 font-brand text-sm font-medium text-teal-600 transition-colors hover:bg-teal-50"
							>
								Try again
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
						<div class="px-6 py-12 text-center">
							<p class="font-brand text-base font-semibold text-slate-800">
								No templates yet.
							</p>
							<p class="mt-2 font-brand text-sm text-slate-500">
								You can write the first one.
							</p>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>

<!-- Mobile Preview Modal -->
{#if showMobilePreview && selectedTemplate}
	<TouchModal onclose={() => (showMobilePreview = false)}>
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

					const mobileTrustTier =
						((data.user as Record<string, unknown> | null)?.trust_tier as number) ?? 0;
					const flow = analyzeEmailFlow(
						selectedTemplate,
						toEmailServiceUser(data.user as Record<string, unknown> | null),
						{ trustTier: mobileTrustTier }
					);

					if (flow.nextAction === 'address') {
						modalActions.openModal('address-modal', 'address', {
							template: selectedTemplate,
							source: 'mobile',
							user: data.user,
							onComplete: async (detail: OnCompleteDetail) => {
								// H1 — trust-context shared across both branches.
								const h1TrustContext = data.user
									? await (
											await import('$lib/core/identity/session-credentials')
										).readH1TrustContext(data.user.id)
									: {};
								if (data.user && detail.districtCommitment) {
									try {
										const verifyRes = await fetch('/api/identity/verify-address', {
											method: 'POST',
											headers: { 'Content-Type': 'application/json' },
											body: JSON.stringify({
												district_commitment: detail.districtCommitment,
												slot_count: detail.commitmentSlotCount,
												verification_method: 'shadow_atlas',
												// FU-1.1: forward coordinates for server-side authenticity check.
												coordinates: detail.coordinates ?? undefined,
												...h1TrustContext
											})
										});
										const verifyResult = await verifyRes.json().catch(() => ({}));
										if (verifyRes.ok) {
											await persistAttestedGround(data.user.id, detail, verifyResult);
										} else {
											throw new Error(
												typeof verifyResult.error === 'string'
													? verifyResult.error
													: 'Address verification failed'
											);
										}
									} catch (groundErr) {
										showGroundPersistenceFailure(groundErr);
										return;
									}
								} else if (data.user && detail.address) {
									try {
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
												const verifyRes = await fetch('/api/identity/verify-address', {
													method: 'POST',
													headers: { 'Content-Type': 'application/json' },
													body: JSON.stringify({
														district: resolved.district.code,
														verification_method: 'civic_api',
														officials: resolved.officials ?? [],
														...h1TrustContext
													})
												});
												const verifyResult = await verifyRes.json().catch(() => ({}));
												if (verifyRes.ok) {
													await persistAttestedGround(
														data.user.id,
														detail,
														verifyResult,
														resolved.district.code
													);
												} else {
													throw new Error(
														typeof verifyResult.error === 'string'
															? verifyResult.error
															: 'Address verification failed'
													);
												}
											}
										}
									} catch (groundErr) {
										showGroundPersistenceFailure(groundErr);
										return;
									}
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
		/* Mobile/Tablet: hairline-bordered region on the warm cream ground.
		   No bg-white (reserved for <Artifact>); no static box-shadow
		   (it lies about what's underneath); 8px radius max per
		   src/lib/design/DESIGN.md prohibitions. */
		padding: 1.5rem;
		border-radius: 8px;
		border: 1px solid oklch(0.9 0.02 250);
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
		/*
		 * Footer is a vertical stack of two related-but-distinct categories:
		 * (1) inline contact row, (2) the open-source credit. Column flex
		 * with a small gap keeps the credit visually anchored to the row
		 * above without merging the two into one wrapping line.
		 */
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
	}

	.creation-footer__row {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	@media (min-width: 1280px) {
		.creation-footer {
			padding-top: 1.5rem;
			align-items: flex-start;
		}

		.creation-footer__row {
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

	/*
	 * Source link: declarative credit, not a primary action.
	 *
	 * Visual tone sits between the neutral mailto and the teal --org —
	 * a touch dimmer than the cool grays around it so the eye reads it
	 * as a signature rather than an invitation. The github mark carries
	 * the destination signal; the text carries the statement.
	 *
	 * Hover warms toward the brand-mark amber (oklch 0.42 0.08 55, same
	 * hue/lightness as `.brand-mark` in CreationSpark) — a semantic
	 * gesture: touching "open source" reveals the brand identity color,
	 * binding the value to the project's name.
	 *
	 * The mark itself sits at 70% opacity in rest state so the text leads
	 * the read; hover lifts it to 100% to confirm "this goes to GitHub."
	 */
	.contact-link--source {
		color: oklch(0.6 0.015 250);
		gap: 0.4rem;
	}

	.source-mark {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		opacity: 0.7;
		transition:
			opacity 200ms ease-out,
			transform 200ms ease-out;
	}

	@media (min-width: 1280px) {
		.source-mark {
			width: 15px;
			height: 15px;
		}
	}

	.contact-link--source .link-text {
		background-image: linear-gradient(currentColor, currentColor);
		background-size: 0% 1px;
		background-position: 0% 100%;
		background-repeat: no-repeat;
		transition: background-size 300ms ease-out;
	}

	.contact-link--source:hover {
		color: oklch(0.42 0.08 55);
	}

	.contact-link--source:hover .source-mark {
		opacity: 1;
		transform: rotate(-4deg);
	}

	.contact-link--source:hover .link-text {
		background-size: 100% 1px;
	}

	.contact-link--source:focus-visible {
		outline: 2px solid oklch(0.55 0.15 195);
		outline-offset: 3px;
		border-radius: 2px;
	}

	@media (prefers-reduced-motion: reduce) {
		.source-mark {
			transition: none;
		}

		.contact-link--source:hover .source-mark {
			transform: none;
		}
	}
</style>
