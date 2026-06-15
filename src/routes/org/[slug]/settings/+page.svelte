<script lang="ts">
	import { page } from '$app/stores';
	import { invalidateAll } from '$app/navigation';
	import { computeOrgScopedEmailHash } from '$lib/core/crypto/org-scoped-hash';
	import { FEATURES } from '$lib/config/features';
	import { Datum } from '$lib/design';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const isOwner = $derived(data.membership.role === 'owner');
	const canEdit = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');
	const canInvite = $derived(data.membership.role === 'owner' || data.membership.role === 'editor');
	const planName = $derived(data.usage.plan ?? data.subscription?.plan ?? 'inactive');

	// Invite form state
	let inviteEmail = $state('');
	let inviteRole = $state<'member' | 'editor'>('member');
	let inviteSending = $state(false);
	let inviteMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

	// Invite action loading states (keyed by invite id)
	let resendingId = $state<string | null>(null);
	let revokingId = $state<string | null>(null);

	// Member action loading states (keyed by membership id)
	let memberMutatingId = $state<string | null>(null);
	let memberMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

	async function changeMemberRole(membershipId: string, role: 'owner' | 'editor' | 'member') {
		if (memberMutatingId) return;
		memberMutatingId = membershipId;
		memberMessage = null;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/members`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ membershipId, role })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to update role' }));
				memberMessage = { type: 'error', text: err.message ?? 'Failed to update role' };
				return;
			}
			memberMessage = { type: 'success', text: 'Role updated' };
			await invalidateAll();
		} catch {
			memberMessage = { type: 'error', text: 'Network error. Please try again.' };
		} finally {
			memberMutatingId = null;
		}
	}

	async function removeMember(membershipId: string, label: string) {
		if (memberMutatingId) return;
		if (!confirm(`Remove ${label} from the organization?`)) return;
		memberMutatingId = membershipId;
		memberMessage = null;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/members`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ membershipId })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to remove member' }));
				memberMessage = { type: 'error', text: err.message ?? 'Failed to remove member' };
				return;
			}
			memberMessage = { type: 'success', text: 'Member removed' };
			await invalidateAll();
		} catch {
			memberMessage = { type: 'error', text: 'Network error. Please try again.' };
		} finally {
			memberMutatingId = null;
		}
	}

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
	const ownerCount = $derived(data.members.filter((member) => member.role === 'owner').length);

	const isValidEmail = $derived(
		inviteEmail.trim().length > 0 && inviteEmail.includes('@') && inviteEmail.includes('.')
	);

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

	// ── Branding editor (Coalition-tier: logo upload + accent + white-label) ──
	const isCoalition = $derived(planName === 'coalition');
	let brandingAccent = $state(data.org.brandingAccent ?? '');
	let brandingLogoUrl = $state<string | null>(data.org.logoUrl ?? null);
	let whiteLabel = $state(data.org.whiteLabel ?? false);
	let brandingSaving = $state(false);
	let logoUploading = $state(false);
	let brandingMessage = $state<{ type: 'success' | 'error'; text: string } | null>(null);

	const accentValid = $derived(
		brandingAccent.trim() === '' || /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(brandingAccent.trim())
	);
	const accentPreview = $derived(
		accentValid && brandingAccent.trim()
			? brandingAccent.trim().startsWith('#')
				? brandingAccent.trim()
				: `#${brandingAccent.trim()}`
			: '#0d9488'
	);

	async function uploadLogo(file: File) {
		if (!isCoalition || logoUploading) return;
		if (!file.type.startsWith('image/')) {
			brandingMessage = { type: 'error', text: 'Logo must be an image file.' };
			return;
		}
		// 2 MiB cap — logos are small; this bounds Convex storage + email weight.
		if (file.size > 2 * 1024 * 1024) {
			brandingMessage = { type: 'error', text: 'Logo must be 2 MB or smaller.' };
			return;
		}
		logoUploading = true;
		brandingMessage = null;
		try {
			const urlRes = await fetch(`/api/org/${data.org.slug}/branding`, { method: 'POST' });
			if (!urlRes.ok) {
				const err = await urlRes.json().catch(() => ({ message: 'Failed to start upload' }));
				brandingMessage = { type: 'error', text: err.message ?? 'Failed to start upload' };
				return;
			}
			const { uploadUrl } = await urlRes.json();
			const putRes = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': file.type },
				body: file
			});
			if (!putRes.ok) {
				brandingMessage = { type: 'error', text: 'Logo upload failed. Please try again.' };
				return;
			}
			const { storageId } = await putRes.json();
			const saveRes = await fetch(`/api/org/${data.org.slug}/branding`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ logoStorageId: storageId })
			});
			if (!saveRes.ok) {
				const err = await saveRes.json().catch(() => ({ message: 'Failed to save logo' }));
				brandingMessage = { type: 'error', text: err.message ?? 'Failed to save logo' };
				return;
			}
			brandingMessage = { type: 'success', text: 'Logo uploaded.' };
			await invalidateAll();
			brandingLogoUrl = data.org.logoUrl ?? brandingLogoUrl;
		} catch {
			brandingMessage = { type: 'error', text: 'Network error during upload.' };
		} finally {
			logoUploading = false;
		}
	}

	function onLogoInput(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) void uploadLogo(file);
		input.value = '';
	}

	async function patchBranding(payload: Record<string, unknown>, okText: string) {
		brandingSaving = true;
		brandingMessage = null;
		try {
			const res = await fetch(`/api/org/${data.org.slug}/branding`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: 'Failed to save branding' }));
				brandingMessage = { type: 'error', text: err.message ?? 'Failed to save branding' };
				return false;
			}
			brandingMessage = { type: 'success', text: okText };
			await invalidateAll();
			return true;
		} catch {
			brandingMessage = { type: 'error', text: 'Network error. Please try again.' };
			return false;
		} finally {
			brandingSaving = false;
		}
	}

	async function saveAccent() {
		if (!isCoalition || brandingSaving || !accentValid) return;
		await patchBranding({ brandingAccent: brandingAccent.trim() || null }, 'Accent color saved.');
	}

	async function removeLogo() {
		if (!isCoalition || brandingSaving) return;
		const ok = await patchBranding({ logoStorageId: null }, 'Logo removed.');
		if (ok) brandingLogoUrl = null;
	}

	async function toggleWhiteLabel() {
		if (!isCoalition || brandingSaving) return;
		const next = !whiteLabel;
		const ok = await patchBranding(
			{ whiteLabel: next },
			next ? 'White-label enabled on outbound surfaces.' : 'Commons branding restored.'
		);
		if (ok) whiteLabel = next;
	}

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
	const smsPercent = $derived(
		data.usage.maxSms > 0 ? Math.min(100, (data.usage.smsSent / data.usage.maxSms) * 100) : 0
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

	function canRemoveMember(member: { role: string }): boolean {
		if (!isOwner) return false;
		if (member.role === 'owner' && ownerCount <= 1) return false;
		return true;
	}

	function roleOptionDisabled(
		member: { role: string },
		role: 'owner' | 'editor' | 'member'
	): boolean {
		if (!isOwner) return true;
		if (member.role === 'owner' && ownerCount <= 1 && role !== 'owner') return true;
		return false;
	}

	const plans = $derived(data.planCatalog);

	type PlanFeatureState = 'live' | 'partial' | 'draft-only' | 'gated';

	function featureStateClass(state: PlanFeatureState): string {
		switch (state) {
			case 'live':
				return 'border-teal-500/30 bg-teal-500/10 text-teal-300';
			case 'partial':
				return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
			case 'draft-only':
			case 'gated':
				return 'border-surface-border-strong bg-surface-overlay text-text-quaternary';
		}
	}

	function featureStateLabel(state: PlanFeatureState): string {
		switch (state) {
			case 'live':
				return 'included';
			case 'partial':
				return 'limited';
			case 'draft-only':
			case 'gated':
				return 'coming';
		}
	}

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
	let rotationRecoveryWords = $state<string[]>([]);
	let rotationRecoveryAck = $state(false);
	let rotationError = $state('');
	let rotationLoading = $state(false);
	let rotationStep = $state<'verify' | 'recovery' | 'saving'>('verify');

	let rotationRecoveryKeyBytes: Uint8Array | null = null;

	function startRotation() {
		showRotation = true;
		rotationStep = 'verify';
		rotationCurrentPassphrase = '';
		rotationRecoveryWords = [];
		rotationRecoveryAck = false;
		rotationError = '';
		rotationRecoveryKeyBytes = null;
	}

	function cancelRotation() {
		showRotation = false;
		rotationCurrentPassphrase = '';
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
			// Current passphrase verified — hold the key, generate new recovery
			cachedOrgKey = key;
			// Go straight to recovery generation (passphrase can't change
			// without re-encrypting all data — this resets recovery only)
			try {
				const { generateRecoveryKey } = await import('$lib/core/crypto/org-pii-encryption');
				const recovery = await generateRecoveryKey();
				rotationRecoveryWords = recovery.words;
				rotationRecoveryKeyBytes = recovery.key;
				rotationStep = 'recovery';
			} catch (err2) {
				rotationError = err2 instanceof Error ? err2.message : 'Failed to generate recovery key';
			}
		} catch (err) {
			rotationError = err instanceof Error ? err.message : 'Verification failed';
		}
	}

	async function finalizeRotation() {
		if (!rotationRecoveryAck || !rotationRecoveryKeyBytes || !cachedOrgKey || rotationLoading)
			return;
		rotationLoading = true;
		rotationError = '';
		rotationStep = 'saving';

		try {
			const { createKeyVerifier, wrapOrgKeyForRecovery } =
				await import('$lib/core/crypto/org-pii-encryption');
			const { cacheOrgKey } = await import('$lib/services/org-key-manager');
			const { useConvexClient } = await import('convex-sveltekit');
			const { api: convexApi } = await import('$lib/convex');

			// Re-wrap existing org key with new recovery key + fresh verifier
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
			const { mnemonicToRecoveryKey, unwrapOrgKeyFromRecovery } =
				await import('$lib/core/crypto/org-pii-encryption');
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

	async function decryptInviteEmails(invites: typeof data.invites, orgKey: CryptoKey | null) {
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

	const passphraseValid = $derived(passphrase.length >= 12 && passphrase === passphraseConfirm);
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
			const { deriveOrgKey, createKeyVerifier, wrapOrgKeyForRecovery } =
				await import('$lib/core/crypto/org-pii-encryption');
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
				console.warn(
					'[Encryption] Server seal failed (wrapping key may not be configured):',
					sealErr
				);
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

	function startEditDomain(domain: (typeof data.issueDomains)[0]) {
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
				const err = await res
					.json()
					.catch(() => ({ message: `Failed to ${isEdit ? 'update' : 'create'} issue domain` }));
				domainMessage = {
					type: 'error',
					text: err.message ?? `Failed to ${isEdit ? 'update' : 'create'} issue domain`
				};
				return;
			}
			domainMessage = {
				type: 'success',
				text: isEdit ? 'Issue domain updated' : 'Issue domain created'
			};
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
	<div id="org-authority">
		<h1 class="text-text-primary text-xl font-semibold">Settings</h1>
		<p class="text-text-tertiary mt-1 text-sm">
			Plan and billing, team roles, data custody, and integrations.
		</p>
	</div>

	<!-- Billing status banner -->
	{#if billingSuccess}
		<div
			class="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
		>
			Subscription activated successfully. Your plan limits are now in effect.
		</div>
	{/if}
	{#if billingCanceled}
		<div
			class="border-surface-border-strong bg-surface-overlay text-text-tertiary rounded-lg border px-4 py-3 text-sm"
		>
			Checkout was canceled. Your plan has not changed.
		</div>
	{/if}

	<!-- Plan limit ground -->
	<section
		id="plan-limits"
		class="bg-surface-base border-surface-border space-y-5 rounded-md border p-6"
	>
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">
					Plan limit ground
				</h2>
				<div class="mt-2 flex items-center gap-3">
					<span class="text-text-primary text-2xl font-semibold capitalize">{planName}</span>
					{#if data.subscription}
						<span
							class="inline-flex items-center rounded border px-2 py-0.5 text-xs {statusBadgeClass(
								data.subscription.status
							)}"
						>
							{data.subscription.status}
						</span>
					{/if}
				</div>
				{#if data.subscription?.currentPeriodEnd}
					<p class="text-text-tertiary mt-1 text-xs">
						{data.subscription.status === 'canceled' ? 'Access until' : 'Renews'}
						{formatDate(data.subscription.currentPeriodEnd)}
					</p>
				{/if}
				<p class="text-text-quaternary mt-1 text-xs">
					Usage period starts {formatDate(data.usage.periodStart)}. Limits come from the enforced
					billing query.
				</p>
			</div>
			{#if isOwner && data.subscription && data.subscription.status !== 'canceled'}
				<button
					onclick={openPortal}
					disabled={portalLoading}
					class="border-surface-border-strong text-text-secondary hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-50"
				>
					{portalLoading ? 'Opening...' : 'Open billing portal'}
				</button>
			{/if}
		</div>

		<!-- Usage meters -->
		<div class="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-3">
			<div class="space-y-2">
				<div class="flex justify-between text-xs">
					<span class="text-text-tertiary">Verified Actions</span>
					<span class="text-text-secondary font-mono tabular-nums">
						<Datum
							value={data.usage.verifiedActions}
						/> / <Datum
							value={data.usage.maxVerifiedActions}
						/>
					</span>
				</div>
				<div class="bg-surface-overlay h-2 overflow-hidden rounded-full">
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
						<Datum
							value={data.usage.emailsSent}
						/> / <Datum
							value={data.usage.maxEmails}
						/>
					</span>
				</div>
				<div class="bg-surface-overlay h-2 overflow-hidden rounded-full">
					<div
						class="h-full rounded-full transition-all {usageBarClass(emailsPercent)}"
						style="width: {emailsPercent}%"
					></div>
				</div>
			</div>
			<div class="space-y-2">
				<div class="flex justify-between text-xs">
					<span class="text-text-tertiary">SMS Reserved</span>
					<span class="text-text-secondary font-mono tabular-nums">
						<Datum
							value={data.usage.smsSent}
						/> / <Datum
							value={data.usage.maxSms}
						/>
					</span>
				</div>
				<div class="bg-surface-overlay h-2 overflow-hidden rounded-full">
					<div
						class="h-full rounded-full transition-all {usageBarClass(smsPercent)}"
						style="width: {smsPercent}%"
					></div>
				</div>
				<p class="text-text-quaternary text-[11px]">
					Your plan reserves this text quota for when bulk texting is fully available.
				</p>
			</div>
		</div>
	</section>

	<!-- Plans -->
	{#if isOwner}
		<section id="plan-feature-boundary" class="space-y-4">
			<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Plans</h2>
			<div class="border-surface-border bg-surface-base rounded-md border px-4 py-3">
				<p class="text-text-tertiary text-sm">
					Quotas and seats are enforced today. Features marked "coming" are listed for
					transparency and aren't available yet.
				</p>
			</div>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each plans as plan}
					{@const isCurrent = planName === plan.slug}
					{@const isUpgrade = !isCurrent}
					<div
						class="space-y-4 rounded-md border p-5 {isCurrent
							? 'border-teal-500/40 bg-teal-500/5'
							: 'border-surface-border bg-surface-base'}"
					>
						<div>
							<h3 class="text-text-primary text-base font-semibold">{plan.name}</h3>
							<p class="text-text-primary mt-1 text-xl font-bold">
								{plan.price}<span class="text-text-tertiary text-xs font-normal">/mo</span>
							</p>
						</div>
						<ul class="space-y-1.5">
							{#each plan.features as feature}
								<li class="text-text-tertiary space-y-1 text-xs">
									<div class="flex items-start justify-between gap-2">
										<span>{feature.label}</span>
										<span
											class="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase {featureStateClass(
												feature.state
											)}"
										>
											{featureStateLabel(feature.state)}
										</span>
									</div>
									<p class="text-text-quaternary text-[11px] leading-4">{feature.detail}</p>
								</li>
							{/each}
						</ul>
						{#if isCurrent}
							<div class="pt-1 text-xs font-medium text-teal-400">Current tier</div>
						{:else if isUpgrade}
							<button
								onclick={() => startCheckout(plan.slug)}
								disabled={!!checkoutLoading}
								class="w-full rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
							>
								{checkoutLoading === plan.slug ? 'Opening checkout...' : 'Open checkout'}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Branding (Coalition-tier) -->
	{#if canEdit}
		<section id="branding-ground" class="space-y-4">
			<div>
				<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Branding</h2>
				<p class="text-text-tertiary mt-1 text-xs">
					Put your logo and accent color on the reports, embed widget, and scorecard you send to
					decision-makers. The public verification page always keeps its Commons attestation — it's
					the independent proof your supporters and staffers can trust.
				</p>
			</div>

			{#if !isCoalition}
				<div
					class="border-surface-border bg-surface-base flex items-start justify-between gap-4 rounded-md border px-4 py-3"
				>
					<div>
						<p class="text-text-primary text-sm font-medium">Coalition tier feature</p>
						<p class="text-text-tertiary mt-1 text-xs leading-5">
							Custom logo, accent color, and white-label outbound surfaces are part of the Coalition
							plan. Upgrade to brand your reports and embeds.
						</p>
					</div>
					{#if isOwner}
						<button
							onclick={() => startCheckout('coalition')}
							disabled={!!checkoutLoading}
							class="shrink-0 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-50"
						>
							{checkoutLoading === 'coalition' ? 'Opening...' : 'Upgrade to Coalition'}
						</button>
					{/if}
				</div>
			{/if}

			<div
				class="border-surface-border bg-surface-base space-y-5 rounded-md border p-5"
				class:opacity-60={!isCoalition}
			>
				{#if brandingMessage}
					<p
						class="text-xs {brandingMessage.type === 'success'
							? 'text-teal-400'
							: 'text-red-400'}"
						role="status"
					>
						{brandingMessage.text}
					</p>
				{/if}

				<!-- Logo upload -->
				<div class="space-y-2">
					<span class="text-text-secondary text-xs font-medium">Logo</span>
					<div class="flex items-center gap-4">
						<div
							class="border-surface-border bg-surface-overlay flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border"
						>
							{#if brandingLogoUrl}
								<img src={brandingLogoUrl} alt="Org logo" class="h-full w-full object-contain" />
							{:else}
								<span class="text-text-quaternary text-[10px] uppercase">None</span>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<label
								class="border-surface-border bg-surface-overlay hover:border-surface-border-strong cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium text-text-secondary transition-colors {!isCoalition ||
								logoUploading
									? 'pointer-events-none opacity-50'
									: ''}"
							>
								{logoUploading ? 'Uploading...' : brandingLogoUrl ? 'Replace logo' : 'Upload logo'}
								<input
									type="file"
									accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
									class="hidden"
									disabled={!isCoalition || logoUploading}
									onchange={onLogoInput}
								/>
							</label>
							{#if brandingLogoUrl}
								<button
									onclick={removeLogo}
									disabled={!isCoalition || brandingSaving}
									class="text-text-tertiary hover:text-text-secondary text-xs underline disabled:opacity-50"
								>
									Remove
								</button>
							{/if}
						</div>
					</div>
					<p class="text-text-quaternary text-[11px]">PNG, JPEG, GIF, or WebP. Up to 2 MB.</p>
				</div>

				<!-- Accent color -->
				<div class="space-y-2">
					<label for="branding-accent" class="text-text-secondary text-xs font-medium"
						>Accent color</label
					>
					<div class="flex items-center gap-3">
						<span
							class="border-surface-border h-9 w-9 shrink-0 rounded-md border"
							style:background-color={accentPreview}
						></span>
						<input
							id="branding-accent"
							type="text"
							bind:value={brandingAccent}
							placeholder="#0d9488"
							disabled={!isCoalition}
							class="border-surface-border bg-surface-overlay text-text-primary w-32 rounded-lg border px-3 py-2 font-mono text-sm focus:border-teal-500 focus:outline-none disabled:opacity-50"
						/>
						<button
							onclick={saveAccent}
							disabled={!isCoalition || brandingSaving || !accentValid}
							class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{brandingSaving ? 'Saving...' : 'Save accent'}
						</button>
					</div>
					{#if !accentValid}
						<p class="text-xs text-red-400">Enter a valid hex color, e.g. #0d9488.</p>
					{/if}
				</div>

				<!-- White-label toggle (outbound only) -->
				<div class="border-surface-border flex items-start justify-between gap-4 border-t pt-4">
					<div>
						<p class="text-text-primary text-sm font-medium">White-label outbound surfaces</p>
						<p class="text-text-tertiary mt-1 text-xs leading-5">
							Removes the "powered by Commons" footer from the report email, embed widget, and
							scorecard embed. The public verification page keeps its Commons attestation either
							way — that's the independent third-party proof.
						</p>
					</div>
					<button
						onclick={toggleWhiteLabel}
						disabled={!isCoalition || brandingSaving}
						role="switch"
						aria-label="Toggle white-label on outbound surfaces"
						aria-checked={whiteLabel}
						class="relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 {whiteLabel
							? 'bg-teal-600'
							: 'bg-surface-border-strong'}"
					>
						<span
							class="inline-block h-5 w-5 transform rounded-full bg-white transition-transform {whiteLabel
								? 'translate-x-5'
								: 'translate-x-0.5'}"
						></span>
					</button>
				</div>
			</div>
		</section>
	{/if}

	<section id="developer-ground" class="space-y-4">
		<div>
			<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Developers</h2>
			<p class="text-text-tertiary mt-1 text-xs">API access and event webhooks.</p>
		</div>
		<div class="grid gap-3 sm:grid-cols-2">
			<a
				href="/api/v1/docs"
				target="_blank"
				rel="noopener"
				class="border-surface-border bg-surface-base hover:border-surface-border-strong rounded-md border p-4 transition-colors"
			>
				<p class="text-text-primary text-sm font-medium">API documentation</p>
				<p class="text-text-tertiary mt-1 text-xs leading-5">
					OpenAPI reference for the public read API.
				</p>
			</a>
			<a
				href="/org/{data.org.slug}/settings/webhooks"
				class="border-surface-border bg-surface-base hover:border-surface-border-strong rounded-md border p-4 transition-colors"
			>
				<p class="text-text-primary text-sm font-medium">Signed webhooks</p>
				<p class="text-text-tertiary mt-1 text-xs leading-5">
					Subscribe endpoints to org events with HMAC signatures, retries, and secret rotation.
				</p>
			</a>
		</div>
	</section>

	<!-- Team -->
	<section id="team-authority" class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">Team</h2>
				<p class="text-text-quaternary mt-1 text-xs">
					Only owners can change roles or remove members; the last owner can't be removed.
				</p>
			</div>
			<div class="text-right">
				<span class="text-text-tertiary font-mono text-xs tabular-nums"
					>{seatsUsed} of {maxSeats} seats used</span
				>
				<p class="text-text-quaternary mt-1 font-mono text-[0.65rem] uppercase">
					<Datum value={ownerCount} /> owner{ownerCount === 1 ? '' : 's'}
				</p>
			</div>
		</div>
		<div
			class="border-surface-border bg-surface-base divide-surface-border divide-y rounded-md border"
		>
			{#each data.members as member}
				<div class="flex items-center gap-3 px-5 py-3">
					{#if member.avatar}
						<img src={member.avatar} alt="" class="h-8 w-8 rounded-full" />
					{:else}
						<div
							class="bg-surface-border-strong text-text-secondary flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
						>
							{(member.name ?? member.email ?? '?').charAt(0).toUpperCase()}
						</div>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="text-text-primary truncate text-sm">
							{member.name ?? member.email ?? 'Unknown member'}
						</p>
						{#if member.name}
							<p class="text-text-tertiary truncate text-xs">{member.email}</p>
						{/if}
					</div>
					{#if isOwner}
						<select
							value={member.role}
							disabled={memberMutatingId === member.id}
							onchange={(e) => {
								const next = (e.target as HTMLSelectElement).value as 'owner' | 'editor' | 'member';
								if (next !== member.role) changeMemberRole(String(member.id), next);
							}}
							class="bg-surface-overlay border-surface-border-strong text-text-secondary rounded border px-2 py-0.5 text-xs focus:border-teal-500 focus:outline-none disabled:opacity-50"
							title={member.role === 'owner' && ownerCount <= 1
								? 'Last owner cannot be demoted'
								: 'Change member role'}
						>
							<option value="member" disabled={roleOptionDisabled(member, 'member')}>Member</option>
							<option value="editor" disabled={roleOptionDisabled(member, 'editor')}>Editor</option>
							<option value="owner" disabled={roleOptionDisabled(member, 'owner')}>Owner</option>
						</select>
						<button
							type="button"
							onclick={() =>
								removeMember(String(member.id), member.name ?? member.email ?? 'this member')}
							disabled={memberMutatingId === member.id || !canRemoveMember(member)}
							title={member.role === 'owner' && ownerCount <= 1
								? 'Last owner cannot be removed'
								: 'Remove member'}
							class="border-surface-border-strong disabled:text-text-quaternary rounded border px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50"
						>
							Remove
						</button>
					{:else}
						<span
							class="bg-surface-overlay border-surface-border-strong text-text-tertiary rounded border px-2 py-0.5 text-xs capitalize"
						>
							{member.role}
						</span>
					{/if}
				</div>
			{/each}
			{#if memberMessage}
				<div class="px-5 py-2">
					<p
						class="text-xs {memberMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}"
					>
						{memberMessage.text}
					</p>
				</div>
			{/if}
		</div>

		<!-- Invite Form (editor+ only) -->
		{#if canInvite}
			<div class="border-surface-border bg-surface-base space-y-3 rounded-md border p-5">
				<h3 class="text-text-primary text-sm font-medium">Invite role holder</h3>
				{#if atSeatLimit}
					<p class="text-xs text-amber-400">
						All {maxSeats} seats are in use. Increase the plan limit to invite more role holders.
					</p>
				{/if}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						sendInvite();
					}}
					class="flex flex-col gap-3 sm:flex-row"
				>
					<input
						type="email"
						bind:value={inviteEmail}
						placeholder="colleague@example.com"
						disabled={inviteSending || atSeatLimit}
						class="border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none disabled:opacity-50"
					/>
					<select
						bind:value={inviteRole}
						disabled={inviteSending || atSeatLimit}
						class="border-surface-border-strong bg-surface-overlay text-text-secondary rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none disabled:opacity-50"
					>
						<option value="member">Member</option>
						<option value="editor">Editor</option>
					</select>
					<button
						type="submit"
						disabled={!isValidEmail || inviteSending || atSeatLimit}
						class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{inviteSending ? 'Sending...' : 'Send role invite'}
					</button>
				</form>
				{#if inviteMessage}
					<p
						class="text-xs {inviteMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}"
					>
						{inviteMessage.text}
					</p>
				{/if}
			</div>
		{/if}

		<!-- Pending role invites -->
		{#if data.invites.length > 0}
			<div class="space-y-2">
				<h3 class="text-text-tertiary text-xs font-medium">Pending role invites</h3>
				<div
					class="border-surface-border bg-surface-base divide-surface-border divide-y rounded-lg border"
				>
					{#each data.invites as invite}
						<div class="flex items-center justify-between px-4 py-2.5 text-sm">
							<span class="text-text-tertiary"
								>{decryptedInviteEmails[invite.id] ?? '[decrypting...]'}</span
							>
							<div class="flex items-center gap-3">
								<span
									class="bg-surface-overlay border-surface-border-strong text-text-tertiary rounded border px-2 py-0.5 text-xs capitalize"
									>{invite.role}</span
								>
								<span class="text-text-quaternary text-xs"
									>expires {formatDate(invite.expiresAt)}</span
								>
								{#if canInvite}
									<button
										onclick={() => resendInvite(invite.id)}
										disabled={resendingId === invite.id || !!revokingId}
										class="border-surface-border-strong text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
									>
										{resendingId === invite.id ? 'Resending...' : 'Resend'}
									</button>
									<button
										onclick={() => revokeInvite(invite.id)}
										disabled={revokingId === invite.id || !!resendingId}
										class="rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
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

	<!-- Legislative domain basis -->
	<section class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">
					Legislative domain basis
				</h2>
				<p class="text-text-tertiary mt-1 text-xs">
					Define the focus basis used by legislative monitoring, matching, and cohort reasoning.
				</p>
			</div>
			<span class="text-text-tertiary font-mono text-xs tabular-nums">{domainCount} of 20</span>
		</div>

		<!-- Existing domains list -->
		{#if data.issueDomains.length > 0}
			<div
				class="border-surface-border bg-surface-base divide-surface-border divide-y rounded-md border"
			>
				{#each data.issueDomains as domain}
					<div class="px-5 py-3">
						<div class="flex items-center justify-between">
							<div class="min-w-0 flex-1">
								<p class="text-text-primary text-sm font-medium">{domain.label}</p>
								{#if domain.description}
									<p class="text-text-tertiary mt-0.5 truncate text-xs">{domain.description}</p>
								{/if}
							</div>
							<div class="ml-3 flex shrink-0 items-center gap-3">
								<span
									class="bg-surface-overlay border-surface-border-strong text-text-tertiary rounded border px-2 py-0.5 font-mono text-xs tabular-nums"
								>
									{domain.weight.toFixed(1)}x
								</span>
								{#if canEdit}
									<button
										onclick={() => startEditDomain(domain)}
										disabled={!!deletingDomainId}
										class="border-surface-border-strong text-text-secondary hover:text-text-primary hover:bg-surface-overlay rounded border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
									>
										Edit
									</button>
									<button
										onclick={() => deleteDomain(domain.id)}
										disabled={deletingDomainId === domain.id}
										class="rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
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
			<div class="border-surface-border bg-surface-base space-y-3 rounded-md border p-5">
				<h3 class="text-text-primary text-sm font-medium">
					{editingDomainId ? 'Edit domain basis' : 'Add domain basis'}
				</h3>
				{#if atDomainLimit && !editingDomainId}
					<p class="text-xs text-amber-400">Maximum of 20 issue domains reached.</p>
				{/if}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						saveDomain();
					}}
					class="space-y-3"
				>
					<div class="flex flex-col gap-3 sm:flex-row">
						<input
							type="text"
							bind:value={domainLabel}
							placeholder="e.g. water rights, school safety, transit equity"
							maxlength={100}
							disabled={domainSaving || (atDomainLimit && !editingDomainId)}
							class="border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none disabled:opacity-50"
						/>
					</div>
					<textarea
						bind:value={domainDescription}
						placeholder="Optional description (helps match legislation more accurately)"
						maxlength={500}
						rows={2}
						disabled={domainSaving || (atDomainLimit && !editingDomainId)}
						class="border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:outline-none disabled:opacity-50"
					></textarea>
					<div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
						<div class="flex items-center gap-2">
							<label for="domain-weight" class="text-text-tertiary text-xs whitespace-nowrap"
								>Priority weight</label
							>
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
							<span class="text-text-secondary w-8 font-mono text-xs tabular-nums"
								>{domainWeight.toFixed(1)}</span
							>
						</div>
						<div class="flex gap-2 sm:ml-auto">
							{#if editingDomainId}
								<button
									type="button"
									onclick={cancelEditDomain}
									class="border-surface-border-strong text-text-secondary hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm transition-colors"
								>
									Cancel
								</button>
							{/if}
							<button
								type="submit"
								disabled={!domainLabel.trim() ||
									domainSaving ||
									(atDomainLimit && !editingDomainId)}
								class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{domainSaving ? 'Saving...' : editingDomainId ? 'Update basis' : 'Add basis'}
							</button>
						</div>
					</div>
				</form>
				{#if domainMessage}
					<p
						class="text-xs {domainMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}"
					>
						{domainMessage.text}
					</p>
				{/if}
			</div>
		{/if}
	</section>

	<!-- PII encryption authority -->
	{#if isOwner}
		<section id="encryption-authority" class="space-y-4">
			<div>
				<h2 class="text-text-secondary text-sm font-medium tracking-wider uppercase">
					PII encryption authority
				</h2>
				<p class="text-text-tertiary mt-1 text-xs">
					Hold person-row PII behind an organization-held encryption key.
				</p>
			</div>

			{#if encryptionConfigured && setupStep !== 'done'}
				<!-- Configured state -->
				<div class="border-surface-border bg-surface-base space-y-3 rounded-md border p-5">
					<div class="flex items-center gap-3">
						<div class="flex items-center gap-2">
							<svg
								class="h-4 w-4 text-emerald-500"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								stroke-width="2"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
								/>
							</svg>
							<span class="text-text-primary text-sm font-medium">Encryption active</span>
						</div>
						{#if deviceCheckDone}
							<span
								class="font-mono text-xs {deviceUnlocked ? 'text-emerald-500' : 'text-amber-400'}"
							>
								{deviceUnlocked ? 'unlocked on this device' : 'locked on this device'}
							</span>
						{/if}
					</div>
					<p class="text-text-tertiary text-xs leading-relaxed">
						Your encryption key is configured. Once data migration completes, person names, emails,
						and phone numbers will be encrypted with your organization's key, accessible only to
						authorized role holders with the passphrase.
					</p>

					<!-- Unlock prompt for devices without cached key -->
					{#if deviceCheckDone && !deviceUnlocked}
						<div class="border-surface-border space-y-3 border-t pt-3">
							<p class="text-text-secondary text-xs">
								Enter the organization passphrase to unlock encryption on this device.
							</p>
							{#if unlockError}
								<div
									class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
								>
									{unlockError}
								</div>
							{/if}
							{#if !showRecoveryFlow}
								<form
									onsubmit={(e) => {
										e.preventDefault();
										unlockWithPassphrase();
									}}
									class="flex flex-col gap-3 sm:flex-row"
								>
									<input
										type="password"
										bind:value={unlockPassphrase}
										placeholder="Organization passphrase"
										autocomplete="current-password"
										disabled={unlockLoading}
										class="border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none disabled:opacity-50"
									/>
									<button
										type="submit"
										disabled={!unlockPassphrase.trim() || unlockLoading}
										class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{unlockLoading ? 'Unlocking...' : 'Unlock'}
									</button>
								</form>
								{#if isOwner && data.encryption.recoveryWrappedOrgKey}
									<button
										onclick={() => {
											showRecoveryFlow = true;
											unlockError = '';
										}}
										class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
									>
										Forgot passphrase? Use recovery words
									</button>
								{/if}
							{:else}
								<!-- Recovery flow -->
								<div class="space-y-3">
									<p class="text-text-secondary text-xs">
										Enter your 24-word recovery phrase, separated by spaces.
									</p>
									{#if recoveryError}
										<div
											class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
										>
											{recoveryError}
										</div>
									{/if}
									<textarea
										bind:value={recoveryInput}
										placeholder="word1 word2 word3 ... word24"
										rows={3}
										disabled={recoveryLoading}
										class="border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary w-full resize-none rounded-lg border px-3 py-2 font-mono text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none disabled:opacity-50"
									></textarea>
									<div class="flex gap-3">
										<button
											onclick={() => {
												showRecoveryFlow = false;
												recoveryInput = '';
												recoveryError = '';
											}}
											class="border-surface-border-strong text-text-secondary hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm transition-colors"
										>
											Back
										</button>
										<button
											onclick={recoverWithMnemonic}
											disabled={!recoveryInput.trim() || recoveryLoading}
											class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
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
						<div class="border-surface-border border-t pt-3">
							{#if !showRotation}
								<button
									onclick={startRotation}
									class="text-text-tertiary hover:text-text-secondary text-xs transition-colors"
								>
									Reset recovery key
								</button>
							{:else if rotationStep === 'verify'}
								<div class="space-y-3">
									<p class="text-text-secondary text-xs">
										Verify your passphrase to generate a new recovery key.
									</p>
									{#if rotationError}
										<div
											class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
										>
											{rotationError}
										</div>
									{/if}
									<form
										onsubmit={(e) => {
											e.preventDefault();
											verifyCurrentPassphrase();
										}}
										class="flex flex-col gap-3 sm:flex-row"
									>
										<input
											type="password"
											bind:value={rotationCurrentPassphrase}
											placeholder="Current passphrase"
											autocomplete="current-password"
											class="border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
										/>
										<button
											type="submit"
											disabled={!rotationCurrentPassphrase.trim()}
											class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
											>Verify</button
										>
										<button
											type="button"
											onclick={cancelRotation}
											class="border-surface-border-strong text-text-secondary hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm transition-colors"
											>Cancel</button
										>
									</form>
								</div>
							{:else if rotationStep === 'recovery'}
								<div class="space-y-3">
									<p class="text-text-secondary text-xs">
										Write down your new 24-word recovery key. The old recovery key will no longer
										work.
									</p>
									{#if rotationError}
										<div
											class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
										>
											{rotationError}
										</div>
									{/if}
									<div
										class="border-surface-border bg-surface-overlay grid grid-cols-3 gap-x-4 gap-y-2 rounded border px-2 py-3 sm:grid-cols-4"
									>
										{#each rotationRecoveryWords as word, i}
											<div class="flex items-baseline gap-1.5">
												<span
													class="text-text-quaternary w-5 shrink-0 text-right font-mono text-[10px] tabular-nums"
													>{i + 1}.</span
												>
												<span class="text-text-primary font-mono text-sm font-medium">{word}</span>
											</div>
										{/each}
									</div>
									<label class="flex cursor-pointer items-start gap-2.5 select-none">
										<input
											type="checkbox"
											bind:checked={rotationRecoveryAck}
											class="border-surface-border-strong mt-0.5 rounded accent-teal-500"
										/>
										<span class="text-text-secondary text-xs leading-relaxed"
											>I have written down these new recovery words.</span
										>
									</label>
									<div class="flex gap-3">
										<button
											onclick={cancelRotation}
											class="border-surface-border-strong text-text-secondary hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm transition-colors"
											>Cancel</button
										>
										<button
											onclick={finalizeRotation}
											disabled={!rotationRecoveryAck || rotationLoading}
											class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
											>{rotationLoading ? 'Saving...' : 'Save New Recovery Key'}</button
										>
									</div>
								</div>
							{:else if rotationStep === 'saving'}
								<div class="flex items-center gap-3">
									<div
										class="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent"
									></div>
									<span class="text-text-secondary text-sm">Saving recovery key...</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{:else if setupStep === 'idle'}
				<!-- Not configured — setup CTA -->
				<div class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5">
					<div class="space-y-2">
						<p class="text-text-primary text-sm leading-relaxed">
							Encryption protects your supporters' personal information with a passphrase that only
							your organization holds. Once enabled, Commons cannot read supporter names, emails, or
							phone numbers — only your team can.
						</p>
						<p class="text-text-tertiary text-xs leading-relaxed">
							You will create a passphrase and receive a 24-word recovery key. If all team members
							forget the passphrase, the recovery key is the only way to regain access. Store it
							securely offline.
						</p>
					</div>
					<button
						onclick={startEncryptionSetup}
						class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500"
					>
						Set Up Encryption
					</button>
				</div>
			{:else if setupStep === 'passphrase'}
				<!-- Step 1: Create passphrase -->
				<div class="border-surface-border bg-surface-base space-y-5 rounded-md border p-5">
					<div>
						<h3 class="text-text-primary text-sm font-semibold">Create a passphrase</h3>
						<p class="text-text-tertiary mt-1 text-xs leading-relaxed">
							This passphrase derives the encryption key for all supporter data in your
							organization. Every team member who needs to view supporter information will need this
							passphrase. Minimum 12 characters.
						</p>
					</div>

					{#if encryptionError}
						<div
							class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
						>
							{encryptionError}
						</div>
					{/if}

					<form
						onsubmit={(e) => {
							e.preventDefault();
							proceedToRecovery();
						}}
						class="space-y-3"
					>
						<div class="space-y-1">
							<label for="enc-passphrase" class="text-text-tertiary text-xs">Passphrase</label>
							<input
								id="enc-passphrase"
								type="password"
								bind:value={passphrase}
								placeholder="At least 12 characters"
								autocomplete="new-password"
								class="border-surface-border-strong bg-surface-overlay text-text-primary placeholder:text-text-quaternary w-full rounded-lg border px-3 py-2 text-sm focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							/>
							{#if passphrase.length > 0 && passphrase.length < 12}
								<p class="text-xs text-amber-400">
									{12 - passphrase.length} more characters needed
								</p>
							{/if}
						</div>
						<div class="space-y-1">
							<label for="enc-confirm" class="text-text-tertiary text-xs">Confirm passphrase</label>
							<input
								id="enc-confirm"
								type="password"
								bind:value={passphraseConfirm}
								placeholder="Re-enter passphrase"
								autocomplete="new-password"
								class="w-full rounded-lg border px-3 py-2 text-sm {passphraseMismatch
									? 'border-red-500/50'
									: 'border-surface-border-strong'} bg-surface-overlay text-text-primary placeholder:text-text-quaternary focus:border-teal-500 focus:ring-1 focus:ring-teal-500 focus:outline-none"
							/>
							{#if passphraseMismatch}
								<p class="text-xs text-red-400">Passphrases do not match</p>
							{/if}
						</div>
						<div class="flex gap-3 pt-1">
							<button
								type="button"
								onclick={cancelEncryptionSetup}
								class="border-surface-border-strong text-text-secondary hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm transition-colors"
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={!passphraseValid}
								class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
							>
								Generate Recovery Key
							</button>
						</div>
					</form>
				</div>
			{:else if setupStep === 'recovery'}
				<!-- Step 2: Recovery words -->
				<div class="border-surface-border bg-surface-base space-y-5 rounded-md border p-5">
					<div>
						<h3 class="text-text-primary text-sm font-semibold">Recovery key</h3>
						<p class="text-text-tertiary mt-1 text-xs leading-relaxed">
							Write these 24 words down on paper and store them somewhere safe. If every team member
							forgets the passphrase, these words are the only way to recover access to encrypted
							supporter data.
						</p>
					</div>

					{#if encryptionError}
						<div
							class="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400"
						>
							{encryptionError}
						</div>
					{/if}

					<!-- Recovery word grid -->
					<div
						class="border-surface-border bg-surface-overlay grid grid-cols-3 gap-x-4 gap-y-2 rounded border px-2 py-3 sm:grid-cols-4"
					>
						{#each recoveryWords as word, i}
							<div class="flex items-baseline gap-1.5">
								<span
									class="text-text-quaternary w-5 shrink-0 text-right font-mono text-[10px] tabular-nums"
									>{i + 1}.</span
								>
								<span class="text-text-primary font-mono text-sm font-medium">{word}</span>
							</div>
						{/each}
					</div>

					<label class="flex cursor-pointer items-start gap-2.5 select-none">
						<input
							type="checkbox"
							bind:checked={recoveryAcknowledged}
							class="border-surface-border-strong mt-0.5 rounded accent-teal-500"
						/>
						<span class="text-text-secondary text-xs leading-relaxed">
							I have written down these 24 words and stored them securely. I understand that if I
							lose both the passphrase and these words, encrypted supporter data cannot be
							recovered.
						</span>
					</label>

					<div class="flex gap-3">
						<button
							type="button"
							onclick={() => {
								setupStep = 'passphrase';
								encryptionError = '';
							}}
							class="border-surface-border-strong text-text-secondary hover:bg-surface-raised rounded-lg border px-4 py-2 text-sm transition-colors"
						>
							Back
						</button>
						<button
							onclick={finalizeEncryptionSetup}
							disabled={!recoveryAcknowledged || encryptionSaving}
							class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{encryptionSaving ? 'Configuring...' : 'Enable Encryption'}
						</button>
					</div>
				</div>
			{:else if setupStep === 'saving'}
				<!-- Saving state -->
				<div class="border-surface-border bg-surface-base rounded-md border p-5">
					<div class="flex items-center gap-3">
						<div
							class="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent"
						></div>
						<span class="text-text-secondary text-sm"
							>Deriving encryption key and configuring...</span
						>
					</div>
				</div>
			{:else if setupStep === 'done'}
				<!-- Just completed setup -->
				<div class="bg-surface-base space-y-3 rounded-md border border-emerald-500/20 p-5">
					<div class="flex items-center gap-2">
						<svg
							class="h-4 w-4 text-emerald-500"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							stroke-width="2"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
							/>
						</svg>
						<span class="text-text-primary text-sm font-medium">Encryption configured</span>
					</div>
					<p class="text-text-tertiary text-xs leading-relaxed">
						Your organization's encryption key has been derived and cached on this device. Share the
						passphrase securely with team members who need to view supporter data.
					</p>
				</div>
			{/if}
		</section>
	{/if}
</div>
