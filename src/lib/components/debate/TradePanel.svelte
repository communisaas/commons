<script lang="ts">
  import { spring } from 'svelte/motion';
  import { TrendingUp } from '@lucide/svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import PrivacyProofStatus from './PrivacyProofStatus.svelte';
  import type { DebateData } from '$lib/stores/debateState.svelte';
  import { onDestroy } from 'svelte';
  import { generateDebateWeightProof } from '$lib/core/zkp/debate-weight-client';
  import { BN254_MODULUS } from '$lib/core/crypto/bn254';

  // Module-scope storage for proof randomness — kept in memory only.
  // sessionStorage would leak ZK note commitment entropy to same-origin scripts.
  // Trade-off: randomness is lost on tab close, requiring re-commit.
  const proofRandomnessStore = new Map<string, bigint>();

  interface Props {
    debate: DebateData;
    prices: Record<number, number>;
    epochPhase: 'commit' | 'reveal' | 'executing' | 'idle';
    engagementTier: number;
    onCommit?: (trade: {
      argumentIndex: number;
      direction: 'BUY' | 'SELL';
      stakeAmount: number;
      weightedAmount: string;
      noteCommitment: string;
      proof?: Uint8Array;
    }) => void;
    preselectedArgument?: number | null;
  }

  let {
    debate,
    prices,
    epochPhase,
    engagementTier,
    onCommit,
    preselectedArgument = null,
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  let selectedArgumentIndex = $state<number | null>(null);
  let direction = $state<'BUY' | 'SELL' | null>(null);
  let stakeAmount = $state(0);

  // Apply pre-selection from ArgumentCard "Stake on this" button
  $effect(() => {
    if (preselectedArgument != null) {
      selectedArgumentIndex = preselectedArgument;
    }
  });

  // ---------------------------------------------------------------------------
  // Privacy proof state
  // ---------------------------------------------------------------------------

  let proofStatus = $state<'idle' | 'generating' | 'complete' | 'failed'>('idle');
  let proofResult = $state<{
    weightedAmount: string;
    noteCommitment: string;
    proof: Uint8Array;
  } | null>(null);
  let proofError = $state<string | null>(null);
  let proofElapsedSeconds = $state(0);
  let proofTimer = $state<ReturnType<typeof setInterval> | null>(null);
  // Tracks the WASM init sub-stage ('loading' | 'initializing' | 'ready' | 'generating' | 'complete' | 'error')
  // to adjust the estimated-seconds hint shown in PrivacyProofStatus.
  let proofStage = $state<string>('idle');

  // ---------------------------------------------------------------------------
  // Derived values — anti-plutocratic weight formula
  // ---------------------------------------------------------------------------

  const dollarAmount = $derived(stakeAmount / 1e6);
  const sqrtStake = $derived(Math.sqrt(dollarAmount));
  const tierMultiplier = $derived(Math.pow(2, engagementTier));
  const weight = $derived(sqrtStake * tierMultiplier);

  const animatedWeight = spring(0, { stiffness: 0.4, damping: 0.8 });
  $effect(() => {
    animatedWeight.set(weight);
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const isCommitPhase = $derived(epochPhase === 'commit');

  const canSubmit = $derived(
    selectedArgumentIndex !== null &&
      direction !== null &&
      dollarAmount >= 1 &&
      dollarAmount <= 100 &&
      isCommitPhase &&
      proofStatus !== 'generating',
  );

  const disabledReason = $derived.by(() => {
    if (epochPhase === 'idle') return 'Market paused';
    if (epochPhase === 'reveal') return 'Reveal phase — trades locked';
    if (epochPhase === 'executing') return 'Epoch executing — please wait';
    if (proofStatus === 'generating') return 'Generating privacy proof...';
    if (selectedArgumentIndex === null) return 'Select an argument';
    if (direction === null) return 'Choose BUY or SELL';
    if (dollarAmount < 1) return 'Minimum $1';
    if (dollarAmount > 100) return 'Maximum $100';
    return null;
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const STANCE_COLORS: Record<string, string> = {
    SUPPORT: 'bg-indigo-100 text-indigo-700',
    OPPOSE: 'bg-red-100 text-red-700',
    AMEND: 'bg-amber-100 text-amber-700',
  };

  const PRESETS = [1, 5, 10, 25];

  function stanceLabel(stance: string): string {
    return stance.charAt(0) + stance.slice(1).toLowerCase();
  }

  function formatPrice(argIndex: number): string {
    const p = prices[argIndex];
    if (p == null) return '—';
    return (p * 100).toFixed(1) + '%';
  }

  function setPreset(dollars: number) {
    stakeAmount = Math.round(dollars * 1e6);
  }

  // ---------------------------------------------------------------------------
  // Privacy proof generation — real debate_weight circuit
  // ---------------------------------------------------------------------------

  /**
   * Generate a debate_weight ZK proof in the browser via WASM.
   *
   * Proves without revealing inputs:
   *   weightedAmount = floor(sqrt(stake)) * 2^tier
   *   noteCommitment = H3(stake, tier, randomness)
   *
   * WASM init takes ~5-15s on the first call; subsequent calls reuse the
   * cached prover and take ~2-8s. The progress callback stages are:
   *   'loading'      — fetching circuit artifacts
   *   'initializing' — compiling WASM backend
   *   'ready'        — prover cached, beginning proof
   *   'generating'   — proof computation in progress
   *   'complete'     — proof bytes returned
   *   'error'        — init or proving failed (prover cache cleared for retry)
   *
   * SharedArrayBuffer: if COOP/COEP headers are absent the prover falls back
   * to single-threaded mode transparently — no action required here.
   *
   * @param stakeUsdc6 - Stake in USDC smallest unit (e.g., 25_000_000n = $25 USDC)
   * @param tier       - Engagement tier 1-4 (tier 0 rejected by DebateMarket)
   * @param debateId   - Debate ID for sessionStorage keying of randomness
   */
  async function generatePrivacyProof(
    stakeUsdc6: bigint,
    tier: 1 | 2 | 3 | 4,
    debateId: string,
  ): Promise<{
    weightedAmount: string;
    noteCommitment: string;
    proof: Uint8Array;
  }> {
    // Generate 128-bit randomness for note commitment entropy.
    // Read as big-endian unsigned integer → bigint.
    // Retry on the astronomically unlikely zero value (validator requires > 0).
    let randomness = 0n;
    while (randomness === 0n) {
      const randomBytes = new Uint8Array(16);
      crypto.getRandomValues(randomBytes);
      randomness = randomBytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
    }

    // Clamp randomness into the BN254 scalar field if somehow >= modulus.
    // This cannot happen for a 128-bit value against the ~254-bit modulus,
    // but the validation check in generateDebateWeightProof requires it.
    randomness = randomness % BN254_MODULUS;

    // Store randomness in memory before proving. The reveal route needs it
    // to reconstruct the note commitment for settlement. Module-scope Map
    // survives the WASM init window but not tab close (re-commit required).
    proofRandomnessStore.set(`debate:${debateId}:randomness`, randomness);

    const result = await generateDebateWeightProof(
      { stake: stakeUsdc6, tier, randomness },
      (stage) => {
        proofStage = stage;
      },
    );

    return {
      weightedAmount: result.weightedAmount,
      noteCommitment: result.noteCommitment,
      proof: result.proof,
    };
  }

  // ---------------------------------------------------------------------------
  // Proof timer management
  // ---------------------------------------------------------------------------

  function startProofTimer() {
    proofElapsedSeconds = 0;
    proofTimer = setInterval(() => {
      proofElapsedSeconds += 1;
    }, 1000);
  }

  function stopProofTimer() {
    if (proofTimer) {
      clearInterval(proofTimer);
      proofTimer = null;
    }
  }

  // Cleanup proof timer on component destroy (navigation during proof generation)
  onDestroy(stopProofTimer);

  // ---------------------------------------------------------------------------
  // Commit handler — now generates proof before submitting
  // ---------------------------------------------------------------------------

  async function handleCommit() {
    if (!canSubmit || selectedArgumentIndex === null || direction === null) return;

    // Capture values before async gap (user could change inputs mid-proving)
    const tradeArgumentIndex = selectedArgumentIndex;
    const tradeDirection = direction;
    const tradeStakeAmount = stakeAmount; // USDC smallest unit
    const tradeTier = Math.max(1, Math.min(4, engagementTier)) as 1 | 2 | 3 | 4;
    const tradeDebateId = debate.id;

    // Reset any prior proof state
    proofStatus = 'generating';
    proofStage = 'loading';
    proofResult = null;
    proofError = null;
    startProofTimer();

    try {
      const result = await generatePrivacyProof(
        BigInt(tradeStakeAmount), // USDC smallest unit → bigint
        tradeTier,
        tradeDebateId,
      );
      stopProofTimer();

      proofResult = result;
      proofStatus = 'complete';

      // Auto-submit: user already clicked "Commit Trade", send the enhanced trade.
      // weightedAmount and noteCommitment are 0x-prefixed hex strings from the
      // circuit's public inputs — the parent's reveal call should pass them as:
      //   debateWeightProof: '0x' + Array.from(result.proof).map(b => b.toString(16).padStart(2, '0')).join('')
      //   debateWeightPublicInputs: [result.weightedAmount, result.noteCommitment]
      onCommit?.({
        argumentIndex: tradeArgumentIndex,
        direction: tradeDirection,
        stakeAmount: tradeStakeAmount,
        weightedAmount: result.weightedAmount,
        noteCommitment: result.noteCommitment,
        proof: result.proof,
      });
    } catch (err) {
      stopProofTimer();
      proofStage = 'error';
      proofStatus = 'failed';
      proofError = err instanceof Error ? err.message : 'Unknown proof generation error';
      console.error('Privacy proof generation failed:', err);
    }
  }
</script>

<div class="rounded-md border border-slate-200 bg-white p-5">
  <!-- ------------------------------------------------------------------ -->
  <!-- Header                                                              -->
  <!-- ------------------------------------------------------------------ -->
  <div class="mb-4 flex items-center gap-2">
    <TrendingUp class="h-5 w-5 text-indigo-500" />
    <h3 class="text-base font-semibold text-slate-800">Place Trade</h3>
  </div>

  <!-- ------------------------------------------------------------------ -->
  <!-- Argument selector                                                   -->
  <!-- ------------------------------------------------------------------ -->
  <label class="mb-1 block text-xs font-medium text-slate-500">Argument</label>
  <select
    class="mb-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800
      focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
    bind:value={selectedArgumentIndex}
  >
    <option value={null} disabled selected>Select an argument...</option>
    {#each debate.arguments as arg}
      <option value={arg.argumentIndex}>
        [{stanceLabel(arg.stance)}] Argument #{arg.argumentIndex + 1} — {formatPrice(arg.argumentIndex)}
      </option>
    {/each}
  </select>

  <!-- ------------------------------------------------------------------ -->
  <!-- Direction toggle                                                    -->
  <!-- ------------------------------------------------------------------ -->
  <label class="mb-1 block text-xs font-medium text-slate-500">Direction</label>
  <div class="mb-4 flex gap-2">
    <button
      type="button"
      class="flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors
        {direction === 'BUY'
        ? 'border-emerald-500 bg-emerald-500 text-white'
        : 'border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-600'}"
      onclick={() => (direction = 'BUY')}
    >
      BUY
    </button>
    <button
      type="button"
      class="flex-1 rounded-lg border px-4 py-2 text-sm font-medium transition-colors
        {direction === 'SELL'
        ? 'border-red-500 bg-red-500 text-white'
        : 'border-slate-200 text-slate-600 hover:border-red-300 hover:text-red-600'}"
      onclick={() => (direction = 'SELL')}
    >
      SELL
    </button>
  </div>

  <!-- ------------------------------------------------------------------ -->
  <!-- Stake input                                                         -->
  <!-- ------------------------------------------------------------------ -->
  <label class="mb-1 block text-xs font-medium text-slate-500">Stake</label>
  <div class="mb-2">
    <div class="relative">
      <span
        class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
      >
        $
      </span>
      <input
        type="number"
        min="1"
        max="100"
        step="1"
        class="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm text-slate-800
          placeholder:text-slate-400 focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100
          focus:outline-none font-mono"
        placeholder="0"
        value={dollarAmount > 0 ? dollarAmount : ''}
        oninput={(e: Event) => {
          const target = e.target as HTMLInputElement;
          const v = parseFloat(target.value);
          stakeAmount = isNaN(v) ? 0 : Math.round(v * 1e6);
        }}
      />
    </div>
  </div>

  <!-- Preset buttons -->
  <div class="mb-4 flex gap-2">
    {#each PRESETS as preset}
      <button
        type="button"
        class="rounded-md border px-3 py-1 text-xs font-medium transition-colors
          {dollarAmount === preset
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
          : 'border-slate-200 text-slate-500 hover:border-indigo-200 hover:text-indigo-600'}"
        onclick={() => setPreset(preset)}
      >
        ${preset}
      </button>
    {/each}
  </div>

  <!-- Token amount -->
  {#if stakeAmount > 0}
    <p class="mb-4 text-xs text-slate-400">
      <span class="font-mono">{(stakeAmount / 1e6).toFixed(2)}</span> USDC
    </p>
  {/if}

  <!-- ------------------------------------------------------------------ -->
  <!-- Weight preview                                                      -->
  <!-- ------------------------------------------------------------------ -->
  {#if dollarAmount >= 1}
    <div class="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p class="mb-1 text-xs font-medium text-slate-500">Weighted Influence</p>
      <p class="text-sm text-slate-700">
        <span class="font-mono">√(${dollarAmount.toFixed(2)})</span>
        <span class="mx-1 text-slate-400">&times;</span>
        <span class="font-mono">2<sup>{engagementTier}</sup></span>
        <span class="mx-1 text-slate-400">=</span>
        <span class="font-mono font-semibold text-indigo-600">
          {$animatedWeight.toFixed(2)}
        </span>
      </p>
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          class="h-full rounded-full bg-indigo-500 transition-all duration-300"
          style="width: {Math.min(($animatedWeight / 20) * 100, 100)}%"
        ></div>
      </div>
    </div>
  {/if}

  <!-- ------------------------------------------------------------------ -->
  <!-- Privacy proof status                                                -->
  <!-- ------------------------------------------------------------------ -->
  {#if proofStatus !== 'idle'}
    <div class="mb-4">
      <PrivacyProofStatus
        status={proofStatus}
        estimatedSeconds={proofStage === 'loading' || proofStage === 'initializing' ? 15 : 8}
        elapsedSeconds={proofElapsedSeconds}
      />
    </div>
  {/if}

  <!-- Proof error detail -->
  {#if proofStatus === 'failed' && proofError}
    <p class="mb-4 text-xs text-amber-600">
      {proofError}
    </p>
  {/if}

  <!-- ------------------------------------------------------------------ -->
  <!-- Submit                                                              -->
  <!-- ------------------------------------------------------------------ -->
  <div class="mb-2">
    {#if epochPhase === 'idle'}
      <Button variant="primary" size="default" disabled classNames="w-full">
        Market Paused
      </Button>
    {:else if !isCommitPhase}
      <div title="Trades can only be committed during the commit phase">
        <Button variant="primary" size="default" disabled classNames="w-full">
          Commit Trade
        </Button>
      </div>
    {:else}
      <Button
        variant="primary"
        size="default"
        disabled={!canSubmit}
        loading={proofStatus === 'generating'}
        classNames="w-full"
        onclick={handleCommit}
      >
        {#if proofStatus === 'generating'}
          Proving...
        {:else}
          Commit Trade
        {/if}
      </Button>
    {/if}
  </div>

  <!-- ------------------------------------------------------------------ -->
  <!-- Phase notice                                                        -->
  <!-- ------------------------------------------------------------------ -->
  <p class="text-center text-xs text-slate-400">
    {#if epochPhase === 'commit'}
      Commit phase active — submit your trade
    {:else if epochPhase === 'reveal'}
      Reveal phase — trades are locked until the next epoch
    {:else if epochPhase === 'executing'}
      Epoch executing — settlements in progress
    {:else}
      Market is currently paused
    {/if}

    {#if disabledReason && isCommitPhase}
      <span class="mt-0.5 block text-slate-400/80">{disabledReason}</span>
    {/if}
  </p>
</div>
