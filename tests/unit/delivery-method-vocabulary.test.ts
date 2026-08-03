/**
 * One vocabulary for the persisted template delivery method.
 *
 * A template's `deliveryMethod` column decides whether a message goes to
 * Congress. Before this collapse the column was an open string and eight
 * different call sites each decided for themselves what counted as
 * congressional — some accepted 'certified', some only 'cwc' — so a single
 * stored value could be congressional to the resolver and direct to the send
 * lane.
 *
 * The seam that stops that regrowing is three-layered: the column is closed by
 * the schema, the single writer refuses anything outside the set, and the
 * question "is this congressional?" has one implementation.
 *
 * The load-bearing block below is the cross-module agreement one. A grep over
 * source text proves only that the words match; running three independent
 * modules over the same template and demanding one boolean proves the BEHAVIOUR
 * matches. The source guard is the backstop that catches a reintroduced private
 * copy, not the proof.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The POST handler pulls in the whole authoring pipeline. Only the outbound
// dependencies are replaced; the validator under test runs for real, and it
// runs before any of them, which is the point being proved.
vi.mock('convex-sveltekit', () => ({ serverQuery: vi.fn(), serverMutation: vi.fn() }));
vi.mock('$lib/core/server/moderation', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/core/server/moderation')>();
	return { ...actual, moderateTemplate: vi.fn() };
});
vi.mock('$lib/core/search/gemini-embeddings', () => ({ generateBatchEmbeddings: vi.fn() }));
vi.mock('$lib/utils/domain-hue-projection', () => ({ projectToHue: vi.fn() }));
vi.mock('$lib/server/internal/secret-auth', () => ({
	getInternalSecret: vi.fn(() => 'delivery-vocabulary-test-secret')
}));
vi.mock('$lib/server/llm-cost-protection', () => ({
	enforceLLMRateLimit: vi.fn(),
	rateLimitResponse: vi.fn()
}));

import { POST } from '../../src/routes/api/templates/+server';
import {
	TEMPLATE_DELIVERY_METHODS,
	isCongressionalDelivery,
	isTemplateDeliveryMethod,
	templateDeliveryMethodForChannel,
	type TemplateDeliveryMethod
} from '$convex/lib/templateDeliveryMethod';
import { isValidTemplate, resolveTemplate } from '$lib/utils/templateResolver';
import { resolveSendLane } from '$lib/services/send-lane';
import { deriveTargetPresentation } from '$lib/utils/deriveTargetPresentation';
import type { EmailFlowTemplate, Template } from '$lib/types/template';
import type { EmailServiceUser } from '$lib/types/user';

// Vitest runs from the repo root (vitest.config.ts lives there).
const REPO_ROOT = process.cwd();
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8');

/** Values that were storable before the collapse and must never be again. */
const RETIRED = ['certified', 'direct', 'email_attested', 'auth'] as const;

function templateWith(deliveryMethod: string): EmailFlowTemplate {
	return {
		id: 'transit-funding',
		slug: 'transit-funding',
		title: 'Fund the crosstown bus',
		description: 'The crosstown route has been cut twice this year.',
		deliveryMethod,
		message_body: 'Dear [Representative Name],\n\nPlease restore the crosstown route.',
		preview: 'Please restore the crosstown route.',
		recipient_config: { emails: [] }
	};
}

const SENDER: EmailServiceUser = {
	id: 'sender-1',
	name: 'Dana Reyes',
	email: 'dana@example.com',
	street: '14 Larch St',
	city: 'Oakland',
	state: 'CA',
	zip: '94607'
};

// ── (a) The runtime vocabulary ───────────────────────────────────────────────

describe('the stored vocabulary', () => {
	it('is exactly cwc and email', () => {
		expect([...TEMPLATE_DELIVERY_METHODS]).toEqual(['cwc', 'email']);
	});

	it('accepts every member', () => {
		for (const method of TEMPLATE_DELIVERY_METHODS) {
			expect(isTemplateDeliveryMethod(method)).toBe(true);
		}
	});

	it('rejects every retired value, the empty string, and non-strings', () => {
		for (const retired of RETIRED) {
			expect(isTemplateDeliveryMethod(retired), `${retired} must not be storable`).toBe(false);
		}
		expect(isTemplateDeliveryMethod('')).toBe(false);
		for (const notAString of [undefined, null, 0, 1, true, {}, [], ['cwc']]) {
			expect(isTemplateDeliveryMethod(notAString)).toBe(false);
		}
	});

	it('calls only cwc congressional', () => {
		expect(isCongressionalDelivery('cwc')).toBe(true);
		expect(isCongressionalDelivery('email')).toBe(false);
		for (const retired of RETIRED) {
			expect(isCongressionalDelivery(retired), `${retired} is not congressional`).toBe(false);
		}
		for (const notAString of [undefined, null, 0, true, {}]) {
			expect(isCongressionalDelivery(notAString)).toBe(false);
		}
	});
});

// ── (b) The authoring surfaces agree with the column ─────────────────────────

describe('authoring channels map into the stored vocabulary', () => {
	const CHANNELS = ['direct', 'certified', 'cwc', 'email_attested'] as const;

	it.each(CHANNELS)('channel %s yields a storable value for either audience', (channelId) => {
		for (const includesCongress of [true, false]) {
			const stored = templateDeliveryMethodForChannel(channelId, { includesCongress });
			expect(
				isTemplateDeliveryMethod(stored),
				`${channelId} + includesCongress=${includesCongress} produced ${stored}`
			).toBe(true);
		}
	});

	it('the certified channel stores cwc, never a retired label of its own', () => {
		expect(templateDeliveryMethodForChannel('certified', { includesCongress: false })).toBe('cwc');
		expect(templateDeliveryMethodForChannel('certified', { includesCongress: true })).toBe('cwc');
	});

	it('a non-congressional channel follows the audience toggle', () => {
		expect(templateDeliveryMethodForChannel('direct', { includesCongress: true })).toBe('cwc');
		expect(templateDeliveryMethodForChannel('direct', { includesCongress: false })).toBe('email');
	});

	it('an absent channel still resolves', () => {
		expect(templateDeliveryMethodForChannel(undefined, {})).toBe('email');
		expect(templateDeliveryMethodForChannel(null, { includesCongress: true })).toBe('cwc');
	});
});

// ── (c) Cross-module runtime agreement — the load-bearing block ──────────────

describe('one template, three modules, one congressional answer', () => {
	it.each([...TEMPLATE_DELIVERY_METHODS])(
		'%s resolves the same way in the resolver, the send lane, and the target presentation',
		(method: TemplateDeliveryMethod) => {
			const expected = isCongressionalDelivery(method);
			const template = templateWith(method);

			// The resolver mints a congressional routing address, or does not.
			const resolved = resolveTemplate(template, SENDER);
			expect(resolved.routingEmail !== undefined, 'resolver routingEmail').toBe(expected);
			expect(resolved.isCongressional, 'resolver isCongressional').toBe(expected);

			// The send lane leaves the direct mailto path, or does not. Checked for
			// both sender states because the congressional split on authentication
			// must not change the congressional ANSWER, only the lane within it.
			expect(resolveSendLane(template, SENDER) !== 'mailto_direct', 'lane, signed in').toBe(
				expected
			);
			expect(resolveSendLane(template, null) !== 'mailto_direct', 'lane, guest').toBe(expected);

			// The presentation shows the federal power level, or does not. No
			// cwcRouting in the config, so the template column is the only input.
			const presentation = deriveTargetPresentation({
				...template,
				deliveryMethod: method,
				recipient_config: {}
			} as unknown as Template);
			const presentedAsCongressional =
				'emphasis' in presentation && presentation.emphasis === 'federal';
			expect(presentedAsCongressional, 'target presentation').toBe(expected);
		}
	);

	it('the per-recipient cwcRouting flag stays a separate question', () => {
		// An email template whose config routes a specific recipient through CWC
		// still stores 'email'. The presentation may surface the federal level;
		// the stored vocabulary is unmoved, which is exactly the boundary the
		// shared module refuses to absorb.
		const template = { ...templateWith('email'), recipient_config: { cwcRouting: true } };
		expect(isCongressionalDelivery(template.deliveryMethod)).toBe(false);
		expect(resolveSendLane(template, SENDER)).toBe('mailto_direct');
	});
});

// ── The HTTP boundary refuses before anything downstream runs ────────────────

function postEvent(template: Record<string, unknown>) {
	return {
		request: new Request('https://commons.email/api/templates', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(template)
		}),
		locals: {
			user: { id: 'user_1', is_verified: false, trust_score: 100 },
			session: { userId: 'user_1' }
		}
	} as never;
}

const POSTABLE_TEMPLATE = {
	title: 'Fund the crosstown bus',
	message_body: 'Please restore the crosstown route.',
	preview: 'Please restore the crosstown route.',
	type: 'petition'
};

describe('POST /api/templates admits only the stored vocabulary', () => {
	it.each(RETIRED)('rejects %s with a field error, not a downstream failure', async (retired) => {
		const response = await POST(
			postEvent({ ...POSTABLE_TEMPLATE, deliveryMethod: retired })
		);

		// 400 with a named field, not a 500 surfaced from Convex after the request
		// has already spent moderation and embedding capacity.
		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			success: boolean;
			errors?: Array<{ field?: string; code?: string; message?: string }>;
		};
		expect(body.success).toBe(false);
		const failure = body.errors?.find((entry) => entry.field === 'deliveryMethod');
		expect(failure, `no deliveryMethod error for ${retired}`).toBeDefined();
		expect(failure?.message).toContain('cwc');
		expect(failure?.message).toContain('email');
	});

	it('still rejects a missing delivery method as required', async () => {
		const response = await POST(postEvent({ ...POSTABLE_TEMPLATE }));
		expect(response.status).toBe(400);
		const body = (await response.json()) as {
			errors?: Array<{ field?: string; code?: string }>;
		};
		expect(body.errors?.some((entry) => entry.field === 'deliveryMethod')).toBe(true);
	});
});

// ── (d) The closed set is what template validation accepts ───────────────────

describe('template validation admits exactly the stored vocabulary', () => {
	it.each([...TEMPLATE_DELIVERY_METHODS])('accepts %s', (method) => {
		expect(isValidTemplate(templateWith(method))).toBe(true);
	});

	it.each(RETIRED)('rejects the retired value %s', (retired) => {
		expect(isValidTemplate(templateWith(retired))).toBe(false);
	});
});

// ── (e) Source guard: no private copy of the vocabulary regrows ──────────────

describe('single-vocabulary source guard', () => {
	const CONSUMERS = [
		'src/lib/utils/templateResolver.ts',
		'src/lib/services/send-lane.ts',
		'src/lib/services/emailService.ts',
		'src/lib/utils/deriveTargetPresentation.ts',
		'src/lib/components/template/TemplateModal.svelte',
		'src/lib/components/template/TemplateCreator.svelte',
		'src/lib/components/layout/MobileBottomBar.svelte',
		'src/lib/components/template/parts/ProgressiveFormContent.svelte',
		'src/routes/+page.svelte',
		'src/routes/api/templates/+server.ts',
		'src/routes/template-modal/[slug]/+page.server.ts',
		'src/routes/s/[slug]/+layout.server.ts'
	];

	const RETIRED_MARKERS = [
		"deliveryMethod === 'certified'",
		"deliveryMethod === 'direct'",
		"deliveryMethod === 'auth'",
		"deliveryMethod === 'email_attested'",
		// The retired five-value admission list, in the shape it was written.
		"'email', 'email_attested', 'certified', 'direct', 'cwc'",
		// The retired channel→method ternary, in the shape both authoring
		// surfaces wrote it.
		"'certified'\n\t\t\t\t\t? 'cwc'"
	];

	it.each(CONSUMERS)('%s decides congressional delivery nowhere of its own', (path) => {
		const source = read(path);
		for (const marker of RETIRED_MARKERS) {
			expect(source.includes(marker), `${path} must not contain ${JSON.stringify(marker)}`).toBe(
				false
			);
		}
	});

	it.each(CONSUMERS)('%s imports the shared vocabulary', (path) => {
		expect(read(path)).toContain('$convex/lib/templateDeliveryMethod');
	});

	it('the slug customizer no longer computes a delivery method at all', () => {
		// Two authoring surfaces cannot disagree when only one of them decides.
		// The slug check never read the value; it was a second, divergent copy.
		expect(read('src/lib/components/template/creator/SlugCustomizer.svelte')).not.toContain(
			'deliveryMethod'
		);
		// The prior slug collapse must survive: the canonicalizer is still shared.
		expect(read('src/lib/components/template/creator/SlugCustomizer.svelte')).toContain(
			'$convex/lib/templateInputBudget'
		);
	});

	it('the schema column is closed to exactly the shared table', () => {
		const schema = read('convex/schema.ts');
		const line = schema
			.split('\n')
			.find((candidate) => /^\s*deliveryMethod:\s*v\.union\(/.test(candidate));
		expect(line, 'templates.deliveryMethod must be a closed union').toBeDefined();
		const literals = [...(line as string).matchAll(/v\.literal\('([^']+)'\)/g)].map((m) => m[1]);
		// Parsed, not pattern-matched: a value added to the table without the
		// schema (or the reverse) fails here rather than diverging in silence.
		expect(literals).toEqual([...TEMPLATE_DELIVERY_METHODS]);
	});

	it('the single writer refuses anything outside the vocabulary', () => {
		const templates = read('convex/templates.ts');
		expect(templates).toContain("from './lib/templateDeliveryMethod'");
		expect(templates).toContain('INVALID_DELIVERY_METHOD');
		// The refusal must precede the one product insert, or it guards nothing.
		expect(templates.indexOf('INVALID_DELIVERY_METHOD')).toBeLessThan(
			templates.indexOf("ctx.db.insert('templates'")
		);
	});

	it('the shared module imports nothing, so both runtimes can load it', () => {
		const module = read('convex/lib/templateDeliveryMethod.ts');
		expect(module).not.toMatch(/^\s*import\s/m);
		expect(module).not.toMatch(/\brequire\(/);
	});
});
