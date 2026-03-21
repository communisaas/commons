<script lang="ts">
	import { page } from '$app/stores';
	import { FEATURES } from '$lib/config/features';
	import type { LayoutData } from './$types';
	import type { Snippet } from 'svelte';

	let {
		children,
		data
	}: {
		children: Snippet;
		data: LayoutData;
	} = $props();

	const currentPath = $derived($page.url.pathname);
	const base = $derived(`/org/${data.org.slug}`);

	const navItems = $derived([
		{ href: base, label: 'Dashboard', icon: 'chart' },
		{ href: `${base}/supporters`, label: 'Supporters', icon: 'people' },
		{ href: `${base}/campaigns`, label: 'Campaigns', icon: 'send' },
		{ href: `${base}/emails`, label: 'Emails', icon: 'email' },
		...(FEATURES.SMS ? [{ href: `${base}/sms`, label: 'SMS / Calls', icon: 'phone' }] : []),
		...(FEATURES.EVENTS ? [{ href: `${base}/events`, label: 'Events', icon: 'calendar' }] : []),
		...(FEATURES.FUNDRAISING ? [{ href: `${base}/fundraising`, label: 'Fundraising', icon: 'currency' }] : []),
		...(FEATURES.AUTOMATION ? [{ href: `${base}/workflows`, label: 'Workflows', icon: 'bolt' }] : []),
		...(FEATURES.LEGISLATION ? [{ href: `${base}/representatives`, label: 'Decision Makers', icon: 'building' }] : []),
		...(FEATURES.LEGISLATION ? [{ href: `${base}/legislation`, label: 'Legislation', icon: 'legislation' }] : []),
		...(FEATURES.LEGISLATION ? [{ href: `${base}/scorecards`, label: 'Scorecards', icon: 'scorecard' }] : []),
		...(FEATURES.NETWORKS ? [{ href: `${base}/networks`, label: 'Networks', icon: 'network' }] : []),
		{ href: `${base}/settings`, label: 'Settings', icon: 'gear' }
	]);

	function isActive(href: string): boolean {
		if (href === base) return currentPath === base;
		return currentPath.startsWith(href);
	}
</script>

<div class="flex min-h-screen">
	<!-- Sidebar -->
	<aside class="hidden md:flex md:w-60 flex-col border-r border-[var(--org-sidebar-border)] bg-[var(--org-sidebar-bg)]">
		<!-- Org header -->
		<div class="px-4 py-5 border-b border-[var(--org-sidebar-border)]">
			<div class="flex items-center gap-3">
				{#if data.org.avatar}
					<img src={data.org.avatar} alt="" class="w-8 h-8 rounded-lg" />
				{:else}
					<div class="w-8 h-8 rounded-lg bg-teal-500/20 flex items-center justify-center text-teal-400 font-semibold text-sm">
						{data.org.name.charAt(0).toUpperCase()}
					</div>
				{/if}
				<div class="min-w-0">
					<p class="text-sm font-medium text-[var(--org-sidebar-text)] truncate">{data.org.name}</p>
					<p class="text-xs text-[var(--org-sidebar-text-dim)] font-mono">{data.membership.role}</p>
				</div>
			</div>
		</div>

		<!-- Navigation -->
		<nav class="flex-1 px-3 py-4 space-y-1">
			{#each navItems as item}
				{@const active = isActive(item.href)}
				<a
					href={item.href}
					class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors {active
						? 'bg-[var(--org-sidebar-active)] text-[var(--org-sidebar-text)] border-l-2 border-teal-500'
						: 'text-[var(--org-sidebar-text-muted)] hover:text-[var(--org-sidebar-text)] hover:bg-[var(--org-sidebar-hover)]'}"
				>
					{#if item.icon === 'chart'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
						</svg>
					{:else if item.icon === 'people'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
						</svg>
					{:else if item.icon === 'send'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
						</svg>
					{:else if item.icon === 'email'}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
					</svg>
				{:else if item.icon === 'phone'}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
					</svg>
				{:else if item.icon === 'calendar'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
						</svg>
					{:else if item.icon === 'currency'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{:else if item.icon === 'bolt'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
						</svg>
					{:else if item.icon === 'building'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
						</svg>
					{:else if item.icon === 'legislation'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
						</svg>
					{:else if item.icon === 'scorecard'}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
					</svg>
				{:else if item.icon === 'network'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
						</svg>
					{:else if item.icon === 'gear'}
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
							<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
					{/if}
					{item.label}
				</a>
			{/each}
		</nav>

		<!-- Back to person layer -->
		<div class="px-3 py-4 border-t border-[var(--org-sidebar-border)]">
			<a href="/" class="flex items-center gap-2 px-3 py-2 text-xs text-[var(--org-sidebar-text-dim)] hover:text-[var(--org-sidebar-text-muted)] transition-colors">
				<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
				</svg>
				Back to commons.email
			</a>
		</div>
	</aside>

	<!-- Mobile header -->
	<div class="md:hidden fixed top-0 left-0 right-0 z-40 bg-[var(--org-sidebar-bg)] border-b border-[var(--org-sidebar-border)] px-4 py-3">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<div class="w-6 h-6 rounded bg-teal-500/20 flex items-center justify-center text-teal-400 font-semibold text-xs">
					{data.org.name.charAt(0).toUpperCase()}
				</div>
				<span class="text-sm font-medium text-[var(--org-sidebar-text)]">{data.org.name}</span>
			</div>
		</div>
		<!-- Mobile nav tabs -->
		<nav class="flex gap-1 mt-3 -mb-3 overflow-x-auto">
			{#each navItems as item}
				{@const active = isActive(item.href)}
				<a
					href={item.href}
					class="px-3 py-2 text-xs whitespace-nowrap border-b-2 transition-colors {active
						? 'border-teal-400 text-[var(--org-sidebar-text)]'
						: 'border-transparent text-[var(--org-sidebar-text-dim)] hover:text-[var(--org-sidebar-text-muted)]'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>
	</div>

	<!-- Main content -->
	<main class="flex-1 min-w-0 pt-[88px] md:pt-0">
		<div class="p-6 md:p-8 max-w-5xl">
			{@render children()}
		</div>
	</main>
</div>
