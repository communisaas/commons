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
			// Store email as plaintext-in-base64 for now — will use org key encryption
			// once org key infrastructure is wired (task 2a-i)
			const encryptedEmail = btoa(email);

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
							<span class="text-text-tertiary">{invite.encryptedEmail ? (() => { try { return atob(invite.encryptedEmail); } catch { return '[encrypted]'; } })() : '[encrypted]'}</span>
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
</div>
