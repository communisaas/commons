<script lang="ts">
	let {
		replies,
		orgSlug
	}: {
		replies: Array<{
			id: string;
			body: string;
			matchedSupporter: boolean;
			linkedBlastId: string | null;
			receivedAt: string;
		}>;
		orgSlug: string;
	} = $props();

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('en-US', {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

{#if replies.length === 0}
	<p class="text-text-tertiary py-6 text-center text-sm">No inbound text replies recorded.</p>
{:else}
	<div class="border-surface-border overflow-x-auto rounded-md border">
		<table class="w-full text-left text-sm">
			<thead>
				<tr class="border-surface-border text-text-tertiary border-b text-xs">
					<th class="px-4 py-3 font-medium">Reply</th>
					<th class="px-4 py-3 font-medium">Scope</th>
					<th class="px-4 py-3 font-medium">Received</th>
				</tr>
			</thead>
			<tbody>
				{#each replies as reply (reply.id)}
					<tr class="border-surface-border/70 border-b last:border-0">
						<td class="px-4 py-3">
							<p class="text-text-primary max-w-[42rem] whitespace-pre-wrap">{reply.body}</p>
						</td>
						<td class="px-4 py-3">
							<p class="text-text-secondary text-xs">
								{reply.matchedSupporter ? 'matched supporter' : 'org number only'}
							</p>
							{#if reply.linkedBlastId}
								<a
									href="/org/{orgSlug}/sms/{reply.linkedBlastId}"
									class="text-text-tertiary hover:text-text-primary mt-1 inline-block text-xs underline underline-offset-4"
								>
									linked text record
								</a>
							{/if}
						</td>
						<td class="text-text-tertiary px-4 py-3">{formatDate(reply.receivedAt)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
