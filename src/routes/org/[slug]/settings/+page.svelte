<script lang="ts">
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import { computeOrgScopedEmailHash } from '$lib/core/crypto/org-scoped-hash';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const isOwner = $derived(data.membership.role === 'owner');
	const canEdit = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');
	const canInvite = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');
	const planName = $derived(data.subscription?.plan ?? 'free');

	// Invite form state
	let inviteEmail = $state('');
	let inviteRole = $state<'member' | 'editor'>('member');
	let inviteSending = $state(false);
	let inviteMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

	// Invite action loading states (keyed by invite id)
	let resendingId = $state<string | null>(null);
	let revokingId = $state<string | null>(null);

	async function resendInvite(inviteId: string) {
		if (resendingId) return;
		resendingId = inviteId;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/invites`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inviteId })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to resend invite' }));
				inviteMessage = { type: 'error', text: err.message ?? 'Failed to resend invite' };
				return;
			}
			inviteMessage = { type: 'success', text: 'Invite resent successfully' };
			await invalidateAll();
		} catch {
			inviteMessage = { type: 'error', text: 'Network error. Please try again.' };
		} finally {
			resendingId = null;
		}
	}

	async function revokeInvite(inviteId: string) {
		if (revokingId) return;
		revokingId = inviteId;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/invites`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ inviteId })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to revoke invite' }));
				inviteMessage = { type: 'error', text: err.message ?? 'Failed to revoke invite' };
				return;
			}
			inviteMessage = { type: 'success', text: 'Invite revoked' };
			await invalidateAll();
		} catch {
			inviteMessage = { type: 'error', text: 'Network error. Please try again.' };
		} finally {
			revokingId = null;
		}
	}

	const seatsUsed = $derived(data.members.length + data.invites.length);
	const maxSeats = $derived(data.org.max_seats);
	const atSeatLimit = $derived(seatsUsed >= maxSeats);

	const isValidEmail = $derived(inviteEmail.trim().length > 0 && inviteEmail.includes('@') && inviteEmail.includes('.'));

	async function sendInvite() {
		if (!isValidEmail || inviteSending || atSeatLimit) return;

		inviteSending = true;
		inviteMessage = null;

		try {
			const email = inviteEmail.trim().toLowerCase();
			// Compute org-scoped hash client-side — no plaintext email reaches server
			const emailHash = await computeOrgScopedEmailHash(data.org.id, email);

			// Encrypt email with org key — required, no plaintext fallback
			if (!cachedOrgKey) {
				inviteMessage = { type: 'error', text: 'Unlock encryption before sending invites.' };
				inviteSending = false;
				return;
			}
			const { encryptWithOrgKey } = await import('$lib/core/crypto/org-pii-encryption');
			const blob = await encryptWithOrgKey(email, cachedOrgKey, emailHash, 'email');
			const encryptedEmail = JSON.stringify(blob);

			const res = await fetch(`/api/org/${data.org.slug}/invites`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					invites: [{ emailHash, encryptedEmail, role: inviteRole }]
				})
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to send invite' }));
				inviteMessage = { type: 'error', text: err.message ?? 'Failed to send invite' };
				return;
			}

			const result = await res.json();
			const status = result.results?.[0]?.status;

			if (status === 'skipped') {
				inviteMessage = { type: 'error', text: 'Already a member or has a pending invite' };
			} else {
				inviteMessage = { type: 'success', text: `Invite sent to ${email}` };
				inviteEmail = '';
				inviteRole = 'member';
				await invalidateAll();
			}
		} catch {
			inviteMessage = { type: 'error', text: 'Network error. Please try again.' };
		} finally {
			inviteSending = false;
		}
	}
	const billingSuccess = $derived($page.url.searchParams.get('billing') === 'success');
	const billingCanceled = $derived($page.url.searchParams.get('billing') === 'canceled');

	let checkoutLoading = $state('');
	let portalLoading = $state(false);

	const actionsPercent = $derived(
		data.usage.maxVerifiedActions > 0
			? Math.min(100, (data.usage.verifiedActions / data.usage.maxVerifiedActions) * 100)
			: 0
	);
	const emailsPercent = $derived(
		data.usage.maxEmails > 0
			? Math.min(100, (data.usage.emailsSent / data.usage.maxEmails) * 100)
			: 0
	);

	function statusBadgeClass(status: string): string {
		switch (status) {
			case 'active':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
			case 'trialing':
				return 'bg-teal-500/15 text-teal-400 border-teal-500/20';
			case 'past_due':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
			case 'canceled':
				return 'bg-red-500/15 text-red-400 border-red-500/20';
			default:
				return 'bg-surface-overlay text-text-tertiary border-surface-border';
		}
	}

	function usageBarClass(percent: number): string {
		if (percent >= 90) return 'bg-red-500';
		if (percent >= 70) return 'bg-amber-500';
		return 'bg-teal-500';
	}

	const plans = [
		{ slug: 'free', name: 'Free', price: '$0', features: ['100 verified actions/mo', '1,000 emails/mo', '2 seats'] },
		{ slug: 'starter', name: 'Starter', price: '$10', features: ['1,000 verified actions/mo', '20,000 emails/mo', '5 seats', 'A/B testing'] },
		{ slug: 'organization', name: 'Organization', price: '$75', features: ['5,000 verified actions/mo', '100,000 emails/mo', '10 seats', 'Custom domain', 'SQL mirror'] },
		{ slug: 'coalition', name: 'Coalition', price: '$200', features: ['10,000 verified actions/mo', '250,000 emails/mo', '25 seats', 'White-label', 'Child orgs'] }
	];

	async function startCheckout(plan: string) {
		checkoutLoading = plan;
		try {
			const res = await fetch('/api/billing/checkout', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ orgSlug: data.org.slug, plan })
			});
			const result = await res.json();
			if (res.ok && result.url) {
				window.location.href = result.url;
			} else {
				alert(result.message ?? 'Failed to start checkout');
				checkoutLoading = '';
			}
		} catch {
			alert('Network error. Please try again.');
			checkoutLoading = '';
		}
	}

	async function openPortal() {
		portalLoading = true;
		try {
			const res = await fetch('/api/billing/portal', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ orgSlug: data.org.slug })
			});
			const result = await res.json();
			if (res.ok && result.url) {
				window.location.href = result.url;
			} else {
				alert(result.message ?? 'Failed to open billing portal');
			}
		} catch {
			alert('Network error. Please try again.');
		} finally {
			portalLoading = false;
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	// Issue domain state
	let domainLabel = $state('');
	let domainDescription = $state('');
	let domainWeight = $state(1.0);
	let domainSaving = $state(false);
	let domainMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);
	let editingDomainId = $state<string | null>(null);
	let deletingDomainId = $state<string | null>(null);

	const domainCount = $derived(data.issueDomains.length);
	const atDomainLimit = $derived(domainCount >= 20);

	// ── Encryption setup state ──
	const encryptionConfigured = $derived(!!data.encryption.orgKeyVerifier);
	type SetupStep = 'idle' | 'passphrase' | 'recovery' | 'saving' | 'done';
	let setupStep = $state<SetupStep>('idle');
	let passphrase = $state('');
	let passphraseConfirm = $state('');
	let recoveryWords = $state<string[]>([]);
	let recoveryAcknowledged = $state(false);
	let encryptionError = $state('');
	let encryptionSaving = $state(false);

	// Derived from recovery key generation — held in memory only during setup
	let recoveryKeyBytes: Uint8Array | null = null;

	// ── Device unlock state ──
	let deviceUnlocked = $state(false);
	let deviceCheckDone = $state(false);
	let unlockPassphrase = $state('');
	let unlockError = $state('');
	let unlockLoading = $state(false);
	// Hold the cached org key in memory for use during this session
	let cachedOrgKey: CryptoKey | null = null;

	// ── Rotation state ──
	let showRotation = $state(false);
	let rotationCurrentPassphrase = $state('');
	let rotationNewPassphrase = $state('');
	let rotationNewConfirm = $state('');
	let rotationRecoveryWords = $state<string[]>([]);
	let rotationRecoveryAck = $state(false);
	let rotationError = $state('');
	let rotationLoading = $state(false);
	let rotationStep = $state<'verify' | 'newpass' | 'recovery' | 'saving'>('verify');

	let rotationRecoveryKeyBytes: Uint8Array | null = null;

	const rotationNewValid = $derived(
		rotationNewPassphrase.length >= 12 &&
		rotationNewPassphrase === rotationNewConfirm
	);

	function startRotation() {
		showRotation = true;
		rotationStep = 'verify';
		rotationCurrentPassphrase = '';
		rotationNewPassphrase = '';
		rotationNewConfirm = '';
		rotationRecoveryWords = [];
		rotationRecoveryAck = false;
		rotationError = '';
		rotationRecoveryKeyBytes = null;
	}

	function cancelRotation() {
		showRotation = false;
		rotationCurrentPassphrase = '';
		rotationNewPassphrase = '';
		rotationNewConfirm = '';
		rotationRecoveryWords = [];
		rotationRecoveryAck = false;
		rotationError = '';
		rotationRecoveryKeyBytes = null;
	}

	async function verifyCurrentPassphrase() {
		if (!rotationCurrentPassphrase.trim()) return;
		rotationError = '';
		try {
			const { deriveOrgKey, verifyOrgKey } = await import('$lib/core/crypto/org-pii-encryption');
			const key = await deriveOrgKey(rotationCurrentPassphrase, data.org.id);
			const valid = await verifyOrgKey(key, data.encryption.orgKeyVerifier!);
			if (!valid) {
				rotationError = 'Wrong passphrase.';
				return;
			}
			// Current passphrase verified — hold the key for rotation
			cachedOrgKey = key;
			rotationStep = 'newpass';
		} catch (err) {
			rotationError = err instanceof Error ? err.message : 'Verification failed';
		}
	}

	async function rotationGenerateRecovery() {
		if (!rotationNewValid) return;
		try {
			const { generateRecoveryKey } = await import('$lib/core/crypto/org-pii-encryption');
			const recovery = await generateRecoveryKey();
			rotationRecoveryWords = recovery.words;
			rotationRecoveryKeyBytes = recovery.key;
			rotationStep = 'recovery';
		} catch (err) {
			rotationError = err instanceof Error ? err.message : 'Failed to generate recovery key';
		}
	}

	async function finalizeRotation() {
		if (!rotationRecoveryAck || !rotationRecoveryKeyBytes || !cachedOrgKey || rotationLoading) return;
		rotationLoading = true;
		rotationError = '';
		rotationStep = 'saving';

		try {
			const { deriveOrgKey, createKeyVerifier, wrapOrgKeyForRecovery } = await import('$lib/core/crypto/org-pii-encryption');
			const { cacheOrgKey } = await import('$lib/services/org-key-manager');
			const { useConvexClient } = await import('convex-sveltekit');
			const { api: convexApi } = await import('$lib/convex');

			// Derive NEW key from new passphrase (this becomes the new verifier)
			// Wait — the underlying AES key doesn't change. We re-wrap the SAME key
			// with the new passphrase-derived verifier + new recovery key.
			// But the verifier is created from the ORG key, not the passphrase key.
			// So we need the actual org key. We already have it in cachedOrgKey.

			// Create new verifier from the existing org key
			const newVerifier = await createKeyVerifier(cachedOrgKey);

			// Wrap org key with new recovery key
			const recoveryWrapped = await wrapOrgKeyForRecovery(cachedOrgKey, rotationRecoveryKeyBytes);

			// Save to Convex
			const convex = useConvexClient();
			await convex.mutation(convexApi.organizations.rotateOrgPassphrase, {
				slug: data.org.slug,
				orgKeyVerifier: newVerifier,
				recoveryWrappedOrgKey: recoveryWrapped
			});

			// Re-seal for server with the same org key
			try {
				const rawKeyBytes = await crypto.subtle.exportKey('raw', cachedOrgKey);
				const rawKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(rawKeyBytes)));
				await convex.action(convexApi.organizations.sealOrgKey, {
					slug: data.org.slug,
					rawKeyBase64
				});
			} catch {
				console.warn('[Rotation] Server re-seal failed');
			}

			// Re-cache with new verifier
			await cacheOrgKey(cachedOrgKey, data.org.id);

			// Clean up
			rotationCurrentPassphrase = '';
			rotationNewPassphrase = '';
			rotationNewConfirm = '';
			rotationRecoveryKeyBytes = null;
			showRotation = false;

			await invalidateAll();
		} catch (err) {
			rotationError = err instanceof Error ? err.message : 'Rotation failed';
			rotationStep = 'recovery';
		} finally {
			rotationLoading = false;
		}
	}

	// ── Recovery flow state ──
	let showRecoveryFlow = $state(false);
	let recoveryInput = $state('');
	let recoveryError = $state('');
	let recoveryLoading = $state(false);

	async function recoverWithMnemonic() {
		if (!recoveryInput.trim() || recoveryLoading) return;
		recoveryLoading = true;
		recoveryError = '';

		try {
			const { mnemonicToRecoveryKey, unwrapOrgKeyFromRecovery } = await import('$lib/core/crypto/org-pii-encryption');
			const { cacheOrgKey } = await import('$lib/services/org-key-manager');

			const wrappedKey = data.encryption.recoveryWrappedOrgKey;
			if (!wrappedKey) {
				recoveryError = 'Recovery key data not available. Only org owners can recover.';
				return;
			}

			// Parse and validate mnemonic (checksum will catch typos)
			const words = recoveryInput.trim().toLowerCase().split(/\s+/);
			const recoveryKeyBytes = await mnemonicToRecoveryKey(words);

			// Unwrap the org key
			const orgKey = await unwrapOrgKeyFromRecovery(wrappedKey, recoveryKeyBytes);

			// Cache on this device
			await cacheOrgKey(orgKey, data.org.id);

			cachedOrgKey = orgKey;
			deviceUnlocked = true;
			showRecoveryFlow = false;
			recoveryInput = '';
		} catch (err) {
			recoveryError = err instanceof Error ? err.message : 'Recovery failed';
		} finally {
			recoveryLoading = false;
		}
	}

	// Decrypted invite emails (populated reactively)
	let decryptedInviteEmails = $state<Record<string, string>>({});

	$effect(() => {
		// Re-run when invites or org key changes
		const invites = data.invites;
		const orgKey = cachedOrgKey;
		decryptInviteEmails(invites, orgKey);
	});

	async function decryptInviteEmails(
		invites: typeof data.invites,
		orgKey: CryptoKey | null
	) {
		const results: Record<string, string> = {};
		for (const invite of invites) {
			if (!invite.encryptedEmail) {
				results[invite.id] = '[no email]';
				continue;
			}
			try {
				const parsed = JSON.parse(invite.encryptedEmail);
				if (parsed.v === 'org-1' && orgKey && invite.emailHash) {
					const { decryptWithOrgKey } = await import('$lib/core/crypto/org-pii-encryption');
					results[invite.id] = await decryptWithOrgKey(parsed, orgKey, invite.emailHash, 'email');
				} else if (parsed.v === 'org-1') {
					results[invite.id] = '[locked]';
				} else {
					results[invite.id] = atob(invite.encryptedEmail);
				}
			} catch {
				// Not JSON or decryption failed — try legacy base64
				try {
					results[invite.id] = atob(invite.encryptedEmail);
				} catch {
					results[invite.id] = '[encrypted]';
				}
			}
		}
		decryptedInviteEmails = results;
	}

	// Check device cache on mount when encryption is configured
	$effect(() => {
		if (encryptionConfigured && data.encryption.orgKeyVerifier && !deviceCheckDone) {
			checkDeviceCache();
		}
	});

	async function checkDeviceCache() {
		try {
			const { getOrPromptOrgKey } = await import('$lib/services/org-key-manager');
			const key = await getOrPromptOrgKey(data.org.id, data.encryption.orgKeyVerifier!);
			if (key) {
				cachedOrgKey = key;
				deviceUnlocked = true;
			}
		} catch {
			// No cached key — will show unlock prompt
		} finally {
			deviceCheckDone = true;
		}
	}

	async function unlockWithPassphrase() {
		if (!unlockPassphrase.trim() || unlockLoading) return;
		unlockLoading = true;
		unlockError = '';

		try {
			const { deriveAndCacheOrgKey } = await import('$lib/services/org-key-manager');
			const key = await deriveAndCacheOrgKey(
				unlockPassphrase,
				data.org.id,
				data.encryption.orgKeyVerifier!
			);

			if (!key) {
				unlockError = 'Wrong passphrase. Please try again.';
				return;
			}

			cachedOrgKey = key;
			deviceUnlocked = true;
			unlockPassphrase = '';
		} catch (err) {
			unlockError = err instanceof Error ? err.message : 'Unlock failed';
		} finally {
			unlockLoading = false;
		}
	}

	const passphraseValid = $derived(
		passphrase.length >= 12 &&
		passphrase === passphraseConfirm
	);
	const passphraseMismatch = $derived(
		passphraseConfirm.length > 0 && passphrase !== passphraseConfirm
	);

	function startEncryptionSetup() {
		setupStep = 'passphrase';
		passphrase = '';
		passphraseConfirm = '';
		recoveryWords = [];
		recoveryAcknowledged = false;
		encryptionError = '';
		recoveryKeyBytes = null;
	}

	function cancelEncryptionSetup() {
		setupStep = 'idle';
		passphrase = '';
		passphraseConfirm = '';
		recoveryWords = [];
		recoveryAcknowledged = false;
		encryptionError = '';
		recoveryKeyBytes = null;
	}

	async function proceedToRecovery() {
		if (!passphraseValid) return;
		try {
			const { generateRecoveryKey } = await import('$lib/core/crypto/org-pii-encryption');
			const recovery = await generateRecoveryKey();
			recoveryWords = recovery.words;
			recoveryKeyBytes = recovery.key;
			setupStep = 'recovery';
		} catch (err) {
			encryptionError = err instanceof Error ? err.message : 'Failed to generate recovery key';
		}
	}

	async function finalizeEncryptionSetup() {
		if (!recoveryAcknowledged || !recoveryKeyBytes || encryptionSaving) return;
		encryptionSaving = true;
		encryptionError = '';
		setupStep = 'saving';

		try {
			const { deriveOrgKey, createKeyVerifier, wrapOrgKeyForRecovery } = await import('$lib/core/crypto/org-pii-encryption');
			const { cacheOrgKey } = await import('$lib/services/org-key-manager');
			const { useConvexClient } = await import('convex-sveltekit');
			const { api: convexApi } = await import('$lib/convex');

			// 1. Derive org key from passphrase (single PBKDF2 derivation)
			const orgKey = await deriveOrgKey(passphrase, data.org.id);

			// 2. Create verifier (sentinel encrypted with org key)
			const verifier = await createKeyVerifier(orgKey);

			// 3. Wrap org key with recovery key
			const recoveryWrapped = await wrapOrgKeyForRecovery(orgKey, recoveryKeyBytes);

			// 4. Save verifier + recovery to Convex — authoritative state
			const convex = useConvexClient();
			await convex.mutation(convexApi.organizations.setOrgKeyVerifier, {
				slug: data.org.slug,
				orgKeyVerifier: verifier,
				recoveryWrappedOrgKey: recoveryWrapped
			});

			// 4b. Seal org key for server-side operations (non-fatal if wrapping key not configured)
			try {
				const rawKeyBytes = await crypto.subtle.exportKey('raw', orgKey);
				const rawKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(rawKeyBytes)));
				await convex.action(convexApi.organizations.sealOrgKey, {
					slug: data.org.slug,
					rawKeyBase64
				});
			} catch (sealErr) {
				// Server seal is non-fatal during initial setup — can be retried later
				// when ORG_KEY_WRAPPING_KEY is configured on the server
				console.warn('[Encryption] Server seal failed (wrapping key may not be configured):', sealErr);
			}

			// 5. Cache key on this device (uses already-derived key, no re-derivation)
			try {
				await cacheOrgKey(orgKey, data.org.id);
			} catch (cacheErr) {
				// Device caching is non-fatal — the unlock flow can re-cache later.
				// Encryption is configured server-side; this device just won't have a cached key.
				console.warn('[Encryption] Device key caching failed:', cacheErr);
			}

			// 6. Clean up sensitive state and mark device as unlocked
			passphrase = '';
			passphraseConfirm = '';
			recoveryKeyBytes = null;
			cachedOrgKey = orgKey;
			deviceUnlocked = true;
			deviceCheckDone = true;
			setupStep = 'done';

			// Refresh page data
			await invalidateAll();
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to configure encryption';
			encryptionError = msg;
			// Clear passphrase on any error — user must re-enter
			passphrase = '';
			passphraseConfirm = '';
			setupStep = 'recovery';
		} finally {
			encryptionSaving = false;
		}
	}

	function startEditDomain(domain: typeof data.issueDomains[0]) {
		editingDomainId = domain.id;
		domainLabel = domain.label;
		domainDescription = domain.description ?? '';
		domainWeight = domain.weight;
		domainMessage = null;
	}

	function cancelEditDomain() {
		editingDomainId = null;
		domainLabel = '';
		domainDescription = '';
		domainWeight = 1.0;
		domainMessage = null;
	}

	async function saveDomain() {
		if (!domainLabel.trim() || domainSaving) return;
		domainSaving = true;
		domainMessage = null;

		const isEdit = !!editingDomainId;
		const method = isEdit ? 'PATCH' : 'POST';
		const body: Record<string, unknown> = {
			label: domainLabel.trim(),
			description: domainDescription.trim() || undefined,
			weight: domainWeight
		};
		if (isEdit) body.id = editingDomainId;

		try {
			const res = await fetch(`/api/org/${data.org.slug}/issue-domains`, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: `Failed to ${isEdit ? 'update' : 'create'} issue domain` }));
				domainMessage = { type: 'error', text: err.message ?? `Failed to ${isEdit ? 'update' : 'create'} issue domain` };
				return;
			}
			domainMessage = { type: 'success', text: isEdit ? 'Issue domain updated' : 'Issue domain created' };
			domainLabel = '';
			domainDescription = '';
			domainWeight = 1.0;
			editingDomainId = null;
			await invalidateAll();
		} catch {
			domainMessage = { type: 'error', text: 'Network error. Please try again.' };
		} finally {
			domainSaving = false;
		}
	}

	async function deleteDomain(id: string) {
		if (deletingDomainId) return;
		deletingDomainId = id;
		domainMessage = null;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/issue-domains`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to delete issue domain' }));
				domainMessage = { type: 'error', text: err.message ?? 'Failed to delete issue domain' };
				return;
			}
			domainMessage = { type: 'success', text: 'Issue domain removed' };
			if (editingDomainId === id) cancelEditDomain();
			await invalidateAll();
		} catch {
			domainMessage = { type: 'error', text: 'Network error. Please try again.' };
		} finally {
			deletingDomainId = null;
		}
	}
</script>

<div class="space-y-8">
	<!-- Header -->
	<div>
		<h1 class="text-xl font-semibold text-text-primary">Settings</h1>
		<p class="text-sm text-text-tertiary mt-1">Manage your organization's billing and team.</p>
	</div>

	<!-- Billing status banner -->
	{#if billingSuccess}
		<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
			Subscription activated successfully. Your plan limits are now in effect.
		</div>
	{/if}
	{#if billingCanceled}
		<div class="rounded-lg border border-surface-border-strong bg-surface-overlay px-4 py-3 text-sm text-text-tertiary">
			Checkout was canceled. Your plan has not changed.
		</div>
	{/if}

	<!-- Current Plan + Usage -->
	<section class="rounded-md bg-surface-base border border-surface-border shadow-[var(--shadow-sm)] p-6 space-y-5">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Current Plan</h2>
				<div class="flex items-center gap-3 mt-2">
					<span class="text-2xl font-semibold text-text-primary capitalize">{planName}</span>
					{#if data.subscription}
						<span class="inline-flex items-center px-2 py-0.5 rounded text-xs border {statusBadgeClass(data.subscription.status)}">
							{data.subscription.status}
						</span>
					{/if}
				</div>
				{#if data.subscription?.currentPeriodEnd}
					<p class="text-xs text-text-tertiary mt-1">
						{data.subscription.status === 'canceled' ? 'Access until' : 'Renews'} {formatDate(data.subscription.currentPeriodEnd)}
					</p>
				{/if}
			</div>
			{#if isOwner && data.subscription && data.subscription.status !== 'canceled'}
				<button
					onclick={openPortal}
					disabled={portalLoading}
					class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors disabled:opacity-50"
				>
					{portalLoading ? 'Opening...' : 'Manage Billing'}
				</button>
			{/if}
		</div>

		<!-- Usage meters -->
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
			<div class="space-y-2">
				<div class="flex justify-between text-xs">
					<span class="text-text-tertiary">Verified Actions</span>
					<span class="text-text-secondary font-mono tabular-nums">
						{data.usage.verifiedActions.toLocaleString()} / {data.usage.maxVerifiedActions.toLocaleString()}
					</span>
				</div>
				<div class="h-2 rounded-full bg-surface-overlay overflow-hidden">
					<div
						class="h-full rounded-full transition-all {usageBarClass(actionsPercent)}"
						style="width: {actionsPercent}%"
					></div>
				</div>
			</div>
			<div class="space-y-2">
				<div class="flex justify-between text-xs">
					<span class="text-text-tertiary">Emails Sent</span>
					<span class="text-text-secondary font-mono tabular-nums">
						{data.usage.emailsSent.toLocaleString()} / {data.usage.maxEmails.toLocaleString()}
					</span>
				</div>
				<div class="h-2 rounded-full bg-surface-overlay overflow-hidden">
					<div
						class="h-full rounded-full transition-all {usageBarClass(emailsPercent)}"
						style="width: {emailsPercent}%"
					></div>
				</div>
			</div>
		</div>
	</section>

	<!-- Plan Selection -->
	{#if isOwner}
		<section class="space-y-4">
			<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Plans</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				{#each plans as plan}
					{@const isCurrent = planName === plan.slug}
					{@const isUpgrade = !isCurrent && plan.slug !== 'free'}
					<div
						class="rounded-md border p-5 space-y-4 {isCurrent
							? 'border-teal-500/40 bg-teal-500/5'
							: 'border-surface-border bg-surface-base'}"
					>
						<div>
							<h3 class="text-base font-semibold text-text-primary">{plan.name}</h3>
							<p class="text-xl font-bold text-text-primary mt-1">
								{plan.price}<span class="text-xs font-normal text-text-tertiary">/mo</span>
							</p>
						</div>
						<ul class="space-y-1.5">
							{#each plan.features as feature}
								<li class="text-xs text-text-tertiary flex items-start gap-1.5">
									<svg class="w-3.5 h-3.5 text-teal-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
									</svg>
									{feature}
								</li>
							{/each}
						</ul>
						{#if isCurrent}
							<div class="text-xs text-teal-400 font-medium pt-1">Current plan</div>
						{:else if isUpgrade}
							<button
								onclick={() => startCheckout(plan.slug)}
								disabled={!!checkoutLoading}
								class="w-full px-3 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50"
							>
								{checkoutLoading === plan.slug ? 'Redirecting...' : 'Upgrade'}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Team Members -->
	<section class="space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Team</h2>
			<span class="text-xs text-text-tertiary font-mono tabular-nums">{seatsUsed} of {maxSeats} seats used</span>
		</div>
		<div class="rounded-md border border-surface-border bg-surface-base divide-y divide-surface-border">
			{#each data.members as member}
				<div class="flex items-center gap-3 px-5 py-3">
					{#if member.avatar}
						<img src={member.avatar} alt="" class="w-8 h-8 rounded-full" />
					{:else}
						<div class="w-8 h-8 rounded-full bg-surface-border-strong flex items-center justify-center text-text-secondary text-xs font-medium">
							{(member.name ?? member.email).charAt(0).toUpperCase()}
						</div>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="text-sm text-text-primary truncate">{member.name ?? member.email}</p>
						{#if member.name}
							<p class="text-xs text-text-tertiary truncate">{member.email}</p>
						{/if}
					</div>
					<span class="text-xs px-2 py-0.5 rounded border bg-surface-overlay border-surface-border-strong text-text-tertiary capitalize">
						{member.role}
					</span>
				</div>
			{/each}
		</div>

		<!-- Invite Form (editor+ only) -->
		{#if canInvite}
			<div class="rounded-md border border-surface-border bg-surface-base p-5 space-y-3">
				<h3 class="text-sm font-medium text-text-primary">Invite a team member</h3>
				{#if atSeatLimit}
					<p class="text-xs text-amber-400">All {maxSeats} seats are in use. Upgrade your plan to invite more members.</p>
				{/if}
				<form
					onsubmit={(e) => { e.preventDefault(); sendInvite(); }}
					class="flex flex-col sm:flex-row gap-3"
				>
					<input
						type="email"
						bind:value={inviteEmail}
						placeholder="colleague@example.com"
						disabled={inviteSending || atSeatLimit}
						class="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 disabled:opacity-50"
					/>
					<select
						bind:value={inviteRole}
						disabled={inviteSending || atSeatLimit}
						class="px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-secondary focus:outline-none focus:border-teal-500 disabled:opacity-50"
					>
						<option value="member">Member</option>
						<option value="editor">Editor</option>
					</select>
					<button
						type="submit"
						disabled={!isValidEmail || inviteSending || atSeatLimit}
						class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
					>
						{inviteSending ? 'Sending...' : 'Send Invite'}
					</button>
				</form>
				{#if inviteMessage}
					<p class="text-xs {inviteMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}">
						{inviteMessage.text}
					</p>
				{/if}
			</div>
		{/if}

		<!-- Pending Invites -->
		{#if data.invites.length > 0}
			<div class="space-y-2">
				<h3 class="text-xs text-text-tertiary font-medium">Pending Invites</h3>
				<div class="rounded-lg border border-surface-border bg-surface-base divide-y divide-surface-border">
					{#each data.invites as invite}
						<div class="flex items-center justify-between px-4 py-2.5 text-sm">
							<span class="text-text-tertiary">{decryptedInviteEmails[invite.id] ?? '[decrypting...]'}</span>
							<div class="flex items-center gap-3">
								<span class="text-xs px-2 py-0.5 rounded border bg-surface-overlay border-surface-border-strong text-text-tertiary capitalize">{invite.role}</span>
								<span class="text-xs text-text-quaternary">expires {formatDate(invite.expiresAt)}</span>
								{#if canInvite}
									<button
										onclick={() => resendInvite(invite.id)}
										disabled={resendingId === invite.id || !!revokingId}
										class="text-xs px-2 py-1 rounded border border-surface-border-strong text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{resendingId === invite.id ? 'Resending...' : 'Resend'}
									</button>
									<button
										onclick={() => revokeInvite(invite.id)}
										disabled={revokingId === invite.id || !!resendingId}
										class="text-xs px-2 py-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{revokingId === invite.id ? 'Revoking...' : 'Revoke'}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</section>

	<!-- Issue Domains -->
	<section class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Issue Domains</h2>
				<p class="text-xs text-text-tertiary mt-1">Define your organization's focus areas for legislative tracking.</p>
			</div>
			<span class="text-xs text-text-tertiary font-mono tabular-nums">{domainCount} of 20</span>
		</div>

		<!-- Existing domains list -->
		{#if data.issueDomains.length > 0}
			<div class="rounded-md border border-surface-border bg-surface-base divide-y divide-surface-border">
				{#each data.issueDomains as domain}
					<div class="px-5 py-3">
						<div class="flex items-center justify-between">
							<div class="min-w-0 flex-1">
								<p class="text-sm text-text-primary font-medium">{domain.label}</p>
								{#if domain.description}
									<p class="text-xs text-text-tertiary mt-0.5 truncate">{domain.description}</p>
								{/if}
							</div>
							<div class="flex items-center gap-3 ml-3 shrink-0">
								<span class="text-xs px-2 py-0.5 rounded border bg-surface-overlay border-surface-border-strong text-text-tertiary font-mono tabular-nums">
									{domain.weight.toFixed(1)}x
								</span>
								{#if canEdit}
									<button
										onclick={() => startEditDomain(domain)}
										disabled={!!deletingDomainId}
										class="text-xs px-2 py-1 rounded border border-surface-border-strong text-text-secondary hover:text-text-primary hover:bg-surface-overlay transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										Edit
									</button>
									<button
										onclick={() => deleteDomain(domain.id)}
										disabled={deletingDomainId === domain.id}
										class="text-xs px-2 py-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{deletingDomainId === domain.id ? 'Removing...' : 'Remove'}
									</button>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Add/Edit domain form (editor+ only) -->
		{#if canEdit}
			<div class="rounded-md border border-surface-border bg-surface-base p-5 space-y-3">
				<h3 class="text-sm font-medium text-text-primary">
					{editingDomainId ? 'Edit issue domain' : 'Add an issue domain'}
				</h3>
				{#if atDomainLimit && !editingDomainId}
					<p class="text-xs text-amber-400">Maximum of 20 issue domains reached.</p>
				{/if}
				<form
					onsubmit={(e) => { e.preventDefault(); saveDomain(); }}
					class="space-y-3"
				>
					<div class="flex flex-col sm:flex-row gap-3">
						<input
							type="text"
							bind:value={domainLabel}
							placeholder="e.g. water rights, school safety, transit equity"
							maxlength={100}
							disabled={domainSaving || (atDomainLimit && !editingDomainId)}
							class="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 disabled:opacity-50"
						/>
					</div>
					<textarea
						bind:value={domainDescription}
						placeholder="Optional description (helps match legislation more accurately)"
						maxlength={500}
						rows={2}
						disabled={domainSaving || (atDomainLimit && !editingDomainId)}
						class="w-full px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 disabled:opacity-50 resize-none"
					></textarea>
					<div class="flex flex-col sm:flex-row items-start sm:items-center gap-3">
						<div class="flex items-center gap-2">
							<label for="domain-weight" class="text-xs text-text-tertiary whitespace-nowrap">Priority weight</label>
							<input
								id="domain-weight"
								type="range"
								bind:value={domainWeight}
								min={0.5}
								max={2.0}
								step={0.1}
								disabled={domainSaving || (atDomainLimit && !editingDomainId)}
								class="w-24 accent-teal-500"
							/>
							<span class="text-xs text-text-secondary font-mono tabular-nums w-8">{domainWeight.toFixed(1)}</span>
						</div>
						<div class="flex gap-2 sm:ml-auto">
							{#if editingDomainId}
								<button
									type="button"
									onclick={cancelEditDomain}
									class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors"
								>
									Cancel
								</button>
							{/if}
							<button
								type="submit"
								disabled={!domainLabel.trim() || domainSaving || (atDomainLimit && !editingDomainId)}
								class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
							>
								{domainSaving ? 'Saving...' : editingDomainId ? 'Update Domain' : 'Add Domain'}
							</button>
						</div>
					</div>
				</form>
				{#if domainMessage}
					<p class="text-xs {domainMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}">
						{domainMessage.text}
					</p>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Supporter Encryption -->
	{#if isOwner}
		<section class="space-y-4">
			<div>
				<h2 class="text-sm font-medium text-text-secondary uppercase tracking-wider">Supporter Encryption</h2>
				<p class="text-xs text-text-tertiary mt-1">Protect supporter PII with an organization-held encryption key.</p>
			</div>

			{#if encryptionConfigured && setupStep !== 'done'}
				<!-- Configured state -->
				<div class="rounded-md border border-surface-border bg-surface-base p-5 space-y-3">
					<div class="flex items-center gap-3">
						<div class="flex items-center gap-2">
							<svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
							</svg>
							<span class="text-sm text-text-primary font-medium">Encryption active</span>
						</div>
						{#if deviceCheckDone}
							<span class="text-xs font-mono {deviceUnlocked ? 'text-emerald-500' : 'text-amber-400'}">
								{deviceUnlocked ? 'unlocked on this device' : 'locked on this device'}
							</span>
						{/if}
					</div>
					<p class="text-xs text-text-tertiary leading-relaxed">
						Your encryption key is configured. Once data migration completes, supporter names, emails,
						and phone numbers will be encrypted with your organization's key — accessible only to team members with the passphrase.
					</p>

					<!-- Unlock prompt for devices without cached key -->
					{#if deviceCheckDone && !deviceUnlocked}
						<div class="border-t border-surface-border pt-3 space-y-3">
							<p class="text-xs text-text-secondary">
								Enter the organization passphrase to unlock encryption on this device.
							</p>
							{#if unlockError}
								<div class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
									{unlockError}
								</div>
							{/if}
							{#if !showRecoveryFlow}
								<form onsubmit={(e) => { e.preventDefault(); unlockWithPassphrase(); }} class="flex flex-col sm:flex-row gap-3">
									<input
										type="password"
										bind:value={unlockPassphrase}
										placeholder="Organization passphrase"
										autocomplete="current-password"
										disabled={unlockLoading}
										class="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-50"
									/>
									<button
										type="submit"
										disabled={!unlockPassphrase.trim() || unlockLoading}
										class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
									>
										{unlockLoading ? 'Unlocking...' : 'Unlock'}
									</button>
								</form>
								{#if isOwner && data.encryption.recoveryWrappedOrgKey}
									<button
										onclick={() => { showRecoveryFlow = true; unlockError = ''; }}
										class="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
									>
										Forgot passphrase? Use recovery words
									</button>
								{/if}
							{:else}
								<!-- Recovery flow -->
								<div class="space-y-3">
									<p class="text-xs text-text-secondary">
										Enter your 24-word recovery phrase, separated by spaces.
									</p>
									{#if recoveryError}
										<div class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
											{recoveryError}
										</div>
									{/if}
									<textarea
										bind:value={recoveryInput}
										placeholder="word1 word2 word3 ... word24"
										rows={3}
										disabled={recoveryLoading}
										class="w-full px-3 py-2 text-sm font-mono rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 disabled:opacity-50 resize-none"
									></textarea>
									<div class="flex gap-3">
										<button
											onclick={() => { showRecoveryFlow = false; recoveryInput = ''; recoveryError = ''; }}
											class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors"
										>
											Back
										</button>
										<button
											onclick={recoverWithMnemonic}
											disabled={!recoveryInput.trim() || recoveryLoading}
											class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
										>
											{recoveryLoading ? 'Recovering...' : 'Recover Key'}
										</button>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Change passphrase (owner, device unlocked) -->
					{#if deviceCheckDone && deviceUnlocked && isOwner}
						<div class="border-t border-surface-border pt-3">
							{#if !showRotation}
								<button
									onclick={startRotation}
									class="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
								>
									Change passphrase
								</button>
							{:else if rotationStep === 'verify'}
								<div class="space-y-3">
									<p class="text-xs text-text-secondary">Verify your current passphrase to continue.</p>
									{#if rotationError}
										<div class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{rotationError}</div>
									{/if}
									<form onsubmit={(e) => { e.preventDefault(); verifyCurrentPassphrase(); }} class="flex flex-col sm:flex-row gap-3">
										<input type="password" bind:value={rotationCurrentPassphrase} placeholder="Current passphrase" autocomplete="current-password" class="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500" />
										<button type="submit" disabled={!rotationCurrentPassphrase.trim()} class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">Verify</button>
										<button type="button" onclick={cancelRotation} class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors">Cancel</button>
									</form>
								</div>
							{:else if rotationStep === 'newpass'}
								<div class="space-y-3">
									<p class="text-xs text-text-secondary">Enter a new passphrase (minimum 12 characters).</p>
									<input type="password" bind:value={rotationNewPassphrase} placeholder="New passphrase" autocomplete="new-password" class="w-full px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500" />
									<input type="password" bind:value={rotationNewConfirm} placeholder="Confirm new passphrase" autocomplete="new-password" class="w-full px-3 py-2 text-sm rounded-lg border {rotationNewConfirm && rotationNewPassphrase !== rotationNewConfirm ? 'border-red-500/50' : 'border-surface-border-strong'} bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500" />
									<div class="flex gap-3">
										<button onclick={cancelRotation} class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors">Cancel</button>
										<button onclick={rotationGenerateRecovery} disabled={!rotationNewValid} class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Generate New Recovery Key</button>
									</div>
								</div>
							{:else if rotationStep === 'recovery'}
								<div class="space-y-3">
									<p class="text-xs text-text-secondary">Write down your new 24-word recovery key. The old recovery key will no longer work.</p>
									{#if rotationError}
										<div class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{rotationError}</div>
									{/if}
									<div class="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-2 py-3 px-2 rounded border border-surface-border bg-surface-overlay">
										{#each rotationRecoveryWords as word, i}
											<div class="flex items-baseline gap-1.5">
												<span class="text-[10px] text-text-quaternary font-mono tabular-nums w-5 text-right shrink-0">{i + 1}.</span>
												<span class="text-sm text-text-primary font-mono font-medium">{word}</span>
											</div>
										{/each}
									</div>
									<label class="flex items-start gap-2.5 cursor-pointer select-none">
										<input type="checkbox" bind:checked={rotationRecoveryAck} class="mt-0.5 rounded border-surface-border-strong accent-teal-500" />
										<span class="text-xs text-text-secondary leading-relaxed">I have written down these new recovery words.</span>
									</label>
									<div class="flex gap-3">
										<button onclick={cancelRotation} class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors">Cancel</button>
										<button onclick={finalizeRotation} disabled={!rotationRecoveryAck || rotationLoading} class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">{rotationLoading ? 'Saving...' : 'Save New Passphrase'}</button>
									</div>
								</div>
							{:else if rotationStep === 'saving'}
								<div class="flex items-center gap-3">
									<div class="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent"></div>
									<span class="text-sm text-text-secondary">Updating passphrase...</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>

			{:else if setupStep === 'idle'}
				<!-- Not configured — setup CTA -->
				<div class="rounded-md border border-surface-border bg-surface-base p-5 space-y-4">
					<div class="space-y-2">
						<p class="text-sm text-text-primary leading-relaxed">
							Encryption protects your supporters' personal information with a passphrase that only your organization holds.
							Once enabled, Commons cannot read supporter names, emails, or phone numbers — only your team can.
						</p>
						<p class="text-xs text-text-tertiary leading-relaxed">
							You will create a passphrase and receive a 24-word recovery key. If all team members forget the passphrase,
							the recovery key is the only way to regain access. Store it securely offline.
						</p>
					</div>
					<button
						onclick={startEncryptionSetup}
						class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors"
					>
						Set Up Encryption
					</button>
				</div>

			{:else if setupStep === 'passphrase'}
				<!-- Step 1: Create passphrase -->
				<div class="rounded-md border border-surface-border bg-surface-base p-5 space-y-5">
					<div>
						<h3 class="text-sm font-semibold text-text-primary">Create a passphrase</h3>
						<p class="text-xs text-text-tertiary mt-1 leading-relaxed">
							This passphrase derives the encryption key for all supporter data in your organization.
							Every team member who needs to view supporter information will need this passphrase.
							Minimum 12 characters.
						</p>
					</div>

					{#if encryptionError}
						<div class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
							{encryptionError}
						</div>
					{/if}

					<form onsubmit={(e) => { e.preventDefault(); proceedToRecovery(); }} class="space-y-3">
						<div class="space-y-1">
							<label for="enc-passphrase" class="text-xs text-text-tertiary">Passphrase</label>
							<input
								id="enc-passphrase"
								type="password"
								bind:value={passphrase}
								placeholder="At least 12 characters"
								autocomplete="new-password"
								class="w-full px-3 py-2 text-sm rounded-lg border border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
							/>
							{#if passphrase.length > 0 && passphrase.length < 12}
								<p class="text-xs text-amber-400">{12 - passphrase.length} more characters needed</p>
							{/if}
						</div>
						<div class="space-y-1">
							<label for="enc-confirm" class="text-xs text-text-tertiary">Confirm passphrase</label>
							<input
								id="enc-confirm"
								type="password"
								bind:value={passphraseConfirm}
								placeholder="Re-enter passphrase"
								autocomplete="new-password"
								class="w-full px-3 py-2 text-sm rounded-lg border {passphraseMismatch ? 'border-red-500/50' : 'border-surface-border-strong'} bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
							/>
							{#if passphraseMismatch}
								<p class="text-xs text-red-400">Passphrases do not match</p>
							{/if}
						</div>
						<div class="flex gap-3 pt-1">
							<button
								type="button"
								onclick={cancelEncryptionSetup}
								class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={!passphraseValid}
								class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							>
								Generate Recovery Key
							</button>
						</div>
					</form>
				</div>

			{:else if setupStep === 'recovery'}
				<!-- Step 2: Recovery words -->
				<div class="rounded-md border border-surface-border bg-surface-base p-5 space-y-5">
					<div>
						<h3 class="text-sm font-semibold text-text-primary">Recovery key</h3>
						<p class="text-xs text-text-tertiary mt-1 leading-relaxed">
							Write these 24 words down on paper and store them somewhere safe.
							If every team member forgets the passphrase, these words are the only way to recover access to encrypted supporter data.
						</p>
					</div>

					{#if encryptionError}
						<div class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
							{encryptionError}
						</div>
					{/if}

					<!-- Recovery word grid -->
					<div class="grid grid-cols-3 sm:grid-cols-4 gap-x-4 gap-y-2 py-3 px-2 rounded border border-surface-border bg-surface-overlay">
						{#each recoveryWords as word, i}
							<div class="flex items-baseline gap-1.5">
								<span class="text-[10px] text-text-quaternary font-mono tabular-nums w-5 text-right shrink-0">{i + 1}.</span>
								<span class="text-sm text-text-primary font-mono font-medium">{word}</span>
							</div>
						{/each}
					</div>

					<label class="flex items-start gap-2.5 cursor-pointer select-none">
						<input
							type="checkbox"
							bind:checked={recoveryAcknowledged}
							class="mt-0.5 rounded border-surface-border-strong accent-teal-500"
						/>
						<span class="text-xs text-text-secondary leading-relaxed">
							I have written down these 24 words and stored them securely.
							I understand that if I lose both the passphrase and these words,
							encrypted supporter data cannot be recovered.
						</span>
					</label>

					<div class="flex gap-3">
						<button
							type="button"
							onclick={() => { setupStep = 'passphrase'; encryptionError = ''; }}
							class="px-4 py-2 text-sm border border-surface-border-strong text-text-secondary rounded-lg hover:bg-surface-raised transition-colors"
						>
							Back
						</button>
						<button
							onclick={finalizeEncryptionSetup}
							disabled={!recoveryAcknowledged || encryptionSaving}
							class="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						>
							{encryptionSaving ? 'Configuring...' : 'Enable Encryption'}
						</button>
					</div>
				</div>

			{:else if setupStep === 'saving'}
				<!-- Saving state -->
				<div class="rounded-md border border-surface-border bg-surface-base p-5">
					<div class="flex items-center gap-3">
						<div class="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent"></div>
						<span class="text-sm text-text-secondary">Deriving encryption key and configuring...</span>
					</div>
				</div>

			{:else if setupStep === 'done'}
				<!-- Just completed setup -->
				<div class="rounded-md border border-emerald-500/20 bg-surface-base p-5 space-y-3">
					<div class="flex items-center gap-2">
						<svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
						</svg>
						<span class="text-sm text-text-primary font-medium">Encryption configured</span>
					</div>
					<p class="text-xs text-text-tertiary leading-relaxed">
						Your organization's encryption key has been derived and cached on this device.
						Share the passphrase securely with team members who need to view supporter data.
					</p>
				</div>
			{/if}
		</section>
	{/if}
</div>
