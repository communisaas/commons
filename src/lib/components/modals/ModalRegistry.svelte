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
	import { FEATURES } from '$lib/config/features';

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

	function getCallback<T extends (...args: unknown[]) => void>(data: ModalData, key: string): T | undefined {
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
		<SignInContent onauth={(provider: string) => (window.location.href = `/auth/${provider}`)} onclose={() => modalActions.closeModal('sign-in-modal')} />
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
				template={data.template as { id: string; title: string; slug: string; message_body?: string }}
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
	{/snippet}
</UnifiedModal>
