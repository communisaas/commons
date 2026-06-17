<script lang="ts">
	import {
		computeAttestationHash,
		hashesEqual,
		parseOfflineVerifyBlock,
		type AttestationPreimage
	} from '$lib/core/crypto/attestation-verify';

	let {
		expectedHash,
		campaignId = null,
		// Block-paste mode (the public /v/[hash] surface): the preimage fields are
		// K-anonymized away on this anonymous endpoint and CANNOT be reconstructed
		// server-side. So the recipient is the oracle — they paste the "Verify
		// offline" block their report email printed, and we reconstruct the exact
		// preimage + recompute the SHA-256. The server never re-publishes the exact
		// counts (K-anonymity preserved) while verification stays real.
		blockPaste = false,
		// Non-redacted mode (a trusted surface that already holds the full preimage).
		preimage = null
	}: {
		expectedHash: string;
		campaignId?: string | null;
		blockPaste?: boolean;
		preimage?: AttestationPreimage | null;
	} = $props();

	let userBlock = $state('');
	let computed = $state<string | null>(null);
	let parseError = $state<string | null>(null);
	let parsed = $state<AttestationPreimage | null>(null);
	let computing = $state(false);
	let match = $derived(computed !== null && hashesEqual(computed, expectedHash));

	async function recompute() {
		computing = true;
		computed = null;
		parseError = null;
		parsed = null;
		try {
			let effective: AttestationPreimage;
			if (blockPaste) {
				if (!userBlock.trim()) {
					parseError = 'Paste the "Verify offline" block from your report email to verify.';
					return;
				}
				const result = parseOfflineVerifyBlock(userBlock);
				if ('error' in result) {
					parseError = result.error;
					return;
				}
				effective = result;
				parsed = result;
			} else if (preimage) {
				effective = preimage;
				parsed = preimage;
			} else {
				parseError = 'No preimage available to verify.';
				return;
			}
			computed = await computeAttestationHash(effective);
		} catch (e) {
			parseError = `Could not recompute: ${e instanceof Error ? e.message : 'unknown error'}`;
		} finally {
			computing = false;
		}
	}
</script>

<div class="verifier">
	<header>
		<h2>Verify this attestation yourself</h2>
		<p class="lede">
			Recompute the SHA-256 hash in your browser and compare it against the platform's claim —
			no need to trust Commons.
		</p>
	</header>

	{#if campaignId}
		<dl class="preimage">
			<dt>Campaign</dt>
			<dd class="mono">{campaignId}</dd>
		</dl>
	{/if}

	{#if blockPaste}
		<aside class="redaction-notice">
			This public page does not surface the report's private fields. Paste the
			<strong>“Verify offline”</strong> block from the report email you received — we reconstruct
			the exact preimage and recompute the hash locally.
			<label>
				<span>Verify-offline block</span>
				<textarea
					bind:value={userBlock}
					rows="11"
					spellcheck="false"
					placeholder={'voter-protocol-report-v1\ncampaign:…\n…paste the whole block from your email…'}
				></textarea>
			</label>
		</aside>
	{:else if parsed}
		<dl class="preimage">
			<dt>Verified actions</dt>
			<dd class="mono">{parsed.verified}</dd>
			<dt>Districts</dt>
			<dd class="mono">{parsed.districtCount}</dd>
			<dt>Authorship</dt>
			<dd class="mono">
				individual={parsed.authorship.individual}, shared={parsed.authorship.shared}
			</dd>
		</dl>
	{/if}

	<div class="hashes">
		<div>
			<label>Platform attestation hash</label>
			<code class="hash">{expectedHash}</code>
		</div>
		<button type="button" onclick={recompute} disabled={computing}>
			{computing ? 'Computing…' : computed === null ? 'Recompute in browser' : 'Recompute'}
		</button>
		{#if parseError}
			<p class="hint">{parseError}</p>
		{/if}
		{#if computed !== null}
			<div>
				<label>Recomputed hash</label>
				<code class="hash">{computed}</code>
			</div>
			<div class="result result-{match ? 'match' : 'mismatch'}">
				{match
					? '✓ Match — this report is authentic'
					: '✗ Mismatch — the pasted values do not produce this hash'}
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
	.redaction-notice {
		font-size: 0.85rem;
		color: var(--zinc-600, #52525b);
		background: var(--zinc-100, #f4f4f5);
		border-radius: 0.3rem;
		padding: 0.75rem 0.9rem;
		margin: 0 0 1.25rem 0;
	}
	.redaction-notice label {
		display: block;
		margin-top: 0.6rem;
	}
	.redaction-notice label span {
		display: block;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--zinc-500, #71717a);
		margin-bottom: 0.25rem;
	}
	.redaction-notice textarea {
		width: 100%;
		font-family: ui-monospace, monospace;
		font-size: 0.78rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--zinc-300, #d4d4d8);
		border-radius: 0.3rem;
		resize: vertical;
		box-sizing: border-box;
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
	.hint {
		font-size: 0.82rem;
		color: var(--zinc-500, #71717a);
		margin: 0;
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
