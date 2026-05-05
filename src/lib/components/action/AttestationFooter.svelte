<script lang="ts">
  // H6 — render through the tier-display helper so this surface, the email
  // footer, and /v/[hash] all share copy. Method may be undefined (legacy
  // callers that don't pass it); the helper's fallback is "Verified
  // Constituent" which is honest but generic.
  import { formatTierDisplay, type VerificationMethod } from '$lib/core/identity/tier-display';

  let { trustTier, districtName, method = null }: {
    trustTier: number;
    districtName: string;
    method?: VerificationMethod;
  } = $props();

  const display = $derived(
    formatTierDisplay({ method, trustTier })
  );
</script>

{#if trustTier >= 2}
  <div class="rounded-lg bg-channel-verified-50 p-3">
    <p class="text-sm font-medium text-channel-verified-800">
      {display.headline}{#if districtName}, {districtName}{/if}
    </p>
    <p class="mt-1 flex items-center gap-1 text-xs text-channel-verified-600">
      <svg class="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
      </svg>
      Cryptographic proof of residency
    </p>
  </div>
{/if}
