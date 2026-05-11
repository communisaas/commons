/**
 * Trade Preimage Store — IndexedDB-backed persistence for commit-reveal preimages.
 *
 * In the commit-reveal trading scheme, the user submits a commitment hash during the
 * commit phase and must later reveal the preimage during the reveal phase. If the
 * preimage is lost, the trade is forfeit — the commitment cannot be opened.
 *
 * Two-store layout for backwards compatibility:
 *   • V1 (`commons-trade-preimages`) keyed by (debateId, epoch) — read-only, holds
 *     legacy records. Has a multi-wallet-on-same-device collision bug.
 *   • V2 (`commons-trade-preimages-v2`) keyed by (userAddress, debateId, epoch) —
 *     all new writes. Per-user isolation prevents collision and limits
 *     shared-device privacy leakage.
 *
 * SECURITY: Preimages are stored in plaintext in IndexedDB. Cryptographically the
 * data isn't adversarial — the commitment hash on-chain is already binding and the
 * nonce blocks third-party opening. But preimages reveal *trading intent* (direction,
 * argument, amount) before reveal, so a shared-device reader can learn another user's
 * position. V2 mitigates this by filtering on userAddress; V1 fallbacks remain for
 * legacy unrevealed commits and don't filter (drains over time as users reveal).
 *
 * BROWSER ONLY: This module uses IndexedDB and must not be imported from server code.
 *
 * @see DebateMarket.sol — commitTrade() and revealTrade()
 * @see debate-client.ts — clientCommitTrade() and clientRevealTrade()
 */

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Direction of a trade: BUY increases price, SELL decreases it. */
export type TradeDirection = 0 | 1; // 0 = BUY, 1 = SELL

/** The preimage data needed to reveal a committed trade. */
export interface TradePreimage {
    /** Owning wallet address, lowercased. Required on v2 records — undefined
     * indicates a legacy v1 record (still readable for reveal, but loses
     * shared-device isolation). */
    userAddress?: string;

    /** Debate identifier (bytes32, 0x-prefixed). */
    debateId: string;

    /** Epoch number the commitment was made in. */
    epoch: number;

    /** Index of the commitment within the epoch's commitment array. */
    commitIndex: number;

    /** Index of the argument being traded on. */
    argumentIndex: number;

    /** Trade direction: 0=BUY, 1=SELL. */
    direction: TradeDirection;

    /** Weighted amount (from debate-weight ZK proof). Stored as decimal string. */
    weightedAmount: string;

    /** Note commitment (from debate-weight ZK proof). bytes32, 0x-prefixed. */
    noteCommitment: string;

    /** Random nonce used in the commitment hash. bytes32, 0x-prefixed. */
    nonce: string;

    /** The commitment hash submitted on-chain. bytes32, 0x-prefixed. */
    commitHash: string;

    /** Transaction hash of the commit transaction. */
    commitTxHash: string;

    /** ISO timestamp when the preimage was stored. */
    storedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// INDEXEDDB HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const DB_NAME_V1 = 'commons-trade-preimages';
const DB_NAME_V2 = 'commons-trade-preimages-v2';
const DB_VERSION = 1;
const STORE_NAME = 'preimages';

/**
 * V1 store: keyPath ['debateId', 'epoch']. Read-only fallback for legacy
 * preimages that pre-date per-user keying. New writes always go to V2.
 *
 * Note: V1 has a known shared-device bug — User A and User B committing on
 * the same debate+epoch on the same device collide on the keyPath, with
 * the second write silently overwriting the first. V2 fixes this.
 */
function openDBV1(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        const request = indexedDB.open(DB_NAME_V1, DB_VERSION);
        request.onupgradeneeded = () => {
            // V1 store created here only if no prior install — legacy users keep their store
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: ['debateId', 'epoch'] });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
    });
}

/**
 * V2 store: keyPath ['userAddress', 'debateId', 'epoch']. Per-user isolation
 * lets multiple wallets on the same device commit on the same debate+epoch
 * without collision. Used for all new writes.
 */
function openDBV2(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME_V2, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, {
                    keyPath: ['userAddress', 'debateId', 'epoch'],
                });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Store a trade preimage after a successful commit transaction.
 *
 * Must be called immediately after the commitTrade transaction is confirmed
 * on-chain. The preimage is needed to reveal the trade in the next epoch's
 * reveal phase. If not stored, the trade is permanently forfeit.
 *
 * Always writes to V2 with `userAddress` populated from the wallet so that
 * multiple wallets on the same device can't collide on the keyPath.
 *
 * @param preimage - The full preimage data including userAddress, nonce, amounts, tx hash
 */
export async function storePreimage(preimage: TradePreimage): Promise<void> {
    if (!preimage.userAddress) {
        throw new Error('storePreimage requires userAddress (lowercased wallet address)');
    }
    const normalized: TradePreimage = {
        ...preimage,
        userAddress: preimage.userAddress.toLowerCase(),
    };
    const db = await openDBV2();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(normalized);
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Retrieve a stored preimage for a specific debate and epoch.
 *
 * Tries V2 (per-user keyed) first, falls back to V1 for legacy preimages
 * that pre-date per-user keying. Returns `null` if no preimage exists.
 *
 * @param debateId - Debate identifier (bytes32)
 * @param epoch - Epoch number
 * @param userAddress - Owning wallet address (lowercased)
 * @returns The stored preimage, or null
 */
export async function getPreimage(
    debateId: string,
    epoch: number,
    userAddress: string
): Promise<TradePreimage | null> {
    const lowered = userAddress.toLowerCase();
    const dbV2 = await openDBV2();
    const v2Result = await new Promise<TradePreimage | null>((resolve, reject) => {
        const tx = dbV2.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get([lowered, debateId, epoch]);
        request.onsuccess = () => {
            dbV2.close();
            resolve(request.result ?? null);
        };
        request.onerror = () => {
            dbV2.close();
            reject(request.error);
        };
    });
    if (v2Result) return v2Result;

    // Fallback: legacy V1 store. Legacy records have no userAddress, so we can't
    // verify ownership — but reveal flow on-chain rejects mismatched commitments,
    // so a wrong-user reveal attempt fails harmlessly at the contract.
    const dbV1 = await openDBV1();
    if (!dbV1) return null;
    return new Promise((resolve, reject) => {
        const tx = dbV1.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get([debateId, epoch]);
        request.onsuccess = () => {
            dbV1.close();
            resolve(request.result ?? null);
        };
        request.onerror = () => {
            dbV1.close();
            reject(request.error);
        };
    });
}

/**
 * Clear a preimage after successful reveal.
 *
 * Deletes from BOTH V1 and V2 stores (preimage may live in either depending
 * on commit-time vintage). Idempotent: missing keys are no-ops.
 *
 * @param debateId - Debate identifier (bytes32)
 * @param epoch - Epoch number
 * @param userAddress - Owning wallet address (lowercased)
 */
export async function clearPreimage(
    debateId: string,
    epoch: number,
    userAddress: string
): Promise<void> {
    const lowered = userAddress.toLowerCase();
    const dbV2 = await openDBV2();
    await new Promise<void>((resolve, reject) => {
        const tx = dbV2.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete([lowered, debateId, epoch]);
        tx.oncomplete = () => {
            dbV2.close();
            resolve();
        };
        tx.onerror = () => {
            dbV2.close();
            reject(tx.error);
        };
    });

    const dbV1 = await openDBV1();
    if (!dbV1) return;
    await new Promise<void>((resolve, reject) => {
        const tx = dbV1.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete([debateId, epoch]);
        tx.oncomplete = () => {
            dbV1.close();
            resolve();
        };
        tx.onerror = () => {
            dbV1.close();
            reject(tx.error);
        };
    });
}

/**
 * Get all pending (unrevealed) preimages for a specific debate, scoped to one user.
 *
 * Used to display pending commitments in the UI and alert the user that they
 * need to reveal during the next reveal phase. Unions V2 (filtered by
 * userAddress) and V1 (legacy, owner unknown — included so revealing legacy
 * commits remains possible). Caller is the local-device principal.
 *
 * @param debateId - Debate identifier (bytes32)
 * @param userAddress - Owning wallet address (lowercased)
 * @returns Array of preimages for this debate (may be empty)
 */
export async function getPendingPreimages(
    debateId: string,
    userAddress: string
): Promise<TradePreimage[]> {
    const lowered = userAddress.toLowerCase();
    const dbV2 = await openDBV2();
    const v2Records = await new Promise<TradePreimage[]>((resolve, reject) => {
        const tx = dbV2.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            dbV2.close();
            const all = (request.result ?? []) as TradePreimage[];
            resolve(all.filter((p) => p.debateId === debateId && p.userAddress === lowered));
        };
        request.onerror = () => {
            dbV2.close();
            reject(request.error);
        };
    });

    const dbV1 = await openDBV1();
    if (!dbV1) return v2Records;
    const v1Records = await new Promise<TradePreimage[]>((resolve, reject) => {
        const tx = dbV1.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => {
            dbV1.close();
            const all = (request.result ?? []) as TradePreimage[];
            resolve(all.filter((p) => p.debateId === debateId));
        };
        request.onerror = () => {
            dbV1.close();
            reject(request.error);
        };
    });
    return [...v2Records, ...v1Records];
}
