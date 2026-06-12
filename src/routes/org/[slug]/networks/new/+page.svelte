<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let name = $state('');
	let slug = $state('');
	let description = $state('');
	let slugManual = $state(false);
	let saving = $state(false);
	let errorMsg = $state('');

	function toSlug(input: string): string {
		return input
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/[\s_]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 50);
	}

	function onNameInput() {
		if (!slugManual) {
			slug = toSlug(name);
		}
	}

	function onSlugInput() {
		slugManual = true;
	}

	async function submit() {
		const trimmedName = name.trim();
		const trimmedSlug = slug.trim();

		if (trimmedName.length < 3 || trimmedName.length > 100) {
			errorMsg = 'Name must be between 3 and 100 characters';
			return;
		}
		if (trimmedSlug.length < 3 || trimmedSlug.length > 50) {
			errorMsg = 'Slug must be between 3 and 50 characters';
			return;
		}

		saving = true;
		errorMsg = '';

		try {
			const res = await fetch(`/api/org/${data.org.slug}/networks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: trimmedName,
					slug: trimmedSlug,
					description: description.trim() || null
				})
			});

			if (res.ok) {
				const result = await res.json();
				const networkId = result?.data?.id;
				if (!networkId) {
					errorMsg = 'Network created but response did not include a network id';
					return;
				}
				window.location.href = `/org/${data.org.slug}/networks/${networkId}`;
			} else {
				const body = await res.json().catch(() => null);
				errorMsg = body?.error ?? `Failed to create network (${res.status})`;
			}
		} catch {
			errorMsg = 'Network error';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Create coalition network | {data.org.name}</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-4xl space-y-6 px-4 py-8">
		<!-- Back link -->
		<a
			href="/org/{data.org.slug}/networks"
			class="text-text-tertiary hover:text-text-primary inline-block text-sm"
		>
			&larr; Networks
		</a>

		<div>
			<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
				<a href="/org/{data.org.slug}/studio" class="hover:text-text-secondary transition-colors">
					Studio
				</a>
				<span aria-hidden="true">/</span>
				<a href="/org/{data.org.slug}/networks" class="hover:text-text-secondary transition-colors">
					Networks
				</a>
				<span aria-hidden="true">/</span>
				<span>Create</span>
			</nav>
			<h1 class="text-text-primary text-xl font-semibold">Create coalition network</h1>
			<p class="text-text-tertiary mt-1 max-w-2xl text-sm">
				Name the network now; invite member organizations from its page after it's created.
			</p>
		</div>

		<!-- Error -->
		{#if errorMsg}
			<div class="rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-400">
				{errorMsg}
			</div>
		{/if}

		<!-- Form -->
		<div
			id="coalition-definition"
			class="border-surface-border bg-surface-base space-y-4 rounded-md border p-5"
		>
			<div>
				<p class="text-text-tertiary font-mono text-xs font-semibold tracking-wider uppercase">
					Network details
				</p>
			</div>
			<div>
				<label for="net-name" class="text-text-secondary mb-1 block text-sm font-medium">
					Name
				</label>
				<input
					id="net-name"
					type="text"
					bind:value={name}
					oninput={onNameInput}
					placeholder="e.g. Climate Action Coalition"
					maxlength="100"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
				/>
				<p class="text-text-tertiary mt-1 text-xs">{name.trim().length}/100 characters</p>
			</div>

			<div>
				<label for="net-slug" class="text-text-secondary mb-1 block text-sm font-medium">
					Slug
				</label>
				<input
					id="net-slug"
					type="text"
					bind:value={slug}
					oninput={onSlugInput}
					placeholder="climate-action-coalition"
					maxlength="50"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none"
				/>
				<p class="text-text-tertiary mt-1 text-xs">
					URL-friendly identifier ({slug.trim().length}/50)
				</p>
			</div>

			<div>
				<label for="net-desc" class="text-text-secondary mb-1 block text-sm font-medium">
					Description (optional)
				</label>
				<textarea
					id="net-desc"
					bind:value={description}
					placeholder="What is this network for?"
					rows="3"
					maxlength="500"
					class="border-surface-border-strong bg-surface-raised text-text-primary placeholder-text-quaternary focus:border-text-tertiary w-full rounded-md border px-3 py-2 text-sm focus:outline-none"
				></textarea>
				<p class="text-text-tertiary mt-1 text-xs">{description.trim().length}/500 characters</p>
			</div>
		</div>

		<!-- Actions -->
		<div class="flex items-center justify-end gap-3">
			<a
				href="/org/{data.org.slug}/networks"
				class="border-surface-border-strong text-text-secondary hover:border-text-tertiary hover:text-text-primary rounded-md border px-4 py-2 text-sm"
			>
				Cancel
			</a>
			<button
				onclick={submit}
				disabled={saving}
				class="bg-surface-overlay text-text-primary hover:bg-surface-raised rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
			>
				{saving ? 'Creating...' : 'Create coalition network'}
			</button>
		</div>
	</div>
</div>
