<script lang="ts">
	import { AlertTriangle } from '@lucide/svelte';

	interface Props {
		/** The subject the existing artifact was built for. */
		builtForSubject: string;
		/** The current subject line. */
		currentSubject: string;
		/** Noun for the artifact, e.g. 'decision-makers' | 'message'. */
		artifactLabel: string;
		/** Re-run resolution/generation for the new subject (destructive: replaces artifact). */
		onUpdate: () => void;
		/** Keep the existing artifact; clears the stale flag by re-stamping builtFor=current. */
		onKeep: () => void;
		/** Whether an update (re-run) is currently in progress — disables buttons. */
		busy?: boolean;
	}

	let { builtForSubject, currentSubject, artifactLabel, onUpdate, onKeep, busy = false }: Props =
		$props();

	/** Truncate a subject for compact side-by-side display. */
	function truncate(s: string): string {
		const trimmed = s.trim();
		return trimmed.length > 80 ? trimmed.slice(0, 79) + '…' : trimmed;
	}
</script>

<div
	class="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
	role="alert"
>
	<div class="flex items-start gap-3">
		<AlertTriangle class="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" aria-hidden="true" />
		<div class="flex-1">
			<p class="font-semibold">Built for a different subject</p>
			<p class="mt-1 text-amber-700">
				Update to rebuild the {artifactLabel} for the current subject, or keep what you have.
			</p>
			<dl class="mt-2 space-y-1 text-amber-700">
				<div class="flex gap-2">
					<dt class="font-medium">Built for:</dt>
					<dd>{truncate(builtForSubject)}</dd>
				</div>
				<div class="flex gap-2">
					<dt class="font-medium">Now:</dt>
					<dd>{truncate(currentSubject)}</dd>
				</div>
			</dl>

			<div class="mt-3 flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={onUpdate}
					disabled={busy}
					class="bg-participation-primary-600 hover:bg-participation-primary-700 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-70"
				>
					{#if busy}
						<svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							></circle>
							<path
								class="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
							></path>
						</svg>
						Updating…
					{:else}
						Update for new subject
					{/if}
				</button>
				<button
					type="button"
					onclick={onKeep}
					disabled={busy}
					class="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-70"
				>
					Keep these
				</button>
			</div>
		</div>
	</div>
</div>
