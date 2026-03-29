<script lang="ts">
	/**
	 * DebateProofGenerator — ZK proof generation for debate participation
	 *
	 * Mirrors ProofGenerator.svelte's state machine but uses
	 * buildDebateActionDomain() for the debate-scoped action domain.
	 */

	// CRITICAL: Buffer shim must load before bb.js
	import '$lib/core/proof/buffer-shim';

	import { onMount } from 'svelte';
	import { ShieldCheck, AlertCircle, Check, Loader2 } from '@lucide/svelte';

	interface Props {
		userId: string;
		/** Base action domain from the template (0x-prefixed, 64 hex chars) */
		baseDomain: string;
		/** Proposition hash of the debate (0x-prefixed, 64 hex chars) */
		propositionHash: string;
		/** Auto-start on mount */
		autoStart?: boolean;
		oncomplete?: (data: {
			proofHex: string;
			publicInputs: string[];
			nullifierHex: string;
			actionDomainHex: string;
		}) => void;
		oncancel?: () => void;
		onreverify?: () => void;
		onerror?: (data: { message: string }) => void;
	}

	let {
		userId,
		baseDomain,
		propositionHash,
		autoStart = false,
		oncomplete,
		oncancel,
		onreverify,
		onerror
	}: Props = $props();

	type ProofState =
		| { status: 'idle' }
		| { status: 'loading-credential' }
		| { status: 'initializing-prover'; progress: number }
		| { status: 'generating-proof'; progress: number }
		| { status: 'complete'; proofHex: string; publicInputs: string[]; nullifierHex: string }
		| { status: 'error'; message: string; recoverable: boolean };

	let proofState: ProofState = $state({ status: 'idle' });
	let educationIndex = $state(0);

	const educationalMessages = [
		{ icon: '✓', text: 'Your argument is anonymous but verified' },
		{ icon: '✓', text: 'Only constituents from this district can participate' },
		{ icon: '✓', text: 'Your stake is locked until resolution' }
	];

	onMount(() => {
		if (autoStart) {
			generateProof();
		}
	});

	// Cycle educational messages during proof generation
	$effect(() => {
		if (proofState.status === 'generating-proof') {
			const interval = setInterval(() => {
				educationIndex = (educationIndex + 1) % educationalMessages.length;
			}, 3000);
			return () => clearInterval(interval);
		}
	});

	async function generateProof() {
		try {
			// Step 1: Load session credential
			proofState = { status: 'loading-credential' };

			const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
			const credential = await getSessionCredential(userId);

			if (!credential) {
				proofState = {
					status: 'error',
					message: 'Your proof credentials need to be restored. This takes one quick verification.',
					recoverable: true
				};
				onerror?.({ message: 'Credential needs recovery' });
				return;
			}

			if (credential.credentialType !== 'three-tree') {
				proofState = {
					status: 'error',
					message: 'Your credential needs to be updated. Please re-verify.',
					recoverable: true
				};
				onerror?.({ message: 'Invalid credential type' });
				return;
			}

			// Step 2: Derive debate action domain
			const { buildDebateActionDomain } = await import('$lib/core/zkp/action-domain-builder');
			const actionDomain = buildDebateActionDomain(baseDomain, propositionHash);
			console.log('[DebateProofGen] Debate action domain:', actionDomain.slice(0, 16) + '...');

			// Step 3: Compute nullifier
			const { computeNullifier } = await import('$lib/core/crypto/poseidon');
			const nullifierHex = await computeNullifier(credential.identityCommitment, actionDomain);
			console.log('[DebateProofGen] Nullifier:', nullifierHex.slice(0, 16) + '...');

			// Step 4: Map credential to circuit inputs
			const { mapCredentialToProofInputs } = await import(
				'$lib/core/identity/proof-input-mapper'
			);
			const proofInputs = mapCredentialToProofInputs(credential, {
				actionDomain,
				nullifier: nullifierHex
			});

			// Step 5: Generate three-tree proof
			proofState = { status: 'initializing-prover', progress: 0 };
			const { generateThreeTreeProof } = await import('$lib/core/zkp/prover-client');

			proofState = { status: 'generating-proof', progress: 0 };
			const result = await generateThreeTreeProof(proofInputs, (progress) => {
				if (progress.stage === 'loading' || progress.stage === 'initializing') {
					proofState = { status: 'initializing-prover', progress: progress.percent };
				} else if (progress.stage === 'generating') {
					proofState = { status: 'generating-proof', progress: progress.percent };
				}
			});

			proofState = {
				status: 'complete',
				proofHex: result.proof,
				publicInputs: result.publicInputsArray,
				nullifierHex
			};

			oncomplete?.({
				proofHex: result.proof,
				publicInputs: result.publicInputsArray,
				nullifierHex,
				actionDomainHex: actionDomain
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Proof generation failed';
			proofState = { status: 'error', message, recoverable: false };
			onerror?.({ message });
		}
	}
</script>

<div class="space-y-4">
	{#if proofState.status === 'idle'}
		<div class="text-center py-4">
			<ShieldCheck class="h-8 w-8 text-indigo-400 mx-auto mb-2" />
			<p class="text-sm text-slate-600">Ready to generate your anonymous proof</p>
			<button
				class="mt-3 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg
					hover:bg-indigo-700 transition-colors"
				onclick={generateProof}
			>
				Generate ZK Proof
			</button>
		</div>

	{:else if proofState.status === 'loading-credential'}
		<div class="flex items-center gap-3 py-4">
			<Loader2 class="h-5 w-5 text-indigo-500 animate-spin" />
			<span class="text-sm text-slate-600">Loading your verification credential...</span>
		</div>

	{:else if proofState.status === 'initializing-prover'}
		<div class="space-y-2 py-4">
			<div class="flex items-center gap-3">
				<Loader2 class="h-5 w-5 text-indigo-500 animate-spin" />
				<span class="text-sm text-slate-600">Initializing proof system...</span>
			</div>
			<div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
				<div
					class="h-full rounded-full bg-indigo-500 transition-all duration-300"
					style="width: {proofState.progress}%"
				></div>
			</div>
		</div>

	{:else if proofState.status === 'generating-proof'}
		<div class="space-y-3 py-4">
			<div class="flex items-center gap-3">
				<Loader2 class="h-5 w-5 text-indigo-500 animate-spin" />
				<span class="text-sm text-slate-600">Generating zero-knowledge proof...</span>
			</div>
			<div class="h-1.5 rounded-full bg-slate-100 overflow-hidden">
				<div
					class="h-full rounded-full bg-indigo-500 transition-all duration-300"
					style="width: {proofState.progress}%"
				></div>
			</div>
			<!-- Educational message -->
			<div class="flex items-center gap-2 text-xs text-slate-500 transition-opacity duration-300">
				<span>{educationalMessages[educationIndex].icon}</span>
				<span>{educationalMessages[educationIndex].text}</span>
			</div>
		</div>

	{:else if proofState.status === 'complete'}
		<div class="flex items-center gap-3 py-4">
			<Check class="h-5 w-5 text-emerald-500" />
			<span class="text-sm font-medium text-emerald-700">Proof generated successfully</span>
		</div>

	{:else if proofState.status === 'error'}
		<div class="space-y-2 py-4">
			<div class="flex items-center gap-3">
				<AlertCircle class="h-5 w-5 text-red-500" />
				<span class="text-sm text-red-700">{proofState.message}</span>
			</div>
			{#if proofState.recoverable}
				<div class="flex gap-2">
					<button
						class="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 rounded
							hover:bg-indigo-100 transition-colors"
						onclick={() => onreverify?.()}
					>
						Re-verify Identity
					</button>
					<button
						class="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 rounded
							hover:bg-slate-100 transition-colors"
						onclick={() => oncancel?.()}
					>
						Cancel
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
