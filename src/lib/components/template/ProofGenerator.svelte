<script lang="ts">
	// CRITICAL: Import buffer shim BEFORE any bb.js code can run.
	// bb.js uses Buffer as a global; without this, Fr constructor throws "Buffer is not defined".
	import '$lib/core/proof/buffer-shim';

	import { onMount } from 'svelte';
	import { ShieldCheck, AlertCircle, Check, Loader2 } from '@lucide/svelte';
	import type { WitnessData } from '$lib/core/proof/witness-encryption';

	interface Props {
		userId: string;
		templateId: string;
		templateData: {
			subject: string;
			message: string;
			recipientOffices: string[];
		};
		/** Structured delivery address for CWC submission (encrypted in witness) */
		deliveryAddress?: {
			name: string;
			email: string;
			street: string;
			city: string;
			state: string;
			zip: string;
			phone?: string;
			congressional_district?: string;
		};
		/** Legislative session ID for action domain (defaults to '119th-congress') */
		sessionId?: string;
		/** Recipient subdivision for action domain (defaults to 'national') */
		recipientSubdivision?: string;
		/** Auto-start proof generation on mount (skips idle state) */
		autoStart?: boolean;
		oncomplete?: (data: { submissionId: string }) => void;
		oncancel?: () => void;
		onreverify?: () => void;
		onerror?: (data: { message: string }) => void;
	}

	let {
		userId,
		templateId,
		templateData,
		deliveryAddress,
		sessionId = '119th-congress',
		recipientSubdivision = 'national',
		autoStart = false,
		oncomplete,
		oncancel,
		onreverify,
		onerror
	}: Props = $props();

	type ProofGenerationState =
		| { status: 'idle' }
		| { status: 'loading-credential' }
		| { status: 'initializing-prover'; progress: number }
		| { status: 'generating-proof'; progress: number }
		| { status: 'encrypting-witness' }
		| { status: 'submitting' }
		| { status: 'complete'; submissionId: string }
		| { status: 'error'; message: string; recoverable: boolean; retryAction?: () => void; retryLabel?: string };

	let proofState: ProofGenerationState = $state({ status: 'idle' });
	let educationIndex = $state(0);

	// Educational messages that cycle during proof generation
	const educationalMessages = [
		{ icon: '✓', text: 'Your exact address stays private' },
		{
			icon: '✓',
			text: 'Congressional staff see: "Verified constituent from your district"'
		},
		{ icon: '✓', text: 'Building your civic reputation on-chain' }
	];

	// Auto-start proof generation if requested (skips idle confirmation step)
	onMount(() => {
		if (autoStart) {
			generateAndSubmit();
		}
	});

	// Cycle educational messages every 3 seconds during proof generation
	$effect(() => {
		if (proofState.status === 'generating-proof') {
			const interval = setInterval(() => {
				educationIndex = (educationIndex + 1) % educationalMessages.length;
			}, 3000);
			return () => clearInterval(interval);
		}
	});

	/**
	 * Main proof generation flow
	 */
	async function generateAndSubmit() {
		try {
			// Step 1: Load session credential from IndexedDB
			proofState = { status: 'loading-credential' };

			const { getSessionCredential } = await import('$lib/core/identity/session-credentials');
			const credential = await getSessionCredential(userId);

			if (!credential) {
				proofState = {
					status: 'error',
					message: 'Your proof credentials need to be restored. This takes one quick verification.',
					recoverable: true,
					retryLabel: 'Restore Credentials',
					retryAction: () => {
						onreverify?.();
					}
				};
				return;
			}

			// Step 2: Generate ZK Proof (branches on credential type)
			let proofHex: string;
			let publicInputsPayload: Record<string, unknown>;
			let nullifierHex: string;
			let actionDomainHex: string = '';

			if (credential.credentialType !== 'three-tree') {
				proofState = {
					status: 'error',
					message: 'Your verification credential needs to be updated. Please re-verify your identity to continue.',
					recoverable: true,
					retryLabel: 'Re-verify Identity',
					retryAction: () => {
						onreverify?.();
					}
				};
				return;
			}

			console.log('[ProofGenerator] Using three-tree proof flow');

			// 2a. Build action domain (deterministic from template + session context)
			const { buildActionDomain } = await import('$lib/core/zkp/action-domain-builder');
			const actionDomain = buildActionDomain({
				country: 'US',
				jurisdictionType: 'federal',
				recipientSubdivision,
				templateId,
				sessionId
			});
			actionDomainHex = actionDomain;
			console.log('[ProofGenerator] Action domain:', actionDomain.slice(0, 16) + '...');

			// 2b. Compute nullifier = H2(identityCommitment, actionDomain) (NUL-001)
			const { computeNullifier } = await import('$lib/core/crypto/poseidon');
			nullifierHex = await computeNullifier(credential.identityCommitment, actionDomain);
			console.log('[ProofGenerator] Nullifier:', nullifierHex.slice(0, 16) + '...');

			// 2c. Map credential to circuit inputs
			const { mapCredentialToProofInputs } = await import(
				'$lib/core/identity/proof-input-mapper'
			);
			const proofInputs = mapCredentialToProofInputs(credential, {
				actionDomain,
				nullifier: nullifierHex
			});

			// 2d. Initialize three-tree prover
			proofState = { status: 'initializing-prover', progress: 0 };
			const { generateThreeTreeProof } = await import('$lib/core/zkp/prover-client');
			proofState = { status: 'initializing-prover', progress: 50 };

			// 2e. Generate three-tree proof
			proofState = { status: 'generating-proof', progress: 0 };
			const threeTreeResult = await generateThreeTreeProof(proofInputs, (progress) => {
				if (progress.stage === 'loading' || progress.stage === 'initializing') {
					proofState = { status: 'initializing-prover', progress: progress.percent };
				} else if (progress.stage === 'generating') {
					proofState = { status: 'generating-proof', progress: progress.percent };
				} else if (progress.stage === 'complete') {
					proofState = { status: 'generating-proof', progress: 100 };
				}
			});

			proofHex = threeTreeResult.proof;
			// BR5-010: Save expected nullifier BEFORE overwriting with prover output
			const expectedNullifier = nullifierHex;
			nullifierHex = threeTreeResult.publicInputs.nullifier;
			publicInputsPayload = {
				userRoot: threeTreeResult.publicInputs.userRoot,
				cellMapRoot: threeTreeResult.publicInputs.cellMapRoot,
				districts: threeTreeResult.publicInputs.districts,
				nullifier: threeTreeResult.publicInputs.nullifier,
				actionDomain: threeTreeResult.publicInputs.actionDomain,
				authorityLevel: threeTreeResult.publicInputs.authorityLevel,
				engagementRoot: threeTreeResult.publicInputs.engagementRoot,
				engagementTier: threeTreeResult.publicInputs.engagementTier,
				publicInputsArray: threeTreeResult.publicInputsArray
			};

			// BR5-010: Cross-validate public inputs against expected values
			if (threeTreeResult.publicInputs.actionDomain !== actionDomain) {
				throw new Error(
					'BR5-010: Proof actionDomain mismatch. Possible proof substitution.'
				);
			}
			if (threeTreeResult.publicInputs.nullifier !== expectedNullifier) {
				throw new Error(
					'BR5-010: Proof nullifier mismatch. Possible proof substitution.'
				);
			}
			if (threeTreeResult.publicInputs.userRoot !== credential.merkleRoot) {
				throw new Error(
					'BR5-010: Proof userRoot does not match credential. Stale or substituted.'
				);
			}
			if (threeTreeResult.publicInputs.cellMapRoot !== credential.cellMapRoot) {
				throw new Error(
					'BR5-010: Proof cellMapRoot does not match credential. Possible district spoofing.'
				);
			}

			console.log('[ProofGenerator] Three-tree proof generated:', {
				proofSize: proofHex.length,
				publicInputCount: threeTreeResult.publicInputsArray.length
			});

			// Step 3: Encrypt witness for TEE processing
			// Three-tree: full WitnessData for TEE proof verification + CWC delivery
			const witnessForEncryption: WitnessData = {
				userRoot: credential.merkleRoot,
				cellMapRoot: credential.cellMapRoot!,
				districts: credential.districts!,
				nullifier: nullifierHex,
				actionDomain: actionDomainHex,
				authorityLevel: credential.authorityLevel ?? 3,
				engagementRoot: credential.engagementRoot!,
				engagementTier: credential.engagementTier ?? 0,
				userSecret: credential.userSecret!,
				cellId: credential.cellId!,
				registrationSalt: credential.registrationSalt!,
				identityCommitment: credential.identityCommitment,
				userPath: credential.merklePath,
				userIndex: credential.leafIndex,
				cellMapPath: credential.cellMapPath!,
				cellMapPathBits: credential.cellMapPathBits!,
				engagementPath: credential.engagementPath!,
				engagementIndex: credential.engagementIndex ?? 0,
				actionCount: credential.actionCount ?? '0',
				diversityScore: credential.diversityScore ?? '0',
				deliveryAddress
			};

			proofState = { status: 'encrypting-witness' };
			const { encryptWitness } = await import('$lib/core/proof/witness-encryption');
			const encryptedWitness = await encryptWitness(witnessForEncryption as WitnessData);

			// Step 4: Submit to backend
			proofState = { status: 'submitting' };

			const response = await fetch('/api/submissions/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					templateId,
					proof: proofHex,
					publicInputs: publicInputsPayload,
					nullifier: nullifierHex,
					encryptedWitness: encryptedWitness.ciphertext,
					witnessNonce: encryptedWitness.nonce,
					ephemeralPublicKey: encryptedWitness.ephemeralPublicKey,
					teeKeyId: encryptedWitness.teeKeyId
				})
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const serverMessage = errorData.message || errorData.error;
				proofState = {
					status: 'error',
					message: serverMessage || 'Submission failed. Please try again.',
					recoverable: true,
					retryAction: () => generateAndSubmit()
				};
				return;
			}

			const data = await response.json();

			// Success!
			proofState = { status: 'complete', submissionId: data.submissionId };
			oncomplete?.({ submissionId: data.submissionId });
		} catch (error) {
			console.error('[ProofGenerator] Generation failed:', error);
			const errorMessage = error instanceof Error
				? error.message
				: 'An unexpected error occurred. Please try again.';

			const isInfrastructureError = /TEE|encryption|503|service unavailable/i.test(errorMessage);

			if (isInfrastructureError) {
				proofState = {
					status: 'error',
					message: 'Secure delivery service is temporarily unavailable. Please try again in a few minutes.',
					recoverable: false
				};
			} else {
				proofState = {
					status: 'error',
					message: errorMessage,
					recoverable: true,
					retryAction: () => generateAndSubmit()
				};
			}
			onerror?.({ message: errorMessage });
		}
	}

	function handleRetry() {
		if (proofState.status === 'error' && proofState.retryAction) {
			proofState.retryAction();
		}
	}

	function handleCancel() {
		oncancel?.();
	}

</script>

<div class="proof-generator">
	{#if proofState.status === 'idle'}
		<!-- Initial state - show preview and submit button -->
		<div class="space-y-6">
			<div class="rounded-lg border border-slate-200 bg-white p-6">
				<h3 class="mb-4 text-lg font-semibold text-slate-900">Ready to send</h3>

				<div class="space-y-3">
					<div>
						<p class="text-sm font-medium text-slate-700">Subject:</p>
						<p class="text-sm text-slate-600">{templateData.subject}</p>
					</div>

					<div>
						<p class="text-sm font-medium text-slate-700">Recipients:</p>
						<p class="text-sm text-slate-600">
							{templateData.recipientOffices.length} congressional
							{templateData.recipientOffices.length === 1 ? 'office' : 'offices'}
						</p>
					</div>

					<div class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
						<p class="mb-2 font-medium">Privacy Protection:</p>
						<ul class="space-y-1 text-sm">
							<li class="flex items-start gap-2">
								<span class="text-blue-600">✓</span>
								<span>Your message will be delivered anonymously</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-blue-600">✓</span>
								<span>Congressional staff will only see "Verified constituent"</span>
							</li>
							<li class="flex items-start gap-2">
								<span class="text-blue-600">✓</span>
								<span>Your reputation will be updated on-chain</span>
							</li>
						</ul>
					</div>
				</div>
			</div>

			<div class="flex gap-3">
				<button
					type="button"
					onclick={handleCancel}
					class="flex-1 rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-50"
				>
					Cancel
				</button>
				<button
					type="button"
					onclick={generateAndSubmit}
					class="flex-1 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-md"
				>
					Send to Representative
				</button>
			</div>
		</div>
	{:else if proofState.status === 'loading-credential'}
		<!-- Loading session credential -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<Loader2 class="mb-4 h-12 w-12 animate-spin text-blue-600" />
			<h3 class="mb-2 text-lg font-semibold text-slate-900">Loading credentials...</h3>
			<p class="text-sm text-slate-600">Retrieving your verification status</p>
		</div>
	{:else if proofState.status === 'initializing-prover'}
		<!-- Initializing WASM prover -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<ShieldCheck class="mb-4 h-12 w-12 animate-pulse text-blue-600" />
			<h3 class="mb-2 text-lg font-semibold text-slate-900">Initializing secure delivery...</h3>
			<p class="mb-4 text-sm text-slate-600">Loading privacy protection system</p>

			<!-- Progress bar -->
			<div class="w-full max-w-md">
				<div class="h-2 w-full rounded-full bg-slate-200">
					<div
						class="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
						style="width: {proofState.progress}%"
					></div>
				</div>
				<p class="mt-2 text-xs text-slate-500">{Math.round(proofState.progress)}%</p>
			</div>
		</div>
	{:else if proofState.status === 'generating-proof'}
		<!-- Generating ZK proof (main wait time) -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<ShieldCheck class="mb-4 h-12 w-12 animate-pulse text-blue-600" />
			<h3 class="mb-2 text-lg font-semibold text-slate-900">Preparing secure delivery...</h3>
			<p class="mb-6 text-sm text-slate-600">
				Proving you're a constituent without revealing your identity
			</p>

			<!-- Progress bar -->
			<div class="mb-6 w-full max-w-md">
				<div class="h-2 w-full rounded-full bg-slate-200">
					<div
						class="h-full rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
						style="width: {proofState.progress}%"
					></div>
				</div>
				<p class="mt-2 text-xs text-slate-500">{Math.round(proofState.progress)}%</p>
			</div>

			<!-- Educational messaging (cycles every 3s) -->
			<div class="w-full max-w-md">
				<div
					class="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900 transition-opacity duration-500"
				>
					<div class="flex items-start gap-2">
						<span class="text-green-600">{educationalMessages[educationIndex].icon}</span>
						<span>{educationalMessages[educationIndex].text}</span>
					</div>
				</div>
			</div>
		</div>
	{:else if proofState.status === 'encrypting-witness'}
		<!-- Encrypting witness -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<ShieldCheck class="mb-4 h-12 w-12 animate-pulse text-blue-600" />
			<h3 class="mb-2 text-lg font-semibold text-slate-900">Encrypting delivery...</h3>
			<p class="mb-6 text-sm text-slate-600">Securing your message with XChaCha20-Poly1305 encryption</p>
		</div>
	{:else if proofState.status === 'submitting'}
		<!-- Submitting to backend -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<Loader2 class="mb-4 h-12 w-12 animate-spin text-blue-600" />
			<h3 class="mb-2 text-lg font-semibold text-slate-900">Submitting...</h3>
			<p class="text-sm text-slate-600">Sending to congressional offices</p>
		</div>
	{:else if proofState.status === 'complete'}
		<!-- Success state (parent transitions away on auto-dispatch; user rarely sees this) -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<div
				class="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-green-400 to-emerald-600 shadow-md"
			>
				<Check class="h-10 w-10 text-white" strokeWidth={3} />
			</div>

			<h3 class="mb-2 text-2xl font-bold text-slate-900">Message Delivered!</h3>
			<p class="mb-6 text-sm text-slate-600">
				Your message was delivered anonymously to congressional offices
			</p>

			<div class="w-full max-w-md">
				<div class="rounded-lg border border-green-200 bg-green-50 p-4">
					<p class="mb-2 text-sm font-medium text-green-900">What happened:</p>
					<ul class="space-y-1 text-left text-sm text-green-800">
						<li class="flex items-start gap-2">
							<span class="text-green-600">✓</span>
							<span
								>Delivered to {templateData.recipientOffices.length} congressional office(s)</span
							>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-green-600">✓</span>
							<span>Your identity was protected with zero-knowledge cryptography</span>
						</li>
						<li class="flex items-start gap-2">
							<span class="text-green-600">✓</span>
							<span>Your civic reputation was updated on-chain</span>
						</li>
					</ul>
				</div>
			</div>

			<!-- oncomplete already dispatched automatically on success (line above).
				 Button retained as visual anchor if parent hasn't transitioned yet. -->
			<button
				type="button"
				onclick={() => { /* Parent already notified via auto-dispatch */ }}
				class="mt-6 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-3 text-base font-semibold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-md"
			>
				Done
			</button>
		</div>
	{:else if proofState.status === 'error'}
		<!-- Error state with recovery -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<AlertCircle class="mb-4 h-12 w-12 text-red-600" />
			<h3 class="mb-2 text-xl font-bold text-slate-900">Something went wrong</h3>
			<p class="mb-6 text-sm text-slate-600">{proofState.message}</p>

			<div class="flex gap-3">
				<button
					type="button"
					onclick={handleCancel}
					class="rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-50"
				>
					Cancel
				</button>
				{#if proofState.recoverable && proofState.retryAction}
					<button
						type="button"
						onclick={handleRetry}
						class="rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 hover:shadow-md"
					>
						{proofState.retryLabel ?? 'Try Again'}
					</button>
				{/if}
			</div>

			<div class="mt-6 w-full max-w-md">
				<div class="rounded-lg border border-blue-200 bg-blue-50 p-4 text-left">
					<p class="mb-2 text-sm font-medium text-blue-900">Need help?</p>
					<ul class="space-y-1 text-sm text-blue-800">
						<li>• Check your internet connection</li>
						<li>• Try refreshing the page</li>
						<li>
							• Contact support at <a href="mailto:support@commons.email" class="underline"
								>support@commons.email</a
							>
						</li>
					</ul>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.proof-generator {
		width: 100%;
		max-width: 42rem;
		margin: 0 auto;
	}
</style>
