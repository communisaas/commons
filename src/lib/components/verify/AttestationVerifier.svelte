<script lang="ts">
	import {
		computeAttestationHash,
		hashesEqual,
		type AttestationPreimage
	} from '$lib/core/crypto/attestation-verify';

	let {
		preimage,
		expectedHash,
		// FIX-V5: when titleRedacted is true, the parent passed placeholder
		// strings for campaignTitle + orgName (privacy-preserving on anonymous
		// surfaces). The visitor types the real values they saw in the email
		// they received, and recompute uses THOSE for the preimage hash. This
		// preserves both privacy (we don't surface title on the public URL)
		// and verifiability (visitor with the email can still confirm).
		titleRedacted = false
	}: {
		preimage: AttestationPreimage;
		expectedHash: string;
		titleRedacted?: boolean;
	} = $props();

	let computed = $state<string | null>(null);
	let computing = $state(false);
	let userTitle = $state('');
	let userOrgName = $state('');
	let match = $derived(computed !== null && hashesEqual(computed, expectedHash));

	async function recompute() {
		computing = true;
		try {
			const effective = titleRedacted
				? { ...preimage, campaignTitle: userTitle.trim(), orgName: userOrgName.trim() }
				: preimage;
			if (titleRedacted && (!effective.campaignTitle || !effective.orgName)) {
				computed = 'error: enter campaign title and organization to recompute';
				return;
			}
			computed = await computeAttestationHash(effective);
		} catch (e) {
			computed = `error: ${e instanceof Error ? e.message : 'unknown'}`;
		} finally {
			computing = false;
		}
	}
</script>

<div class="verifier">
	<header>
		<h2>Verify attestation</h2>
		<p class="lede">
			Recompute the SHA-256 hash in your browser from the canonical preimage
			fields below and compare against the platform's claim.
		</p>
	</header>

	{#if titleRedacted}
		<aside class="redaction-notice">
			Title and organization are redacted on this public surface.
			Enter the values from the email or report you received to recompute
			the hash.
			<label>
				<span>Campaign title</span>
				<input type="text" bind:value={userTitle} placeholder="As it appeared in your email" />
			</label>
			<label>
				<span>Organization</span>
				<input type="text" bind:value={userOrgName} placeholder="As it appeared in your email" />
			</label>
		</aside>
	{/if}

	<dl class="preimage">
		<dt>Campaign</dt>
		<dd class="mono">{preimage.campaignId}</dd>
		{#if !titleRedacted}
			<dt>Title</dt>
			<dd>{preimage.campaignTitle}</dd>
			<dt>Organization</dt>
			<dd>{preimage.orgName}</dd>
		{/if}
		<dt>Verified actions</dt>
		<dd class="mono">{preimage.verified}</dd>
		<dt>Districts</dt>
		<dd class="mono">{preimage.districtCount}</dd>
		<dt>Authorship</dt>
		<dd class="mono">
			individual={preimage.authorship.individual},
			shared={preimage.authorship.shared},
			explicit={preimage.authorship.explicit ? 'yes' : 'no'}
		</dd>
		<dt>Date range</dt>
		<dd>
			{preimage.dateRange.earliest} – {preimage.dateRange.latest}
			({preimage.dateRange.spanDays} days)
		</dd>
		{#if preimage.identityBreakdown}
			<dt>Identity</dt>
			<dd class="mono">
				govId={preimage.identityBreakdown.govId},
				address={preimage.identityBreakdown.addressVerified},
				email={preimage.identityBreakdown.emailOnly}
			</dd>
		{/if}
		<dt>Geography hashes</dt>
		<dd class="mono small">
			{(preimage.geography ?? []).length} districts
		</dd>
	</dl>

	<div class="hashes">
		<div>
			<label>Platform attestation hash</label>
			<code class="hash">{expectedHash}</code>
		</div>
		<button type="button" onclick={recompute} disabled={computing}>
			{computing ? 'Computing…' : computed === null ? 'Recompute in browser' : 'Recompute'}
		</button>
		{#if computed !== null}
			<div>
				<label>Recomputed hash</label>
				<code class="hash">{computed}</code>
			</div>
			<div class="result result-{match ? 'match' : 'mismatch'}">
				{match ? '✓ Match — attestation verified' : '✗ Mismatch — preimage diverges from hash'}
			</div>
		{/if}
	</div>
</div>

<style>
	.verifier {
		border: 1px solid var(--zinc-300, #d4d4d8);
		border-radius: 0.4rem;
		padding: 1.25rem;
		margin: 1.5rem 0;
		background: var(--zinc-50, #fafafa);
	}
	header h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1.1rem;
	}
	.lede {
		color: var(--zinc-500, #71717a);
		font-size: 0.85rem;
		margin: 0 0 1rem 0;
	}
	.preimage {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.4rem 1rem;
		margin: 0 0 1.25rem 0;
		font-size: 0.9rem;
	}
	.preimage dt {
		font-weight: 500;
		color: var(--zinc-700, #3f3f46);
	}
	.preimage dd {
		margin: 0;
	}
	.mono {
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
	}
	.small {
		font-size: 0.8rem;
		color: var(--zinc-500, #71717a);
	}
	.hashes {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.hashes label {
		display: block;
		font-size: 0.75rem;
		color: var(--zinc-500, #71717a);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.2rem;
	}
	.hash {
		display: block;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		padding: 0.4rem 0.6rem;
		background: var(--zinc-900, #18181b);
		color: var(--zinc-50, #fafafa);
		border-radius: 0.25rem;
		word-break: break-all;
	}
	button {
		background: var(--accent, #0d9488);
		color: white;
		border: 0;
		padding: 0.5rem 1rem;
		border-radius: 0.3rem;
		cursor: pointer;
		font: inherit;
		align-self: flex-start;
	}
	button:disabled {
		opacity: 0.5;
		cursor: wait;
	}
	.result {
		padding: 0.5rem 0.75rem;
		border-radius: 0.3rem;
		font-weight: 500;
	}
	.result-match {
		background: var(--green-100, #dcfce7);
		color: var(--green-800, #166534);
	}
	.result-mismatch {
		background: var(--red-100, #fee2e2);
		color: var(--red-800, #991b1b);
	}
</style>
