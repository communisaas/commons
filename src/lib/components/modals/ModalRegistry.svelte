<script lang="ts">
	/**
	 * ModalRegistry - Central registry for all application modals
	 *
	 * All modals are declared here once and controlled via modalActions API.
	 * Routes call modalActions.openModal(id, type, data) to trigger modals.
	 */
	import UnifiedModal from '$lib/components/ui/UnifiedModal.svelte';
	import { OnboardingContent, SignInContent } from '$lib/components/auth/parts';
	import TemplateModal from '$lib/components/template/TemplateModal.svelte';
	import { ProgressiveFormContent } from '$lib/components/template/parts';
	import AddressCollectionForm from '$lib/components/onboarding/AddressCollectionForm.svelte';
	import DebateModal from '$lib/components/debate/DebateModal.svelte';
	import WalletConnect from '$lib/components/wallet/WalletConnect.svelte';
	import GovernmentCredentialVerification from '$lib/components/auth/GovernmentCredentialVerification.svelte';
	import { modalActions } from '$lib/stores/modalSystem.svelte';
	import type { ComponentTemplate } from '$lib/types/component-props';
	import type { DebateData } from '$lib/stores/debateState.svelte';
	import { FEATURES, isAnyMdlProtocolEnabled } from '$lib/config/features';

	/** Type-safe accessors for modal data fields */
	type ModalData = Record<string, unknown>;

	function getTemplate(data: ModalData): ComponentTemplate | undefined {
		return data?.template as ComponentTemplate | undefined;
	}

	function getUser(data: ModalData): { id: string; name: string; trust_tier?: number } | null {
		return (data?.user as { id: string; name: string; trust_tier?: number }) ?? null;
	}

	function getSource(data: ModalData): 'social-link' | 'direct-link' | 'share' {
		return (data?.source as 'social-link' | 'direct-link' | 'share') || 'direct-link';
	}

	function getCallback<T extends (...args: unknown[]) => void>(
		data: ModalData,
		key: string
	): T | undefined {
		return data?.[key] as T | undefined;
	}
</script>

<!-- Onboarding Modal -->
<UnifiedModal
	id="onboarding-modal"
	type="onboarding"
	size="md"
	showCloseButton={true}
	closeOnBackdrop={true}
	closeOnEscape={true}
>
	{#snippet children(data)}
		{#if data?.template}
			<OnboardingContent
				template={getTemplate(data)!}
				source={getSource(data)}
				onauth={(provider) => (window.location.href = `/auth/${provider}`)}
				onclose={() => modalActions.closeModal('onboarding-modal')}
			/>
		{/if}
	{/snippet}
</UnifiedModal>

<!-- Sign In Modal (Generic) -->
<UnifiedModal
	id="sign-in-modal"
	type="sign-in"
	size="md"
	showCloseButton={true}
	closeOnBackdrop={true}
	closeOnEscape={true}
>
	{#snippet children(data)}
		<SignInContent
			onauth={(provider: string) => (window.location.href = `/auth/${provider}`)}
			onclose={() => modalActions.closeModal('sign-in-modal')}
		/>
	{/snippet}
</UnifiedModal>

{#if FEATURES.ADDRESS_SPECIFICITY === 'district'}
	<!-- Address Modal (for Congressional templates) -->
	<UnifiedModal
		id="address-modal"
		type="address"
		size="sm"
		closeOnBackdrop={true}
		closeOnEscape={true}
	>
		{#snippet children(data)}
			<div class="overflow-hidden rounded-md bg-white">
				<AddressCollectionForm
					_template={getTemplate(data) || { title: '', deliveryMethod: '' }}
					oncomplete={async (detail) => {
						const onComplete = getCallback<(d: unknown) => void>(data, 'onComplete');
						await onComplete?.(detail);
						modalActions.closeModal('address-modal');
					}}
				/>
			</div>
		{/snippet}
	</UnifiedModal>
{/if}

<!-- Template Modal -->
<UnifiedModal
	id="template-modal"
	type="template_modal"
	size="lg"
	showCloseButton={false}
	closeOnBackdrop={false}
	closeOnEscape={true}
>
	{#snippet children(data)}
		{#if data?.template}
			<TemplateModal
				template={getTemplate(data)!}
				user={getUser(data)}
				initialState={data?.initialState}
				onclose={() => modalActions.closeModal('template-modal')}
				onused={() => {
					// Template used - keep modal open for post-send flow
				}}
			/>
		{/if}
	{/snippet}
</UnifiedModal>

<!-- Progressive Form Modal (for email templates with auth) -->
<UnifiedModal
	id="progressive-form-modal"
	type="template_modal"
	size="md"
	showCloseButton={true}
	closeOnBackdrop={true}
	closeOnEscape={true}
>
	{#snippet children(data)}
		{#if data?.template}
			<ProgressiveFormContent
				template={getTemplate(data)!}
				user={getUser(data)}
				_onclose={() => modalActions.closeModal('progressive-form-modal')}
				onsend={(sendData) => {
					const onSend = getCallback<(d: unknown) => void>(data, 'onSend');
					onSend?.(sendData);
					modalActions.closeModal('progressive-form-modal');
				}}
			/>
		{/if}
	{/snippet}
</UnifiedModal>

{#if FEATURES.DEBATE}
	<!-- Debate Modal (staked deliberation) -->
	<UnifiedModal
		id="debate-modal"
		type="debate"
		size="lg"
		showCloseButton={false}
		closeOnBackdrop={false}
		closeOnEscape={true}
	>
		{#snippet children(data)}
			{#if data?.template}
				<DebateModal
					template={data.template as {
						id: string;
						title: string;
						slug: string;
						message_body?: string;
					}}
					user={data.user as { id: string; trust_tier?: number } | null}
					debate={(data.debate as DebateData) ?? null}
					mode={(data.mode as 'initiate' | 'participate' | 'cosign') ?? 'participate'}
					cosignArgumentIndex={data.cosignArgumentIndex as number | undefined}
				/>
			{/if}
		{/snippet}
	</UnifiedModal>
{/if}

{#if FEATURES.WALLET}
	<!-- Wallet Connect Modal -->
	<UnifiedModal
		id="wallet-connect-modal"
		type="wallet-connect"
		size="sm"
		showCloseButton={true}
		closeOnBackdrop={true}
		closeOnEscape={true}
	>
		{#snippet children(_data)}
			<WalletConnect
				onconnected={() => {
					modalActions.closeModal('wallet-connect-modal');
				}}
			/>
		{/snippet}
	</UnifiedModal>
{/if}

<!-- Identity Verification Modal (mDL) -->
<UnifiedModal
	id="identity-verification-modal"
	type="identity-verification"
	size="sm"
	showCloseButton={true}
	closeOnBackdrop={false}
	closeOnEscape={true}
>
	{#snippet children(data)}
		{#if data?.userId}
			{#if !isAnyMdlProtocolEnabled()}
				<!--
					F-1.3 launch gate. Government-ID verification (mDL / passport)
					surfaces a calm placeholder when no protocol lane is available.
				-->
				<section class="px-8 py-10" data-testid="modal-mdl-gated">
					<p class="font-mono text-[10px] text-slate-500 uppercase" style="letter-spacing: 0.22em">
						Government-ID verification
					</p>
					<h2
						class="mt-2 text-2xl leading-tight font-semibold text-slate-900"
						style="font-family: 'Satoshi', system-ui, sans-serif"
					>
						Coming soon.
					</h2>

					<div class="mt-5 border-t border-b border-dotted border-slate-300 py-5">
						<p class="text-[14px] leading-relaxed text-slate-700">
							Android OpenID4VP is the first supported lane for mDL verification. iOS Safari support
							follows after Apple Business Connect and the final ISO 18013-5 §9.1.3
							device-authentication step.
						</p>
						<p class="mt-3 text-[14px] leading-relaxed text-slate-700">
							Address-attested verification (Tier&nbsp;2) is the highest tier available for now and
							is sufficient for messaging your representatives.
						</p>
					</div>

					<div
						class="mt-6 flex items-center justify-end border-t border-dotted border-slate-300 pt-4"
					>
						<button
							type="button"
							class="font-mono text-sm text-slate-700 underline decoration-slate-400 decoration-1 underline-offset-4 transition-colors hover:text-slate-900 hover:decoration-slate-700"
							onclick={() => modalActions.closeModal('identity-verification-modal')}
						>
							Close &rarr;
						</button>
					</div>
				</section>
			{:else}
				<GovernmentCredentialVerification
					userId={data.userId as string}
					userEmail={data.userEmail as string | undefined}
					templateSlug={data.templateSlug as string | undefined}
					oncomplete={async () => {
						const onComplete = getCallback<() => void>(data, 'onComplete');
						await onComplete?.();
						modalActions.closeModal('identity-verification-modal');
					}}
					onerror={(err) => {
						const onError = data?.onError as ((e: { message: string }) => void) | undefined;
						onError?.(err);
					}}
					oncancel={() => modalActions.closeModal('identity-verification-modal')}
				/>
			{/if}
		{/if}
	{/snippet}
</UnifiedModal>
