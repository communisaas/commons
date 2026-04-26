# Re-grounding Perceptual Dwell Notes

Stage 4e — source-grounded dwell against the re-grounding surface. Reading `AddressChangeFlow.svelte`, `AddressVerificationFlow.svelte` (`regroundingMode` branches), and `profile/+page.svelte` integration as a user would experience them. Not brutalist critique — a judgment-call note for post-launch polish.

## Atmosphere across capture → witnessing → complete

The document register holds. The mono eyebrow "New ground" (all-caps, 10px, 0.22em letter-spacing) carries across `path-select`, `geolocating`, `resolving`, `confirm-district`, and `issuing-credential`, establishing a single voice that persists through every async step. The shift to emerald-700 on the eyebrow at `complete` is the only chromatic move in the whole ceremony — a restrained accent, not a celebration. This works. Most apps would pile on confetti; the re-grounding stays administrative, which fits the seriousness of revoking a credential.

Dotted border-t / border-b on every surface creates a document-like rhythm — like the perforations on a carbon-copy form. When the witnessing list appears, the pulsing emerald dot against the same dotted rule feels continuous with the surfaces that preceded it. No register break there.

## Composition inhabiting the surface

Zone 1 (`Current ground` → `Prior ground` at `complete`, with a `Former` chip) stays mounted through every phase. Reading the layout code confirms it: the `grid` + `sm:grid-cols-2` classes toggle on the parent div, and the section doesn't unmount. The user who has been staring at the old-ground pane for the entire capture + witnessing sequence continues to stare at the same DOM node when the new-ground pane arrives beside it. Continuity is real here, not just narrated.

One small felt gap: at the exact moment of grid-morph (phase transitions from `witnessing` to `complete`), the class toggle causes the old-ground pane to shift left while the inner flow collapses from full-width to the right column. The transition is `transition-[max-width] duration-500` on the outer container, but the internal columns don't animate — they jump. The jump is softened by the outer width tween, but a FLIP or `view-transition-name` would bind the old-ground pane's pre- and post-positions into a single movement. KG-3 captures this as polish-level.

## Voice

"Your representatives have changed." is the headline that lands at `complete` when `districtChanged` is true. The three-way branch (reps changed / senators changed / reps carry forward) is wired to real state — the headline doesn't lie to you when the move was within-district. This is the right kind of honesty. The "Your ground has been re-attested. Your representatives carry forward." variant is quieter and more dignified than the reps-changed version — it earns its place by not pretending the change was bigger than it was.

"Re-ground here →" as the primary action on `confirm-district` reads well. It's specific to this ceremony (not "Confirm" or "Continue") and it lets the user understand what they're committing to. "Retire" on the witnessing line and "Attest" on the second line use words that match the gravity.

## Remaining register breaks

Minor: the error banner on `confirm-district` ("There was a problem...") renders in red-700 with a red-300 dotted border. The register holds, but the AlertCircle icon is filled red-500, which is marginally brighter than everything else on the surface. A red-400 or a thin-stroke icon would sit more quietly in the document.

Minor: the fallback `!regroundingMode` branches (lines 815-891, 1287-1358, etc.) are the older pill-and-emerald-fill register. These don't ship with re-grounding — they're the initial-verification paths — but they live in the same file, which means a dev touching the witnessing branch is one conditional away from the visual language that preceded this work. Not a user-facing issue; an author-facing one. Probably worth extracting the regrounding branches to a `AddressVerificationRegroundingBody.svelte` subcomponent post-launch.

Minor: the "Done →" link at the end of the consequential diff is the only primary affordance with a hover transition to emerald (`hover:text-emerald-700`). Every other document-register primary action is slate-on-slate. This one colorshift is defensible — it signals completion — but it's slightly louder than everything else.

## Summary

The surface holds. Composition is genuinely inhabited, not just visually evoked. Voice is consistent and calibrated. Three items of low-priority polish: grid-morph jump (KG-3 already tracked), error-icon brightness, and the primary "Done" link being the only accent-shift hover. None are launch-blocking.
