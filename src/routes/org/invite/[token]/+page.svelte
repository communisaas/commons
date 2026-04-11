<script lang="ts">
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const currentPath = $derived($page.url.pathname);
</script>

<svelte:head>
	<title>Join {data.orgName} | Commons</title>
</svelte:head>

<div class="invite-page">
	<div class="invite-page__card">
		{#if data.expired}
			<div class="invite-page__icon invite-page__icon--expired">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
				</svg>
			</div>
			<h1 class="invite-page__title">Invite expired</h1>
			<p class="invite-page__subtitle">
				This invite to join <strong>{data.orgName}</strong> has expired.
				Ask the org admin to send a new one.
			</p>
			<a href="/org" class="invite-page__btn invite-page__btn--secondary">
				Go to organizations
			</a>
		{:else if !data.isAuthenticated}
			<div class="invite-page__icon">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
				</svg>
			</div>
			<h1 class="invite-page__title">Join {data.orgName}</h1>
			<p class="invite-page__subtitle">
				You've been invited to join as <strong>{data.inviteRole}</strong>.
				Sign in to accept this invite.
			</p>
			<a href="/auth/google?returnTo={encodeURIComponent(currentPath)}" class="invite-page__btn invite-page__btn--primary">
				Sign in to accept
			</a>
		{:else}
			<div class="invite-page__icon">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
				</svg>
			</div>
			<h1 class="invite-page__title">Join {data.orgName}</h1>
			<p class="invite-page__subtitle">
				You've been invited to join as <strong>{data.inviteRole}</strong>.
			</p>
			<form method="POST" action="?/accept">
				<button type="submit" class="invite-page__btn invite-page__btn--primary">
					Accept invite
				</button>
			</form>
		{/if}
	</div>
</div>

<style>
	.invite-page {
		min-height: 80vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 3rem 1.5rem;
	}

	.invite-page__card {
		max-width: 24rem;
		width: 100%;
		text-align: center;
		padding: 2.5rem 2rem;
		border-radius: 16px;
		border: 1px solid oklch(0.92 0.01 250);
		background: white;
		box-shadow: 0 1px 3px oklch(0.2 0.02 250 / 0.04);
	}

	.invite-page__icon {
		width: 3rem;
		height: 3rem;
		margin: 0 auto 1.25rem;
		color: oklch(0.45 0.1 180);
	}

	.invite-page__icon svg {
		width: 100%;
		height: 100%;
	}

	.invite-page__icon--expired {
		color: oklch(0.55 0.1 50);
	}

	.invite-page__title {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1.25rem;
		font-weight: 700;
		color: oklch(0.2 0.03 250);
		margin: 0 0 0.5rem;
	}

	.invite-page__subtitle {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		color: oklch(0.5 0.02 250);
		line-height: 1.5;
		margin: 0 0 1.5rem;
	}

	.invite-page__warning {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		color: oklch(0.5 0.12 50);
		background: oklch(0.97 0.03 50);
		border: 1px solid oklch(0.9 0.06 50);
		border-radius: 8px;
		padding: 0.625rem 0.75rem;
		margin: 0 0 1.5rem;
		text-align: left;
	}

	.invite-page__btn {
		display: inline-block;
		padding: 0.625rem 1.5rem;
		border-radius: 8px;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
		transition: all 150ms ease-out;
		border: none;
	}

	.invite-page__btn--primary {
		background: oklch(0.35 0.08 180);
		color: white;
	}

	.invite-page__btn--primary:hover {
		background: oklch(0.3 0.1 180);
	}

	.invite-page__btn--secondary {
		background: oklch(0.97 0.01 250);
		color: oklch(0.35 0.02 250);
		border: 1px solid oklch(0.88 0.02 250);
	}

	.invite-page__btn--secondary:hover {
		background: oklch(0.94 0.01 250);
	}
</style>
