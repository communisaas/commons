# Commons Design Constitution

Version: v1.0.0
Maintainer: Communiqué PBC (initial)
Licence: at the recipient's choice, CC-BY-4.0 or Apache-2.0

## Preamble

This document is the design constitution of the reference implementation of the Commons protocol. It is published by Communiqué PBC as the maintainer of the reference implementation.

The protocol substrate — its cryptographic specifications, its on-chain governance, its trust-model accounting — is documented separately in `voter-protocol/specs/`. Peer implementations of the protocol are welcome and are expected to publish their own design constitutions; they are not bound by this one.

This document binds the reference implementation. As of its publication, the protocol does not pass the walkaway test (see `voter-protocol/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md`). Several commitments below are observed in current shipping code; others are the direction of work and are labelled accordingly.

The constitution is amended through the procedure in §5. Editing without amendment — typos, formatting, broken links, errata of fact that do not change meaning — is permitted by the maintainer alone. Substantive change is amendment.

## §1 Substrate

The substrate is what holds plurality together.

### 1.1 The mathematics is the only authority

Where the protocol asserts a fact about identity, district, or delivery, that fact is a cryptographic verification anyone can re-run. It is not an assertion the maintainer asks to be trusted. Where verification is not yet possible, the assertion is honestly labelled as interpretive.

*Currently observed:* the FROZEN domain strings, the three-tree membership proof, the district-nullifier mechanism, and the on-chain registry roots in `voter-protocol/specs/CRYPTOGRAPHY-SPEC.md`.

*Currently absent:* the rendered receipt does not yet surface its hash (`src/lib/components/template/TemplateModal.svelte` carries a TODO). The `Datum` and `Cite` primitives in `src/lib/design/` are defined but not yet propagated to all verifiable claims in the interface.

### 1.2 Federation by default

The substrate is independent of any single implementing organisation. The cryptographic strings, the on-chain registries, and the governance procedure operate without privileging the reference implementation. A peer implementation that follows the specifications correctly is compatible; the reference implementation has no editorial seat over the protocol.

*Currently observed:* the FROZEN strings carry the prefix `voter-protocol-*`, not `commons-*`. The licence model permits independent implementation. `voter-protocol/GOVERNANCE.md` documents the federation expectation.

*Currently absent:* no peer implementation yet exists. The transition gates in `voter-protocol/GOVERNANCE.md` *Planned transition* require an independent peer to operate before the protocol can be considered federation-validated rather than federation-prepared.

### 1.3 Permanence over product cycles

The substrate is designed for thirty years. Where a decision is reversible, it is reversible cheaply. Where a decision is irreversible — the FROZEN domain strings, an on-chain registry root, a published constitutional amendment — the cost of getting it wrong is forever. The maintainer makes irreversible decisions sparingly and with explicit acknowledgement.

*Currently observed:* the FROZEN strings (migrated `commons-*` → `voter-protocol-*` pre-launch); the on-chain timelock structure documented in `voter-protocol/GOVERNANCE.md` §"On-chain governance"; the convention of a signed deployment manifest binding deployed addresses to configured timelock values.

*Currently absent:* the on-chain anchoring of this constitution itself. Phase 6 of the realignment work commits the constitution's hash to a registry contract; until then, the canonical anchor is the first-publication sha256 in the issue masthead that promulgates the constitution.

## §2 Artifact

Every entry in the public record is an artifact.

### 2.1 Verifiable or honestly interpretive

Every visual element is one of two things: a verifiable claim — a count, a date, a hash, a district code — or an interpretation — a description, a rationale, a summary. The two registers are distinguishable typographically. Verifiable claims appear in JetBrains Mono with tabular numerals; interpretations appear in Satoshi.

This is the generative constraint of the Civic Proof design language, codified in this repository on 2026-04-13. The constitution names that language as the existing manifestation of this principle.

*Currently observed:* the `Datum` and `Cite` primitives in `src/lib/design/` enforce the typographic distinction; the verification packet, the receipt, and the org specimen carry the constraint.

*Currently absent:* propagation across all surfaces. Many mid-traffic surfaces still mix registers without typographic distinction. Phase 8 of the realignment work addresses the gap.

### 2.2 Information has shape; express the shape

The five citizen dimensions — geography, time, identity, voice, engagement — are first-class design material. A count is not the same as a temporal rhythm; a tier is not the same as a composition. Each dimension has a primitive that expresses its shape: `Datum` for verifiable numerics, `Pulse` for temporal rhythm, `Ratio` for composition, `Rings` for tier or depth, `Cite` for provenance, `Artifact` for bounded specimens, `EntityCluster` for proximity.

These are dimensions of *citizen* action. The dimensions an institution operates in — authority, jurisdiction, evidence — are documented in `voter-protocol/specs/`, where they belong. Naming this asymmetry honestly is part of the principle: the design constitution is built around the citizen-side of the civic contract because the reference implementation is the citizen-facing interface to the protocol.

*Currently observed:* the seven primitives are defined in `src/lib/design/` and progressively replace ad-hoc Tailwind compositions.

*Currently absent:* display-scale typography for hero numbers and registry stamps. Email and PDF rendering preserve the dimensions only partially.

### 2.3 The cryptographic substrate is visible as registry marks

Hashes, nullifiers, Merkle roots, signatures, and version anchors appear in margins and footers as marks of the substrate, not behind copy. The reader of any artifact can find the cryptographic facts that hold the artifact together without leaving the artifact.

*Currently observed:* the verification packet; the org specimen.

*Currently absent:* the homepage masthead, the receipt confirmation, the email and PDF exports. Phase 6 of the realignment work addresses the gap across the seven Audit B opportunities catalogued there.

## §3 Commons

The commons is how plurality coexists.

### 3.1 Plurality encoded, not curated

The substrate accepts entries from anyone meeting verification thresholds. Editorial discretion does not exclude legitimate entries. Where moderation is necessary, the standards are published, the decisions are recorded, and the appeal path is open.

The two-layer Groq moderation pipeline rejects only injection attempts and content that fails the published safety standard. Legitimate political speech across the spectrum is accepted regardless of the maintainer's preferences. The five citizen dimensions encode plurality structurally; templates filter, locations filter, but no editorial axis filters.

*Currently observed:* the moderation pipeline as published; the absence of editorial filtering on legitimate templates.

*Currently absent:* the appeal path is documented internally; the public-facing appeal artifact is forthcoming.

### 3.2 Decision-makers and constitutional moments share the substrate

A bill, a delivered message, a coalition founding, an amendment to this document, a debate transcript — these are entries in the same public record. The record does not privilege the institution over the citizen, or the citizen over the institution, or routine action over structural moment. The same primitives, the same cryptographic anchors, the same legibility expectations apply.

*Currently observed:* the unified `DecisionMaker` entity in the data model; the verification packet routing citizen action to staffer-legible delivery.

*Currently absent:* the public DM page, the coalition founding charter artifact, the public debate index. Phase 5 of the realignment work addresses the gap.

### 3.3 Plain English

The voice register is plain English. Sentences a fourteen-year-old reads without help. No marketing superlatives. No emotional manipulation. No cypherpunk performance. Honest about what the system does and does not do.

This register is adopted by the reference implementation from this issue forward. It is not enforced on the substrate; peer implementations may choose differently. The supersession of the prior register (`docs/design/voice.md` under "Direct. Specific. Institutional.") is recorded in the issue editorial note that promulgates this constitution.

*Currently observed:* the homepage masthead, the onboarding content, the receipt — per Phase 3 of the realignment work, closed 2026-05-05.

*Currently absent:* further surfaces remain mixed-register. Phase 8 of the realignment work addresses the gap.

## §4 Open-protocol commitments

The reference implementation operates under the licence model, governance procedure, and trust model documented in `voter-protocol/`:

- The protocol code is licensed under Apache-2.0 (`voter-protocol/LICENSE`).
- The protocol specifications are licensed under the recipient's choice of CC-BY-4.0 or Apache-2.0 (`voter-protocol/LICENSE-specs`, `voter-protocol/LICENSE-CC-BY-4.0`).
- The FROZEN cryptographic domain strings are committed and immutable post-launch (`voter-protocol/specs/CRYPTOGRAPHY-SPEC.md` §0).
- Governance, succession, and conflict resolution operate per `voter-protocol/GOVERNANCE.md`.
- The walkaway-test accounting of what currently rests on operator integrity is in `voter-protocol/specs/TRUST-MODEL-AND-OPERATOR-INTEGRITY.md`.

The reference implementation does not extend or override these commitments through this constitution. Where this constitution and the protocol substrate disagree, the protocol substrate governs.

This document is licensed under the recipient's choice of CC-BY-4.0 or Apache-2.0, matching the protocol specifications.

## §5 Amendment

This constitution is amended through the spec-change process documented in `voter-protocol/specs/proposals/README.md`. Amendment is plural by construction.

An amendment proposal is admitted only when at least **two reviewers** concur in writing. At least **one** of those reviewers must be a person who is not a current or former Communiqué PBC employee, contractor, or fund recipient (the insider-conflict rule of `voter-protocol/GOVERNANCE.md` §"Insider-conflict rule" applies). The independent reviewer is, in practice:

- an independent security researcher; **or**
- an operator of a deployed peer implementation as defined in `voter-protocol/GOVERNANCE.md` *Planned transition* (1); **or**
- a maintainer of a peer civic-tech project who has reviewed the relevant section in writing.

The reviewers' written concurrence is recorded in the proposal's archival entry. PBC alone cannot amend this document.

When at least two peer implementations have adopted the protocol substrate per *Planned transition* (1), the threshold rises: amendment then requires **2-of-3 supermajority among adopting maintainers**. The constitution's amendment procedure scales with the protocol's federation.

Amendments take effect upon publication of a new Issue of the public record citing the amendment proposal's hash, the post-amendment hash of this document, and the date. Amendments do not retroactively change a document's first-publication hash; the full hash chain is preserved in the issue masthead in chronological order.

The maintainer's restraint is not the enforcement mechanism. The requirement of co-signers is.

---

*Maintainer: Communiqué PBC. First publication promulgated by `docs/record/vol-1/issue-1.md`. Hash chain in that issue's masthead.*
