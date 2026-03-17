<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import TemplateModal from '$lib/components/template/TemplateModal.svelte';
	import type { PageData } from './$types';
	import { coordinated } from '$lib/utils/timerCoordinator';
	import { trackTemplateView } from '$lib/core/analytics/client';

	let { data }: { data: PageData } = $props();

	let showModal = $state(true);

	// Convert full user object to simplified type for TemplateModal
	const simplifiedUser = $derived(
		data.user ? { id: data.user.id, name: data.user.name || 'User' } : null
	);

	onMount(() => {
		// Track view via DP analytics pipeline
		trackTemplateView(data.template.id);

		// Check for pending template action from OAuth flow
		const pendingAction = sessionStorage.getItem('pending_template_action');
		if (pendingAction) {
			sessionStorage.removeItem('pending_template_action');
			// User just completed OAuth, show success state briefly
		}
	});

	function handleModalClose() {
		showModal = false;
		// Navigate to template page instead of closing modal
		goto(`/s/${data.template.slug}`);
	}

	const componentId = 'TemplateModalPage_' + Math.random().toString(36).substr(2, 9);

	function handleTemplateUsed(_data: { templateId: string; action: string }) {
		// Track successful conversion

		// Optionally redirect to profile or success page
		coordinated.setTimeout(
			() => {
				goto('/profile?success=template_sent');
			},
			2000,
			'transition',
			componentId
		);
	}
</script>

<svelte:head>
	<title>{data.template.title} | Take Action | Commons</title>
	<meta name="description" content={data.template.description} />

	<!-- Prevent indexing of modal pages -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if showModal}
	<TemplateModal
		template={data.template}
		user={simplifiedUser}
		onclose={handleModalClose}
		onused={handleTemplateUsed}
	/>
{/if}

<!-- Fallback content (shouldn't be visible) -->
<div class="flex min-h-screen items-center justify-center bg-slate-100">
	<div class="text-center">
		<h1 class="mb-4 text-2xl font-bold text-slate-900">{data.template.title}</h1>
		<p class="mb-6 text-slate-600">Loading your campaign action...</p>
		<a
			href="/{data.template.slug}"
			class="inline-flex items-center rounded-lg bg-participation-primary-600 px-4 py-2 text-white transition-colors hover:bg-participation-primary-700"
		>
			View full campaign
		</a>
	</div>
</div>
