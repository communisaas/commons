<script lang="ts">
	import { enhance } from '$app/forms';
	import { Datum, RegistryMark } from '$lib/design';
	import type { ActionData, PageData } from './$types';

	const { data, form }: { data: PageData; form?: ActionData } = $props();

	const AVAILABLE_EVENTS = [
		'campaign_action.created',
		'campaign.updated',
		'supporter.created',
		'supporter.updated',
		'supporter.deleted',
		'donation.completed',
		'donation.refunded',
		'event.rsvp_created'
	] as const;

	type WebhookRow = PageData['webhooks'][number];
	type RecentDelivery = PageData['recentDeliveries'][number];

	let showCreate = $state(false);

	const endpointCount = $derived(data.webhooks.length);
	const activeEndpointCount = $derived(data.webhooks.filter((webhook) => webhook.enabled).length);
	const pausedEndpointCount = $derived(endpointCount - activeEndpointCount);
	const subscribedEventCount = $derived(
		data.webhooks.reduce((sum, webhook) => sum + webhook.events.length, 0)
	);
	const recentDeliveryCount = $derived(data.recentDeliveries.length);
	const deliveredCount = $derived(
		data.recentDeliveries.filter((delivery) => delivery.deliveredAt).length
	);
	const retryingCount = $derived(
		data.recentDeliveries.filter(
			(delivery) => delivery.nextRetryAt && !delivery.deliveredAt && !delivery.isDead
		).length
	);
	const deadCount = $derived(data.recentDeliveries.filter((delivery) => delivery.isDead).length);
	const failureCount = $derived(
		data.webhooks.reduce((sum, webhook) => sum + webhook.failureCount, 0)
	);
	const testedDeliveryId = $derived(
		form?.tested && form.tested.error === null ? form.tested.deliveryId : null
	);
	function fmtDate(ms: number | null | undefined): string {
		if (!ms) return '—';
		return new Date(ms).toLocaleString();
	}

	function deliveryTimestamp(delivery: RecentDelivery): number | null {
		return delivery.deliveredAt ?? delivery.nextRetryAt ?? delivery.createdAt ?? null;
	}

	function deliveryStatusLabel(delivery: RecentDelivery): string {
		if (delivery.deliveredAt) return 'Delivered';
		if (delivery.isDead) return 'Dead letter';
		if (delivery.nextRetryAt) return 'Retry scheduled';
		return 'Queued';
	}

	function deliveryStatusClass(delivery: RecentDelivery): string {
		if (delivery.deliveredAt) return 'border-teal-500/30 bg-teal-500/10 text-teal-300';
		if (delivery.isDead) return 'border-red-500/30 bg-red-500/10 text-red-400';
		if (delivery.nextRetryAt) return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
		return 'border-surface-border-strong bg-surface-overlay text-text-tertiary';
	}

	function endpointStatusClass(webhook: WebhookRow): string {
		if (webhook.enabled) return 'border-teal-500/30 bg-teal-500/10 text-teal-300';
		return 'border-surface-border-strong bg-surface-overlay text-text-tertiary';
	}
</script>

<svelte:head>
	<title>Signed event webhooks | Settings</title>
</svelte:head>

<div class="bg-surface-raised text-text-primary min-h-screen">
	<div class="mx-auto max-w-6xl space-y-6 px-4 py-8">
		<header class="flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0">
				<nav class="text-text-tertiary mb-3 flex items-center gap-2 text-sm">
					<a
						href="/org/{data.orgSlug}/settings"
						class="hover:text-text-secondary transition-colors"
					>
						Settings
					</a>
					<span aria-hidden="true">/</span>
					<span>Signed event webhooks</span>
				</nav>
				<h1 class="text-text-primary text-xl font-semibold">Signed event webhooks</h1>
				<p class="text-text-tertiary mt-1 max-w-3xl text-sm">
					Subscribe external systems to Commons org events. Every delivery is signed and retried,
					and each attempt is recorded below.
				</p>
			</div>
			<button
				type="button"
				class="bg-surface-overlay text-text-primary hover:bg-surface-base rounded-md px-4 py-2 text-sm font-semibold transition-colors"
				onclick={() => (showCreate = !showCreate)}
			>
				{showCreate ? 'Close form' : 'Add endpoint'}
			</button>
		</header>

		{#if form?.signingSecret && form?.created}
			<aside
				class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
			>
				<p class="font-medium">Signing secret shown once</p>
				<p class="mt-1 text-amber-100/80">
					Store this in the receiver now. Commons will not display it again; rotation creates a new
					active secret.
				</p>
				<pre
					class="bg-surface-base text-text-primary mt-3 overflow-x-auto rounded-md px-3 py-2 text-xs"><code
						>{form.signingSecret}</code
					></pre>
			</aside>
		{/if}

		{#if form?.rotated && form?.signingSecret}
			<aside
				class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
			>
				<p class="font-medium">New signing secret shown once</p>
				<p class="mt-1 text-amber-100/80">
					The previous secret remains available to the receiver during rotation. Update the receiver
					verifier before dropping the old secret.
				</p>
				<pre
					class="bg-surface-base text-text-primary mt-3 overflow-x-auto rounded-md px-3 py-2 text-xs"><code
						>{form.signingSecret}</code
					></pre>
			</aside>
		{/if}

		{#if testedDeliveryId}
			<aside
				class="rounded-md border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-100"
			>
				<p class="font-medium">Test delivery queued</p>
				<p class="mt-1 text-teal-100/80">
					Commons queued a signed <code>webhook.test</code> POST. The attempt record below will show whether
					the receiver accepted, retried, or dead-lettered the delivery.
				</p>
				<code class="text-text-secondary mt-3 block text-xs break-all">{testedDeliveryId}</code>
			</aside>
		{/if}

		<section
			id="signed-event-ground"
			class="border-surface-border bg-surface-base rounded-md border p-4"
		>
			<div class="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p class="text-text-primary text-sm font-medium">Signature contract</p>
					<p class="text-text-tertiary mt-1 max-w-3xl text-sm">
						Commons signs the raw JSON payload as <code>timestamp.payload</code> using the endpoint
						signing secret and sends the result in
						<RegistryMark
							variant="tag"
							value="X-Commons-Signature-256"
							copy={false}
							class="text-text-secondary"
						/>. Receivers should verify the HMAC and enforce their replay window.
					</p>
				</div>
				<div class="grid min-w-52 grid-cols-3 gap-3 text-right">
					<div>
						<p class="text-text-primary text-lg font-bold">
							<Datum value={AVAILABLE_EVENTS.length} />
						</p>
						<p class="text-text-tertiary text-xs">event kinds</p>
					</div>
					<div>
						<p class="text-text-primary text-lg font-bold">
							<Datum value={subscribedEventCount} />
						</p>
						<p class="text-text-tertiary text-xs">subscriptions</p>
					</div>
					<div>
						<p class="text-text-primary text-lg font-bold">
							<Datum value={failureCount} />
						</p>
						<p class="text-text-tertiary text-xs">failures</p>
					</div>
				</div>
			</div>
		</section>

		<section id="webhook-endpoints" class="space-y-3">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p class="text-text-primary text-sm font-medium">Endpoint custody</p>
					<p class="text-text-tertiary mt-1 text-sm">
						Endpoint rows are org-scoped. Secrets are revealed only on creation or rotation.
					</p>
				</div>
				<div class="flex gap-4 text-right text-xs">
					<div>
						<p class="text-text-primary text-base font-bold">
							<Datum value={activeEndpointCount} />
						</p>
						<p class="text-text-tertiary">enabled</p>
					</div>
					<div>
						<p class="text-text-primary text-base font-bold">
							<Datum value={pausedEndpointCount} />
						</p>
						<p class="text-text-tertiary">paused</p>
					</div>
				</div>
			</div>

			{#if showCreate}
				<form
					method="POST"
					action="?/create"
					use:enhance
					class="border-surface-border bg-surface-base grid gap-4 rounded-md border p-4"
				>
					<label class="grid gap-1">
						<span class="text-text-secondary text-sm font-medium">Endpoint URL</span>
						<input
							type="url"
							name="url"
							required
							placeholder="https://example.com/commons/events"
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder:text-text-quaternary rounded-md border px-3 py-2 text-sm outline-none focus:border-teal-500/60"
						/>
					</label>
					<fieldset class="border-surface-border-strong grid gap-2 rounded-md border p-3">
						<legend class="text-text-secondary px-1 text-sm font-medium">Events</legend>
						<div class="grid gap-2 sm:grid-cols-2">
							{#each AVAILABLE_EVENTS as event (event)}
								<label class="flex items-center gap-2 text-sm">
									<input type="checkbox" name="events" value={event} class="accent-teal-500" />
									<code class="text-text-secondary text-xs">{event}</code>
								</label>
							{/each}
						</div>
					</fieldset>
					<label class="grid gap-1">
						<span class="text-text-secondary text-sm font-medium">Description</span>
						<input
							type="text"
							name="description"
							maxlength="500"
							placeholder="Optional receiver label"
							class="border-surface-border-strong bg-surface-raised text-text-primary placeholder:text-text-quaternary rounded-md border px-3 py-2 text-sm outline-none focus:border-teal-500/60"
						/>
					</label>
					{#if form?.error}
						<p class="text-sm text-red-400">{form.error}</p>
					{/if}
					<button
						type="submit"
						class="w-fit rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500"
					>
						Create endpoint
					</button>
				</form>
			{/if}

			<div class="border-surface-border bg-surface-base overflow-x-auto rounded-md border">
				<table class="w-full min-w-[860px] text-left text-sm">
					<thead class="text-text-tertiary border-surface-border border-b text-xs uppercase">
						<tr>
							<th class="px-3 py-3 font-semibold">Endpoint</th>
							<th class="px-3 py-3 font-semibold">Events</th>
							<th class="px-3 py-3 font-semibold">Status</th>
							<th class="px-3 py-3 font-semibold">Last delivered</th>
							<th class="px-3 py-3 font-semibold">Failures</th>
							<th class="px-3 py-3 font-semibold">Actions</th>
						</tr>
					</thead>
					<tbody class="divide-surface-border divide-y">
						{#if data.webhooks.length === 0}
							<tr>
								<td colspan="6" class="text-text-tertiary px-3 py-10 text-center">
									No endpoints configured. Add one before Commons can deliver org events to an
									external system.
								</td>
							</tr>
						{/if}
						{#each data.webhooks as webhook (webhook.id)}
							<tr>
								<td class="px-3 py-3 align-top">
									<code class="text-text-secondary text-xs break-all">{webhook.url}</code>
									{#if webhook.description}
										<p class="text-text-tertiary mt-1 text-xs">{webhook.description}</p>
									{/if}
								</td>
								<td class="px-3 py-3 align-top">
									<div class="flex max-w-md flex-wrap gap-1">
										{#each webhook.events as event}
											<span
												class="border-surface-border-strong bg-surface-overlay text-text-secondary rounded-md border px-1.5 py-0.5 font-mono text-[0.68rem]"
											>
												{event}
											</span>
										{/each}
									</div>
								</td>
								<td class="px-3 py-3 align-top">
									<span
										class="inline-flex rounded-md border px-2 py-0.5 text-xs font-medium {endpointStatusClass(
											webhook
										)}"
									>
										{webhook.enabled ? 'Enabled' : 'Paused'}
									</span>
								</td>
								<td class="text-text-tertiary px-3 py-3 align-top text-xs">
									{fmtDate(webhook.lastDeliveredAt)}
								</td>
								<td class="px-3 py-3 align-top">
									<Datum value={webhook.failureCount} />
								</td>
								<td class="px-3 py-3 align-top">
									<div class="flex flex-wrap gap-3">
										<form method="POST" action="?/test" use:enhance>
											<input type="hidden" name="webhookId" value={webhook.id} />
											<button
												type="submit"
												disabled={!webhook.enabled}
												title={webhook.enabled
													? 'Queue signed webhook.test delivery'
													: 'Enable endpoint before testing'}
												class="disabled:text-text-quaternary text-sm font-medium text-teal-300 hover:text-teal-200 disabled:cursor-not-allowed"
											>
												Send test
											</button>
										</form>
										<form method="POST" action="?/update" use:enhance>
											<input type="hidden" name="webhookId" value={webhook.id} />
											<input type="hidden" name="enabled" value={(!webhook.enabled).toString()} />
											<button
												type="submit"
												class="text-sm font-medium text-teal-300 hover:text-teal-200"
											>
												{webhook.enabled ? 'Pause' : 'Enable'}
											</button>
										</form>
										<form method="POST" action="?/rotate" use:enhance>
											<input type="hidden" name="webhookId" value={webhook.id} />
											<button
												type="submit"
												class="text-sm font-medium text-teal-300 hover:text-teal-200"
											>
												Rotate secret
											</button>
										</form>
										<form
											method="POST"
											action="?/delete"
											use:enhance
											onsubmit={(event) => {
												if (!confirm('Delete this endpoint and its delivery history?')) {
													event.preventDefault();
												}
											}}
										>
											<input type="hidden" name="webhookId" value={webhook.id} />
											<button
												type="submit"
												class="text-sm font-medium text-red-400 hover:text-red-300"
											>
												Delete
											</button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section id="webhook-delivery-evidence" class="space-y-3">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p class="text-text-primary text-sm font-medium">Delivery attempt evidence</p>
					<p class="text-text-tertiary mt-1 text-sm">
						This is the sender-side retry log. It does not prove the receiver processed the event.
					</p>
				</div>
				<div class="grid grid-cols-3 gap-4 text-right text-xs">
					<div>
						<p class="text-text-primary text-base font-bold">
							<Datum value={deliveredCount} />
						</p>
						<p class="text-text-tertiary">delivered</p>
					</div>
					<div>
						<p class="text-text-primary text-base font-bold">
							<Datum value={retryingCount} />
						</p>
						<p class="text-text-tertiary">retrying</p>
					</div>
					<div>
						<p class="text-text-primary text-base font-bold">
							<Datum value={deadCount} />
						</p>
						<p class="text-text-tertiary">dead</p>
					</div>
				</div>
			</div>

			<div class="border-surface-border bg-surface-base overflow-x-auto rounded-md border">
				<table class="w-full min-w-[760px] text-left text-sm">
					<thead class="text-text-tertiary border-surface-border border-b text-xs uppercase">
						<tr>
							<th class="px-3 py-3 font-semibold">Event</th>
							<th class="px-3 py-3 font-semibold">Endpoint</th>
							<th class="px-3 py-3 font-semibold">Status</th>
							<th class="px-3 py-3 font-semibold">HTTP</th>
							<th class="px-3 py-3 font-semibold">Attempt</th>
							<th class="px-3 py-3 font-semibold">Timestamp</th>
						</tr>
					</thead>
					<tbody class="divide-surface-border divide-y">
						{#if data.recentDeliveries.length === 0}
							<tr>
								<td colspan="6" class="text-text-tertiary px-3 py-10 text-center">
									No delivery attempts loaded yet. Attempts appear after a matching org event is
									emitted.
								</td>
							</tr>
						{/if}
						{#each data.recentDeliveries as delivery (delivery.id)}
							<tr>
								<td class="px-3 py-3 align-top">
									<code class="text-text-secondary text-xs">{delivery.event}</code>
								</td>
								<td class="px-3 py-3 align-top">
									<code class="text-text-tertiary text-xs break-all">{delivery.webhookUrl}</code>
								</td>
								<td class="px-3 py-3 align-top">
									<span
										class="inline-flex rounded-md border px-2 py-0.5 text-xs font-medium {deliveryStatusClass(
											delivery
										)}"
									>
										{deliveryStatusLabel(delivery)}
									</span>
									{#if delivery.errorMessage}
										<p class="text-text-tertiary mt-1 max-w-xs text-xs">{delivery.errorMessage}</p>
									{/if}
								</td>
								<td class="px-3 py-3 align-top">
									<Datum value={delivery.statusCode} />
								</td>
								<td class="px-3 py-3 align-top">
									<Datum value={delivery.attempt} />
								</td>
								<td class="text-text-tertiary px-3 py-3 align-top text-xs">
									{fmtDate(deliveryTimestamp(delivery))}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

	</div>
</div>
