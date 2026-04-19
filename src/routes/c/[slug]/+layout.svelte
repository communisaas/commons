<script lang="ts">
	import '../../../app.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="min-h-screen">
	<header class="border-b border-slate-200 px-4 py-3">
		<a href="/" class="text-sm font-medium text-slate-600 hover:text-slate-900">
			commons.email
		</a>
	</header>
	<main>
		{@render children()}
	</main>
</div>
