/**
 * The sender's own words survive the trip to the recipient — on every lane.
 *
 * A campaign letter carries an author-placed `[Personal Connection]` slot. The
 * preview renders the sender's typed characters at that slot, so the letter they
 * read is the letter with their words inside it. These tests state that letter as
 * a literal the test owns, then parse the recipient side back out of each lane's
 * `mailto:` URL and demand the literal be in there. Nothing here asks product
 * code what it expects; that would pass no matter which way the two drifted.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	analyzeEmailFlow,
	assembleMailto,
	buildSuppressionZone,
	generateMailtoUrl
} from '$lib/services/emailService';
import { resolveTemplate } from '$lib/utils/templateResolver';
import { moderatePersonalConnection } from '$lib/utils/personal-connection';
import { buildAttestation, type VerificationMethod } from '$lib/core/identity/tier-display';
import type { EmailServiceUser } from '$lib/types/user';
import type { EmailFlowTemplate } from '$lib/types/template';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** The recipient side, read only off the URL — never off the inputs that built it. */
function recipientBody(url: string): string {
	return decodeURIComponent(new URL(url).search.match(/[?&]body=([^&]*)/)![1]);
}

// Test-owned literals. SENDER_VISIBLE is the letter the preview shows: the body
// with the typed characters standing where the author put the placeholder.
const TYPED = 'My son waited eleven months for a hearing aid.';
const BODY = 'Dear official,\n\n[Personal Connection]\n\nPlease act.\n\n[Name]';
const SENDER_VISIBLE =
	'Dear official,\n\nMy son waited eleven months for a hearing aid.\n\nPlease act.';
const DISTRICT = 'CA-12';

const directTemplate: EmailFlowTemplate = {
	id: 'hearing-aid-wait',
	slug: 'hearing-aid-wait',
	title: 'Cut the hearing aid wait',
	description: 'A test template',
	deliveryMethod: 'email',
	message_body: BODY,
	recipient_config: { emails: ['official@example.test'] }
};

const congressionalTemplate: EmailFlowTemplate = {
	...directTemplate,
	id: 'hearing-aid-wait-cwc',
	slug: 'hearing-aid-wait-cwc',
	deliveryMethod: 'cwc',
	recipient_config: { emails: [] }
};

const sender: EmailServiceUser = {
	id: 'u1',
	email: 'ada@example.test',
	name: 'Ada Lovelace',
	street: '1 Main St',
	city: 'Springfield',
	state: 'CA',
	zip: '90210',
	is_verified: true,
	verification_method: 'civic_api'
};

/**
 * The two `/s/[slug]` sends compose inline inside the route component, so they
 * cannot be called without mounting it. These helpers run the route's own
 * recipe — the real resolver, the real attestation builder, the real assembly —
 * so the lane tests below still read a genuine `mailto:` URL rather than a
 * hand-joined string. The recipe is reproduced, so it is also pinned: see
 * `the detail page hands the assembly the zones these lanes reproduce`.
 */
function detailPageSingleAssembly() {
	const resolved = resolveTemplate(directTemplate, sender, { personalConnection: TYPED });
	const attestation =
		buildAttestation({
			trustTier: 2,
			method: sender.verification_method as VerificationMethod,
			districtCode: DISTRICT,
			credentialHash: null
		}).block ?? undefined;

	const assembly = assembleMailto({
		recipients: ['member@example.test'],
		subject: directTemplate.title,
		zones: {
			body: resolved.body.replace(/\[District\]/g, DISTRICT),
			attestation,
			// The route always names this zone; it is empty here because these
			// fixtures mint no server-side do-not-contact URLs.
			suppression: buildSuppressionZone([{ email: 'member@example.test' }])
		}
	});
	if (!assembly.ok) throw new Error(assembly.message);
	return assembly;
}

function detailPageBatchAssembly() {
	const resolved = resolveTemplate(directTemplate, sender, { personalConnection: TYPED });
	const attestation =
		buildAttestation({
			trustTier: 2,
			method: sender.verification_method as VerificationMethod,
			districtCode: DISTRICT,
			credentialHash: null
		}).block ?? undefined;

	const recipients = ['one@example.test', 'two@example.test', 'three@example.test'];
	const assembly = assembleMailto({
		recipients,
		subject: directTemplate.title,
		zones: {
			body: resolved.body.replace(/\[District\]/g, DISTRICT).trim(),
			attestation,
			// See above: named, and empty without minted URLs.
			suppression: buildSuppressionZone(recipients.map((email) => ({ email })))
		}
	});
	if (!assembly.ok) throw new Error(assembly.message);
	return assembly;
}

describe('the words the sender read reach the recipient', () => {
	it('the flow entry point carries them at the author placeholder', () => {
		const flow = analyzeEmailFlow(directTemplate, sender, {
			trustTier: 2,
			personalConnection: TYPED
		});

		expect(flow.error).toBeUndefined();
		const body = recipientBody(flow.mailtoUrl as string);
		expect(body).toContain(SENDER_VISIBLE);
		expect(body).not.toContain('[Personal Connection]');
	});

	it('the direct-recipient assembly carries them', () => {
		const result = generateMailtoUrl(directTemplate, sender, { personalConnection: TYPED });

		expect(result.error).toBeUndefined();
		const body = recipientBody(result.url as string);
		expect(body).toContain(SENDER_VISIBLE);
		expect(body).not.toContain('[Personal Connection]');
	});

	it('the congressional relay assembly carries them', () => {
		const result = generateMailtoUrl(congressionalTemplate, sender, {
			trustTier: 2,
			personalConnection: TYPED
		});

		expect(result.error).toBeUndefined();
		const body = recipientBody(result.url as string);
		expect(body).toContain(SENDER_VISIBLE);
		expect(body).not.toContain('[Personal Connection]');
	});

	it('the detail page single composition carries them', () => {
		const body = recipientBody(detailPageSingleAssembly().url);

		expect(body).toContain(SENDER_VISIBLE);
		expect(body).not.toContain('[Personal Connection]');
	});

	it('the detail page batch composition carries them', () => {
		const body = recipientBody(detailPageBatchAssembly().url);

		expect(body).toContain(SENDER_VISIBLE);
		expect(body).not.toContain('[Personal Connection]');
	});

	it('the detail page batch composition places them at the slot, not above the letter', () => {
		// A prepend put the sender's words above the salutation. The claim is made
		// against what left in the URL, not against a string the test joined.
		const body = recipientBody(detailPageBatchAssembly().url);

		expect(body.startsWith(TYPED)).toBe(false);
		expect(body.startsWith('Dear official,')).toBe(true);
	});

	it('single and batch emit the same letter block for the same input', () => {
		// Two different sends — one addressee, then three, each resolved and
		// assembled on its own. Strip each one's own footer and the letter the
		// recipient reads must be the same characters on both lanes.
		const singleBody = recipientBody(detailPageSingleAssembly().url);
		const batchBody = recipientBody(detailPageBatchAssembly().url);

		expect(singleBody).toContain('\n\n---');
		expect(batchBody).toContain('\n\n---');

		// Same offset, or one lane stacked something ahead of the letter that the
		// other did not — a difference the block comparison below cannot see,
		// because it starts counting at the salutation.
		expect(singleBody.indexOf('Dear official,')).toBe(batchBody.indexOf('Dear official,'));

		const singleLetter = singleBody.slice(
			singleBody.indexOf('Dear official,'),
			singleBody.indexOf('\n\n---')
		);
		const batchLetter = batchBody.slice(
			batchBody.indexOf('Dear official,'),
			batchBody.indexOf('\n\n---')
		);

		expect(singleLetter).toContain(SENDER_VISIBLE);
		expect(singleLetter).toBe(batchLetter);
	});
});

describe('no bracket string ever reaches a recipient', () => {
	const manualFill = [
		'[Personal Connection]',
		'[Your Story]',
		'[Personal Story]',
		'[Phone]',
		'[Your Phone]',
		'[Your Experience]'
	];

	const bracketTemplate: EmailFlowTemplate = {
		...directTemplate,
		title: 'Cut the wait [Personal Connection]',
		message_body:
			'Dear official,\n\n[Personal Connection]\n\n[Your Story]\n[Personal Story]\n[Phone]\n' +
			'[Your Phone]\n[Your Experience]\n\nPlease act.\n\n[Name]\n[Address]'
	};

	it('a guest who typed nothing sends no placeholders, on the flow entry point', () => {
		const flow = analyzeEmailFlow(bracketTemplate, null, {});
		const body = recipientBody(flow.mailtoUrl as string);
		const subject = decodeURIComponent(
			new URL(flow.mailtoUrl as string).search.match(/[?&]subject=([^&]*)/)![1]
		);

		for (const placeholder of manualFill) {
			expect(body).not.toContain(placeholder);
			expect(subject).not.toContain(placeholder);
		}

		// The instructional rewrite for a guest is a different concern and survives.
		expect(body).toContain('[Your Name]');
		expect(body).toContain('[Your Address]');
	});

	it('a guest who typed nothing sends no placeholders, on the direct assembly', () => {
		const result = generateMailtoUrl(bracketTemplate, null, {});
		const body = recipientBody(result.url as string);

		for (const placeholder of manualFill) {
			expect(body).not.toContain(placeholder);
		}
		expect(body).toContain('[Your Name]');
	});

	it('an authenticated sender who typed nothing sends no placeholders', () => {
		const result = generateMailtoUrl(bracketTemplate, sender, {});
		const body = recipientBody(result.url as string);

		for (const placeholder of manualFill) {
			expect(body).not.toContain(placeholder);
		}
	});
});

describe('unapproved words never reach a mailto', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubFetch(impl: () => Promise<unknown>) {
		const fetchMock = vi.fn(impl);
		vi.stubGlobal('fetch', fetchMock);
		return fetchMock;
	}

	it('refuses when the sender is not authenticated to be moderated', async () => {
		stubFetch(async () =>
			new Response(JSON.stringify({ error: 'Authentication required' }), { status: 401 })
		);

		const result = await moderatePersonalConnection(TYPED);
		expect(result.approved).toBe(false);
		expect(result.approved === false && result.reason.length).toBeGreaterThan(0);
	});

	it('refuses a response that does not say approved', async () => {
		stubFetch(async () =>
			new Response(JSON.stringify({ summary: 'Flagged for review' }), { status: 200 })
		);

		const result = await moderatePersonalConnection(TYPED);
		expect(result.approved).toBe(false);
		expect(result.approved === false && result.reason).toBe('Flagged for review');
	});

	it('refuses when the check itself fails', async () => {
		stubFetch(async () => {
			throw new Error('network down');
		});

		const result = await moderatePersonalConnection(TYPED);
		expect(result.approved).toBe(false);
	});

	it('approves an explicit approval', async () => {
		stubFetch(async () => new Response(JSON.stringify({ approved: true }), { status: 200 }));

		expect(await moderatePersonalConnection(TYPED)).toEqual({ approved: true });
	});

	it('spends no request on text that does not exist', async () => {
		const fetchMock = stubFetch(async () => new Response('{}', { status: 200 }));

		expect(await moderatePersonalConnection('')).toEqual({ approved: true });
		expect(await moderatePersonalConnection('   \n\t ')).toEqual({ approved: true });
		expect(fetchMock).toHaveBeenCalledTimes(0);
	});
});

describe('one substitution point', () => {
	const SUBSTITUTION = /replace\(\/\\\[Personal Connection\\\]/;

	it('the sender-visible side is still the raw typed value at the placeholder', () => {
		// SENDER_VISIBLE above models what these two lines produce. If either moves,
		// the literal stops describing the preview and this suite proves nothing.
		expect(src('src/lib/components/template-browser/MessagePreview.svelte')).toContain(
			'{variableValues[segment.name]}'
		);

		const preview = src('src/lib/components/template-browser/parts/PreviewContent.svelte');
		expect(preview).toContain("e?.name === 'Personal Connection'");
		expect(preview).toContain("personalConnectionValue = e.value ?? ''");
	});

	it('no surface substitutes the placeholder itself', () => {
		const surfaces = [
			'src/routes/s/[slug]/+page.svelte',
			'src/lib/components/template/TemplateModal.svelte',
			'src/lib/services/emailService.ts',
			'src/lib/components/template-browser/parts/ActionBar.svelte'
		];

		for (const path of surfaces) {
			const text = src(path);
			expect(text).not.toMatch(SUBSTITUTION);
			expect(text).not.toContain("'[Personal Connection]'");
		}
	});

	it('the assembly offers no zone to carry the text out of position', () => {
		const service = src('src/lib/services/emailService.ts');
		const zones = service.slice(
			service.indexOf('export interface MailtoZones'),
			service.indexOf('export interface MailtoAssemblyInput')
		);

		expect(zones).not.toContain('personalConnection');
		expect(service).not.toContain('input.zones.personalConnection');
	});

	it('the detail page names the text and lets the resolver place it', () => {
		const page = src('src/routes/s/[slug]/+page.svelte');

		expect(page).toContain('personalConnection: personalConnectionValue');
		expect(page).toContain('await moderatePersonalConnection(');
		expect(page).not.toContain('templateWithPC');
		expect(page).not.toContain('import ActionBar');
	});

	it('the detail page hands the assembly the zones these lanes reproduce', () => {
		// Both `/s/[slug]` sends are inline in the route and cannot be invoked
		// without mounting the component, so the lane helpers above rebuild their
		// zone recipe. A zone that appears, moves, or disappears in the route has
		// to turn this file RED — otherwise the reconstruction quietly stops
		// standing for the product and the lanes prove nothing about it.
		const page = src('src/routes/s/[slug]/+page.svelte');

		const zoneKeysAt = (from: number) => {
			const open = page.indexOf('zones: {', from);
			return page
				.slice(open + 'zones: {'.length, page.indexOf('}', open))
				.split('\n')
				.map((line) => line.trim().match(/^(\w+)/)?.[1])
				.filter((key): key is string => key != null);
		};

		const single = page.indexOf('assembleMailto({');
		const batch = page.indexOf('assembleMailto({', single + 1);
		expect(single).toBeGreaterThan(-1);
		expect(batch).toBeGreaterThan(single);
		expect(page.indexOf('assembleMailto({', batch + 1)).toBe(-1);

		expect(zoneKeysAt(single)).toEqual(['body', 'attestation', 'suppression']);
		expect(zoneKeysAt(batch)).toEqual(['body', 'attestation', 'suppression']);
	});

	it('there is one moderation call site abstraction', () => {
		const callers = [
			'src/routes/s/[slug]/+page.svelte',
			'src/lib/components/template-browser/parts/ActionBar.svelte'
		];

		for (const path of callers) {
			expect(src(path)).not.toContain("fetch('/api/moderation/personalization'");
		}
		expect(src('src/lib/utils/personal-connection.ts')).toContain(
			"fetch('/api/moderation/personalization'"
		);
	});
});
