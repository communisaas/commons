/**
 * Cross-boundary delivery policy — the single source of truth shared by all three
 * enforcement points, so a security/access-control tier can never drift across them:
 *
 *   - the Convex action       `convex/submissions.ts`            (`./_policy`)
 *   - the SvelteKit endpoint  `src/routes/api/submissions/create` (`$convex/_policy`)
 *   - the client gate         `TemplateModal.svelte`             (`$convex/_policy`)
 *
 * Lives in `convex/` because `convex/` cannot import from `src/`, but `src/` resolves
 * `convex/` via the `$convex` alias (svelte.config.js) — so this is the only location
 * reachable from every side. Underscore-prefixed so Convex treats it as a helper
 * module, not a function module.
 *
 * REQUIRED_CONGRESSIONAL_PROOF_TIER — the floor for API-relayed (CWC / congressional)
 * delivery. Tier 2 (district-confirmed via the address-first flow) DELIVERS; gov-ID
 * (tier 4) raises the assurance BADGE on the proof, it is NOT the bar. Email/mailto
 * delivery is open (no gate) — the channel sets the requirement, not the recipient.
 */
export const REQUIRED_CONGRESSIONAL_PROOF_TIER = 2;
