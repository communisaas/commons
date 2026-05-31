<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	const { data, form }: { data: PageData; form: ActionData } = $props();

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

	let showCreate = $state(false);

	function fmtDate(ms: number | null | undefined): string {
		if (!ms) return '—';
		return new Date(ms).toLocaleString();
	}
</script>

<svelte:head>
	<title>Webhooks · Settings</title>
</svelte:head>

<section class="webhooks">
	<header>
		<h1>Webhooks</h1>
		<p class="lede">
			Subscribe an external endpoint to org events. Each delivery is HMAC-SHA256
			signed. Verify <code>X-Commons-Signature-256: t=&lt;ts&gt;,v1=&lt;hmac&gt;</code> as
			<code>HMAC-SHA256({"timestamp"}.{"payload"}, signingSecret)</code>.
		</p>
		<button class="primary" type="button" onclick={() => (showCreate = !showCreate)}>
			{showCreate ? 'Cancel' : 'New webhook'}
		</button>
	</header>

	{#if form?.signingSecret && form?.created}
		<aside class="secret-reveal">
			<h2>Signing secret (shown once)</h2>
			<p>
				Copy this now and store it securely. Commons will never display it again. If
				you lose it, rotate to generate a new one.
			</p>
			<pre><code>{form.signingSecret}</code></pre>
		</aside>
	{/if}

	{#if form?.rotated && form?.signingSecret}
		<aside class="secret-reveal">
			<h2>New signing secret (shown once)</h2>
			<p>
				The previous secret is still accepted during the rotation window. Update your
				verifier now to use the new one.
			</p>
			<pre><code>{form.signingSecret}</code></pre>
		</aside>
	{/if}

	{#if showCreate}
		<form method="POST" action="?/create" use:enhance class="create-form">
			<label>
				<span>Endpoint URL</span>
				<input type="url" name="url" required placeholder="https://example.com/hook" />
			</label>
			<fieldset>
				<legend>Events</legend>
				{#each AVAILABLE_EVENTS as ev (ev)}
					<label class="event-check">
						<input type="checkbox" name="events" value={ev} />
						<code>{ev}</code>
					</label>
				{/each}
			</fieldset>
			<label>
				<span>Description (optional)</span>
				<input type="text" name="description" maxlength="500" />
			</label>
			{#if form?.error}
				<p class="error">{form.error}</p>
			{/if}
			<button type="submit" class="primary">Create webhook</button>
		</form>
	{/if}

	<table class="list">
		<thead>
			<tr>
				<th>URL</th>
				<th>Events</th>
				<th>Status</th>
				<th>Last delivered</th>
				<th>Failures</th>
				<th>Actions</th>
			</tr>
		</thead>
		<tbody>
			{#if data.webhooks.length === 0}
				<tr><td colspan="6" class="empty">No webhooks configured.</td></tr>
			{/if}
			{#each data.webhooks as w (w.id)}
				<tr>
					<td class="url"><code>{w.url}</code></td>
					<td class="events">
						{#each w.events as e}<span class="event">{e}</span>{/each}
					</td>
					<td>
						<span class="status status-{w.enabled ? 'on' : 'off'}">
							{w.enabled ? 'Enabled' : 'Disabled'}
						</span>
					</td>
					<td>{fmtDate(w.lastDeliveredAt)}</td>
					<td>{w.failureCount}</td>
					<td class="actions">
						<form method="POST" action="?/update" use:enhance>
							<input type="hidden" name="webhookId" value={w.id} />
							<input type="hidden" name="enabled" value={(!w.enabled).toString()} />
							<button type="submit" class="link">{w.enabled ? 'Disable' : 'Enable'}</button>
						</form>
						<form method="POST" action="?/rotate" use:enhance>
							<input type="hidden" name="webhookId" value={w.id} />
							<button type="submit" class="link">Rotate secret</button>
						</form>
						<form
							method="POST"
							action="?/delete"
							use:enhance
							onsubmit={(e) => {
								if (!confirm('Delete this webhook and its delivery history?')) {
									e.preventDefault();
								}
							}}
						>
							<input type="hidden" name="webhookId" value={w.id} />
							<button type="submit" class="link danger">Delete</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.webhooks {
		max-width: 960px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}
	header {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	h1 {
		margin: 0;
	}
	.lede {
		color: var(--zinc-500, #71717a);
		font-size: 0.95rem;
	}
	.lede code {
		font-size: 0.85rem;
		background: var(--zinc-100, #f4f4f5);
		padding: 0.05rem 0.3rem;
		border-radius: 0.2rem;
	}
	button.primary {
		background: var(--accent, #14b8a6);
		color: white;
		border: 0;
		padding: 0.5rem 1rem;
		border-radius: 0.3rem;
		cursor: pointer;
		font-weight: 500;
		align-self: flex-start;
	}
	button.link {
		background: transparent;
		border: 0;
		color: var(--accent, #14b8a6);
		cursor: pointer;
		padding: 0;
		font: inherit;
	}
	button.link.danger {
		color: var(--red-600, #dc2626);
	}
	.secret-reveal {
		background: var(--amber-50, #fffbeb);
		border: 1px solid var(--amber-300, #fcd34d);
		border-radius: 0.4rem;
		padding: 1rem;
		margin: 1rem 0;
	}
	.secret-reveal h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
	}
	.secret-reveal pre {
		background: var(--zinc-900, #18181b);
		color: var(--zinc-50, #fafafa);
		padding: 0.6rem;
		border-radius: 0.3rem;
		overflow-x: auto;
		word-break: break-all;
		white-space: pre-wrap;
	}
	.create-form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		background: var(--zinc-50, #fafafa);
		border-radius: 0.4rem;
		margin-bottom: 1.5rem;
	}
	.create-form label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.create-form input[type='url'],
	.create-form input[type='text'] {
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--zinc-300, #d4d4d8);
		border-radius: 0.3rem;
		font: inherit;
	}
	fieldset {
		border: 1px solid var(--zinc-300, #d4d4d8);
		border-radius: 0.3rem;
		padding: 0.6rem 1rem;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.4rem;
	}
	fieldset legend {
		padding: 0 0.4rem;
		font-weight: 500;
	}
	.event-check {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-direction: row !important;
	}
	.error {
		color: var(--red-600, #dc2626);
		margin: 0;
	}
	table.list {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	table.list th,
	table.list td {
		text-align: left;
		padding: 0.6rem;
		border-bottom: 1px solid var(--zinc-200, #e4e4e7);
		vertical-align: top;
	}
	table.list th {
		font-weight: 600;
		color: var(--zinc-700, #3f3f46);
	}
	td.url code {
		word-break: break-all;
		font-size: 0.8rem;
	}
	td.events .event {
		display: inline-block;
		background: var(--zinc-100, #f4f4f5);
		padding: 0.1rem 0.4rem;
		border-radius: 0.2rem;
		font-size: 0.75rem;
		margin: 0.1rem;
		font-family: ui-monospace, monospace;
	}
	td.actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	td.actions form {
		display: inline;
	}
	.status {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 0.2rem;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.status-on {
		background: var(--green-100, #dcfce7);
		color: var(--green-800, #166534);
	}
	.status-off {
		background: var(--zinc-200, #e4e4e7);
		color: var(--zinc-700, #3f3f46);
	}
	.empty {
		text-align: center;
		color: var(--zinc-500, #71717a);
		font-style: italic;
		padding: 2rem;
	}
</style>
