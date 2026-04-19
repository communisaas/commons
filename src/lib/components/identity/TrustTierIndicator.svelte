<!--
	TrustTierIndicator.svelte

	Ambient trust-tier awareness in the 48px IdentityStrip header.

	Perceptual engineering: this is a living element, not a static badge.
	The user's verification state is an ongoing relationship with the system.

	Compact: shield pill with tier label (32px height, fits header context).
	Expanded: popover showing action matrix — which actions are unlocked/locked
	at the current trust tier, with credential freshness for each.

	States:
	  T0 (Guest)              — never rendered (no user object)
	  T1 (Authenticated)      — muted neutral, single ring
	  T2 (District Verified)  — blue, two rings
	  T3 (Identity Verified)  — emerald, three rings
	  T4 (Passport Verified)  — purple, four rings
	  T5 (Government Verified)— gold, five rings filled

	Design system: oklch colors, Satoshi headings, Berkeley Mono data, Lucide icons.
	Pattern: matches WalletStatus.svelte (header pill + popover + backdrop close).
-->

<script lang="ts">
	import { Shield, Lock, Unlock, ChevronDown, Eye, MessageSquare, Mail, FileSignature } from '@lucide/svelte';
	import {
		type TrustTier,
		TRUST_TIER_LABELS
	} from '$lib/core/identity/authority-level';
	import {
		type CredentialAction,
		ACTION_DESCRIPTIONS,
		ACTION_REQUIRED_TIER,
		getDaysUntilExpiry,
		type SessionCredentialForPolicy
	} from '$lib/core/identity/credential-policy';

	// ── Props ─────────────────────────────────────────────────────────────────

	interface Props {
		/** Current trust tier (0-5). Derived from deriveTrustTier(user). */
		tier: TrustTier;
		/** Session credential for freshness checks. Null if no credential stored. */
		credential?: SessionCredentialForPolicy | null;
		/** Callback when user clicks the upgrade CTA in the popover. */
		onUpgrade?: () => void;
	}

	let {
		tier,
		credential = null,
		onUpgrade
	}: Props = $props();

	// ── Tier visual config ───────────────────────────────────────────────────

	interface TierConfig {
		hue: number;
		chroma: number;
		lightness: number;
		ringCount: number;
	}

	const TIER_CONFIGS: Record<TrustTier, TierConfig> = {
		0: { hue: 250, chroma: 0.02, lightness: 0.7, ringCount: 0 },
		1: { hue: 250, chroma: 0.02, lightness: 0.55, ringCount: 1 },
		2: { hue: 260, chroma: 0.18, lightness: 0.55, ringCount: 2 },
		3: { hue: 160, chroma: 0.18, lightness: 0.5, ringCount: 3 },
		4: { hue: 160, chroma: 0.20, lightness: 0.42, ringCount: 4 },
		5: { hue: 85, chroma: 0.15, lightness: 0.55, ringCount: 5 }
	};

	// ── Action matrix config ─────────────────────────────────────────────────
	// Maps each action to its minimum required tier and icon

	interface ActionRow {
		action: CredentialAction;
		label: string;
		minTier: TrustTier;
		icon: typeof Eye;
	}

	const ACTION_MATRIX: ActionRow[] = [
		{ action: 'view_content', label: ACTION_DESCRIPTIONS.view_content, minTier: ACTION_REQUIRED_TIER.view_content as TrustTier, icon: Eye },
		{ action: 'community_discussion', label: ACTION_DESCRIPTIONS.community_discussion, minTier: ACTION_REQUIRED_TIER.community_discussion as TrustTier, icon: MessageSquare },
		{ action: 'constituent_message', label: ACTION_DESCRIPTIONS.constituent_message, minTier: ACTION_REQUIRED_TIER.constituent_message as TrustTier, icon: Mail },
		{ action: 'official_petition', label: ACTION_DESCRIPTIONS.official_petition, minTier: ACTION_REQUIRED_TIER.official_petition as TrustTier, icon: FileSignature }
	];

	// ── Derived state ────────────────────────────────────────────────────────

	const config = $derived(TIER_CONFIGS[tier]);
	const tierLabel = $derived(TRUST_TIER_LABELS[tier]);

	const accentColor = $derived(
		`oklch(${config.lightness} ${config.chroma} ${config.hue})`
	);
	const accentBg = $derived(
		`oklch(${config.lightness} ${config.chroma} ${config.hue} / 0.12)`
	);
	const accentBorder = $derived(
		`oklch(${config.lightness + 0.2} ${config.chroma} ${config.hue} / 0.5)`
	);

	/** For each action, whether it's unlocked at the current tier + days until credential expiry */
	const actionStates = $derived(
		ACTION_MATRIX.map((row) => {
			const unlocked = tier >= row.minTier;
			let daysLeft: number | null = null;

			if (unlocked && credential) {
				daysLeft = getDaysUntilExpiry(credential, row.action);
			}

			return { ...row, unlocked, daysLeft };
		})
	);

	// ── Popover state ────────────────────────────────────────────────────────

	let isOpen: boolean = $state(false);

	function togglePopover() {
		isOpen = !isOpen;
	}

	function closePopover() {
		isOpen = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isOpen) {
			isOpen = false;
		}
	}

	function handleTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			togglePopover();
		}
		if (event.key === 'Escape') {
			isOpen = false;
		}
	}

	// ── SVG ring generation ──────────────────────────────────────────────────
	// 5 concentric rings, progressively filled based on tier

	const RING_COUNT = 5;
	const SVG_SIZE = 18;
	const CENTER = SVG_SIZE / 2;
	const MIN_RADIUS = 3;
	const MAX_RADIUS = 8;

	function getRings(filledCount: number): Array<{ r: number; filled: boolean }> {
		const rings = [];
		for (let i = 0; i < RING_COUNT; i++) {
			const r = MIN_RADIUS + ((MAX_RADIUS - MIN_RADIUS) / (RING_COUNT - 1)) * i;
			rings.push({ r, filled: i < filledCount });
		}
		return rings;
	}

	const rings = $derived(getRings(config.ringCount));
</script>

<svelte:window onkeydown={isOpen ? handleKeydown : undefined} />

{#if tier > 0}
	{#if isOpen}
		<div
			class="tti__backdrop"
			role="presentation"
			onclick={closePopover}
		></div>
	{/if}

	<div class="tti">
		<!-- Trigger pill -->
		<button
			type="button"
			class="tti__pill"
			class:tti__pill--open={isOpen}
			style="--tti-accent: {accentColor}; --tti-accent-bg: {accentBg}; --tti-accent-border: {accentBorder};"
			onclick={togglePopover}
			onkeydown={handleTriggerKeydown}
			aria-haspopup="true"
			aria-expanded={isOpen}
			aria-label="Trust tier: {tierLabel}. Press Enter to see action permissions."
		>
			<!-- Concentric ring shield -->
			<svg
				class="tti__shield"
				width={SVG_SIZE}
				height={SVG_SIZE}
				viewBox="0 0 {SVG_SIZE} {SVG_SIZE}"
				aria-hidden="true"
			>
				{#each rings as ring, i}
					<circle
						cx={CENTER}
						cy={CENTER}
						r={ring.r}
						fill="none"
						stroke={ring.filled ? accentColor : `oklch(0.85 0.01 250)`}
						stroke-width="1.2"
						opacity={ring.filled ? 1 - i * 0.12 : 0.4}
					/>
				{/each}
			</svg>

			<span class="tti__label">{tierLabel}</span>

			<ChevronDown
				class="tti__chevron {isOpen ? 'tti__chevron--open' : ''}"
			/>
		</button>

		<!-- Popover: action matrix -->
		{#if isOpen}
			<div
				class="tti__popover"
				role="dialog"
				aria-label="Trust tier actions"
			>
				<!-- Tier header -->
				<div class="tti__popover-header" style="--tti-accent: {accentColor}; --tti-accent-bg: {accentBg};">
					<div class="tti__popover-shield-wrap">
						<svg
							width="28"
							height="28"
							viewBox="0 0 {SVG_SIZE} {SVG_SIZE}"
							aria-hidden="true"
						>
							{#each rings as ring, i}
								<circle
									cx={CENTER}
									cy={CENTER}
									r={ring.r}
									fill="none"
									stroke={ring.filled ? accentColor : `oklch(0.85 0.01 250)`}
									stroke-width="1.2"
									opacity={ring.filled ? 1 - i * 0.12 : 0.4}
								/>
							{/each}
						</svg>
					</div>
					<div class="tti__popover-title-group">
						<h3 class="tti__popover-title">{tierLabel}</h3>
						<p class="tti__popover-subtitle">Tier {tier} of 5</p>
					</div>
				</div>

				<!-- Action rows -->
				<div class="tti__action-list" role="list" aria-label="Action permissions">
					{#each actionStates as row}
						<div
							class="tti__action-row"
							class:tti__action-row--locked={!row.unlocked}
							role="listitem"
						>
							<div class="tti__action-icon-wrap" class:tti__action-icon-wrap--unlocked={row.unlocked}>
								{#if row.unlocked}
									<Unlock class="tti__action-icon tti__action-icon--unlocked" />
								{:else}
									<Lock class="tti__action-icon tti__action-icon--locked" />
								{/if}
							</div>

							<div class="tti__action-info">
								<span class="tti__action-label" class:tti__action-label--locked={!row.unlocked}>
									{row.label}
								</span>
								{#if row.unlocked && row.daysLeft !== null}
									<span class="tti__action-expiry" class:tti__action-expiry--warn={row.daysLeft <= 7} class:tti__action-expiry--urgent={row.daysLeft <= 1}>
										{#if row.daysLeft < 0}
											Credential expired
										{:else if row.daysLeft === 0}
											Expires today
										{:else}
											{row.daysLeft}d remaining
										{/if}
									</span>
								{:else if !row.unlocked}
									<span class="tti__action-requires">
										Requires Tier {row.minTier}
									</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<!-- Upgrade CTA (if not at max tier) -->
				{#if tier < 5 && onUpgrade}
					<div class="tti__popover-footer">
						<button
							type="button"
							class="tti__upgrade-btn"
							onclick={() => { closePopover(); onUpgrade?.(); }}
						>
							Upgrade verification
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* ── Backdrop ───────────────────────────────────────────────────────────── */

	.tti__backdrop {
		position: fixed;
		inset: 0;
		z-index: 90;
	}

	/* ── Wrapper ────────────────────────────────────────────────────────────── */

	.tti {
		position: relative;
		display: inline-flex;
		align-items: center;
	}

	/* ── Trigger pill ───────────────────────────────────────────────────────── */

	.tti__pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 10px 4px 7px;
		border-radius: 20px;
		border: 1px solid var(--tti-accent-border);
		background: var(--tti-accent-bg);
		cursor: pointer;
		height: 32px;
		transition:
			background 150ms cubic-bezier(0.4, 0, 0.2, 1),
			border-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.tti__pill:hover,
	.tti__pill--open {
		background: oklch(0.94 0.02 250 / 0.7);
		border-color: var(--tti-accent);
	}

	.tti__pill:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px oklch(0.6 0.15 270 / 0.5);
	}

	/* ── Shield SVG ─────────────────────────────────────────────────────────── */

	.tti__shield {
		flex-shrink: 0;
	}

	/* ── Label ──────────────────────────────────────────────────────────────── */

	.tti__label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--header-text-primary, oklch(0.15 0.02 250));
		white-space: nowrap;
		letter-spacing: 0.01em;
	}

	/* ── Chevron ────────────────────────────────────────────────────────────── */

	:global(.tti__chevron) {
		width: 12px;
		height: 12px;
		color: oklch(0.5 0.02 250);
		flex-shrink: 0;
		transition: transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	:global(.tti__chevron--open) {
		transform: rotate(180deg);
	}

	/* ── Popover ────────────────────────────────────────────────────────────── */

	.tti__popover {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		z-index: 100;

		min-width: 280px;
		max-width: 340px;
		padding: 0;

		background: oklch(1 0 0 / 0.98);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border: 1px solid var(--header-border, oklch(0.85 0.02 250 / 0.6));
		border-radius: 12px;
		box-shadow:
			0 4px 6px oklch(0 0 0 / 0.05),
			0 10px 24px oklch(0 0 0 / 0.1);

		transform-origin: top right;
		animation: tti-popover-enter 140ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	@keyframes tti-popover-enter {
		from {
			opacity: 0;
			transform: scale(0.95) translateY(-4px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	/* ── Popover header ─────────────────────────────────────────────────────── */

	.tti__popover-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 14px 14px 10px;
	}

	.tti__popover-shield-wrap {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--tti-accent-bg);
	}

	.tti__popover-title-group {
		flex: 1;
		min-width: 0;
	}

	.tti__popover-title {
		margin: 0;
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.9375rem;
		font-weight: 600;
		color: var(--header-text-primary, oklch(0.15 0.02 250));
		line-height: 1.3;
	}

	.tti__popover-subtitle {
		margin: 0;
		font-family: 'Berkeley Mono', 'Cascadia Code', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.55 0.02 250);
		letter-spacing: 0.02em;
	}

	/* ── Action list ────────────────────────────────────────────────────────── */

	.tti__action-list {
		padding: 4px 6px;
		border-top: 1px solid oklch(0.92 0.01 250 / 0.8);
	}

	.tti__action-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 8px;
		border-radius: 8px;
	}

	.tti__action-row--locked {
		opacity: 0.55;
	}

	/* ── Action icon ────────────────────────────────────────────────────────── */

	.tti__action-icon-wrap {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 7px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: oklch(0.93 0.01 250 / 0.6);
	}

	.tti__action-icon-wrap--unlocked {
		background: oklch(0.65 0.18 160 / 0.12);
	}

	:global(.tti__action-icon) {
		width: 14px;
		height: 14px;
	}

	:global(.tti__action-icon--unlocked) {
		color: oklch(0.5 0.18 160);
	}

	:global(.tti__action-icon--locked) {
		color: oklch(0.6 0.02 250);
	}

	/* ── Action info ────────────────────────────────────────────────────────── */

	.tti__action-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.tti__action-label {
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--header-text-primary, oklch(0.15 0.02 250));
		line-height: 1.3;
		text-transform: capitalize;
	}

	.tti__action-label--locked {
		color: oklch(0.55 0.02 250);
	}

	.tti__action-expiry {
		font-family: 'Berkeley Mono', 'Cascadia Code', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.55 0.02 250);
		letter-spacing: 0.02em;
	}

	.tti__action-expiry--warn {
		color: oklch(0.55 0.15 80);
	}

	.tti__action-expiry--urgent {
		color: oklch(0.5 0.2 20);
	}

	.tti__action-requires {
		font-family: 'Berkeley Mono', 'Cascadia Code', ui-monospace, monospace;
		font-size: 0.6875rem;
		color: oklch(0.65 0.02 250);
		letter-spacing: 0.02em;
	}

	/* ── Upgrade CTA footer ─────────────────────────────────────────────────── */

	.tti__popover-footer {
		padding: 6px 6px 6px;
		border-top: 1px solid oklch(0.92 0.01 250 / 0.8);
	}

	.tti__upgrade-btn {
		display: flex;
		width: 100%;
		justify-content: center;
		padding: 8px 14px;
		border-radius: 8px;
		border: none;
		background: oklch(0.5 0.18 260);
		color: oklch(1 0 0);
		font-family: 'Satoshi', system-ui, sans-serif;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 150ms cubic-bezier(0.4, 0, 0.2, 1),
			transform 100ms cubic-bezier(0.4, 0, 0.2, 1),
			box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.tti__upgrade-btn:hover {
		background: oklch(0.44 0.2 260);
		box-shadow: 0 4px 12px oklch(0.5 0.18 260 / 0.3);
	}

	.tti__upgrade-btn:active {
		transform: scale(0.98);
	}

	.tti__upgrade-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 3px oklch(0.5 0.18 260 / 0.35);
	}

	/* ── Reduced motion ─────────────────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.tti__popover {
			animation: none;
		}

		.tti__pill,
		.tti__upgrade-btn,
		.tti__action-row {
			transition: none;
		}

		:global(.tti__chevron) {
			transition: none;
		}
	}
</style>
