/**
 * Webhook event-catalog parity — the permanent drift-guard for A4.
 *
 * The advertised webhook catalog (WEBHOOK_EVENTS) must equal the set of events
 * actually emitted via `queueEvent` across convex/. This test goes RED the
 * instant a 9th catalog entry is added with no emitter, an emit string is
 * typo'd, or one of the wired emits is deleted — the exact drift class that
 * left 4 events subscribable-but-inert before A4.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_SET } from '../../../convex/_webhookEvents';

const CONVEX = join(process.cwd(), 'convex');

function readConvexSource(): string {
	return readdirSync(CONVEX)
		.filter((f) => f.endsWith('.ts') && f !== '_webhookEvents.ts')
		.map((f) => readFileSync(join(CONVEX, f), 'utf8'))
		.join('\n');
}

// Every queueEvent call literal across convex/ (the emit-set). `event:` always
// precedes `payload:` in these calls, so the first event literal within a short
// window after `queueEvent` is the emitted event.
function extractEmitSet(source: string): Set<string> {
	const out = new Set<string>();
	const re = /queueEvent[\s\S]{0,160}?event:\s*'([^']+)'/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(source)) !== null) out.add(m[1]);
	return out;
}

describe('webhook event-catalog parity', () => {
	const source = readConvexSource();
	const emitSet = extractEmitSet(source);

	it('the canonical catalog is exactly the expected 8 events', () => {
		expect([...WEBHOOK_EVENTS].sort()).toEqual(
			[
				'campaign.updated',
				'campaign_action.created',
				'donation.completed',
				'donation.refunded',
				'event.rsvp_created',
				'supporter.created',
				'supporter.deleted',
				'supporter.updated'
			].sort()
		);
	});

	it('webhook.test is NOT a subscribable catalog event', () => {
		expect(WEBHOOK_EVENT_SET.has('webhook.test')).toBe(false);
	});

	it('every advertised event is actually emitted (no allowlisted-but-inert event)', () => {
		const missing = [...WEBHOOK_EVENTS].filter((e) => !emitSet.has(e));
		expect(missing).toEqual([]);
	});

	it('every emitted event is in the catalog (no orphan/typo emit)', () => {
		const orphan = [...emitSet].filter((e) => !WEBHOOK_EVENT_SET.has(e));
		expect(orphan).toEqual([]);
	});

	it('both validators derive from the canonical set, not a private copy', () => {
		for (const file of ['orgWebhooks.ts', 'v1api.ts']) {
			const text = readFileSync(join(CONVEX, file), 'utf8');
			expect(text).toContain('WEBHOOK_EVENT_SET');
			// The hand-written 8-string Set is gone — a catalog literal no longer
			// appears in the validator files (only in _webhookEvents.ts + emit sites).
			expect(text).not.toContain("'supporter.updated'");
		}
	});

	it('every advertising surface lists exactly the canonical 8', () => {
		const surfaces = [
			'src/lib/server/api-v1/openapi.ts',
			'src/lib/components/org/SignalWell.svelte',
			'src/routes/org/[slug]/settings/webhooks/+page.svelte'
		];
		for (const rel of surfaces) {
			const text = readFileSync(join(process.cwd(), rel), 'utf8');
			for (const event of WEBHOOK_EVENTS) {
				expect(text, `${rel} missing ${event}`).toContain(event);
			}
		}
	});
});
