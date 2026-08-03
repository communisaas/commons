/**
 * Which lane does this send take, and does that lane carry the sender's own words?
 *
 * One decision, one place. The modal routes on it, the preview draws its
 * affordances from it, and the guard at the proof entry refuses on it — so a
 * change to routing cannot leave the preview describing a different send.
 *
 * The two imports are the sender-fill placeholder table and the stored
 * delivery-method vocabulary. Both are themselves pure and importless, so this
 * module still loads unchanged in any runtime that needs to decide a lane.
 */

import {
	manualFillReplacements,
	resolvePlaceholders
} from '$convex/lib/messagePlaceholders';
import { isCongressionalDelivery } from '$convex/lib/templateDeliveryMethod';

/** Every way a message leaves this system. */
export const SEND_LANES = ['mailto_direct', 'mailto_congressional_relay', 'cwc_zkp'] as const;

export type SendLane = (typeof SEND_LANES)[number];

/** The shape a lane decision needs from a template — nothing more. */
export interface SendLaneTemplate {
	deliveryMethod?: string | null;
}

/**
 * Read the sender's proof tier without demanding a shape.
 *
 * Callers hand this several different user types across two runtimes, and some
 * carry no tier at all — an absent tier is a sender who has proved nothing, which
 * is the safe reading and the one the routing code already makes.
 */
function trustTierOf(user: unknown): number {
	if (!user || typeof user !== 'object') return 0;
	const tier = (user as { trust_tier?: unknown }).trust_tier;
	return typeof tier === 'number' && Number.isFinite(tier) ? tier : 0;
}

/**
 * The tier at which a sender holds the district proof the zero-knowledge path
 * requires. Below it, a congressional send falls back to the relay — the same
 * lane a guest takes, and one that carries the sender's own words.
 */
const PROOF_LANE_MIN_TRUST_TIER = 2;

/**
 * Resolve the lane for one send.
 *
 * A congressional template splits on what the sender can PROVE, not on whether
 * they are signed in. Signing in with OAuth alone yields no district credential,
 * so a sender below the proof tier takes the relay exactly as a guest does. The
 * routing code makes that same tier decision; deciding it on truthiness here
 * would classify those senders onto a lane they cannot take and strip the note
 * from the lane they actually take.
 */
export function resolveSendLane(template: SendLaneTemplate, user: unknown | null): SendLane {
	if (isCongressionalDelivery(template?.deliveryMethod)) {
		return trustTierOf(user) >= PROOF_LANE_MIN_TRUST_TIER
			? 'cwc_zkp'
			: 'mailto_congressional_relay';
	}
	return 'mailto_direct';
}

/**
 * Does the lane deliver text the sender typed?
 *
 * Keyed by the whole `SendLane` union on purpose: a new lane that forgets its
 * row is a type error, not an `undefined` that quietly reads as "does not
 * carry" — or worse, as "does".
 *
 * `cwc_zkp: false` is a statement about the wire, not a preference. Two facts
 * make it true today:
 *   - `src/routes/api/submissions/create/+server.ts` destructures templateId,
 *     proof, publicInputs, nullifier, encryptedWitness, witnessNonce,
 *     ephemeralPublicKey, teeKeyId, idempotencyKey, sessionId and
 *     recipientSubdivision — no message-bearing field exists on the request.
 *   - `convex/submissions.ts` resolves the letter with `manualFillReplacements()`
 *     called with no argument, because the row holds a proof and not a body, so
 *     every sender-fill slot erases server-side.
 *
 * Reversing this row is a congressional launch-gate item, not a code tweak: it
 * needs fail-closed moderation on the submit route, a server-encrypted message
 * envelope, and a matching bump to the TEE `/resolve` contract.
 */
export const LANE_CARRIES_SENDER_TEXT: Record<SendLane, boolean> = {
	mailto_direct: true,
	mailto_congressional_relay: true,
	cwc_zkp: false
};

/** Will the words this sender types reach the recipient on the lane they are on? */
export function laneCarriesSenderText(template: SendLaneTemplate, user: unknown | null): boolean {
	return LANE_CARRIES_SENDER_TEXT[resolveSendLane(template, user)];
}

/**
 * What a sender is told when their own words meet a lane that cannot carry them.
 *
 * The sentence lives beside the decision it explains. Three surfaces say it — the
 * modal's last-resort guard, the send button's refusal, and the notice raised when
 * a note stored before the lane changed is discarded — and a sentence copied into
 * three files is a sentence that ends up meaning three different things.
 *
 * It names the alternative rather than only the refusal: the same words go through
 * on the email lane, which is a real option, not a consolation.
 */
export const SENDER_TEXT_NOT_CARRIED_REASON =
	'Official delivery sends the campaign letter exactly as written, so your added note cannot travel with it. Clear the note to send officially, or send by email instead.';

/**
 * The letter as this sender must see it, given the lane.
 *
 * On a carrying lane the author's sender-fill slots stay put — they are the
 * affordance. On a lane that cannot carry them, they are erased here through the
 * same table and the same resolver the send path uses, so what the sender reads
 * is byte-for-byte what the recipient receives: no editable card inviting words
 * that go nowhere, and no inert chip left behind bearing the slot's own name.
 *
 * Erasing at the text level rather than dropping parsed segments is what makes
 * that byte-identity hold: the erasure has to take the placeholder's line and
 * close the gap the same way the send path does, which a per-segment drop cannot.
 */
export function senderVisibleLetter(
	template: SendLaneTemplate,
	user: unknown | null,
	text: string
): string {
	if (laneCarriesSenderText(template, user)) return text;
	return resolvePlaceholders(text, manualFillReplacements());
}
