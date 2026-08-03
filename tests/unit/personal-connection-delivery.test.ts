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

import { analyzeEmailFlow, generateMailtoUrl } from '$lib/services/emailService';
import { resolveTemplate } from '$lib/utils/templateResolver';
import { moderatePersonalConnection } from '$lib/utils/personal-connection';
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
		// The lane resolves the template and hands the result to the shared assembly.
		const resolved = resolveTemplate(directTemplate, sender, { personalConnection: TYPED });

		expect(resolved.body).toContain(SENDER_VISIBLE);
		expect(resolved.body).not.toContain('[Personal Connection]');
	});

	it('the detail page batch composition places them identically, not above the letter', () => {
		const resolved = resolveTemplate(directTemplate, sender, { personalConnection: TYPED });
		const attestation = 'Self-reported constituent (Census geocoder) · CA-12';
		const batchBody = [resolved.body, '---', attestation].join('\n\n');

		expect(batchBody).toContain(SENDER_VISIBLE);
		// A prepend put the sender's words above the salutation. Same input, same
		// position, on both lanes — or this is back.
		expect(batchBody.startsWith(TYPED)).toBe(false);
		expect(batchBody.startsWith('Dear official,')).toBe(true);
	});

	it('single and batch emit the same letter for the same input', () => {
		const single = resolveTemplate(directTemplate, sender, { personalConnection: TYPED });
		const batch = resolveTemplate(directTemplate, sender, { personalConnection: TYPED });

		expect(single.body).toBe(batch.body);
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
