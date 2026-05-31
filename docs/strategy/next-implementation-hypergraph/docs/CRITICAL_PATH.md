# Critical Path

The 5 chokepoints define the longest dependency chain. Everything else can move in parallel with them.

## Chain

```
CP-1 (ABC enrollment, Apple-side weeks)
   ↓
CP-2 (ses-proxy Lambda deploy)   ──┐
CP-5 (Sentry on-call wiring)     ──┤
                                   ↓
                       NEW-A-5 staging walk
                                   ↓
                       NEW-A-6 launch runbook
                                   ↓
                       NEW-A-7 CONGRESSIONAL flag flip
                                   ↓
                       ============= W-0 → W-1 =============
                                   ↓
                       NEW-E-1..5 substrate writer wire-ups
                                   ↓
                       ============= W-1 → W-2 =============
                                   ↓
              ┌──────────────────────────────────────┐
              ↓                                      ↓
   CP-3 (mainnet composite,                  CP-4 (TEE enclave)
   Safe multisig + audit)                          ↓
              ↓                            NEW-T4-1 delegation executor
   NEW-T6-1 anchor pipeline                        ↓
              ↓                            NEW-T4-2 ZK on AI actions
   NEW-T6-3 cadence                                ↓
              ↓                            NEW-T4-7 message-writer + proof
   NEW-T6-10 archive manifest                      ↓
              ↓                            NEW-T4-9 delegation UI
   NEW-T8-6 long-term artifact
              ↓
   NEW-T8-4b IPFS report URL
                       ↓
                       ============= W-2 → W-3 =============
                                   ↓
                       T3-1 OpenStates + T3-2 special districts (parallel)
                                   ↓
                       T3-8/T3-10/T4-4 multi-jurisdiction infrastructure
                                   ↓
                       ============= W-3 → W-4 =============
                                   ↓
                       T3-3/T3-4/T3-5 country resolvers (parallel)
                                   ↓
                       T7-4 cross-border schema → T7-6 multi-country delivery
```

## Critical chain length

- **W-0 (pre-launch ops)**: clock-bound by ABC enrollment (Apple weeks). Lambda + Sentry parallelizable.
- **W-1 (launch + cleanup)**: 5 substrate wire-ups + 2 staging items (~1-2 weeks engineering)
- **W-2 (hardening)**: clock-bound by mainnet audit + TEE provisioning (multi-week each)
- **W-3 (Phase 2)**: ~3-4 months engineering across state-data + Phase 2 precision
- **W-4 (international)**: ~2 months engineering + per-country compliance

## Chokepoint owners

| Chokepoint | Task | Gate | Owner |
| --- | --- | --- | --- |
| CP-1 | NEW-A-1 | Apple Business Connect review | Apple (external) |
| CP-2 | NEW-T2-2 | AWS Lambda deploy + secret sync | Commons ops |
| CP-3 | NEW-T6-2 | Safe multisig + audit firm cycle | Commons ops + auditor |
| CP-4 | NEW-T5-3 | AWS Nitro Enclave provisioning | Commons ops |
| CP-5 | NEW-A-4 | Sentry → PagerDuty wiring | Commons ops |

Three of five chokepoints (CP-2, CP-3, CP-5) are Commons ops responsibility. CP-1 is Apple-side and CP-4 is AWS-side; engineering work for both is already done.
