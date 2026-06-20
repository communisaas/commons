<!--
  SendConfirmation — the engineered send PEAK + the honesty confirm.

  A mailto handoff only tells us the mail app was OPENED, never that mail was
  sent. So instead of optimistically marking "contacted" on a tab-return timer,
  this surface asks — "did it send?" — and only an explicit Yes marks contact.
  That same moment is the peak: it names the consequence, surfaces the proof the
  message carried (a real /v/[hash] receipt for verified senders, sender-framed),
  and offers the forward action (share so others send too). No-mail-client users
  get the copy path (with a manual-select fallback if the clipboard is denied).

  Principle: peak-end + goal-gradient at the finish; affordance/signal honesty
  (never claim delivery the system can't observe).
-->
<script lang="ts">
	import { Check, Copy, Share2, ExternalLink, X } from '@lucide/svelte';

	let {
		recipientNames = [],
		/** The attestation line the message carried, e.g. "Verified resident · CA-12". */
		attestationLine = undefined,
		/** Real receipt link (/v/[hash]) — only present for verified senders. */
		proofUrl = undefined,
		/** Campaign URL for the share-forward. */
		shareUrl,
		/** Full message text for the copy fallback. */
		messageText = '',
		/** Called only on an explicit "Yes, it sent" — this is what marks contact. */
		onConfirmSent,
		onClose
	}: {
		recipientNames?: string[];
		attestationLine?: string;
		proofUrl?: string;
		shareUrl: string;
		messageText?: string;
		onConfirmSent: () => void;
		onClose: () => void;
	} = $props();

	let stage = $state<'confirm' | 'sent' | 'copy'>('confirm');
	let copied = $state(false);
	let copyFailed = $state(false);
	let shared = $state(false);
	let cardEl = $state<HTMLElement>();

	const count = $derived(recipientNames.length);
	const who = $derived(
		count === 0
			? 'your recipient'
			: count <= 2
				? recipientNames.join(' and ')
				: `${count} recipients`
	);

	function confirmSent() {
		onConfirmSent(); // mark contact FIRST, then advance to the success stage
		stage = 'sent';
	}
	function notSent() {
		stage = 'copy';
	}
	async function copyMessage() {
		try {
			await navigator.clipboard.writeText(messageText);
			copied = true;
			copyFailed = false;
		} catch {
			copied = false;
			copyFailed = true; // the textarea is the manual fallback
		}
	}
	async function share() {
		try {
			if (typeof navigator !== 'undefined' && navigator.share) {
				await navigator.share({ url: shareUrl });
				shared = true;
			} else {
				await navigator.clipboard.writeText(shareUrl);
				shared = true;
			}
		} catch {
			/* user dismissed the share sheet / clipboard denied — no-op */
		}
	}

	// Move focus INTO the dialog on open + whenever the stage (and its buttons) change.
	$effect(() => {
		stage; // re-run on stage change
		cardEl?.querySelector<HTMLElement>('button:not(.sc-close)')?.focus();
	});

	// Escape closes; Tab is trapped within the dialog so keyboard users can't reach
	// the page behind (which also prevents a concurrent send orphaning an in-flight card).
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
			return;
		}
		if (e.key !== 'Tab' || !cardEl) return;
		const f = Array.from(
			cardEl.querySelectorAll<HTMLElement>(
				'button, a[href], textarea, [tabindex]:not([tabindex="-1"])'
			)
		);
		if (f.length === 0) return;
		const first = f[0];
		const last = f[f.length - 1];
		const active = document.activeElement;
		if (!cardEl.contains(active as Node)) {
			e.preventDefault();
			first.focus();
		} else if (e.shiftKey && active === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && active === last) {
			e.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window on:keydown={onKeydown} />

<div class="sc-overlay" role="dialog" aria-modal="true" aria-labelledby="sc-title">
	<div class="sc-card" bind:this={cardEl}>
		<button type="button" class="sc-close" aria-label="Close" onclick={onClose}>
			<X class="h-4 w-4" />
		</button>

		{#if stage === 'confirm'}
			<h2 id="sc-title" class="sc-title">We opened your mail app for {who}.</h2>
			<p class="sc-sub">Send it from there, then let us know — we can't see your mail app, so a real "sent" only counts when you confirm.</p>
			<div class="sc-actions">
				<button type="button" class="sc-btn sc-btn--primary" onclick={confirmSent}>Yes, it sent</button>
				<button type="button" class="sc-btn sc-btn--ghost" onclick={notSent}>No — copy it instead</button>
			</div>
		{:else if stage === 'sent'}
			<div class="sc-peak-mark"><Check class="h-5 w-5" /></div>
			<h2 id="sc-title" class="sc-title">Sent to {who}.</h2>
			{#if attestationLine}
				<p class="sc-proof">
					Your message carried <strong>{attestationLine}</strong>.
					{#if proofUrl}
						<a class="sc-proof-link" href={proofUrl} target="_blank" rel="noopener">
							View receipt <ExternalLink class="h-3 w-3" />
						</a>
					{/if}
				</p>
			{/if}
			<div class="sc-actions">
				<button type="button" class="sc-btn sc-btn--primary" onclick={share}>
					<Share2 class="h-4 w-4" />
					{shared ? 'Link copied — share it' : 'Share so others send too'}
				</button>
				<button type="button" class="sc-btn sc-btn--ghost" onclick={onClose}>Done</button>
			</div>
		{:else}
			<h2 id="sc-title" class="sc-title">Copy your message</h2>
			<p class="sc-sub">Paste it into any email client and send to {who}.</p>
			<textarea class="sc-copy-text" readonly rows="5" value={messageText}></textarea>
			<div class="sc-actions">
				<button type="button" class="sc-btn sc-btn--primary" onclick={copyMessage}>
					<Copy class="h-4 w-4" />
					{copyFailed ? 'Select the text above to copy' : copied ? 'Copied' : 'Copy message'}
				</button>
				<button type="button" class="sc-btn sc-btn--ghost" onclick={confirmSent}>I sent it</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.sc-overlay {
		position: fixed;
		inset: 0;
		z-index: 1010;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: oklch(0.2 0.02 250 / 0.45);
		backdrop-filter: blur(2px);
	}
	.sc-card {
		position: relative;
		width: 100%;
		max-width: 26rem;
		background: #fff;
		border-radius: 1rem;
		padding: 1.75rem 1.5rem 1.5rem;
		box-shadow: 0 20px 50px -12px oklch(0.2 0.02 250 / 0.35);
		text-align: center;
		animation: sc-rise 200ms ease;
	}
	@keyframes sc-rise {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	.sc-close {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		display: inline-flex;
		padding: 0.375rem;
		border: none;
		background: none;
		color: oklch(0.6 0.012 250);
		cursor: pointer;
		border-radius: 0.5rem;
	}
	.sc-close:hover { color: oklch(0.3 0.02 250); }
	.sc-close:focus-visible { outline: 2px solid var(--coord-verified, #10b981); outline-offset: 2px; }
	.sc-peak-mark {
		width: 2.75rem;
		height: 2.75rem;
		margin: 0 auto 0.75rem;
		border-radius: 9999px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--coord-verified, #10b981);
		color: #fff;
	}
	.sc-title {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 1.125rem;
		font-weight: 600;
		color: oklch(0.25 0.02 250);
		line-height: 1.35;
	}
	.sc-sub {
		margin: 0.625rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: oklch(0.5 0.015 250);
	}
	.sc-proof {
		margin: 0.75rem 0 0;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: oklch(0.45 0.015 250);
	}
	.sc-proof strong { color: oklch(0.3 0.02 250); font-weight: 600; }
	.sc-proof-link {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: 0.25rem;
		color: var(--coord-verified, #10b981);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.sc-proof-link:hover { text-decoration: underline; }
	.sc-copy-text {
		width: 100%;
		margin-top: 0.875rem;
		padding: 0.625rem 0.75rem;
		border: 1px solid oklch(0.88 0.01 250);
		border-radius: 0.5rem;
		background: oklch(0.985 0.003 250);
		font-size: 0.75rem;
		line-height: 1.5;
		color: oklch(0.35 0.015 250);
		resize: none;
		text-align: left;
	}
	.sc-copy-text:focus-visible { outline: 2px solid var(--coord-verified, #10b981); outline-offset: 1px; }
	.sc-actions {
		margin-top: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.sc-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.625rem 1rem;
		border-radius: 0.625rem;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background-color 150ms ease, border-color 150ms ease;
	}
	.sc-btn--primary {
		border: none;
		background: var(--coord-verified, #10b981);
		color: #fff;
	}
	.sc-btn--primary:hover { background: oklch(0.62 0.13 165); }
	.sc-btn--ghost {
		border: 1px solid oklch(0.86 0.01 250);
		background: #fff;
		color: oklch(0.35 0.02 250);
	}
	.sc-btn--ghost:hover { border-color: oklch(0.7 0.01 250); }
	.sc-btn:focus-visible { outline: 2px solid var(--coord-verified, #10b981); outline-offset: 2px; }

	@media (prefers-reduced-motion: reduce) {
		.sc-card { animation: none; }
		.sc-btn { transition: none; }
	}
</style>
