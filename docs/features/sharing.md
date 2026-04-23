# Universal Sharing Strategy: Share Anywhere, Not Just Facebook/LinkedIn

**Date**: 2025-01-08
**Insight**: Platform-specific buttons (Facebook, LinkedIn) are limiting. Templates need to spread EVERYWHERE.

> ⚠️ **2026-04-23 audit — implemented vs prescribed:**
>
> - **Share URL `/s/[slug]`:** ✓ live.
> - **OG image:** `/s/[slug]/og-image/+server.ts` generates **1200×630**
>   images via Satori + Sharp, includes `verifiedSends` count and
>   domain-aware color. Meta-tag linkage on the share page is not
>   obviously wired — verify before relying on social cards.
> - **ShareButton:** native `navigator.share()` with clipboard fallback.
>   **The 4 pre-written message variants** (short / medium / long / SMS)
>   prescribed here are **not surfaced in `ShareButton.svelte`**.
>   `generateShareMessage()` in `src/lib/core/share/share-messages.ts`
>   exists, but only a single default message is passed from
>   `ShareButton`. `TemplateModal.svelte` has richer share UX (hardcoded
>   message variants + QR + raw-URL field) but doesn't call
>   `generateShareMessage()` either.
> - **Analytics view tracking** uses `trackTemplateView()`
>   (`src/lib/core/analytics/client.ts:~251`) with localStorage dedup
>   (1 view per template per browser per day) + k-ary LDP when
>   `VITE_ANALYTICS_DP_ENABLED=true` + daily per-metric contribution
>   caps. No raw counts exposed. This doc is silent on DP.
> - **Congressional gating:** `/s/[slug]/+layout.server.ts:~26-28` 404s
>   CWC templates when `FEATURES.CONGRESSIONAL=false`.
> - **No Prisma refs; Convex-only.**

---

## The Problem with Platform-Specific Share Buttons

**What we almost built**:
```svelte
<button onclick={() => shareOnFacebook()}>Share on Facebook</button>
<button onclick={() => shareOnLinkedIn()}>Share on LinkedIn</button>
<button onclick={() => shareOnTwitter()}>Share on Twitter</button>
```

**Why this is limiting**:
- ❌ Only works on 3 platforms (ignores Discord, Slack, Reddit, WhatsApp, Signal, Telegram, group chats, email, etc.)
- ❌ Requires maintaining platform-specific implementations
- ❌ Breaks when platforms change their share APIs
- ❌ No in-person sharing (protests, meetings, events)
- ❌ Users feel forced into specific platforms

---

## Universal Sharing Strategy

### 1. Native Share (Mobile) + Clipboard Copy (Desktop)

**One button that works everywhere**:

```svelte
<script lang="ts">
  async function handleShare() {
    const shareData = {
      title: template.title,
      text: shareMessage,
      url: shareUrl
    };

    // Mobile: Use native share sheet (works on iOS, Android)
    if (navigator.share && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        // Track share attempt
        trackShare('native');
      } catch (err) {
        // User cancelled
      }
    } else {
      // Desktop: Copy to clipboard
      await navigator.clipboard.writeText(`${shareMessage}\n\n${shareUrl}`);
      showCopiedConfirmation();
      trackShare('clipboard');
    }
  }
</script>

<button onclick={handleShare}>
  {#if isMobile}
    Share this template
  {:else}
    Copy share link
  {/if}
</button>
```

**Why this works**:
- ✅ Mobile: Opens native share sheet → user picks ANY app (WhatsApp, Discord, Telegram, Signal, Email, etc.)
- ✅ Desktop: Copies to clipboard → user pastes ANYWHERE (Slack, Discord, Reddit, group chats, email, etc.)
- ✅ One implementation, works everywhere
- ✅ Future-proof (no platform API dependencies)

---

### 2. Pre-Written Share Messages (Copy-Paste Friendly)

**Multiple message variations for different contexts**:

```svelte
<script lang="ts">
  const shareMessages = $derived(() => {
    const actionCount = template.metrics?.sent || 0;
    const baseUrl = shareUrl;

    return {
      // Short & urgent (Twitter, Discord)
      short: actionCount > 1000
        ? `🔥 ${actionCount.toLocaleString()}+ people have taken action on "${template.title}"\n\nJoin us: ${baseUrl}`
        : `Take action on "${template.title}"\n\n${baseUrl}`,

      // Medium (Slack, group chats)
      medium: `I just used this template to contact my representatives about ${template.category.toLowerCase()}.\n\n"${template.title}"\n\n${actionCount > 0 ? `${actionCount.toLocaleString()} people have already taken action. ` : ''}Takes 2 minutes: ${baseUrl}`,

      // Long (Email, Reddit)
      long: `Hey, I wanted to share this civic action template with you.\n\n"${template.title}"\n\n${template.description}\n\n${actionCount > 1000 ? `This is going viral - ${actionCount.toLocaleString()}+ people have already taken action. ` : actionCount > 100 ? `${actionCount.toLocaleString()} people have taken action so far. ` : ''}It takes about 2 minutes to customize and send. Your voice matters.\n\n${baseUrl}`,

      // SMS-friendly (under 160 chars)
      sms: `${template.title} - ${actionCount > 0 ? `Join ${actionCount.toLocaleString()}+ people: ` : ''}${baseUrl}`
    };
  });
</script>

<!-- Copy buttons for different contexts -->
<div class="space-y-2">
  <button onclick={() => copyMessage(shareMessages.short)}>
    Copy short message (Twitter, Discord)
  </button>
  <button onclick={() => copyMessage(shareMessages.medium)}>
    Copy for Slack/group chats
  </button>
  <button onclick={() => copyMessage(shareMessages.long)}>
    Copy detailed message (Email, Reddit)
  </button>
  <button onclick={() => copyMessage(shareMessages.sms)}>
    Copy for text messages
  </button>
</div>
```

**Why this works**:
- ✅ Users can share on ANY platform
- ✅ Optimized for different contexts (Twitter vs email vs SMS)
- ✅ Social proof included in every message
- ✅ Clear call-to-action
- ✅ Easy to customize before sending

---

### 3. QR Codes (In-Person Viral Sharing)

**For protests, meetings, events, posters**:

```svelte
<script lang="ts">
  import QRCode from 'qrcode';
  import { onMount } from 'svelte';

  let qrCodeDataUrl = $state<string>('');

  onMount(async () => {
    // Generate QR code for template URL
    qrCodeDataUrl = await QRCode.toDataURL(shareUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#1E293B',
        light: '#FFFFFF'
      }
    });
  });

  function downloadQRCode() {
    // Download as PNG for printing on flyers/posters
    const a = document.createElement('a');
    a.href = qrCodeDataUrl;
    a.download = `${template.slug}-qr-code.png`;
    a.click();
  }
</script>

<!-- QR Code Display -->
<div class="rounded-lg border bg-white p-6">
  <h3>Share in person</h3>
  <img src={qrCodeDataUrl} alt="QR code for {template.title}" class="mx-auto" />
  <p class="text-sm text-slate-600">
    Print this QR code on flyers, posters, or signs. People can scan to take action instantly.
  </p>
  <button onclick={downloadQRCode}>
    Download QR code for printing
  </button>
</div>
```

**Why this works**:
- ✅ Viral at protests, rallies, town halls
- ✅ Printable for posters, flyers, handouts
- ✅ Zero friction (scan → take action)
- ✅ Bridges physical and digital organizing

**Use cases**:
- Protest signs: "Scan to tell your rep to support rent control"
- Town hall handouts: QR code on printed materials
- Coffee shop bulletin boards: Poster with QR code
- Tabling events: QR code on table tents

---

### 4. Direct URL Sharing (The Ultimate Fallback)

**Always show the raw URL**:

```svelte
<div class="rounded-lg border bg-slate-50 p-4">
  <div class="flex items-center justify-between">
    <div class="flex-1 mr-3">
      <input
        type="text"
        readonly
        value={shareUrl}
        class="w-full bg-white border rounded px-3 py-2 font-mono text-sm"
        onclick={(e) => e.currentTarget.select()}
      />
    </div>
    <button
      onclick={async () => {
        await navigator.clipboard.writeText(shareUrl);
        showCopiedConfirmation();
      }}
      class="px-4 py-2 bg-participation-primary-500 text-white rounded"
    >
      Copy URL
    </button>
  </div>
  <p class="mt-2 text-xs text-slate-600">
    Share this link anywhere: Discord, Slack, Reddit, group chats, email, etc.
  </p>
</div>
```

**Why this works**:
- ✅ Works on EVERY platform (no exceptions)
- ✅ Users can paste anywhere
- ✅ Click-to-select for easy copying
- ✅ No JavaScript required

---

## Revised Implementation (Week 1, Days 3-5)

### Priority 3: Universal Sharing UI

**File to modify**: `src/lib/components/template/TemplateModal.svelte`

**Features to add**:

1. **Primary action: Universal share button**
   - Mobile: `navigator.share()` (opens native share sheet)
   - Desktop: Copy to clipboard

2. **Secondary: Pre-written messages**
   - Short (Twitter/Discord)
   - Medium (Slack/group chats)
   - Long (Email/Reddit)
   - SMS-friendly

3. **Tertiary: QR code**
   - Display QR code
   - Download for printing
   - Use at protests/events

4. **Always visible: Raw URL**
   - Click-to-select input
   - Copy button
   - Works everywhere

**Implementation**:

```svelte
<!-- src/lib/components/template/TemplateModal.svelte -->
<script lang="ts">
  import QRCode from 'qrcode';

  let qrCodeDataUrl = $state<string>('');
  let showQRCode = $state(false);
  let showMessages = $state(false);

  // Generate QR code on demand
  async function loadQRCode() {
    if (!qrCodeDataUrl) {
      qrCodeDataUrl = await QRCode.toDataURL(shareUrl, { width: 300 });
    }
    showQRCode = true;
  }

  // Universal share handler
  async function handleUniversalShare() {
    const shareData = {
      title: template.title,
      text: shareMessages.medium,
      url: shareUrl
    };

    if (navigator.share && navigator.canShare(shareData)) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(`${shareMessages.medium}\n\n${shareUrl}`);
      showCopied = true;
    }
  }
</script>

<!-- Share Section -->
<div class="space-y-4">
  <!-- Primary: Universal Share -->
  <button
    onclick={handleUniversalShare}
    class="w-full btn-primary"
  >
    {#if navigator.share}
      Share this template
    {:else}
      Copy share message
    {/if}
  </button>

  <!-- Secondary: Pre-written Messages -->
  <details>
    <summary class="cursor-pointer text-sm text-slate-600">
      Show pre-written messages for different platforms
    </summary>
    <div class="mt-3 space-y-2">
      <button onclick={() => copyMessage(shareMessages.short)}>
        Twitter/Discord
      </button>
      <button onclick={() => copyMessage(shareMessages.medium)}>
        Slack/group chats
      </button>
      <button onclick={() => copyMessage(shareMessages.long)}>
        Email/Reddit
      </button>
      <button onclick={() => copyMessage(shareMessages.sms)}>
        Text message
      </button>
    </div>
  </details>

  <!-- Tertiary: QR Code -->
  <button
    onclick={loadQRCode}
    class="text-sm text-slate-600 underline"
  >
    Show QR code for in-person sharing
  </button>

  {#if showQRCode}
    <div class="rounded-lg border bg-white p-4">
      <img src={qrCodeDataUrl} alt="QR code" class="mx-auto" />
      <button onclick={downloadQRCode} class="mt-2 text-sm">
        Download for printing
      </button>
    </div>
  {/if}

  <!-- Always Visible: Raw URL -->
  <div class="rounded-lg border bg-slate-50 p-3">
    <input
      type="text"
      readonly
      value={shareUrl}
      onclick={(e) => e.currentTarget.select()}
      class="w-full bg-white border rounded px-3 py-2 font-mono text-xs"
    />
    <p class="mt-1 text-xs text-slate-500">
      Share this link anywhere
    </p>
  </div>
</div>
```

---

## Dependencies

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

---

## The Bottom Line

**Platform-specific buttons (Facebook, LinkedIn):**
- Work on 3 platforms
- Limit where templates can spread
- Break when APIs change

**Universal sharing (native share + clipboard + QR):**
- Works EVERYWHERE (Discord, Slack, Reddit, WhatsApp, Signal, Telegram, email, SMS, in-person, etc.)
- Future-proof
- Enables viral spread in ALL contexts (digital + physical)

**Templates should spread like wildfire, not be limited to Facebook.**

Next up: Implement universal sharing UI (Days 3-5).
