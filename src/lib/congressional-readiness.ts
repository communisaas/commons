/**
 * Single source of truth for whether the CONGRESSIONAL campaign type may be
 * OFFERED / authored. Runtime-readiness driven (NOT the compile-time
 * `FEATURES.CONGRESSIONAL` bundle flag), so B1 arming delivery via the Convex
 * runtime env flips both the Studio "Send to Congress" button and the
 * campaigns/new type reveal + POST allowlist together — no static-flag drift.
 *
 * This gates AUTHORING/reveal ONLY. The CWC *delivery* gate
 * (`isCongressionalDeliveryLaunched()` + per-submission proof/template/chamber
 * checks at dispatch) stays independently enforced — authoring a CONGRESSIONAL
 * draft when readiness is true never implies a message will deliver.
 *
 * `ready` already implies `launched` (readiness.ready ANDs the launch flag), so
 * the check is belt-and-suspenders; both are required.
 */
export function congressionalDeliveryAvailable(
	readiness: { launched?: boolean | null; ready?: boolean | null } | null | undefined
): boolean {
	return readiness?.launched === true && readiness?.ready === true;
}
