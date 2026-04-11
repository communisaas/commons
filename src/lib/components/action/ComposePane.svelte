<script lang="ts">
  import { spring } from 'svelte/motion';
  import { onMount, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { ArrowLeft } from '@lucide/svelte';
  import AccountabilityOpener from './AccountabilityOpener.svelte';
  import PersonalSpace from './PersonalSpace.svelte';
  import TemplateBodyPreview from './TemplateBodyPreview.svelte';
  import AttestationFooter from './AttestationFooter.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { generatePersonalizedMailto } from '$lib/services/emailService';
  import type { LandscapeMember } from '$lib/utils/landscapeMerge';
  import type { Template } from '$lib/types/template';

  let {
    recipient,
    template,
    districtName = '',
    trustTier = 0,
    personalPrompt = null,
    onSent,
    onBack
  }: {
    recipient: LandscapeMember;
    template: Template;
    districtName: string;
    trustTier?: number;
    personalPrompt?: string | null;
    onSent: () => void;
    onBack: () => void;
  } = $props();

  // Compose state
  let openerText = $state(recipient.accountabilityOpener ?? '');
  let personalText = $state('');
  // Strip [Personal Connection] — handled by PersonalSpace (Zone 2)
  let bodyText = $state(
    template.message_body
      .replace(/\s*\[Personal Connection\]\s*/g, ' ')
      .replace(/  +/g, ' ')
      .trim()
  );
  let sendError = $state<string | null>(null);

  // Mobile slide-up animation
  let slideY = spring(100, { stiffness: 0.35, damping: 0.4 });
  let isMobile = $state(false);
  let overlayEl = $state<HTMLDivElement | undefined>(undefined);

  // Focus trap: keep Tab focus within mobile overlay, Escape to dismiss
  function handleOverlayKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleDismiss();
      return;
    }

    if (e.key !== 'Tab' || !overlayEl) return;

    const focusable = overlayEl.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    isMobile = browser && window.innerWidth < 768;
    if (isMobile) {
      // Trigger slide-up entrance
      requestAnimationFrame(() => slideY.set(0));
      // Focus first interactive element after overlay renders
      tick().then(() => {
        if (overlayEl) {
          const firstFocusable = overlayEl.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [contenteditable="true"]'
          );
          firstFocusable?.focus();
        }
      });
    }
  });

  // Attestation text (only for Tier 2+)
  const attestationText = $derived(
    trustTier >= 2
      ? `Verified resident, ${districtName}\nCryptographic proof of residency`
      : undefined
  );

  // Subject line
  const subject = $derived(template.subject || template.title);

  function handleSend() {
    if (!recipient.email) {
      sendError = 'No email address available for this recipient.';
      return;
    }

    const result = generatePersonalizedMailto({
      recipient: {
        name: recipient.name,
        email: recipient.email,
        title: recipient.title,
        organization: recipient.organization
      },
      subject,
      opener: openerText,
      personalInput: personalText || undefined,
      templateBody: bodyText,
      attestation: attestationText
    });

    if ('error' in result) {
      sendError = result.error.message;
      return;
    }

    // Launch email client
    window.location.href = result.url;

    // Brief delay, then mark as sent
    setTimeout(() => {
      onSent();
    }, 500);
  }

  function handleDismiss() {
    if (isMobile) {
      slideY.set(100);
      setTimeout(onBack, 300);
    } else {
      onBack();
    }
  }
</script>

{#if isMobile}
  <!-- Mobile: slide-up bottom sheet -->
  <div
    class="fixed inset-0 z-[1010]"
    bind:this={overlayEl}
    role="dialog"
    aria-modal="true"
    aria-label="Compose message to {recipient.name}"
    tabindex="-1"
    onkeydown={handleOverlayKeydown}
  >
    <!-- Backdrop -->
    <button
      type="button"
      class="absolute inset-0 bg-black/40"
      onclick={handleDismiss}
      aria-label="Close compose pane"
    ></button>

    <!-- Bottom sheet -->
    <div
      class="absolute bottom-0 left-0 right-0 rounded-t-2xl bg-white"
      style="transform: translateY({$slideY}%); max-height: 90vh;"
    >
      <!-- Drag handle -->
      <div class="flex justify-center py-3">
        <div class="h-1 w-10 rounded-full bg-slate-300"></div>
      </div>

      <!-- Scrollable content -->
      <div class="overflow-y-auto px-5 pb-6" style="max-height: calc(90vh - 48px);">
        <!-- Recipient header -->
        <h2 class="mb-4 text-lg font-semibold text-slate-900">
          Message to {recipient.name}
        </h2>

        <!-- Zone 1: Accountability Opener -->
        <AccountabilityOpener
          name={recipient.name}
          title={recipient.title}
          opener={recipient.accountabilityOpener ?? null}
          onchange={(text) => { openerText = text; }}
        />

        <!-- Zone 2: Personal Space -->
        <PersonalSpace
          {personalPrompt}
          onchange={(text) => { personalText = text; }}
        />

        <!-- Zone 3: Template Body Preview -->
        <TemplateBodyPreview
          body={template.message_body}
          {districtName}
          onchange={(text) => { bodyText = text; }}
        />

        <!-- Zone 4: Attestation Footer (Tier 2+) -->
        {#if trustTier >= 2}
          <div class="mt-3">
            <AttestationFooter {trustTier} {districtName} />
          </div>
        {/if}

        <!-- Error display -->
        {#if sendError}
          <div class="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {sendError}
          </div>
        {/if}

        <!-- Send button -->
        <div class="mt-4">
          <Button
            variant="verified"
            classNames="w-full min-h-[44px] bg-channel-verified-600 hover:bg-channel-verified-700 border-channel-verified-700"
            onclick={handleSend}
            disabled={!recipient.email}
          >
            Send via email &rarr;
          </Button>
        </div>
      </div>
    </div>
  </div>
{:else}
  <!-- Desktop: inline panel -->
  <div class="rounded-md border border-slate-200 bg-white shadow-sm">
    <!-- Back link -->
    <div class="border-b border-slate-100 px-6 py-4">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        onclick={handleDismiss}
      >
        <ArrowLeft class="h-4 w-4" />
        Back to all decision-makers
      </button>
    </div>

    <!-- Compose content -->
    <div class="px-6 py-5">
      <!-- Recipient header -->
      <h2 class="mb-5 text-lg font-semibold text-slate-900">
        Message to {recipient.name}
      </h2>

      <!-- Zone 1: Accountability Opener -->
      <AccountabilityOpener
        name={recipient.name}
        title={recipient.title}
        opener={recipient.accountabilityOpener ?? null}
        onchange={(text) => { openerText = text; }}
      />

      <!-- Zone 2: Personal Space -->
      <PersonalSpace
        {personalPrompt}
        onchange={(text) => { personalText = text; }}
      />

      <!-- Zone 3: Template Body Preview -->
      <TemplateBodyPreview
        body={template.message_body}
        {districtName}
        onchange={(text) => { bodyText = text; }}
      />

      <!-- Zone 4: Attestation Footer (Tier 2+) -->
      {#if trustTier >= 2}
        <div class="mt-3">
          <AttestationFooter {trustTier} {districtName} />
        </div>
      {/if}

      <!-- Error display -->
      {#if sendError}
        <div class="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {sendError}
        </div>
      {/if}

      <!-- Send button -->
      <div class="mt-5">
        <Button
          variant="verified"
          classNames="w-full min-h-[44px] bg-channel-verified-600 hover:bg-channel-verified-700 border-channel-verified-700"
          onclick={handleSend}
          disabled={!recipient.email}
        >
          Send via email &rarr;
        </Button>
      </div>
    </div>
  </div>
{/if}
