# Public Record · Volume 1 · Issue 1

Date: 2026-05-06
Status: Inaugural · Promulgates `CONSTITUTION.md@v1.0.0`
Maintainer: Communiqué PBC
Licence: at the recipient's choice, CC-BY-4.0 or Apache-2.0

## Hash manifest

| Document | Form | Hash |
|---|---|---|
| `CONSTITUTION.md@v1.0.0` | source (markdown) | sha256:[computed at first publication] |
| `record/vol-1/issue-1.md@v1.0.0` | source (markdown) | sha256:[computed at first publication] |
| `record/vol-1/issue-1.html` | rendered (web) | sha256:[computed at release tag] |
| `record/vol-1/issue-1.pdf` | rendered (print) | sha256:[computed at release tag] |
| `record/vol-1/issue-1.txt` | rendered (plain-text) | sha256:[computed at release tag] |

The first-publication sha256 of each source document is canonical and immutable. Any subsequent amendment is appended below in chronological order with its own hash, the proposal hash that admitted it, and the date. The masthead chain is the audit record.

The rendered forms are non-canonical: they are faithful presentations of the source. Where any conflict arises between a rendered form and the source markdown, the source markdown governs. The PDF and plain-text exports are release-gate deliverables; the screen-reader pass on the rendered web form is also a release gate.

## §A Promulgation

This issue promulgates **`CONSTITUTION.md@v1.0.0`** as the design constitution of the reference implementation of the Commons protocol. The constitution is structured in five sections — Substrate, Artifact, Commons, Open-protocol commitments, and Amendment.

The constitution does not bind the protocol substrate. The protocol substrate is governed by `voter-protocol/GOVERNANCE.md` and the specifications under `voter-protocol/specs/`. The constitution does not bind peer implementations of the protocol; peers publish their own design constitutions. The constitution binds the reference implementation maintained by Communiqué PBC.

Adoption is effective on this issue's date.

## §B Editorial note: voice register supersession

Prior to this issue, the design voice of the reference implementation was documented in `docs/design/voice.md` under the heading *"Direct. Specific. Institutional."* Effective with the publication of this issue, that doctrine is **superseded** by the GOV.UK plain-English register described in §3.3 of the constitution.

The prior register served the reference implementation through pre-launch development. The supersession is recorded honestly: it was not a refinement but a register reset. The cypherpunk-direct register over-rewarded specificity at the expense of accessibility. The plain-English register accepts a small loss of precision for a substantial gain in legibility across the reader populations the public record must serve — civic staffers, citizens, designers, auditors, and future maintainers reading at a thirty-year horizon.

The prior `voice.md` is retained in the repository with status `SUPERSEDED` and is not deleted. References from current code that adopt the prior register are migrated through Phase 3 of the realignment work, which closed 2026-05-05. Where any conflict arises between the constitution and the superseded `voice.md`, the constitution governs.

## §C Errata policy

Errata of fact that do not change meaning — typos, formatting, broken links — are corrected by the maintainer and recorded in the next issue's errata block, without amendment.

Substantive change to the constitution is amendment, governed by §5 of the constitution: at least two reviewers in writing, including at least one independent security researcher or peer-implementation operator, with the supermajority threshold rising as peer implementations adopt the protocol substrate.

Errata to this issue, or amendments to the constitution that arise after this issue's publication, are appended below with their own hash, the proposal hash that admitted them, and the date. The masthead's hash manifest preserves the chain in chronological order. The first-publication hash of each source document is canonical and is not retroactively changed.

## §D Cadence

Issues of the public record are published as material developments warrant. There is no fixed cadence. The expected occasions for a new issue are:

- adoption of an amendment to the constitution
- promulgation of a new normative artifact (a new specification module, a new set of design primitives that supersedes a prior set)
- recording of a constitutional moment (the first peer implementation's adoption of the protocol substrate, the establishment of a successor entity per `voter-protocol/GOVERNANCE.md` §"Succession", or a comparable event)

The expectation is irregularity. A long silence between issues is a sign that no material development has warranted publication, not a sign that publication has lapsed.

## §E Forward

The realignment work that prepared the reference implementation for this constitution is recorded in `docs/design/REALIGNMENT-TASK-GRAPH.md`.

- Phase 0 (federation hygiene of the protocol substrate, on which the reference implementation depends) closed at do-5 on 2026-05-05.
- Phase 3 (voice triage on the highest-traffic surfaces) closed at do-1 on 2026-05-05.
- Phase 1 (this constitution) closes with the publication of this issue.
- Phases 2, 4, 5, 6, 7, and 8 remain open.
- Phase 0.5 hard launch gates remain open. The protocol substrate cannot ship as canonical reference implementation until those gates close. This issue, and the constitution it promulgates, is not gated by Phase 0.5; the constitution declares the design commitments of the reference implementation independently of the launch event.

The constitution will, in time, be cited from outside this repository. This issue is the first such citation.

## §F Errata and amendments

*(none at first publication)*

---

*This issue is the first entry in the public record. Subsequent issues append. The record begins.*
