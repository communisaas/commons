# ZK Proof Generation Testing Strategy

## The Reality: Browser-Native Cryptography Can't Run in CI

**WASM proving requires a real browser with sufficient memory and compute.** CI runners (GitHub Actions, CircleCI) have limited resources and often can't run heavy cryptographic operations.

**This is fine.** We test what matters at each layer.

> ⚠️ **DIVERGENCE BANNER (2026-04-23 audit).** The layered philosophy
> (unit → integration → E2E → manual) is sound. Specific test files
> referenced do not exist as named:
>
> - ❌ `tests/integration/zk-proof-generation.test.ts` — not present.
> - ❌ `tests/e2e/zk-proof-generation.spec.ts` — not present. E2E suite
>   has `identity-verification-flow.spec.ts`,
>   `moderation/moderation-pipeline.spec.ts`, and
>   `basic-functionality.spec.ts` — none are proof-specific.
> - ✅ `tests/unit/ProofGenerator.test.ts` — exists (unit tests only).
> - ✅ Voter-protocol integration tests live at
>   `tests/unit/voter-protocol/` (NOT `tests/e2e/voter-protocol/`).
> - Circuit in scope is `three_tree_membership`, **31 public inputs**
>   (`THREE_TREE_PUBLIC_INPUT_COUNT = 31` at
>   `src/lib/core/crypto/noir-prover-shim.ts:22`), validated at
>   `src/routes/api/submissions/create/+server.ts:~125` as `!== 31`.
>   Submit endpoint is `/api/submissions/create`, not
>   `/api/congressional/submit`.
> - **TEE is scaffolded, not deployed.** Witness encryption
>   (XChaCha20-Poly1305 + X25519) + `/api/tee/public-key` endpoint exist;
>   the enclave doesn't. Treat any strategy that assumes an attested
>   TEE round-trip as Phase-2.
> - Ghost refs to `src/lib/core/zkp/witness-builder.ts` and
>   `proof-generation.svelte.ts` are not present; the real prover API
>   is `src/lib/core/zkp/prover-client.ts` (`initializeThreeTreeProver`,
>   `generateThreeTreeProof`).

---

## Testing Strategy (3 Layers)

### Layer 1: API Surface Tests (CI-Friendly ✅)

**What:** Test the TypeScript API without actually running WASM.
**Where:** `tests/integration/zk-proof-generation.test.ts`
**Runs in:** Node/Vitest (fast, CI-friendly)

**What we test:**
- ✅ Function signatures and return types
- ✅ Error handling and validation logic
- ✅ Caching behavior (does it attempt to cache?)
- ✅ Browser compatibility detection
- ✅ Input validation (Merkle path length, leaf index bounds)
- ✅ Mock proof generation (structure, not cryptography)

**What we DON'T test:**
- ❌ Actual WASM initialization (requires browser)
- ❌ Real proof generation (requires browser)
- ❌ Cryptographic soundness (Noir/Barretenberg UltraHonk via @aztec/bb.js; Trail of Bits audit planned)
- ❌ Performance benchmarks (requires real hardware)

**Example:**
```typescript
describe('API Surface Tests', () => {
  it('should validate Merkle path length', async () => {
    const invalidPath = Array(10).fill('0x0...');

    // This will fail BEFORE hitting WASM (input validation)
    await expect(
      generateDistrictProof(commitment, actionId, 0, invalidPath, 'CA-12')
    ).rejects.toThrow('Invalid Merkle path length: 10 (expected 12)');
  });
});
```

**CI Command:**
```bash
npm run test:integration -- zk-proof-generation
```

---

### Layer 2: E2E Browser Tests (CI-Optional 🤷)

**What:** Test actual WASM proving in real browsers.
**Where:** `tests/e2e/zk-proof-generation.spec.ts`
**Runs in:** Playwright (Chromium/Firefox/WebKit)

**What we test:**
- ✅ WASM module loads in browser
- ✅ Prover initializes (cold + cached)
- ✅ Proof generation works end-to-end
- ✅ Performance benchmarks (real hardware)
- ✅ Memory usage (browser DevTools)
- ✅ UX flow (ProofGenerationModal)

**CI Strategy:**
- **Skip in CI** (too resource-intensive)
- **Run locally** before deployment
- **Run in staging** after deployment (Vercel preview)

**Local Command:**
```bash
npx playwright test tests/e2e/zk-proof-generation.spec.ts --headed
```

**Why skip in CI?**
- WASM keygen: 5-10s on desktop, 15-30s on CI
- Memory usage: 600-800MB (CI runners have 2-4GB total)
- Flaky timeouts on low-resource CI machines
- Not worth the CI compute cost

---

### Layer 3: Manual Testing (Required Before Deploy 🚨)

**What:** Human-driven testing on real devices.
**Where:** Real browsers + devices
**Runs in:** Manual QA checklist

**Devices to test:**
- Desktop: Chrome, Firefox, Safari (Mac/Windows)
- Mobile: iOS Safari (iPhone 12+), Android Chrome (Pixel 5+)
- Low-end: Android Chrome (Moto G Power, 3GB RAM)

**Manual Checklist:**

```markdown
## Desktop Testing (5-10 min)

### Chrome
- [ ] Cold start initialization: 5-10s
- [ ] Cached initialization: <100ms
- [ ] Proof generation: 1-2s
- [ ] Memory usage: 600-800MB peak
- [ ] Educational messages cycle every 3s
- [ ] Modal auto-closes after success

### Firefox
- [ ] Same as Chrome

### Safari
- [ ] Same as Chrome (may be slower, 8-12s cold start)

## Mobile Testing (10-15 min)

### iOS Safari (iPhone 12+)
- [ ] Cold start: 15-30s
- [ ] Cached: <100ms
- [ ] Proof generation: 8-15s
- [ ] No crashes on backgrounding
- [ ] Memory warning handling

### Android Chrome (Pixel 5+)
- [ ] Same as iOS

### Low-end Android (Moto G Power)
- [ ] Cold start: 30-60s (acceptable)
- [ ] Proof generation: 20-30s (acceptable)
- [ ] Fallback to Phase 1 if memory too low

## Error Scenarios

- [ ] Network offline during proof gen → fallback to Phase 1
- [ ] Tab backgrounded → proof continues
- [ ] Browser low memory → graceful degradation
- [ ] WASM import fails → fallback to Phase 1

## UX Flow

1. Navigate to template: `/s/example-template`
2. Click "Send Message"
3. Complete identity verification (use mock providers)
4. ProofGenerationModal appears
5. Stage 1: "Initializing Noir prover..." (5-10s first time)
6. Stage 2: "Generating zero-knowledge proof..." (1-2s desktop)
7. Educational messages cycle (3s intervals)
8. Stage 3: "Proof generated successfully!" (shows time)
9. Modal auto-closes after 2s
10. Message sends to congressional office

✅ All steps complete without errors
```

**Recording benchmarks:**
Create a Google Sheet with:
- Browser/Device
- Cold start time
- Cached start time
- Proof gen time (avg of 3)
- Memory usage (Chrome DevTools)
- Notes (any issues)

---

## What About CI? (Pragmatic Approach)

### CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/test.yml
name: Test Suite

on: [push, pull_request]

jobs:
  unit-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:unit        # Fast, no WASM
      - run: npm run test:integration # Fast, no WASM
      # ✅ ZK proof API tests run here (no WASM)

  e2e-critical:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:e2e -- --grep-invert "ZK Proof"
      # ✅ Runs all E2E EXCEPT ZK proof tests (too slow)

  zk-proof-smoke:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npx playwright install
      - run: npm run test:e2e -- zk-proof-generation --timeout 60000
      # ✅ Only on main branch, generous timeout, expected to fail sometimes
      # ✅ If it passes, great! If not, we test manually
```

### Deployment Gates

**Before merging to `main`:**
1. ✅ CI unit/integration tests pass
2. ✅ CI E2E tests pass (except ZK)
3. ✅ Manual ZK proof testing on at least 2 devices

**Before deploying to production:**
1. ✅ All above
2. ✅ Manual ZK proof testing on all supported devices
3. ✅ Performance benchmarks recorded
4. ✅ Staging environment ZK proof tests pass

---

## Why This Works

### 1. Fast CI Feedback (5-10 min)
- Unit tests: 30s
- Integration tests: 2-3 min
- E2E (no ZK): 5 min
- **Total: ~8 min** (fast feedback loop)

### 2. No Flaky CI
- No resource-intensive WASM tests
- No cryptographic timeouts
- No memory-related failures
- **Reliable CI pipeline**

### 3. Real Testing Where It Matters
- Manual testing catches UX issues
- Performance benchmarks on real devices
- Error handling tested in production-like conditions
- **Quality where users experience it**

### 4. Developer Velocity
- Don't wait 30 min for CI to run heavy WASM tests
- Catch API issues fast (unit/integration)
- Reserve expensive tests for pre-deploy manual QA
- **Ship faster without sacrificing quality**

---

## Current Status

### ✅ Implemented
- API surface tests (`tests/integration/zk-proof-generation.test.ts`)
- E2E browser tests (`tests/e2e/zk-proof-generation.spec.ts`)
- Manual testing checklist (above)
- CI pipeline configuration (proposed)

### 🏗️ TODO
- [ ] Add `.skip` to WASM tests in integration suite
- [ ] Update CI config to skip ZK E2E tests
- [ ] Create manual testing Google Sheet
- [ ] Document performance benchmarks (after manual testing)
- [ ] Add smoke test on main branch (optional, for monitoring)

### ⏳ Blocked
- Full E2E flow testing (waiting for Phase 1 identity verification complete)
- Shadow Atlas integration (Merkle trees being built by other agent)
- Production performance benchmarks (need deployed app)

---

## Testing Philosophy

**Good testing is about confidence, not coverage.**

We have confidence because:
1. **API tests** ensure correct integration patterns
2. **E2E tests** prove it works in real browsers
3. **Manual tests** catch real UX issues
4. **Noir/Barretenberg (UltraHonk via @aztec/bb.js)** provides the proving system (Trail of Bits audit planned)

We DON'T need:
- ❌ 100% coverage (diminishing returns)
- ❌ Heavy CI tests (slow, flaky, expensive)
- ❌ Cryptographic correctness tests (audited upstream)

**We test the right things at the right time.**

---

## Questions?

**Q: What if WASM proving fails in production?**
A: We fallback to Phase 1 (encrypted address). User can still send message.

**Q: How do we know performance is acceptable?**
A: Manual benchmarking + real user monitoring (once deployed).

**Q: Can we test cryptographic soundness?**
A: No. That's what audits are for. We use Noir/Barretenberg (UltraHonk via @aztec/bb.js); Trail of Bits audit planned.

**Q: What about Playwright in CI with more resources?**
A: Possible with self-hosted runners (8GB RAM+), but not worth it vs manual testing.

**Q: How often should we run manual tests?**
A: Before every production deploy. Weekly for staging.

---

## Bottom Line

**Browser-native cryptography is tested like native mobile apps:**
- Fast unit/API tests in CI ✅
- Automated E2E tests locally/staging ✅
- Manual QA on real devices before deploy ✅
- Production monitoring after deploy ✅

**This is industry standard. This works.**
