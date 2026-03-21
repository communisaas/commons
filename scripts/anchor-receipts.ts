/**
 * Anchor Receipts CLI
 *
 * Batches unanchored accountability receipts into Merkle trees
 * and stores the root hash. IPFS pinning added in Phase 4.
 *
 * Note: Merkle tree logic mirrors src/lib/server/legislation/receipts/anchor.ts
 * but is duplicated here because CLI scripts can't import SvelteKit $lib/ paths.
 * Keep both in sync when modifying tree construction.
 *
 * Usage: npx tsx scripts/anchor-receipts.ts
 */

import { PrismaClient } from '@prisma/client';

// Note: this runs in Node.js (not CF Workers), so we can use PrismaClient directly
const db = new PrismaClient();

async function sha256Hex(input: string): Promise<string> {
	const encoded = new TextEncoder().encode(input);
	const hash = await crypto.subtle.digest('SHA-256', encoded);
	return Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function main() {
	console.log('[anchor] Starting receipt anchoring...');

	// Find unanchored actioned receipts
	const unanchored = await db.accountabilityReceipt.findMany({
		where: {
			status: 'actioned',
			anchorRoot: null
		},
		select: {
			id: true,
			attestationDigest: true,
			billId: true
		},
		orderBy: { createdAt: 'asc' }
	});

	if (unanchored.length === 0) {
		console.log('[anchor] No unanchored receipts found');
		return;
	}

	console.log(`[anchor] Found ${unanchored.length} unanchored receipts`);

	// Group by bill
	const byBill = new Map<string, typeof unanchored>();
	for (const r of unanchored) {
		if (!byBill.has(r.billId)) byBill.set(r.billId, []);
		byBill.get(r.billId)!.push(r);
	}

	let totalAnchored = 0;

	for (const [billId, receipts] of byBill) {
		// Build Merkle tree for this bill's receipts
		const leaves = receipts.map((r) => r.attestationDigest);
		const paddedSize = Math.pow(2, Math.ceil(Math.log2(leaves.length)));
		const emptyHash = await sha256Hex('empty');

		let currentLevel = [...leaves];
		while (currentLevel.length < paddedSize) currentLevel.push(emptyHash);

		while (currentLevel.length > 1) {
			const next: string[] = [];
			for (let i = 0; i < currentLevel.length; i += 2) {
				next.push(await sha256Hex(currentLevel[i] + (currentLevel[i + 1] ?? emptyHash)));
			}
			currentLevel = next;
		}

		const root = currentLevel[0];
		console.log(
			`[anchor] Bill ${billId}: ${receipts.length} receipts, root=${root.slice(0, 16)}...`
		);

		// Update all receipts with the anchor root
		await db.accountabilityReceipt.updateMany({
			where: { id: { in: receipts.map((r) => r.id) } },
			data: { anchorRoot: root }
		});

		totalAnchored += receipts.length;
	}

	console.log(`[anchor] Anchored ${totalAnchored} receipts across ${byBill.size} bills`);
	await db.$disconnect();
}

main().catch((err) => {
	console.error('[anchor] Fatal error:', err);
	process.exit(1);
});
