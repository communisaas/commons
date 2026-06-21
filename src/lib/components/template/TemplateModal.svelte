<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	// import { browser } from '$app/environment';
	import { goto, invalidateAll } from '$app/navigation';
	import { fade, fly, scale, slide } from 'svelte/transition';
	import { quintOut, backOut, elasticOut } from 'svelte/easing';
	import { spring } from 'svelte/motion';
	import { page } from '$app/stores';
	import { decryptedUser } from '$lib/stores/decryptedUser.svelte';
	import { coordinated, useTimerCleanup } from '$lib/utils/timerCoordinator';
	import {
		X,
		Send,
		Eye as _Eye,
		Share2,
		Copy,
		CheckCircle2,
		ExternalLink,
		Sparkles as _Sparkles,
		ArrowRight,
		Heart as _Heart,
		Trophy as _Trophy,
		QrCode,
		Download,
		ShieldCheck,
		AlertCircle,
		MapPin,
		Fingerprint,
		Loader2,
		Smartphone
	} from '@lucide/svelte';
	import QRCode from 'qrcode';
	// import TemplateMeta from '$lib/components/template/TemplateMeta.svelte';
	// import MessagePreview from '$lib/components/landing/template/MessagePreview.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { Datum } from '$lib/design';
	import {
		modalActions,
		modalState as _modalState,
		isModalOpen as _isModalOpen
	} from '$lib/stores/modalSystem.svelte';
	import { analyzeEmailFlow, launchEmail } from '$lib/services/emailService';
	// import TemplatePreview from '$lib/components/landing/template/TemplatePreview.svelte';
	import SubmissionStatus from '$lib/components/submission/SubmissionStatus.svelte';

	import VerificationGate from '$lib/components/auth/VerificationGate.svelte';
	import ProofGenerator from '$lib/components/template/ProofGenerator.svelte';
	import AddressCollectionForm from '$lib/components/onboarding/AddressCollectionForm.svelte';
	import { isAnyMdlProtocolEnabled } from '$lib/config/features';
	import {
		storeConstituentAddress,
		getConstituentAddress
	} from '$lib/core/identity/constituent-address';
	import { getJurisdictionLabels } from '$lib/core/locale/jurisdiction';
	import { persistGroundVaultForAddress } from '$lib/core/identity/ground-vault-persistence';
	import { unlockGroundVaultWithPasskey } from '$lib/core/identity/ground-vault-unlock';
	import {
		credentialMeetsMinimumTier,
		getUsableProofCredential
	} from '$lib/core/identity/recovery-detector';
	import type { ClientCellProofResult } from '$lib/core/shadow-atlas/browser-client';
	import type { ComponentTemplate } from '$lib/types/component-props';
	import type { Representative } from '$lib/types/any-replacements';
	import type { Representative as ProviderRepresentative } from '$lib/core/legislative/types';

	let {
		template,
		user = null,
		initialState = undefined,
		onclose,
		onused
	}: {
		template: ComponentTemplate;
		user?: { id: string; name: string; trust_tier?: number } | null;
		initialState?: string;
		onclose?: () => void;
		onused?: (data: { templateId: string; action: 'mailto_opened' }) => void;
	} = $props();

	// Component ID for timer coordination
	const componentId = 'template-modal-' + Math.random().toString(36).substring(2, 15);

	// Modal States - access from modalActions (not a store, just a getter)
	const currentState = $derived(modalActions.modalState);
	const isAuthenticatedCongressional = $derived(
		template.deliveryMethod === 'cwc' && Boolean(user)
	);

	const jurisdictionLabels = getJurisdictionLabels();

	let showCopied = $state(false);
	let _showShareMenu = $state(false);
	let actionProgress = spring(0, { stiffness: 0.2, damping: 0.8 });
	let celebrationScale = spring(1, { stiffness: 0.3, damping: 0.6 });
	let submissionId = $state<string | null>(null);
	let proofSubmissionBlocked = $state<string | null>(null);

	// Verification gate state
	let showVerificationGate = $state(false);
	let verificationGateRef = $state<VerificationGate | null>(null);

	// Address collection state (for congressional templates)
	let needsAddress = $state(false);
	let collectingAddress = $state(false);
	/** Census Block GEOID from address verification (for three-tree ZK architecture) */
	let verifiedCellId = $state<string | undefined>(undefined);
	/** Structured address from AddressCollectionForm for ProofGenerator deliveryAddress */
	let verifiedAddress = $state<{
		street: string;
		city: string;
		state: string;
		zip: string;
		district?: string;
	} | null>(null);

	interface TemplateGroundState {
		vault?: {
			status?: string;
			ciphertext?: string;
			nonce?: string;
			aeadAssociatedData?: string;
		} | null;
		cell?: {
			cellId?: string | null;
			h3Cell?: string | null;
			districts?: string[] | null;
			source?: string | null;
		} | null;
		wrappers?: Array<{
			status?: string | null;
			passkeyCredentialId?: string | null;
			prfSalt?: string | null;
			wrappedDek?: string | null;
			hkdfInfo?: string | null;
		}> | null;
	}

	type DeliveryAddressState = 'ready' | 'locked' | 'reentry' | 'missing';

	let groundState = $state<TemplateGroundState | null>(null);
	let groundStateLoaded = $state(false);
	let groundStateLoading = $state(false);
	let groundStateError = $state<string | null>(null);
	let groundUnlocking = $state(false);
	let groundUnlockError = $state<string | null>(null);

	// Enhanced URL copy component state
	let copyButtonScale = spring(1, { stiffness: 0.4, damping: 0.8 });
	let copyButtonRotation = spring(0, { stiffness: 0.3, damping: 0.7 });
	let copyButtonGlow = $state(false);
	let copySuccessWave = $state(false);

	// QR code state
	let qrCodeDataUrl = $state<string>('');
	let showQRCode = $state(false);

	// Timestamp captured the first time we enter the celebration (sent) state
	let sentAt = $state<Date | null>(null);
	$effect(() => {
		if (currentState === 'celebration' && !sentAt) {
			sentAt = new Date();
		}
	});

	function formatSentAt(d: Date | null): string {
		if (!d) return '';
		const pad = (n: number) => n.toString().padStart(2, '0');
		const year = d.getUTCFullYear();
		const month = pad(d.getUTCMonth() + 1);
		const day = pad(d.getUTCDate());
		const hh = pad(d.getUTCHours());
		const mm = pad(d.getUTCMinutes());
		return `${year}-${month}-${day} at ${hh}:${mm} UTC`;
	}

	function deliveryMethodLabel(method: string | undefined): string {
		if (method === 'cwc') return `Through the ${jurisdictionLabels.legislativeAdjective} message system (CWC)`;
		if (method === 'certified') return 'Through certified delivery';
		if (method === 'email') return 'Direct email to the recipient';
		if (method === 'auth') return 'Through the authenticated message channel';
		return 'Through the configured delivery channel';
	}

	// Submission error message for error state UI
	let submissionError = $state<string | null>(null);

	// Trust-upgrade sub-state for address attestation interstitials.
	type TrustUpgradePhase = 'choice' | 'simulating';
	let trustUpgradePhase = $state<TrustUpgradePhase>('choice');

	// TODO: wire to delivery-worker SSE/polling response. Currently false because
	// delivery-worker runs via waitUntil() and the modal can't await its result; the
	// downstream UI block is gated behind this flag.
	let hasSenateDelivery = $state(false);

	// Generate share URL for template
	const shareUrl = $derived(`${$page.url.origin}/s/${template.slug}`);
	const activeGroundWrapperCount = $derived(
		groundState?.wrappers?.filter((wrapper) => wrapper.status === 'active').length ?? 0
	);
	const disclosedGroundCell = $derived(
		groundState?.cell?.h3Cell ?? groundState?.cell?.cellId ?? null
	);
	const disclosedGroundDistrict = $derived(
		verifiedAddress?.district ??
			($page.data?.user as { congressional_district?: string } | undefined)
				?.congressional_district ??
			groundState?.cell?.districts?.find((value) => value && !/^0x0+$/i.test(value)) ??
			null
	);
	const hasServerGroundVault = $derived(Boolean(groundState?.vault));
	const hasDisclosedGroundMetadata = $derived(Boolean(groundState?.cell));
	const deliveryAddressState = $derived.by((): DeliveryAddressState => {
		if (hasVerifiedDeliveryAddress()) return 'ready';
		if (hasServerGroundVault && activeGroundWrapperCount > 0) return 'locked';
		if (hasServerGroundVault || hasDisclosedGroundMetadata || groundStateLoaded) return 'reentry';
		return 'missing';
	});

	// Pre-written action-page messages for different contexts.
	const shareMessages = $derived(() => {
		const actionCount = numericCount(template.send_count);
		const domain = typeof template.domain === 'string' ? template.domain.toLowerCase() : 'advocacy';

		return {
			// Short & urgent (Twitter, Discord) - <280 chars
			short:
				actionCount > 1000
					? `🔥 ${actionCount.toLocaleString()}+ people confirming routes: "${template.title}"\n\n${shareUrl}`
					: `"${template.title}"\n\n${shareUrl}`,

			// Medium (Slack, group chats)
			medium: `Coordinating on ${domain}.\n\n"${template.title}"\n\n${actionCount > 0 ? `${actionCount.toLocaleString()} reader${actionCount === 1 ? '' : 's'} already confirmed. ` : ''}Open the action page to confirm your route: ${shareUrl}`,

			// Long (Email, Reddit)
			long: `I confirmed my route on this action page.\n\n"${template.title}"\n\n${template.description}\n\n${actionCount > 1000 ? `${actionCount.toLocaleString()}+ readers already confirmed. ` : actionCount > 100 ? `${actionCount.toLocaleString()} readers confirmed. ` : ''}Open the action page to confirm your route.\n\n${shareUrl}`,

			// SMS-friendly (under 160 chars)
			sms:
				actionCount > 0
					? `${template.title} - ${actionCount.toLocaleString()} confirmed: ${shareUrl}`
					: `${template.title} - confirm your route: ${shareUrl}`
		};
	});

	function numericCount(value: unknown): number {
		if (typeof value === 'number' && Number.isFinite(value)) return value;
		if (typeof value === 'string') {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		return 0;
	}

	function setVerifiedAddressFromStored(stored: Awaited<ReturnType<typeof getConstituentAddress>>) {
		if (!stored) return;
		verifiedAddress = {
			street: stored.street,
			city: stored.city,
			state: stored.state,
			zip: stored.zip,
			district: stored.district
		};
	}

	async function fetchGroundState(): Promise<TemplateGroundState | null> {
		const response = await fetch('/api/ground/state', {
			headers: { Accept: 'application/json' }
		});
		if (response.status === 401) return null;
		if (!response.ok) {
			throw new Error(`Ground state unavailable (${response.status})`);
		}
		return (await response.json()) as TemplateGroundState;
	}

	async function hydrateGroundForDelivery() {
		if (!user?.id) return;

		groundStateLoading = true;
		groundStateError = null;

		const [storedResult, groundResult] = await Promise.allSettled([
			getConstituentAddress(user.id),
			fetchGroundState()
		]);

		if (storedResult.status === 'fulfilled') {
			setVerifiedAddressFromStored(storedResult.value);
			if (storedResult.value) {
				console.log('[TemplateModal] Hydrated address from encrypted local store');
			}
		} else {
			console.warn('[TemplateModal] Failed to hydrate local address:', storedResult.reason);
		}

		if (groundResult.status === 'fulfilled') {
			groundState = groundResult.value;
			groundStateLoaded = true;
		} else {
			console.warn('[TemplateModal] Failed to load ground state:', groundResult.reason);
			groundStateError =
				groundResult.reason instanceof Error
					? groundResult.reason.message
					: 'Ground state unavailable';
			groundStateLoaded = false;
		}

		groundStateLoading = false;
	}

	// Store event handlers for proper cleanup
	let mailAppBlurHandler: (() => void) | null = null;
	let mailAppVisibilityHandler: (() => void) | null = null;

	// Initialize modal and auto-trigger mailto for ALL users (viral QR code flow)
	onMount(async () => {
		// Don't manipulate scroll here - UnifiedModal handles it
		// Don't call modalActions.open - parent component handles it

		// If initialState is provided, skip auto-routing and go directly to that state
		if (initialState) {
			console.log(`[TemplateModal] initialState="${initialState}" — skipping auto-routing`);
			modalActions.setState(
				initialState as import('$lib/stores/modalSystem.svelte').LegacyModalState
			);
			return;
		}

		// Congressional templates: guests get mailto relay, authenticated get ZKP/CWC
		if (template.deliveryMethod === 'cwc') {
			if (!user) {
				console.log('[TemplateModal] Guest on congressional template — mailto relay');
				handleUnifiedEmailFlow();
			} else if ((user.trust_tier ?? 0) >= 2) {
				// Tier 2+ means district proof exists. Delivery still needs the address
				// locally available, PRF-unlockable, or re-entered for the government POST.
				await hydrateGroundForDelivery();
				modalActions.setState('confirmation');
			} else {
				// Tier 1 (OAuth-only): needs address verification before ZKP
				console.log(
					`[TemplateModal] Tier ${user.trust_tier ?? 1} user on congressional — showing trust upgrade`
				);
				trustUpgradePhase = 'choice';
				modalActions.setState('trust-upgrade');
			}
			return;
		}

		// Trigger mailto for all users (authenticated or not)
		// This removes friction for viral template sharing via QR code
		// After they send, we'll prompt account creation if needed
		handleUnifiedEmailFlow();
	});

	onDestroy(() => {
		// Don't manipulate scroll here - UnifiedModal handles it
		useTimerCleanup(componentId)();

		// Clean up event listeners
		if (mailAppBlurHandler) {
			window.removeEventListener('blur', mailAppBlurHandler);
			mailAppBlurHandler = null;
		}
		if (mailAppVisibilityHandler) {
			document.removeEventListener('visibilitychange', mailAppVisibilityHandler);
			mailAppVisibilityHandler = null;
		}
	});

	function handleClose() {
		onclose?.();
	}

	async function handleUnifiedEmailFlow(_skipNavigation: boolean = false) {
		modalActions.setState('loading');

		// Reset and animate progress bar
		actionProgress.set(0);

		// Delay setting to 1 to allow animation
		coordinated.setTimeout(
			() => {
				actionProgress.set(1);
			},
			50,
			'progress',
			componentId
		);

		// Use unified email service
		const currentUser = $page.data?.user || user;

		// Populate credentialHash from IndexedDB for Tier 2+ users
		// so the email footer can include the verify URL
		let enrichedUser = currentUser;
		if (currentUser?.id && (currentUser.trust_tier ?? 0) >= 2) {
			try {
				const { getCredential } = await import('$lib/core/identity/credential-store');
				const credential = await getCredential(currentUser.id, 'district_residency');
				if (credential?.credentialHash) {
					enrichedUser = { ...currentUser, credentialHash: credential.credentialHash };
				}
			} catch (err) {
				console.warn('[TemplateModal] Failed to load credential hash:', err);
			}
		}

		const flow = analyzeEmailFlow(template, enrichedUser, {
			trustTier: enrichedUser?.trust_tier ?? 0
		});

		// Store mailto URL for later use
		if (flow.mailtoUrl) {
			modalActions.setMailtoUrl(flow.mailtoUrl);
		}

		// NOTE: Navigation removed from here - now happens after user confirms send
		// This prevents the race condition where navigation interrupts mailto

		// Show loading state briefly to let user understand what's happening
		coordinated.setTimeout(
			() => {
				if (flow.mailtoUrl) {
					// Launch email using unified service
					launchEmail(flow.mailtoUrl);

					// Dispatch for analytics — distinguish verified vs unverified (CI-003)
					onused?.({
						templateId: template.id,
						action: 'mailto_opened'
					});

					// Set up enhanced mail app detection
					setupEnhancedMailAppDetection();
				}
			},
			800,
			'modal',
			componentId
		); // Shorter delay since we're not navigating
	}

	function setupEnhancedMailAppDetection() {
		// Clean up any existing handlers first
		if (mailAppBlurHandler) {
			window.removeEventListener('blur', mailAppBlurHandler);
			mailAppBlurHandler = null;
		}
		if (mailAppVisibilityHandler) {
			document.removeEventListener('visibilitychange', mailAppVisibilityHandler);
			mailAppVisibilityHandler = null;
		}

		let hasDetectedSwitch = false;
		const detectionStartTime = Date.now();

		// Helper to transition to appropriate state
		const handleDetection = (detected: boolean) => {
			if (!hasDetectedSwitch) {
				hasDetectedSwitch = true;

				// Remove listeners immediately
				if (mailAppBlurHandler) {
					window.removeEventListener('blur', mailAppBlurHandler);
					mailAppBlurHandler = null;
				}
				if (mailAppVisibilityHandler) {
					document.removeEventListener('visibilitychange', mailAppVisibilityHandler);
					mailAppVisibilityHandler = null;
				}

				if (detected) {
					// Email client likely opened - show confirmation
					modalActions.setState('confirmation');
				} else {
					// No detection - show retry option
					modalActions.setState('retry_needed');
				}
			}
		};

		// Detect when user leaves browser (mail app opens)
		mailAppBlurHandler = () => {
			// Any blur within 3 seconds means email client opened
			if (Date.now() - detectionStartTime < 3000) {
				handleDetection(true);
			}
		};

		mailAppVisibilityHandler = () => {
			if (document.hidden && Date.now() - detectionStartTime < 3000) {
				handleDetection(true);
			}
		};

		// Add event listeners
		window.addEventListener('blur', mailAppBlurHandler);
		document.addEventListener('visibilitychange', mailAppVisibilityHandler);

		// OPTIMISTIC APPROACH: Assume mailto: worked unless we have evidence it didn't
		// Wait 2 seconds - if user never left the window, they might not have an email client configured
		coordinated.setTimeout(
			() => {
				if (!hasDetectedSwitch) {
					// CHANGED: Default to success (assume mailto: worked)
					// Only show error if window NEVER lost focus during the entire flow
					// This prevents false-negatives when user quickly returns to browser
					handleDetection(true);
				}
			},
			2000,
			'detection-timeout',
			componentId
		);

		// Final cleanup after reasonable time
		coordinated.setTimeout(
			() => {
				if (mailAppBlurHandler) {
					window.removeEventListener('blur', mailAppBlurHandler);
					mailAppBlurHandler = null;
				}
				if (mailAppVisibilityHandler) {
					document.removeEventListener('visibilitychange', mailAppVisibilityHandler);
					mailAppVisibilityHandler = null;
				}
			},
			5000,
			'cleanup',
			componentId
		);
	}

	/**
	 * Handle address collection complete
	 * AddressCollectionForm calls oncomplete() with a plain object (not CustomEvent).
	 * We parse the formatted address string into components and store locally
	 * (privacy-preserving: no server persistence of address).
	 */
	async function handleAddressComplete(data: {
		address: string;
		verified: boolean;
		streetAddress: string;
		city: string;
		state: string;
		zip: string;
		representatives?: Representative[] | ProviderRepresentative[];
		districtCommitment?: string;
		commitmentSlotCount?: number;
		coordinates?: { lat: number; lng: number } | null;
		addressToken?: string | null;
		addressHash?: string | null;
		cellProof?: ClientCellProofResult | null;
	}) {
		console.log('[Template Modal] Address complete:', {
			verified: data.verified,
			hasDistrictCommitment: typeof data.districtCommitment === 'string',
			hasCoordinates: Boolean(data.coordinates)
		});

		if (data.verified !== true) {
			verifiedAddress = null;
			collectingAddress = false;
			needsAddress = true;
			submissionError = `Address verification must complete before sending to ${jurisdictionLabels.legislativeBody}.`;
			modalActions.setState('error');
			return;
		}

		// Extract congressional district from verified representative data.
		// Supports DecisionMaker shapes (title field derives chamber)
		const houseRep = data.representatives?.find((r) => {
			if ('chamber' in r && r.chamber === 'house') return true;
			if ('title' in r && typeof r.title === 'string') {
				const t = r.title.toLowerCase();
				return !t.includes('senator') && !t.includes('senate');
			}
			return false;
		}) as Representative | undefined;
		if (!houseRep?.district) {
			verifiedAddress = null;
			collectingAddress = false;
			needsAddress = true;
			submissionError = `A ${jurisdictionLabels.legislativeAdjective} district could not be resolved for this address.`;
			modalActions.setState('error');
			return;
		}

		const rawDistrict = houseRep.district;
		// district may already be a full code like "CA-11" — extract the number suffix
		const districtNumber = rawDistrict.includes('-') ? rawDistrict.split('-').pop()! : rawDistrict;
		const district = `${data.state}-${districtNumber.toString().padStart(2, '0')}`;
		const nextVerifiedAddress = {
			street: data.streetAddress,
			city: data.city,
			state: data.state,
			zip: data.zip,
			district
		};

		// For authenticated users on CWC templates: attest address, then require proof.
		if (user?.id && template.deliveryMethod === 'cwc') {
			if (
				typeof data.districtCommitment !== 'string' ||
				!data.districtCommitment ||
				!data.coordinates ||
				typeof data.coordinates.lat !== 'number' ||
				typeof data.coordinates.lng !== 'number'
			) {
				verifiedAddress = null;
				collectingAddress = false;
				needsAddress = true;
				submissionError =
					'Address commitment could not be computed. Please retry address verification before sending.';
				modalActions.setState('error');
				return;
			}

			try {
				trustUpgradePhase = 'simulating';
				modalActions.setState('trust-upgrade');

				// Always call verify-address — even for Tier 2+ users re-entering address.
				// This updates district_hash, UserDMRelation, and credential on the server.
				// Without this, a user who moves districts keeps their old district forever.
				// H1: include trust-context (cellStraddles / cellAnchorMode / atlasVersion)
				// from session credential so the row carries it at issuance.
				const { readH1TrustContext } = await import('$lib/core/identity/session-credentials');
				const h1TrustContext = await readH1TrustContext(user.id);
				const verifyRes = await fetch('/api/identity/verify-address', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						district,
						verification_method: 'civic_api',
						officials: data.representatives,
						district_commitment: data.districtCommitment,
						slot_count: data.commitmentSlotCount,
						coordinates: data.coordinates,
						// F-2.4: forward the resolve-address token + hash when present.
						// Server requires both whenever address_hash is supplied; absence
						// keeps the legacy permissive path so non-AddressCollectionForm
						// callers (browser-geolocation flows) keep working.
						...(data.addressToken && data.addressHash
							? { address_token: data.addressToken, address_hash: data.addressHash }
							: {}),
						...h1TrustContext
					})
				});
				const verifyResult = await verifyRes.json();

				if (!verifyRes.ok || !verifyResult.success) {
					console.error('[Template Modal] verify-address failed:', verifyResult.error);
					verifiedAddress = null;
					collectingAddress = false;
					needsAddress = true;
					submissionError =
						verifyResult.error || 'Unable to verify this address. Please retry before sending.';
					modalActions.setState('error');
					return;
				}

				try {
					const persisted = await persistGroundVaultForAddress({
						userId: user.id,
						address: nextVerifiedAddress,
						ground: verifyResult.ground ?? {},
						verificationMethod: verifyResult.ground?.source ?? 'civic_api',
						coordinates: data.coordinates,
						cellProof: data.cellProof,
						migrationSource: 'template-delivery-reentry'
					});
					if (!persisted) {
						throw new Error('GROUND_VAULT_NOT_PERSISTED');
					}
				} catch (e) {
					console.warn('[Template Modal] Ground vault persistence failed:', e);
					verifiedAddress = null;
					collectingAddress = false;
					needsAddress = true;
					groundStateError =
						'Your district was attested, but encrypted ground could not be saved. Re-enter your address before official delivery.';
					submissionError = groundStateError;
					modalActions.setState('ground-restore');
					return;
				}

				// Retire stale address/proof caches after the new district is durable.
				try {
					const { clearConstituentAddress } =
						await import('$lib/core/identity/constituent-address');
					const { clearTreeState } = await import('$lib/core/identity/session-credentials');
					await Promise.all([clearConstituentAddress(user.id), clearTreeState(user.id)]);
				} catch (e) {
					console.error('[Template Modal] Critical cache retirement failed:', e);
					verifiedAddress = null;
					needsAddress = true;
					proofSubmissionBlocked =
						'Your prior proof credentials could not be retired. Please refresh and retry before sending.';
					submissionError = proofSubmissionBlocked;
					modalActions.setState('error');
					return;
				}

				try {
					const { invalidateLocationCaches } =
						await import('$lib/core/identity/cache-invalidation');
					await invalidateLocationCaches(user.id);
				} catch (e) {
					console.warn('[Template Modal] Location cache invalidation failed:', e);
				}

				// Persist encrypted in IndexedDB only after stale caches are retired.
				try {
					await storeConstituentAddress(user.id, nextVerifiedAddress);
				} catch (e) {
					console.warn('[Template Modal] Local address persistence failed:', e);
					verifiedAddress = null;
					collectingAddress = false;
					needsAddress = true;
					groundStateError =
						'Your encrypted ground was saved, but this device could not store the readable address. Re-enter before official delivery.';
					submissionError = groundStateError;
					modalActions.setState('ground-restore');
					return;
				}

				verifiedAddress = nextVerifiedAddress;
				collectingAddress = false;
				needsAddress = false;
				await hydrateGroundForDelivery();

				// Refresh server data so locals.user has updated district_hash
				await invalidateAll();

				modalActions.setState('confirmation');
			} catch (e) {
				console.error('[Template Modal] Address verification failed:', e);
				verifiedAddress = null;
				collectingAddress = false;
				needsAddress = true;
				submissionError = 'Unable to verify this address. Please retry before sending.';
				modalActions.setState('error');
			}
			return;
		}

		verifiedAddress = nextVerifiedAddress;
		collectingAddress = false;
		needsAddress = false;

		// Persist encrypted in IndexedDB — survives modal remounts and sessions
		if (user?.id) {
			storeConstituentAddress(user.id, { ...verifiedAddress, district }).catch((e) =>
				console.warn('[Template Modal] Address persistence failed:', e)
			);
		}

		// Non-CWC or guest address collection does not enter the proof pipeline.
		await handleUnifiedEmailFlow();
	}

	/**
	 * Submit Congressional message via ZK proof flow.
	 * Triggers ProofGenerator component for proof generation + encrypted submission.
	 */
	function submitCongressionalMessage() {
		console.log('[Template Modal] Starting ZKP submission flow');
		// Renders ProofGenerator (with autoStart) which handles:
		// credentials, proof generation, witness encryption, submission.
		// Errors dispatched via onerror callback → handleProofError.
		modalActions.setState('cwc-submission');
	}

	function hasVerifiedDeliveryAddress(): boolean {
		return Boolean(
			verifiedAddress?.street &&
			verifiedAddress.city &&
			verifiedAddress.state &&
			verifiedAddress.zip &&
			verifiedAddress.district
		);
	}

	function requireCongressionalDeliveryAddress(): boolean {
		if (hasVerifiedDeliveryAddress()) {
			return true;
		}

		needsAddress = true;
		if (deliveryAddressState === 'locked' || deliveryAddressState === 'reentry') {
			console.log(
				'[Template Modal] Delivery address is not locally readable; showing restore state'
			);
			collectingAddress = false;
			modalActions.setState('ground-restore');
			return false;
		}

		console.log(
			'[Template Modal] Congressional template needs address - showing inline collection'
		);
		collectingAddress = true;
		return false;
	}

	function beginAddressReentry() {
		submissionError = null;
		groundUnlockError = null;
		needsAddress = true;
		collectingAddress = true;
	}

	async function unlockSavedGroundAddress() {
		if (!groundState || !user?.id) return;

		groundUnlocking = true;
		groundUnlockError = null;
		try {
			const payload = await unlockGroundVaultWithPasskey(groundState);
			const address = {
				street: payload.address.street,
				city: payload.address.city,
				state: payload.address.state,
				zip: payload.address.zip,
				district: payload.district
			};
			verifiedAddress = address;
			await storeConstituentAddress(user.id, address);
			modalActions.setState('confirmation');
		} catch (e) {
			groundUnlockError = e instanceof Error ? e.message : 'Could not unlock saved address.';
		} finally {
			groundUnlocking = false;
		}
	}

	function normalizeDistrictCode(district: string | undefined): string | null {
		return district ? district.trim().toUpperCase() : null;
	}

	async function continueCongressionalProofFlow() {
		if (proofSubmissionBlocked) {
			submissionError = proofSubmissionBlocked;
			modalActions.setState('error');
			return;
		}

		if (!requireCongressionalDeliveryAddress()) {
			return;
		}

		if (!user?.id || !verificationGateRef) {
			submissionError = 'Verification is unavailable. Please refresh and try again before sending.';
			modalActions.setState('error');
			return;
		}

		const isVerified = await verificationGateRef.checkVerification();
		if (!isVerified) {
			showVerificationGate = true;
			return;
		}

		const credential = await getUsableProofCredential(user.id);
		if (!credential || !credentialMeetsMinimumTier(credential, 4)) {
			showVerificationGate = true;
			return;
		}

		const addressDistrict = normalizeDistrictCode(verifiedAddress?.district);
		const credentialDistrict = normalizeDistrictCode(credential.congressionalDistrict);
		if (addressDistrict && credentialDistrict && addressDistrict !== credentialDistrict) {
			try {
				const { clearTreeState } = await import('$lib/core/identity/session-credentials');
				await clearTreeState(user.id);
			} catch (e) {
				console.error('[Template Modal] Failed to retire mismatched proof credential:', e);
				proofSubmissionBlocked =
					'Your proof credentials no longer match your delivery address. Please refresh and retry before sending.';
				submissionError = proofSubmissionBlocked;
				modalActions.setState('error');
				return;
			}

			console.log('[Template Modal] Proof credential district differs from delivery address');
			showVerificationGate = true;
			return;
		}

		submitCongressionalMessage();
	}

	/**
	 * Handle verification complete from VerificationGate
	 * After user verifies, proceed with Congressional submission
	 */
	async function handleVerificationComplete(data: {
		userId: string;
		method: string;
		verified?: boolean;
	}) {
		console.log('[Template Modal] Verification complete, proceeding with submission:', data);
		showVerificationGate = false;

		if (data.verified === false) {
			submissionError = 'Verification did not complete. Please try again before sending.';
			modalActions.setState('error');
			return;
		}

		// Government-ID and recovery completions create the local proof material
		// needed by ProofGenerator. Do not route by stale server trust_tier props here.
		if (!data.method.startsWith('address:')) {
			await continueCongressionalProofFlow();
		} else {
			handleUnifiedEmailFlow();
		}

		// Celebration animation
		celebrationScale.set(1.05).then(() => celebrationScale.set(1));
	}

	/**
	 * Handle verification cancel from VerificationGate
	 * User cancelled verification - return to confirmation state
	 */
	function handleVerificationCancel() {
		console.log('[Template Modal] Verification cancelled');
		showVerificationGate = false;
		// Return to confirmation state so user can try again
		modalActions.setState('confirmation');
	}

	/**
	 * Handle proof generation complete
	 * Move to tracking state to show TEE processing + delivery
	 */
	function handleProofComplete(data: { submissionId: string }) {
		console.log('[Template Modal] Proof generation complete:', data);
		submissionId = data.submissionId;
		modalActions.setState('tracking');

		// Celebration animation
		celebrationScale.set(1.05).then(() => celebrationScale.set(1));
	}

	/**
	 * Handle proof generation cancel
	 * User cancelled proof generation - return to confirmation state
	 */
	function handleProofCancel() {
		console.log('[Template Modal] Proof generation cancelled');
		modalActions.setState('confirmation');
	}

	/**
	 * Handle proof generation error
	 * Show error and allow retry
	 */
	function handleProofError(data: { message: string }) {
		console.error('[Template Modal] Proof generation failed:', data.message);
		submissionError = data.message;
		modalActions.setState('error');
	}

	function handleProofReverify() {
		if (!hasVerifiedDeliveryAddress()) {
			console.log('[Template Modal] Delivery address required, opening address re-entry');
			beginAddressReentry();
			return;
		}
		console.log('[Template Modal] Credential expired, re-opening verification gate');
		showVerificationGate = true;
	}

	async function handleSendConfirmation(sent: boolean) {
		if (sent) {
			// Check if Congressional message (Phase 1: only these are verified)
			const isCongressional = template.deliveryMethod === 'cwc';

			// DEMO MODE: For guest users on non-Congressional (mailto) templates,
			// skip onboarding and go straight to celebration for viral QR code flow
			if (!user && !isCongressional) {
				console.log(
					'[Template Modal] Guest user confirmed send - proceeding to celebration (demo mode)'
				);

				// Go straight to celebration for mailto templates
				modalActions.confirmSend();

				// Navigate to template page after brief celebration
				coordinated.setTimeout(
					async () => {
						await goto(`/s/${template.slug}`, { replaceState: true });
					},
					1500,
					'transition',
					componentId
				);

				// Celebration animation
				celebrationScale.set(1.05).then(() => celebrationScale.set(1));
				return;
			}

			// Guest on congressional template: already sent via mailto relay.
			// Go to celebration with upgrade CTA (same as non-congressional guest path).
			if (!user && isCongressional) {
				console.log(
					'[Template Modal] Guest confirmed send on congressional — celebration + upgrade CTA'
				);

				modalActions.confirmSend();

				coordinated.setTimeout(
					async () => {
						await goto(`/s/${template.slug}`, { replaceState: true });
					},
					1500,
					'transition',
					componentId
				);

				celebrationScale.set(1.05).then(() => celebrationScale.set(1));
				return;
			}

			if (isCongressional) {
				// STEP 1: Check if user has address (for CWC delivery)
				// CWC requires full address encrypted into the ZKP witness.
				// Address is hydrated from encrypted IndexedDB on mount (Tier 2+)
				// or collected inline via AddressCollectionForm.
				if (!requireCongressionalDeliveryAddress()) {
					return; // Stop until address collected
				}

				// STEP 2: Progressive verification gate. If it passes, proof-grade
				// local credentials exist and we can enter the ZKP → TEE → CWC path.
				await continueCongressionalProofFlow();
			} else {
				// Non-Congressional messages use mailto — track the confirmed send
				// Fire-and-forget: don't block celebration on API response
				fetch('/api/positions/confirm-send', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ templateId: template.id })
				}).catch((err) => console.warn('[Template Modal] Confirm send tracking failed:', err));

				modalActions.confirmSend();

				// Navigate to template page after brief celebration
				coordinated.setTimeout(
					async () => {
						await goto(`/s/${template.slug}`, { replaceState: true });
					},
					1500,
					'direct-navigation',
					componentId
				);
			}

			// Celebration animation for both paths
			celebrationScale.set(1.05).then(() => celebrationScale.set(1));
		} else {
			// User didn't send, retry the flow
			modalActions.setState('loading');

			// Clean up existing event listeners before retry
			if (mailAppBlurHandler) {
				window.removeEventListener('blur', mailAppBlurHandler);
				mailAppBlurHandler = null;
			}
			if (mailAppVisibilityHandler) {
				document.removeEventListener('visibilitychange', mailAppVisibilityHandler);
				mailAppVisibilityHandler = null;
			}

			// Re-trigger the entire email flow with skipNavigation=true
			coordinated.setTimeout(
				() => {
					handleUnifiedEmailFlow(true); // Skip navigation on retry
				},
				100,
				'retry',
				componentId
			);
		}
	}

	// Universal share handler (native share or clipboard)
	async function handleUniversalShare() {
		const shareData = {
			title: template.title,
			text: shareMessages().medium,
			url: shareUrl
		};

		// Try native share first (mobile)
		if (navigator.share && navigator.canShare?.(shareData)) {
			try {
				await navigator.share(shareData);
				// Track share
				console.log('[Share] Native share used');
			} catch (err) {
				// User cancelled or error
				if (err instanceof Error && err.name !== 'AbortError') {
					console.error('[Share] Native share failed:', err);
				}
			}
		} else {
			// Fallback to clipboard (desktop)
			await copyMessage(shareMessages().medium);
		}
	}

	// Copy message to clipboard
	async function copyMessage(message: string) {
		try {
			await navigator.clipboard.writeText(`${message}\n\n${shareUrl}`);
			showCopied = true;
			coordinated.setTimeout(
				() => {
					showCopied = false;
				},
				3000,
				'copy-hide',
				componentId
			);
		} catch {
			console.warn('Clipboard copy failed');
		}
	}

	// Copy just the URL
	async function copyTemplateUrl() {
		try {
			// Trigger press animation
			copyButtonScale.set(0.95);
			copyButtonRotation.set(-2);
			copyButtonGlow = true;

			// Copy to clipboard
			await navigator.clipboard.writeText(shareUrl);

			// Success animation sequence
			coordinated.setTimeout(
				() => {
					copyButtonScale.set(1.02);
					copyButtonRotation.set(2);
					copySuccessWave = true;
					showCopied = true;
				},
				100,
				'copy-success',
				componentId
			);

			// Reset to normal
			coordinated.setTimeout(
				() => {
					copyButtonScale.set(1);
					copyButtonRotation.set(0);
					copyButtonGlow = false;
				},
				300,
				'copy-reset',
				componentId
			);

			// Hide success state
			coordinated.setTimeout(
				() => {
					showCopied = false;
					copySuccessWave = false;
				},
				3000,
				'copy-hide',
				componentId
			);
		} catch {
			console.warn('Error occurred');
		}
	}

	// Generate QR code
	async function loadQRCode() {
		if (!qrCodeDataUrl) {
			try {
				qrCodeDataUrl = await QRCode.toDataURL(shareUrl, {
					width: 300,
					margin: 2,
					color: {
						dark: '#1E293B',
						light: '#FFFFFF'
					}
				});
			} catch (err) {
				console.error('QR code generation failed:', err);
			}
		}
		showQRCode = true;
	}

	// Download QR code as PNG
	function downloadQRCode() {
		if (!qrCodeDataUrl) return;

		const a = document.createElement('a');
		a.href = qrCodeDataUrl;
		a.download = `${template.slug}-qr-code.png`;
		a.click();
	}

	// TODO: poll submission delivery status from TEE confirmation endpoint
</script>

<!-- Modal Content (no backdrop - UnifiedModal handles that) -->
<div class="flex max-h-[90vh] w-full flex-col overflow-clip" role="document" tabindex="-1">
	<!-- Dynamic Content Based on State -->
	{#if currentState === 'loading'}
		<!-- Loading State - mailto is being resolved -->
		<div class="p-6 text-center sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<div
				class="bg-participation-primary-100 mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full sm:mb-6 sm:h-20 sm:w-20"
				style="transform: scale({$celebrationScale})"
			>
				<Send class="text-participation-primary-600 h-8 w-8 sm:h-10 sm:w-10" />
			</div>
			<h3 class="mb-2 text-xl font-bold text-slate-900 sm:text-2xl">Preparing message...</h3>
			<p class="mb-4 text-sm text-slate-600 sm:mb-6 sm:text-base">
				Opening your email with pre-filled message.
			</p>

			<!-- Animated progress indicator -->
			<div class="mx-auto h-2 w-32 overflow-hidden rounded-full bg-slate-200">
				<div
					class="from-participation-primary-500 to-participation-primary-700 h-full rounded-full bg-gradient-to-r transition-all duration-1000 ease-out"
					style="width: {$actionProgress * 100}%"
				></div>
			</div>
		</div>
	{:else if currentState === 'confirmation'}
		<!-- Send Confirmation State - Did user actually send? -->
		<div class="relative p-6 text-center sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute top-4 right-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			<div
				class="bg-participation-primary-100 mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full sm:mb-6 sm:h-20 sm:w-20"
			>
				<Send class="text-participation-primary-600 h-8 w-8 sm:h-10 sm:w-10" />
			</div>
			<h3 class="mb-2 text-xl font-bold text-slate-900 sm:text-2xl">
				{isAuthenticatedCongressional ? 'Send officially?' : 'Did you send it?'}
			</h3>
			<p class="mb-4 text-sm text-slate-600 sm:mb-6 sm:text-base">
				{#if isAuthenticatedCongressional}
					{jurisdictionLabels.legislativeBody} requires your name, email, and address for official delivery. We decrypt
					the address only for this send.
				{:else}
					Confirm to track this action.
				{/if}
			</p>

			<div class="flex justify-center gap-2 sm:gap-3">
				<Button
					variant="primary"
					size="lg"
					classNames="flex-1 min-w-[120px] sm:min-w-[140px] whitespace-nowrap"
					onclick={() => handleSendConfirmation(true)}
				>
					<CheckCircle2 class="mr-2 h-5 w-5 shrink-0" />
					{isAuthenticatedCongressional ? 'Send officially' : 'Yes, sent'}
				</Button>
				<Button
					variant="secondary"
					size="lg"
					classNames="flex-1 min-w-[120px] sm:min-w-[140px] whitespace-nowrap"
					onclick={() =>
						isAuthenticatedCongressional ? handleClose() : handleSendConfirmation(false)}
				>
					<ArrowRight class="mr-2 h-5 w-5 shrink-0 rotate-180" />
					{isAuthenticatedCongressional ? 'Not now' : 'Try again'}
				</Button>
			</div>
		</div>
	{:else if currentState === 'retry_needed'}
		<!-- Retry Needed State - Email client didn't open -->
		<div class="relative p-6 text-center sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute top-4 right-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			<div
				class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 sm:mb-6 sm:h-20 sm:w-20"
			>
				<ExternalLink class="h-8 w-8 text-amber-600 sm:h-10 sm:w-10" />
			</div>
			<h3 class="mb-2 text-xl font-bold text-slate-900 sm:text-2xl">Email client didn't open</h3>
			<p class="mb-4 text-sm text-slate-600 sm:mb-6 sm:text-base">
				Your email app may not be configured. Would you like to try again or copy the message
				instead?
			</p>

			<div class="flex flex-col gap-3">
				<Button
					variant="primary"
					size="lg"
					classNames="w-full"
					onclick={() => handleUnifiedEmailFlow(true)}
				>
					<Send class="mr-2 h-5 w-5" />
					Try opening email again
				</Button>

				<button
					onclick={() => {
						// Navigate to template page where they can see/copy the message
						goto(`/s/${template.slug}`);
						handleClose();
					}}
					class="text-sm text-slate-600 underline hover:text-slate-800"
				>
					View template to copy message manually
				</button>
			</div>
		</div>
	{:else if currentState === 'celebration'}
		<!-- Sent state: plain receipt -->
		<div class="flex h-full flex-col">
			<!-- Receipt header -->
			<div class="border-b border-slate-200 p-6">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
						>
							<CheckCircle2 class="h-5 w-5 text-slate-700" />
						</div>
						<div>
							<h2 class="text-lg font-semibold text-slate-900">Sent</h2>
							<p class="text-sm text-slate-600">Your message has been sent.</p>
						</div>
					</div>
					<button
						onclick={handleClose}
						aria-label="Close"
						class="rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
					>
						<X class="h-5 w-5" />
					</button>
				</div>
			</div>

			<!-- Receipt body -->
			<div class="flex-1 space-y-6 overflow-y-auto p-6">
				<!-- Plain receipt: what, when, how, count -->
				<div class="rounded-lg border border-slate-200 bg-white p-4">
					<dl class="space-y-3 text-sm">
						<div>
							<dt class="text-xs font-medium tracking-wide text-slate-500 uppercase">
								What was sent
							</dt>
							<dd class="mt-1 text-slate-900">{template.title}</dd>
						</div>
						<div>
							<dt class="text-xs font-medium tracking-wide text-slate-500 uppercase">When</dt>
							<dd class="mt-1 font-mono tabular-nums text-slate-900">
								Sent {formatSentAt(sentAt)}
							</dd>
						</div>
						<div>
							<dt class="text-xs font-medium tracking-wide text-slate-500 uppercase">How</dt>
							<dd class="mt-1 text-slate-900">
								{deliveryMethodLabel(template.deliveryMethod)}
							</dd>
						</div>
						<div>
							<dt class="text-xs font-medium tracking-wide text-slate-500 uppercase">
								Send count
							</dt>
							<dd class="mt-1 text-slate-900">
								<Datum
									value={numericCount(template.send_count)}
									class="text-base text-slate-900"
								/>
							</dd>
						</div>
						<!-- TODO: surface receipt hash when receipt-generation lands -->
					</dl>
				</div>

				<!-- Upgrade CTAs (mutually exclusive: guest → auth, tier 1 → address verification) -->
				{#if !user}
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p class="mb-1 text-sm font-semibold text-slate-900">
							{template.deliveryMethod === 'cwc'
								? 'Verified-constituent delivery requires an account.'
								: 'Track delivery and review past sends with an account.'}
						</p>
						<p class="mb-3 text-xs text-slate-700">
							{template.deliveryMethod === 'cwc'
								? `Verified messages route through CWC with constituent-status confirmation. Account creation is free.`
								: 'An account lets you track delivery and review past sends. Account creation is free.'}
						</p>
						<button
							onclick={() => {
								onclose?.();
								modalActions.openModal('onboarding-modal', 'onboarding', {
									template,
									source: 'post-send-upgrade' as const,
									skipDirectSend: true
								});
							}}
							class="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
						>
							Create account
						</button>
					</div>
				{:else if user && (user.trust_tier ?? 0) < 2}
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p class="mb-1 text-sm font-semibold text-slate-900">Verify your address.</p>
						<p class="mb-3 text-xs text-slate-700">
							Address verification establishes your district. The {jurisdictionLabels.legislativeBody}
							office uses district to route and prioritise constituent messages.
						</p>
						<button
							onclick={() => {
								onclose?.();
								modalActions.openModal('address-modal', 'address', {
									template,
									source: 'post-send-tier-upgrade'
								});
							}}
							class="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
						>
							Verify address
						</button>
					</div>
				{:else if user && (user.trust_tier ?? 0) === 2 && template.deliveryMethod === 'cwc'}
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p class="mb-1 text-sm font-semibold text-slate-900">
							Identity verification enables cryptographic delivery.
						</p>
						<p class="mb-3 text-xs text-slate-700">
							This message was delivered as a constituent. Identity verification lets the next send
							carry a zero-knowledge proof of constituent status.
						</p>
						<button
							onclick={() => {
								onclose?.();
								if (user?.id) {
									modalActions.openModal('identity-verification-modal', 'identity-verification', {
										userId: user.id,
										userEmail: decryptedUser.email ?? undefined,
										templateSlug: template.slug,
										onComplete: async () => {
											await invalidateAll();
										}
									});
								}
							}}
							class="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
						>
							Verify identity
						</button>
					</div>
				{:else if user && (user.trust_tier ?? 0) === 3 && template.deliveryMethod === 'cwc'}
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<p class="mb-1 text-sm font-semibold text-slate-900">
							Identity verified. Proof delivery is available on the next send.
						</p>
						<p class="text-xs text-slate-700">
							The next send can attach a district proof and a delivery receipt.
						</p>
					</div>
				{/if}

				<!-- Share -->
				<div class="space-y-3">
					<button
						onclick={handleUniversalShare}
						class="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50"
					>
						<Share2 class="h-5 w-5" />
						<span
							>{typeof navigator !== 'undefined' && 'share' in navigator
								? 'Share action page'
								: 'Copy action page message'}</span
						>
					</button>
				</div>

				{#if showCopied}
					<div
						class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-center text-sm text-slate-700"
						in:fade={{ duration: 200 }}
						out:fade={{ duration: 200 }}
					>
						Copied to clipboard.
					</div>
				{/if}

				<!-- QR code -->
				<button
					onclick={loadQRCode}
					class="w-full text-sm text-slate-600 underline hover:text-slate-900"
				>
					<QrCode class="mr-1 inline h-4 w-4" />
					Show QR code for in-person sharing
				</button>

				{#if showQRCode && qrCodeDataUrl}
					<div class="rounded-lg border border-slate-200 bg-white p-4" in:fade={{ duration: 300 }}>
						<img src={qrCodeDataUrl} alt="QR code for {template.title}" class="mx-auto" />
						<p class="mt-2 mb-3 text-center text-xs text-slate-600">Print for in-person sharing.</p>
						<button
							onclick={downloadQRCode}
							class="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Download class="h-4 w-4" />
							Download for printing
						</button>
					</div>
				{/if}

				<!-- Raw URL -->
				<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
					<input
						type="text"
						readonly
						value={shareUrl}
						onclick={(e) => e.currentTarget.select()}
						class="mb-2 w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700"
					/>
					<div class="flex items-center justify-between text-xs text-slate-500">
						<span>Action page URL</span>
						<button onclick={copyTemplateUrl} class="text-slate-700 hover:underline">
							Copy action page
						</button>
					</div>
				</div>

				<!-- Senate delivery verification (only if actual Senate submission) -->
				{#if hasSenateDelivery}
					<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
						<div class="mb-2 flex items-center gap-2">
							<CheckCircle2 class="h-4 w-4 text-slate-700" />
							<p class="text-sm font-semibold text-slate-900">Senate delivery confirmed</p>
						</div>
						<p class="mb-2 text-xs text-slate-700">
							Delivered through the official Senate messaging system.
						</p>
						<a
							href="https://soapbox.senate.gov/api"
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
						>
							<ExternalLink class="h-3 w-3" />
							soapbox.senate.gov/api
						</a>
					</div>
				{/if}
			</div>
		</div>
	{:else if currentState === 'ground-restore'}
		<!-- Ground restore: verified proof exists, delivery address is not readable locally -->
		<div class="relative p-6 sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<button
				onclick={handleClose}
				class="absolute top-4 right-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			<div class="mb-6 text-center">
				<div
					class="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-100"
				>
					<MapPin class="h-7 w-7 text-slate-600" />
				</div>
				{#if groundStateLoading}
					<h3 class="mb-1 text-xl font-bold text-slate-900">Checking saved address</h3>
					<p class="text-sm text-slate-500">Looking for a readable address on this device.</p>
				{:else if deliveryAddressState === 'locked'}
					<h3 class="mb-1 text-xl font-bold text-slate-900">Saved address is locked</h3>
					<p class="text-sm text-slate-500">
						Your district proof is active, but this browser cannot read the saved address right now.
						{jurisdictionLabels.legislativeBody} requires address fields for official delivery.
					</p>
				{:else}
					<h3 class="mb-1 text-xl font-bold text-slate-900">Address needs re-entry</h3>
					<p class="text-sm text-slate-500">
						Your district proof is active, but this device does not have the address needed for
						official delivery.
					</p>
				{/if}
			</div>

			{#if disclosedGroundDistrict || disclosedGroundCell}
				<div class="mb-5 rounded-md border border-slate-200 bg-slate-50 p-4 text-left">
					<p class="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
						Disclosed location
					</p>
					<div class="space-y-1 text-sm text-slate-700">
						{#if disclosedGroundDistrict}
							<p>District: {disclosedGroundDistrict}</p>
						{/if}
						{#if disclosedGroundCell}
							<p>Cell: {disclosedGroundCell}</p>
						{/if}
					</div>
				</div>
			{/if}

			{#if groundUnlockError}
				<p class="mb-4 text-center text-sm text-amber-700">{groundUnlockError}</p>
			{:else if groundStateError}
				<p class="mb-4 text-center text-sm text-amber-700">{groundStateError}</p>
			{/if}

			<div class="flex flex-col gap-3">
				{#if deliveryAddressState === 'locked'}
					<Button
						variant="primary"
						size="lg"
						classNames="w-full"
						disabled={groundUnlocking}
						onclick={unlockSavedGroundAddress}
					>
						<Fingerprint class="mr-2 h-5 w-5" />
						{groundUnlocking ? 'Unlocking...' : 'Unlock saved address'}
					</Button>
				{/if}
				<Button
					variant={deliveryAddressState === 'locked' ? 'secondary' : 'primary'}
					size="lg"
					classNames="w-full"
					onclick={beginAddressReentry}
				>
					<MapPin class="mr-2 h-5 w-5" />
					Re-enter address
				</Button>
				<Button
					variant="secondary"
					size="lg"
					classNames="w-full"
					disabled={groundStateLoading}
					onclick={async () => {
						await hydrateGroundForDelivery();
						if (hasVerifiedDeliveryAddress()) {
							await continueCongressionalProofFlow();
						}
					}}
				>
					<ArrowRight class="mr-2 h-5 w-5" />
					Check this device again
				</Button>
			</div>
		</div>
	{:else if collectingAddress}
		<!-- Address Collection State - Inline for Congressional templates -->
		<div class="relative p-6 sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute top-4 right-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			<AddressCollectionForm
				_template={{
					title: template.title,
					deliveryMethod: template.deliveryMethod
				}}
				oncomplete={handleAddressComplete}
			/>
		</div>
	{:else if currentState === 'trust-upgrade'}
		<!-- Trust Upgrade — graduated trust with shared verification gate -->
		<div class="relative p-6 sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<button
				onclick={() => {
					trustUpgradePhase = 'choice';
					handleClose();
				}}
				class="absolute top-4 right-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			{#if trustUpgradePhase === 'choice'}
				<!-- Phase 1: Choice — strengthen signal -->
				<div class="mb-6 text-center">
					<div
						class="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-100"
					>
						<ShieldCheck class="h-7 w-7 text-slate-600" />
					</div>
					<h3 class="mb-1 text-xl font-bold text-slate-900">Strengthen your signal</h3>
					<p class="text-sm text-slate-500">
						{jurisdictionLabels.legislativeBody} delivery requires a verified district and a readable address
					</p>
				</div>

				<div class="space-y-3">
					{#if isAnyMdlProtocolEnabled()}
						<!-- mDL: Highest signal — verify with digital ID -->
						<button
							onclick={() => {
								if (!requireCongressionalDeliveryAddress()) return;
								showVerificationGate = true;
							}}
							class="group flex w-full items-center gap-4 rounded-md border-2 border-emerald-200 bg-slate-50 p-4 text-left transition-all hover:border-emerald-300 hover:shadow-md"
						>
							<div
								class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100"
							>
								<Smartphone class="h-5 w-5 text-emerald-600" />
							</div>
							<div class="min-w-0 flex-1">
								<span class="block text-sm font-semibold text-emerald-900"
									>Verify with Digital ID</span
								>
								<span class="block text-xs text-emerald-600"
									>Adds a stronger proof when available.</span
								>
							</div>
							<ArrowRight
								class="h-4 w-4 shrink-0 text-emerald-400 transition-transform group-hover:translate-x-0.5"
							/>
						</button>
					{/if}

					<!-- Address: Primary CTA — available now, resolves the tension -->
					<button
						onclick={() => {
							collectingAddress = true;
						}}
						class="group flex w-full items-center gap-4 rounded-md border-2 border-emerald-200 bg-emerald-50 p-4 text-left transition-all hover:border-emerald-300 hover:shadow-md"
					>
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100"
						>
							<MapPin class="h-5 w-5 text-emerald-600" />
						</div>
						<div class="min-w-0 flex-1">
							<span class="block text-sm font-semibold text-emerald-900">Verify your address</span>
							<span class="block text-xs text-emerald-600"
								>Confirms your district for official delivery.</span
							>
						</div>
						<ArrowRight
							class="h-4 w-4 shrink-0 text-emerald-400 transition-transform group-hover:translate-x-0.5"
						/>
					</button>

					<!-- Divider -->
					<div class="flex items-center gap-3 py-0.5">
						<div class="h-px flex-1 bg-slate-200"></div>
						<span class="text-[10px] font-medium tracking-wider text-slate-400 uppercase">or</span>
						<div class="h-px flex-1 bg-slate-200"></div>
					</div>

					<!-- Email: Quiet escape hatch — still valid, just lower signal -->
					<button
						onclick={() => handleUnifiedEmailFlow()}
						class="group flex w-full items-center gap-4 rounded-md border border-slate-200 bg-white p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm"
					>
						<div
							class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100"
						>
							<Send class="h-5 w-5 text-slate-500" />
						</div>
						<div class="min-w-0 flex-1">
							<span class="block text-sm font-medium text-slate-700">Send now via email</span>
							<span class="block text-xs text-slate-500"
								>Named sender. Lower priority but still delivered.</span
							>
						</div>
						<ArrowRight
							class="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
						/>
					</button>
				</div>
			{:else if trustUpgradePhase === 'simulating'}
				<!-- Address attestation interstitial -->
				<div class="flex flex-col items-center justify-center py-8" in:fade={{ duration: 200 }}>
					<div class="relative mb-6">
						<div class="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
							<Fingerprint class="h-10 w-10 text-emerald-600" />
						</div>
						<div
							class="absolute -right-1 -bottom-1 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md"
						>
							<Loader2 class="h-5 w-5 animate-spin text-emerald-600" />
						</div>
					</div>
					<p class="text-lg font-semibold text-slate-900">Verifying credential...</p>
					<p class="mt-2 text-sm text-slate-500">Bootstrapping cryptographic identity</p>
				</div>
			{/if}
		</div>
	{:else if currentState === 'cwc-submission'}
		<!-- ZKP Proof Generation & Submission State -->
		<div class="flex h-full flex-col">
			<!-- Header -->
			<div class="border-b border-slate-100 p-6">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-100"
							style="transform: scale({$celebrationScale})"
						>
							<ShieldCheck class="h-5 w-5 text-blue-600" />
						</div>
						<div>
							<h2 class="text-lg font-semibold text-slate-900">Securing your message</h2>
							<p class="text-sm text-slate-600">Generating zero-knowledge proof</p>
						</div>
					</div>
					<button
						onclick={handleClose}
						class="rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
					>
						<X class="h-5 w-5" />
					</button>
				</div>
			</div>

			<!-- Proof Generator Component -->
			<div class="flex-1 overflow-y-auto p-6">
				{#if user?.id}
					<ProofGenerator
						userId={user.id}
						templateId={template.id}
						templateData={{
							subject: template.title,
							message: template.message_body || template.description,
							recipientOffices: (() => {
								const config = template.recipient_config as Record<string, unknown> | undefined;
								const chambers = config?.chambers as string[] | undefined;
								return chambers ?? ['Senate', 'House'];
							})()
						}}
						deliveryAddress={verifiedAddress
							? {
									name: decryptedUser.name || user.name || 'Constituent',
									email: decryptedUser.email || $page.data?.user?.email || '',
									street: verifiedAddress.street,
									city: verifiedAddress.city,
									state: verifiedAddress.state,
									zip: verifiedAddress.zip,
									congressional_district: $page.data?.user?.congressional_district || undefined
								}
							: undefined}
						autoStart={true}
						oncomplete={(data) => handleProofComplete(data)}
						oncancel={() => handleProofCancel()}
						onreverify={() => handleProofReverify()}
						onerror={(data) => handleProofError(data)}
					/>
				{:else}
					<div class="flex flex-col items-center justify-center py-12 text-center">
						<AlertCircle class="mb-4 h-12 w-12 text-amber-500" />
						<h3 class="mb-2 text-lg font-semibold text-slate-900">Authentication Required</h3>
						<p class="mb-6 text-sm text-slate-600">
							Sign in to send verified messages to {jurisdictionLabels.legislativeBody}.
						</p>
						<div class="flex gap-3">
							<Button variant="secondary" size="lg" onclick={handleClose}>Cancel</Button>
							<Button
								variant="primary"
								size="lg"
								onclick={() => {
									onclose?.();
									modalActions.openModal('onboarding-modal', 'onboarding', {
										template,
										source: 'template-modal' as const,
										skipDirectSend: true
									});
								}}
							>
								Sign in to continue
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{:else if currentState === 'tracking'}
		<!-- Agent Processing Tracking State -->
		<div class="flex h-full flex-col">
			<!-- Header -->
			<div class="border-b border-slate-100 p-6">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="bg-participation-primary-100 inline-flex h-10 w-10 items-center justify-center rounded-full"
							style="transform: scale({$celebrationScale})"
						>
							<Send class="text-participation-primary-600 h-5 w-5" />
						</div>
						<div>
							<h2 class="text-lg font-semibold text-slate-900">Message sent</h2>
							<p class="text-sm text-slate-600">Tracking delivery</p>
						</div>
					</div>
					<button
						onclick={() => {
							// Navigate to template page when closing tracking
							goto(`/s/${template.slug}`, { replaceState: true });
							handleClose();
						}}
						class="rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
					>
						<X class="h-5 w-5" />
					</button>
				</div>
			</div>

			<!-- Submission Status -->
			<div class="flex-1 p-6">
				{#if submissionId}
					<SubmissionStatus
						{submissionId}
						initialStatus="sending"
						onDelivered={() => {
							// Auto-transition to celebration when delivery confirms
							// No auto-navigate: let user interact with share/celebration UI
							modalActions.setState('celebration');
						}}
						onOverride={() => {
							// Allow user to bypass agent processing
							modalActions.setState('celebration');

							// Still navigate after a delay
							coordinated.setTimeout(
								async () => {
									await goto(`/s/${template.slug}`, { replaceState: true });
								},
								2000,
								'override-navigation',
								componentId
							);
						}}
					/>
				{:else}
					<!-- Fallback if no submission ID -->
					<div class="rounded-lg border border-slate-200 bg-white p-4 text-center">
						<Send class="text-participation-primary-600 mx-auto mb-3 h-8 w-8" />
						<p class="text-slate-600">Message processing started</p>
					</div>
				{/if}
			</div>
		</div>
	{:else if currentState === 'error'}
		<!-- Error State - submission failed -->
		<div class="relative p-6 text-center sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute top-4 right-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			<div
				class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-100 sm:mb-6 sm:h-20 sm:w-20"
			>
				<AlertCircle class="h-8 w-8 text-red-600 sm:h-10 sm:w-10" />
			</div>
			<h3 class="mb-2 text-xl font-bold text-slate-900 sm:text-2xl">Something went wrong</h3>
			<p class="mb-4 text-sm text-slate-600 sm:mb-6 sm:text-base">
				{submissionError || 'An unexpected error occurred while sending your message.'}
			</p>

			<div class="flex justify-center gap-2 sm:gap-3">
				<Button
					variant="primary"
					size="lg"
					classNames="flex-1 min-w-[120px] sm:min-w-[140px] whitespace-nowrap"
					onclick={async () => {
						submissionError = null;
						await continueCongressionalProofFlow();
					}}
				>
					<ArrowRight class="mr-2 h-5 w-5 shrink-0" />
					Try Again
				</Button>
				<Button
					variant="secondary"
					size="lg"
					classNames="flex-1 min-w-[120px] sm:min-w-[140px] whitespace-nowrap"
					onclick={handleClose}
				>
					Close
				</Button>
			</div>
		</div>
	{:else}
		<!-- Fallback for unhandled states (auth_required, proof-generation, etc.) -->
		<div class="p-6 text-center">
			<p class="text-sm text-slate-600">Loading...</p>
		</div>
	{/if}
</div>

<!-- Verification Gate Modal -->
{#if user?.id}
	<VerificationGate
		bind:this={verificationGateRef}
		userId={user.id}
		templateSlug={template.slug}
		cellId={verifiedCellId}
		minimumTier={template.deliveryMethod === 'cwc' ? 4 : 2}
		electedTarget={template.deliveryMethod === 'cwc'}
		userTrustTier={user.trust_tier ?? 1}
		bind:showModal={showVerificationGate}
		onverified={(data) => handleVerificationComplete(data)}
		oncancel={() => handleVerificationCancel()}
	/>
{/if}
