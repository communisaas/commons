<script lang="ts">
	import { CheckCircle2, Loader2 } from '@lucide/svelte';
	import RegroundingAddressCapture from './address-steps/RegroundingAddressCapture.svelte';
	import {
		getFullCellDataFromBrowser,
		type ClientCellProofResult
	} from '$lib/core/shadow-atlas/browser-client';
	import { poseidon2Sponge24 } from '$lib/core/crypto/poseidon';
	import { persistGroundVaultForAddress } from '$lib/core/identity/ground-vault-persistence';
	import {
		getConstituentAddress,
		storeConstituentAddress
	} from '$lib/core/identity/constituent-address';

	type RestoreStep = 'address-input' | 'resolving' | 'complete';

	interface ActiveGroundCredential {
		districtCredentialId: string;
		district: string | null;
		districtCommitment: string | null;
		slotCount: number | null;
		source: string | null;
		issuedAt: number | null;
		expiresAt: number | null;
	}

	let {
		userId,
		onComplete,
		onCancel
	}: {
		userId: string;
		onComplete?: () => void;
		onCancel?: () => void;
	} = $props();

	let street = $state('');
	let city = $state('');
	let stateCode = $state('');
	let zipCode = $state('');
	let errorMessage = $state('');
	let step = $state<RestoreStep>('address-input');
	let restoredDistrict = $state<string | null>(null);

	const detectedCountry: 'US' | 'CA' = $derived(
		/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(zipCode.trim()) ? 'CA' : 'US'
	);
	const isFormValid = $derived(
		street.trim().length > 0 &&
			city.trim().length > 0 &&
			stateCode.trim().length === 2 &&
			(/^\d{5}(-\d{4})?$/.test(zipCode.trim()) ||
				/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(zipCode.trim()))
	);

	async function loadRestoreCredential(): Promise<ActiveGroundCredential> {
		const response = await fetch('/api/ground/restore-state');
		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(body?.error || body?.message || 'Could not load your active ground proof.');
		}
		const credential = body?.credential as ActiveGroundCredential | null | undefined;
		if (!credential?.districtCredentialId) {
			throw new Error('No active district proof was found. Verify your address again to continue.');
		}
		return credential;
	}

	async function resolveCellProof(
		lat: number,
		lng: number
	): Promise<{ proof: ClientCellProofResult | null; commitment: string | null; slotCount: number | null }> {
		const proof = await getFullCellDataFromBrowser({ lat, lng, country: detectedCountry });
		if (!proof?.districts || proof.districts.length !== 24) {
			return { proof: null, commitment: null, slotCount: null };
		}
		const commitment = await poseidon2Sponge24(proof.districts);
		const empty = '0x' + '0'.repeat(64);
		const slotCount = proof.districts.filter((slot) => slot !== empty).length;
		return { proof, commitment, slotCount };
	}

	function normalizeCommitment(value: string | null | undefined): string | null {
		if (!value) return null;
		try {
			return BigInt(value).toString(16);
		} catch {
			return value.toLowerCase().replace(/^0x/, '');
		}
	}

	function assertAddressMatchesCredential(input: {
		credential: ActiveGroundCredential;
		addressDistrict: string | null;
		commitment: string | null;
		slotCount: number | null;
	}) {
		const expectedCommitment = normalizeCommitment(input.credential.districtCommitment);
		const actualCommitment = normalizeCommitment(input.commitment);
		if (expectedCommitment) {
			if (!actualCommitment || expectedCommitment !== actualCommitment) {
				throw new Error(
					'That address does not match your active district proof. Use re-grounding when you are changing address.'
				);
			}
			if (
				typeof input.credential.slotCount === 'number' &&
				typeof input.slotCount === 'number' &&
				input.credential.slotCount !== input.slotCount
			) {
				throw new Error(
					'That address resolved to different district data than your active proof. Use re-grounding when you are changing address.'
				);
			}
			return;
		}

		const expectedDistrict = input.credential.district?.trim().toUpperCase();
		const actualDistrict = input.addressDistrict?.trim().toUpperCase();
		if (expectedDistrict && actualDistrict && expectedDistrict !== actualDistrict) {
			throw new Error(
				'That address resolves to a different district than your active proof. Use re-grounding when you are changing address.'
			);
		}
	}

	async function handleSubmit() {
		if (!isFormValid) return;
		step = 'resolving';
		errorMessage = '';

		try {
			const [credential, response] = await Promise.all([
				loadRestoreCredential(),
				fetch('/api/location/resolve-address', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						street: street.trim(),
						city: city.trim(),
						state: stateCode.trim().toUpperCase(),
						zip: zipCode.trim(),
						...(detectedCountry === 'CA' ? { country: 'CA' } : {})
					})
				})
			]);
			const data = await response.json();
			if (!response.ok || !data.resolved) {
				throw new Error(data.error || 'Could not verify that address. Check it and try again.');
			}

			if (data.address?.street) street = data.address.street;
			if (data.address?.city) city = data.address.city;
			if (data.address?.state) stateCode = data.address.state;
			if (data.address?.zip) zipCode = data.address.zip;

			const coordinates =
				typeof data.coordinates?.lat === 'number' && typeof data.coordinates?.lng === 'number'
					? { lat: data.coordinates.lat, lng: data.coordinates.lng }
					: null;
			if (!coordinates) {
				throw new Error('That address resolved without coordinates. Check it and try again.');
			}

			const { proof, commitment, slotCount } = await resolveCellProof(
				coordinates.lat,
				coordinates.lng
			);
			const addressDistrict = typeof data.district?.code === 'string' ? data.district.code : null;
			assertAddressMatchesCredential({
				credential,
				addressDistrict,
				commitment,
				slotCount
			});

			const address = {
				street: street.trim(),
				city: city.trim(),
				state: stateCode.trim().toUpperCase(),
				zip: zipCode.trim(),
				...(addressDistrict ? { district: addressDistrict } : {})
			};
			await persistGroundVaultForAddress({
				userId,
				address,
				ground: {
					districtCredentialId: credential.districtCredentialId,
					district: addressDistrict ?? credential.district,
					districtCommitment: commitment ?? credential.districtCommitment,
					slotCount: slotCount ?? credential.slotCount,
					cellId: data.cell_id,
					source: credential.source ?? 'reentry',
					issuedAt: credential.issuedAt,
					expiresAt: credential.expiresAt
				},
				verificationMethod: 'reentry',
				coordinates,
				cellProof: proof,
				migrationSource: 'profile-reentry'
			});
			await storeConstituentAddress(userId, address);
			const readable = await getConstituentAddress(userId);
			if (!readable) {
				throw new Error(
					'The encrypted address could not be read back from this device. Check browser storage settings and try again.'
				);
			}
			restoredDistrict = addressDistrict ?? credential.district;
			step = 'complete';
		} catch (error) {
			console.warn('[AddressRestoreFlow] restore failed:', error);
			errorMessage =
				error instanceof Error
					? error.message
					: 'Could not restore the saved address. Please try again.';
			step = 'address-input';
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && isFormValid && step === 'address-input') {
			handleSubmit();
		}
	}
</script>

{#if step === 'resolving'}
	<section class="px-4 py-10 text-center" aria-live="polite">
		<Loader2 class="mx-auto h-6 w-6 animate-spin text-emerald-600" />
		<p class="mt-3 text-sm font-medium text-slate-700">Restoring saved address...</p>
	</section>
{:else if step === 'complete'}
	<section class="px-4 py-8 text-center" aria-live="polite">
		<CheckCircle2 class="mx-auto h-7 w-7 text-emerald-600" />
		<h2
			class="mt-3 text-xl leading-tight font-semibold text-slate-900"
			style="font-family: 'Satoshi', system-ui, sans-serif"
		>
			Address restored.
		</h2>
		<p class="mt-2 text-sm text-slate-500">
			{#if restoredDistrict}
				This device can use your saved address again for {restoredDistrict}.
			{:else}
				This device can use your saved address again.
			{/if}
		</p>
		<div class="mt-6 border-t border-dotted border-slate-300 pt-4 text-right">
			<button
				type="button"
				class="font-mono text-sm text-slate-700 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-slate-900 hover:decoration-slate-700"
				onclick={() => onComplete?.()}
			>
				Done &rarr;
			</button>
		</div>
	</section>
{:else}
	<RegroundingAddressCapture
		bind:streetAddress={street}
		bind:city
		bind:stateCode
		bind:zipCode
		{detectedCountry}
		eyebrow="Restore ground"
		title="Re-enter your address."
		description="We resolve it and compare it to your active district proof, then save a fresh encrypted address record on this device."
		footer="This repairs local readable ground. It does not issue a new district credential unless you use re-grounding for a changed address."
		{errorMessage}
		onSubmit={handleSubmit}
		onCancel={onCancel}
		onKeydown={handleKeydown}
	/>
{/if}
