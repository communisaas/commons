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
		Users,
		Eye as _Eye,
		Share2,
		Copy,
		CheckCircle2,
		ExternalLink,
		Sparkles as _Sparkles,
		ArrowRight,
		Heart as _Heart,
		Trophy as _Trophy,
		Flame,
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
	import {
		isDigitalCredentialsSupported,
		requestCredential
	} from '$lib/core/identity/digital-credentials-api';
	import {
		storeConstituentAddress,
		getConstituentAddress
	} from '$lib/core/identity/constituent-address';
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

	let showCopied = $state(false);
	let _showShareMenu = $state(false);
	let actionProgress = spring(0, { stiffness: 0.2, damping: 0.8 });
	let celebrationScale = spring(1, { stiffness: 0.3, damping: 0.6 });
	let submissionId = $state<string | null>(null);

	// Verification gate state
	let showVerificationGate = $state(false);
	let verificationGateRef = $state<VerificationGate | null>(null);

	// Address collection state (for congressional templates)
	let needsAddress = $state(false);
	let collectingAddress = $state(false);
	/** Census Block GEOID from address verification (for three-tree ZK architecture) */
	let verifiedCellId = $state<string | undefined>(undefined);
	/** Structured address from AddressCollectionForm for ProofGenerator deliveryAddress */
	let verifiedAddress = $state<{ street: string; city: string; state: string; zip: string } | null>(null);

	// Enhanced URL copy component state
	let copyButtonScale = spring(1, { stiffness: 0.4, damping: 0.8 });
	let copyButtonRotation = spring(0, { stiffness: 0.3, damping: 0.7 });
	let copyButtonGlow = $state(false);
	let copySuccessWave = $state(false);

	// QR code state
	let qrCodeDataUrl = $state<string>('');
	let showQRCode = $state(false);

	// Submission error message for error state UI
	let submissionError = $state<string | null>(null);

	// Trust-upgrade sub-state for wallet attempt flow
	type TrustUpgradePhase = 'choice' | 'wallet-requesting' | 'wallet-failed' | 'simulating';
	let trustUpgradePhase = $state<TrustUpgradePhase>('choice');
	let walletErrorMessage = $state<string | null>(null);

	// TODO(Phase 2): Wire to delivery-worker SSE/polling response.
	// Currently false: delivery-worker runs via waitUntil(), modal can't await result.
	// UI block at ~line 993 is correctly gated behind this flag.
	let hasSenateDelivery = $state(false);

	// Generate share URL for template
	const shareUrl = $derived(`${$page.url.origin}/s/${template.slug}`);

	// Pre-written share messages for different contexts
	const shareMessages = $derived(() => {
		const actionCount = template.metrics?.sent || 0;
		const category = template.category?.toLowerCase() || 'advocacy';

		return {
			// Short & urgent (Twitter, Discord) - <280 chars
			short:
				actionCount > 1000
					? `🔥 ${actionCount.toLocaleString()}+ people coordinating: "${template.title}"\n\n${shareUrl}`
					: `"${template.title}"\n\n${shareUrl}`,

			// Medium (Slack, group chats)
			medium: `Coordinating on ${category}.\n\n"${template.title}"\n\n${actionCount > 0 ? `${actionCount.toLocaleString()} people already sent. ` : ''}Takes 2 minutes: ${shareUrl}`,

			// Long (Email, Reddit)
			long: `I sent this.\n\n"${template.title}"\n\n${template.description}\n\n${actionCount > 1000 ? `${actionCount.toLocaleString()}+ people already sent this. ` : actionCount > 100 ? `${actionCount.toLocaleString()} people acted. ` : ''}Takes 2 minutes.\n\n${shareUrl}`,

			// SMS-friendly (under 160 chars)
			sms:
				actionCount > 0
					? `${template.title} - Join ${actionCount.toLocaleString()}+: ${shareUrl}`
					: `${template.title} - ${shareUrl}`
		};
	});

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
			modalActions.setState(initialState as import('$lib/stores/modalSystem.svelte').LegacyModalState);
			return;
		}

		// Congressional templates: guests get mailto relay, authenticated get ZKP/CWC
		if (template.deliveryMethod === 'cwc') {
			if (!user) {
				console.log('[TemplateModal] Guest on congressional template — mailto relay');
				handleUnifiedEmailFlow();
			} else if ((user.trust_tier ?? 0) >= 2) {
				// Tier 2+ (address-verified): hydrate stored address, then ZKP
				const stored = await getConstituentAddress(user.id);
				if (stored) {
					verifiedAddress = {
						street: stored.street,
						city: stored.city,
						state: stored.state,
						zip: stored.zip
					};
					console.log('[TemplateModal] Tier 2+ — hydrated address from encrypted store');
				}
				handleSendConfirmation(true);
			} else {
				// Tier 1 (OAuth-only): needs address verification before ZKP
				console.log(`[TemplateModal] Tier ${user.trust_tier ?? 1} user on congressional — showing trust upgrade`);
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

		const flow = analyzeEmailFlow(template, enrichedUser, { trustTier: enrichedUser?.trust_tier ?? 0 });

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
	async function handleAddressComplete(
		data: {
			address: string;
			verified: boolean;
			streetAddress: string;
			city: string;
			state: string;
			zip: string;
			representatives?: Representative[] | ProviderRepresentative[];
		}
	) {
		console.log('[Template Modal] Address complete:', {
			street: data.streetAddress,
			city: data.city,
			state: data.state,
			zip: data.zip,
			verified: data.verified
		});

		// Invalidate stale location caches from prior address
		// Pass userId so encrypted constituent address + session tree state are cleared
		try {
			const { invalidateLocationCaches } = await import('$lib/core/identity/cache-invalidation');
			await invalidateLocationCaches(user?.id);
		} catch {
			// Non-fatal
		}

		// Store structured address in component state for ProofGenerator
		verifiedAddress = {
			street: data.streetAddress,
			city: data.city,
			state: data.state,
			zip: data.zip
		};

		// Close address collection
		collectingAddress = false;
		needsAddress = false;

		// Extract congressional district from representatives or default to at-large
		// Supports DecisionMaker shapes (title field derives chamber)
		const houseRep = data.representatives?.find((r) => {
			if ('chamber' in r && r.chamber === 'house') return true;
			if ('title' in r && typeof r.title === 'string') {
				const t = r.title.toLowerCase();
				return !t.includes('senator') && !t.includes('senate');
			}
			return false;
		}) as Representative | undefined;
		const districtNumber = houseRep?.district ?? 'AL';
		const district = `${data.state}-${districtNumber.toString().padStart(2, '0')}`;

		// Persist encrypted in IndexedDB — survives modal remounts and sessions
		if (user?.id) {
			storeConstituentAddress(user.id, { ...verifiedAddress, district }).catch((e) =>
				console.warn('[Template Modal] Address persistence failed:', e)
			);
		}

		// For authenticated users on CWC templates: issue credential + bootstrap ZKP
		if (user?.id && template.deliveryMethod === 'cwc') {
			const alreadyVerified = (user.trust_tier ?? 0) >= 2;

			try {
				trustUpgradePhase = 'simulating';
				modalActions.setState('trust-upgrade');

				// Always call verify-address — even for Tier 2+ users re-entering address.
				// This updates district_hash, UserDMRelation, and credential on the server.
				// Without this, a user who moves districts keeps their old district forever.
				const verifyRes = await fetch('/api/identity/verify-address', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						district,
						verification_method: 'civic_api',
						officials: data.representatives
					})
				});
				const verifyResult = await verifyRes.json();

				if (!verifyResult.success) {
					console.error('[Template Modal] verify-address failed:', verifyResult.error);
					if (alreadyVerified) {
						// Tier 2+ can still proceed — they have a valid (possibly stale) credential
						handleSendConfirmation(true);
					} else {
						await handleUnifiedEmailFlow();
					}
					return;
				}

				// Refresh server data so locals.user has updated district_hash
				await invalidateAll();

				if (alreadyVerified) {
					// Already verified — proceed directly to send
					handleSendConfirmation(true);
				} else {
					// New verification — proceed to ZKP flow
					submitCongressionalMessage();
				}
			} catch (e) {
				console.error('[Template Modal] Address verification failed:', e);
				if (alreadyVerified) {
					handleSendConfirmation(true);
				} else {
					await handleUnifiedEmailFlow();
				}
			}
			return;
		}

		// Non-CWC or guest: continue with existing flow
		if (user?.id && verificationGateRef) {
			const isVerified = await verificationGateRef.checkVerification();
			if (!isVerified) {
				showVerificationGate = true;
				return;
			}
		}

		// Proceed to submission — route by tier
		if ((user?.trust_tier ?? 0) >= 3) {
			await submitCongressionalMessage();
		} else {
			await handleUnifiedEmailFlow();
		}
	}

	/**
	 * Attempt real mDL wallet verification.
	 *
	 * Flow:
	 * 1. Call /api/identity/verify-mdl/start for DeviceRequest config
	 * 2. Trigger navigator.credentials.get() — iOS shows wallet prompt
	 * 3. If wallet succeeds: verify on server, proceed to ZKP
	 * 4. If wallet fails (not enrolled, unsupported): show brief error,
 *    then offer to use another method.
	 */
	async function attemptWalletVerification() {
		trustUpgradePhase = 'wallet-requesting';
		walletErrorMessage = null;

		// If DC API isn't supported, skip straight to failure
		if (!isDigitalCredentialsSupported()) {
			walletErrorMessage = 'Digital Credentials API not supported in this browser';
			trustUpgradePhase = 'wallet-failed';
			return;
		}

		try {
			// Step 1: Get DeviceRequest config from server
			const startResponse = await fetch('/api/identity/verify-mdl/start', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: user?.id })
			});

			if (!startResponse.ok) {
				throw new Error('Failed to initialize wallet verification');
			}

			const { requests, nonce } = await startResponse.json();

			// Step 2: Trigger real wallet prompt — iOS will show the wallet UI
			const result = await requestCredential({ requests });

			if (!result.success) {
				if (result.error === 'user_cancelled') {
					// User dismissed the wallet — go back to choice
					trustUpgradePhase = 'choice';
					return;
				}
				// Wallet failed (not enrolled, unsupported protocol, etc.)
				throw new Error(result.message);
			}

			// Step 3: Wallet succeeded — verify on server
			trustUpgradePhase = 'simulating'; // Reuse simulating state for "verifying..."

			const verifyResponse = await fetch('/api/identity/verify-mdl/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					protocol: result.protocol,
					data: result.data,
					nonce
				})
			});

			if (!verifyResponse.ok) {
				throw new Error('Server verification failed');
			}

			// Real verification succeeded — proceed to ZKP
			// Consume response body
			verifyResponse.json().catch(() => {});

			// Refresh server data so locals.user has verified_at set
			await invalidateAll();

			submitCongressionalMessage();
		} catch (err) {
			// Wallet or server failed — show the error, then offer to simulate
			walletErrorMessage = err instanceof Error ? err.message : 'Wallet verification failed';
			trustUpgradePhase = 'wallet-failed';
		}
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

	/**
	 * Handle verification complete from VerificationGate
	 * After user verifies, proceed with Congressional submission
	 */
	function handleVerificationComplete(data: { userId: string; method: string }) {
		console.log(
			'[Template Modal] Verification complete, proceeding with submission:',
			data
		);
		showVerificationGate = false;

		// Now that user is verified, route by tier
		if ((user?.trust_tier ?? 0) >= 3) {
			submitCongressionalMessage();
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
				console.log('[Template Modal] Guest confirmed send on congressional — celebration + upgrade CTA');

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
				const hasAddress = verifiedAddress &&
					verifiedAddress.street &&
					verifiedAddress.city &&
					verifiedAddress.state &&
					verifiedAddress.zip;

				if (!hasAddress) {
					// Need address for CWC delivery — collect it inline
					console.log(
						'[Template Modal] Congressional template needs address - showing inline collection'
					);
					collectingAddress = true;
					needsAddress = true;
					return; // Stop until address collected
				}

				// STEP 2: Progressive verification gate: Check if user is verified
				if (user?.id && verificationGateRef) {
					const isVerified = await verificationGateRef.checkVerification();

					if (!isVerified) {
						// User not verified - show verification gate
						console.log('[Template Modal] User not verified, showing verification gate');
						showVerificationGate = true;
						return; // Stop submission until verification complete
					}
				}

				// STEP 3: User has address + is verified - route by tier
				if ((user?.trust_tier ?? 0) >= 3) {
					// Tier 3+: ZKP → TEE → CWC pipeline
					await submitCongressionalMessage();
				} else {
					// Tier 1-2: email_attested → mailto with district attestation footer
					await handleUnifiedEmailFlow();
				}
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

	// TODO(Phase 2): Poll submission delivery status from TEE confirmation endpoint
</script>

<!-- Modal Content (no backdrop - UnifiedModal handles that) -->
<div
	class="flex max-h-[90vh] w-full flex-col overflow-clip"
	role="document"
	tabindex="-1"
>
	<!-- Dynamic Content Based on State -->
	{#if currentState === 'loading'}
		<!-- Loading State - mailto is being resolved -->
		<div class="p-6 text-center sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<div
				class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-participation-primary-100 sm:mb-6 sm:h-20 sm:w-20"
				style="transform: scale({$celebrationScale})"
			>
				<Send class="h-8 w-8 text-participation-primary-600 sm:h-10 sm:w-10" />
			</div>
			<h3 class="mb-2 text-xl font-bold text-slate-900 sm:text-2xl">Preparing message...</h3>
			<p class="mb-4 text-sm text-slate-600 sm:mb-6 sm:text-base">
				Opening your email with pre-filled message.
			</p>

			<!-- Animated progress indicator -->
			<div class="mx-auto h-2 w-32 overflow-hidden rounded-full bg-slate-200">
				<div
					class="h-full rounded-full bg-gradient-to-r from-participation-primary-500 to-participation-primary-700 transition-all duration-1000 ease-out"
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
				class="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			<div
				class="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-participation-primary-100 sm:mb-6 sm:h-20 sm:w-20"
			>
				<Send class="h-8 w-8 text-participation-primary-600 sm:h-10 sm:w-10" />
			</div>
			<h3 class="mb-2 text-xl font-bold text-slate-900 sm:text-2xl">Did you send it?</h3>
			<p class="mb-4 text-sm text-slate-600 sm:mb-6 sm:text-base">Confirm to track this action.</p>

			<div class="flex justify-center gap-2 sm:gap-3">
				<Button
					variant="primary"
					size="lg"
					classNames="flex-1 min-w-[120px] sm:min-w-[140px] whitespace-nowrap"
					onclick={() => handleSendConfirmation(true)}
				>
					<CheckCircle2 class="mr-2 h-5 w-5 shrink-0" />
					Yes, sent
				</Button>
				<Button
					variant="secondary"
					size="lg"
					classNames="flex-1 min-w-[120px] sm:min-w-[140px] whitespace-nowrap"
					onclick={() => handleSendConfirmation(false)}
				>
					<ArrowRight class="mr-2 h-5 w-5 shrink-0 rotate-180" />
					Try again
				</Button>
			</div>
		</div>
	{:else if currentState === 'retry_needed'}
		<!-- Retry Needed State - Email client didn't open -->
		<div class="relative p-6 text-center sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
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
		<!-- Enhanced Celebration State -->
		<div class="flex h-full flex-col">
			<!-- Celebration Header -->
			<div class="border-b border-slate-100 p-6">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-3">
						<div
							class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-green-100 to-blue-100"
							style="transform: scale({$celebrationScale})"
						>
							<CheckCircle2 class="h-5 w-5 text-green-600" />
						</div>
						<div>
							<h2 class="text-lg font-semibold text-slate-900">🎉 Mission Accomplished!</h2>
							<p class="text-sm text-slate-600">Your message has been sent</p>
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

			<!-- Enhanced Celebration Content -->
			<div class="flex-1 space-y-6 overflow-y-auto p-6">
				<!-- Pioneer Badge (first 10 users) or Impact Counter -->
				{#if (template.metrics?.sent ?? 0) <= 10}
					{@const sentCount = template.metrics?.sent ?? 0}
					<!-- Pioneer Badge -->
					<div
						class="rounded-lg border-2 border-orange-300 bg-gradient-to-br from-orange-50 via-amber-50 to-yellow-50 p-6"
					>
						<div class="text-center">
							<div
								class="mb-3 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-600 shadow-lg"
							>
								<Flame class="h-8 w-8 text-white" />
							</div>
							<div class="mb-2 text-3xl font-bold text-slate-900">
								{#if sentCount === 0}
									🔥 FIRST SENDER 🔥
								{:else}
									Pioneer #{sentCount + 1}
								{/if}
							</div>
							<p class="mb-3 text-sm font-medium text-orange-900">
								{#if sentCount === 0}
									You just launched this movement
								{:else}
									Early adopter • Setting the standard
								{/if}
							</p>
							<div class="rounded-lg bg-white/50 px-4 py-3 text-xs text-slate-700">
								<p class="font-semibold">Your impact matters most:</p>
								<p class="mt-1">Every movement starts with pioneers like you who act first.</p>
							</div>
						</div>
					</div>
				{:else}
					{@const sentCount = template.metrics?.sent ?? 0}
					<!-- Standard Impact Counter -->
					<div class="rounded-lg border border-slate-200 bg-white p-4">
						<div class="text-center">
							<div class="mb-2 text-3xl font-bold text-slate-900">
								You + {sentCount.toLocaleString()} others
							</div>
							<p class="text-sm text-slate-600">Real voices creating real change</p>
							<div class="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
								<Users class="h-3 w-3" />
								<span>Part of a movement</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Upgrade CTAs (mutually exclusive: guest → auth, tier 1 → address verification) -->
				{#if !user}
					<div
						class="rounded-lg border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-4"
						in:fly={{ y: 10, duration: 400, delay: 300 }}
					>
						<p class="mb-1 text-sm font-semibold text-blue-900">
							{template.deliveryMethod === 'cwc'
								? 'Want verified constituent delivery?'
								: 'Want to track your impact?'}
						</p>
						<p class="mb-3 text-xs text-blue-700">
							{template.deliveryMethod === 'cwc'
								? 'Create a free account to send through official congressional channels with verified constituent status.'
								: 'Create a free account to track delivery and join the movement.'}
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
							class="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.98]"
						>
							Create free account
						</button>
					</div>
				{:else if user && (user.trust_tier ?? 0) < 2}
					<div
						class="rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-4"
						in:fly={{ y: 10, duration: 400, delay: 300 }}
					>
						<p class="mb-1 text-sm font-semibold text-indigo-900">
							Verify your address for faster delivery
						</p>
						<p class="mb-3 text-xs text-indigo-700">
							Congressional offices prioritize verified constituents. Add your address to ensure your message is counted.
						</p>
						<button
							onclick={() => {
								onclose?.();
								modalActions.openModal('address-modal', 'address', {
									template,
									source: 'post-send-tier-upgrade'
								});
							}}
							class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-indigo-700 active:scale-[0.98]"
						>
							Verify your address
						</button>
					</div>
				{:else if user && (user.trust_tier ?? 0) === 2 && template.deliveryMethod === 'cwc'}
					<div
						class="rounded-lg border border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 p-4"
						in:fly={{ y: 10, duration: 400, delay: 300 }}
					>
						<p class="mb-1 text-sm font-semibold text-purple-900">
							Verify your identity for cryptographic delivery
						</p>
						<p class="mb-3 text-xs text-purple-700">
							Your message was delivered as a constituent. Verify your identity to send with a zero-knowledge proof next time — unfakeable, unbottable.
						</p>
						<button
							onclick={() => {
								onclose?.();
								if (user?.id) {
									modalActions.openModal('identity-verification-modal', 'identity-verification', {
										userId: user.id,
										templateSlug: template.slug,
										onComplete: async () => {
											await invalidateAll();
										}
									});
								}
							}}
							class="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-purple-700 active:scale-[0.98]"
						>
							Verify identity
						</button>
					</div>
				{:else if user && (user.trust_tier ?? 0) === 3 && template.deliveryMethod === 'cwc'}
					<div
						class="rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 to-violet-50 p-4"
						in:fly={{ y: 10, duration: 400, delay: 300 }}
					>
						<p class="mb-1 text-sm font-semibold text-indigo-900">
							Generate a ZK proof next time
						</p>
						<p class="mb-3 text-xs text-indigo-700">
							You're identity-verified. Next time, send with a zero-knowledge proof — mathematically verified district residency. Maximum weight.
						</p>
					</div>
				{/if}

				<!-- Next Steps / Share -->
				<div class="space-y-3">
					<!-- Primary: Universal Share Button -->
					<button
						onclick={handleUniversalShare}
						class="flex w-full items-center justify-center gap-2 rounded-lg bg-participation-primary-600 px-6 py-3 font-semibold text-white shadow-sm transition-all hover:bg-participation-primary-700 active:scale-95"
					>
						<Share2 class="h-5 w-5" />
						<span>{(typeof navigator !== 'undefined' && 'share' in navigator) ? 'Share template' : 'Copy share message'}</span>
					</button>
				</div>

				{#if showCopied}
					<div
						class="rounded-lg bg-green-50 px-4 py-2 text-center text-sm text-green-700"
						in:scale={{ duration: 200 }}
						out:fade={{ duration: 200 }}
					>
						✓ Copied to clipboard!
					</div>
				{/if}

				<!-- QR Code -->
				<button
					onclick={loadQRCode}
					class="w-full text-sm text-slate-600 underline hover:text-slate-900"
				>
					<QrCode class="mr-1 inline h-4 w-4" />
					Show QR code for in-person sharing
				</button>

				{#if showQRCode && qrCodeDataUrl}
					<div class="rounded-lg border border-slate-200 bg-white p-4" in:scale={{ duration: 300 }}>
						<img src={qrCodeDataUrl} alt="QR code for {template.title}" class="mx-auto" />
						<p class="mb-3 mt-2 text-center text-xs text-slate-600">
							Print this for protests, meetings, or events
						</p>
						<button
							onclick={downloadQRCode}
							class="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
						>
							<Download class="h-4 w-4" />
							Download for printing
						</button>
					</div>
				{/if}

				<!-- Always Visible: Raw URL -->
				<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
					<input
						type="text"
						readonly
						value={shareUrl}
						onclick={(e) => e.currentTarget.select()}
						class="mb-2 w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-700"
					/>
					<div class="flex items-center justify-between text-xs text-slate-500">
						<span>Share this link anywhere</span>
						<button
							onclick={copyTemplateUrl}
							class="text-participation-primary-600 hover:underline"
						>
							Copy URL
						</button>
					</div>
				</div>

				<!-- Senate Delivery Verification (only if actual Senate submission) -->
				{#if hasSenateDelivery}
					<div class="rounded-lg border border-blue-200 bg-blue-50 p-4" in:fade={{ duration: 400 }}>
						<div class="mb-2 flex items-center gap-2">
							<CheckCircle2 class="h-4 w-4 text-blue-600" />
							<p class="text-sm font-semibold text-blue-900">Senate Delivery Confirmed</p>
						</div>
						<p class="mb-2 text-xs text-blue-800">
							Your message was delivered through the official Senate messaging system
						</p>
						<a
							href="https://soapbox.senate.gov/api"
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline"
						>
							<ExternalLink class="h-3 w-3" />
							soapbox.senate.gov/api
						</a>
					</div>
				{/if}
			</div>
		</div>
	{:else if collectingAddress}
		<!-- Address Collection State - Inline for Congressional templates -->
		<div class="relative p-6 sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<!-- Close Button -->
			<button
				onclick={handleClose}
				class="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
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
		<!-- Trust Upgrade — graduated trust with real wallet attempt -->
		<div class="relative p-6 sm:p-8" in:scale={{ duration: 500, easing: backOut }}>
			<button
				onclick={() => { trustUpgradePhase = 'choice'; handleClose(); }}
				class="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
			>
				<X class="h-5 w-5" />
			</button>

			{#if trustUpgradePhase === 'choice'}
				<!-- Phase 1: Choice — strengthen signal -->
				<div class="mb-6 text-center">
					<div class="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
						<ShieldCheck class="h-7 w-7 text-slate-600" />
					</div>
					<h3 class="mb-1 text-xl font-bold text-slate-900">Strengthen your signal</h3>
					<p class="text-sm text-slate-500">Congressional offices prioritize verified constituents</p>
				</div>

				<div class="space-y-3">
					<!-- mDL: Highest signal — verify with digital ID -->
					<button
						onclick={() => { attemptWalletVerification(); }}
						class="group flex w-full items-center gap-4 rounded-xl border-2 border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 p-4 text-left transition-all hover:border-purple-300 hover:shadow-md"
					>
						<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100">
							<Smartphone class="h-5 w-5 text-purple-600" />
						</div>
						<div class="min-w-0 flex-1">
							<span class="block text-sm font-semibold text-purple-900">Verify with Digital ID</span>
							<span class="block text-xs text-purple-600">Cryptographic proof of identity. Undeniable signal.</span>
						</div>
						<ArrowRight class="h-4 w-4 shrink-0 text-purple-400 transition-transform group-hover:translate-x-0.5" />
					</button>

					<!-- Address: Primary CTA — available now, resolves the tension -->
					<button
						onclick={() => { collectingAddress = true; }}
						class="group flex w-full items-center gap-4 rounded-xl border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4 text-left transition-all hover:border-emerald-300 hover:shadow-md"
					>
						<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
							<MapPin class="h-5 w-5 text-emerald-600" />
						</div>
						<div class="min-w-0 flex-1">
							<span class="block text-sm font-semibold text-emerald-900">Verify your address</span>
							<span class="block text-xs text-emerald-600">Confirms your district. Your message gets read.</span>
						</div>
						<ArrowRight class="h-4 w-4 shrink-0 text-emerald-400 transition-transform group-hover:translate-x-0.5" />
					</button>

					<!-- Divider -->
					<div class="flex items-center gap-3 py-0.5">
						<div class="h-px flex-1 bg-slate-200"></div>
						<span class="text-[10px] font-medium uppercase tracking-wider text-slate-400">or</span>
						<div class="h-px flex-1 bg-slate-200"></div>
					</div>

					<!-- Email: Quiet escape hatch — still valid, just lower signal -->
					<button
						onclick={() => handleUnifiedEmailFlow()}
						class="group flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm"
					>
						<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
							<Send class="h-5 w-5 text-slate-500" />
						</div>
						<div class="min-w-0 flex-1">
							<span class="block text-sm font-medium text-slate-700">Send now via email</span>
							<span class="block text-xs text-slate-500">Named sender. Lower priority but still delivered.</span>
						</div>
						<ArrowRight class="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
					</button>
				</div>

			{:else if trustUpgradePhase === 'wallet-requesting'}
				<!-- Phase 2: Wallet prompt active — iOS shows wallet UI -->
				<div class="flex flex-col items-center justify-center py-8" in:fade={{ duration: 200 }}>
					<div class="relative mb-6">
						<div class="flex h-20 w-20 items-center justify-center rounded-full bg-purple-100">
							<Smartphone class="h-10 w-10 text-purple-600" />
						</div>
						<div class="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md">
							<Loader2 class="h-5 w-5 animate-spin text-purple-600" />
						</div>
					</div>
					<p class="text-lg font-semibold text-slate-900">Requesting wallet...</p>
					<p class="mt-2 max-w-xs text-center text-sm text-slate-600">
						Your device will prompt you to share <strong>only</strong> your postal code and state
					</p>
				</div>

			{:else if trustUpgradePhase === 'wallet-failed'}
				<!-- Phase 3: Wallet failed — show error + offer to simulate -->
				<div class="flex flex-col items-center py-6" in:fade={{ duration: 200 }}>
					<div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
						<AlertCircle class="h-8 w-8 text-amber-600" />
					</div>
					<h3 class="mb-1 text-lg font-bold text-slate-900">Wallet unavailable</h3>
					<p class="mb-4 max-w-xs text-center text-sm text-slate-500">
						{walletErrorMessage || 'Digital ID verification requires enrollment with your state DMV.'}
					</p>

						<button
							onclick={() => { trustUpgradePhase = 'choice'; }}
							class="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
						>
							Try another method
						</button>
				</div>

			{:else if trustUpgradePhase === 'simulating'}
				<!-- Phase 4: Simulating verification — brief interstitial -->
				<div class="flex flex-col items-center justify-center py-8" in:fade={{ duration: 200 }}>
					<div class="relative mb-6">
						<div class="flex h-20 w-20 items-center justify-center rounded-full bg-purple-100">
							<Fingerprint class="h-10 w-10 text-purple-600" />
						</div>
						<div class="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-md">
							<Loader2 class="h-5 w-5 animate-spin text-purple-600" />
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
						deliveryAddress={verifiedAddress ? {
							name: decryptedUser.name || user.name || 'Constituent',
							email: decryptedUser.email || $page.data?.user?.email || '',
							street: verifiedAddress.street,
							city: verifiedAddress.city,
							state: verifiedAddress.state,
							zip: verifiedAddress.zip,
							congressional_district: $page.data?.user?.congressional_district || undefined
						} : undefined}
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
						<p class="mb-6 text-sm text-slate-600">Sign in to send verified messages to Congress.</p>
						<div class="flex gap-3">
							<Button
								variant="secondary"
								size="lg"
								onclick={handleClose}
							>
								Cancel
							</Button>
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
							class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-participation-primary-100"
							style="transform: scale({$celebrationScale})"
						>
							<Send class="h-5 w-5 text-participation-primary-600" />
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
						<Send class="mx-auto mb-3 h-8 w-8 text-participation-primary-600" />
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
				class="absolute right-4 top-4 rounded-full p-2 text-slate-400 transition-all duration-200 hover:bg-slate-100 hover:text-slate-600"
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
					onclick={() => {
						submissionError = null;
						submitCongressionalMessage();
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
		userTrustTier={user.trust_tier ?? 1}
		bind:showModal={showVerificationGate}
		onverified={(data) => handleVerificationComplete(data)}
		oncancel={() => handleVerificationCancel()}
	/>
{/if}
