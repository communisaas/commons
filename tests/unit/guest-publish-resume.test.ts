/**
 * Guest publish → OAuth → resume.
 *
 * Publishing requires an account. The creator gates the guest at the publish
 * seam and hands off through the one guest-continuity contract the codebase
 * speaks: save the draft, redirect to `/auth/<provider>?returnTo=/?create=true&
 * resumeDraft=<id>`, then claim the ownerless draft on return.
 *
 * These are source-pin assertions (same idiom as
 * tests/unit/components/create-frontdoor-polish.test.ts): they lock the wiring
 * and the ordering that make the hand-off non-destructive.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const CREATOR_PATH = 'src/lib/components/template/TemplateCreator.svelte';
const HOME_PATH = 'src/routes/+page.svelte';
const OVERLAY_PATH = 'src/lib/components/template/creator/AuthGateOverlay.svelte';

const creator = src(CREATOR_PATH);
const home = src(HOME_PATH);
const overlay = src(OVERLAY_PATH);

describe('guest publish gate lives in the creator, before the draft is marked for deletion', () => {
	const handleSaveBody = (() => {
		const start = creator.indexOf('function handleSave()');
		expect(start).toBeGreaterThan(-1);
		const end = creator.indexOf('const progress = $derived.by(', start);
		expect(end).toBeGreaterThan(start);
		return creator.slice(start, end);
	})();

	it('gates the guest strictly before draftCleanupMode flips to delete', () => {
		const gateIndex = handleSaveBody.indexOf('showPublishAuthGate = true;');
		const cleanupIndex = handleSaveBody.indexOf("draftCleanupMode = 'delete'");

		expect(gateIndex).toBeGreaterThan(-1);
		expect(cleanupIndex).toBeGreaterThan(-1);
		// Marking the draft for deletion before gating would let onDestroy discard
		// the exact draft the hand-off exists to resume.
		expect(gateIndex).toBeLessThan(cleanupIndex);
	});

	it('the gate returns before dispatching onsave, so no guest publish skips OAuth', () => {
		const gateIndex = handleSaveBody.indexOf('if (isGuest) {');
		const dispatchIndex = handleSaveBody.indexOf('onsave?.(');
		expect(gateIndex).toBeGreaterThan(-1);
		expect(dispatchIndex).toBeGreaterThan(gateIndex);
		expect(handleSaveBody).toMatch(
			/if \(isGuest\) \{[\s\S]*?showPublishAuthGate = true;[\s\S]*?return;[\s\S]*?\}/
		);
	});

	it('reuses the live AuthGateOverlay rather than a second auth surface', () => {
		expect(creator).toContain('AuthGateOverlay');
		expect(creator).toContain('showPublishAuthGate');
		expect(creator).toContain('isGuest');
		expect(creator).toContain('{#if showPublishAuthGate}');
		expect(creator).toContain('{draftId}');
		expect(creator).toMatch(
			/\{#if showPublishAuthGate\}[\s\S]*?onSaveDraft=\{\(\) =>[\s\S]*?templateDraftStore\.saveDraft\(draftId,[\s\S]*?\/>/
		);
	});

	it('backing out of the gate keeps the work on screen', () => {
		const gateBlock = creator.slice(
			creator.indexOf('{#if showPublishAuthGate}'),
			creator.indexOf('{/if}', creator.indexOf('{#if showPublishAuthGate}'))
		);
		expect(gateBlock).toContain('onback={() => (showPublishAuthGate = false)}');
		expect(gateBlock).not.toContain('onclose');
		expect(gateBlock).not.toContain('formData =');
	});
});

describe('the hand-off is the single existing draft-resume mechanism', () => {
	it('the overlay saves the draft then redirects through the provider start route', () => {
		expect(overlay).toContain('onSaveDraft?.()');
		expect(overlay).toContain('create=true&resumeDraft=');
		expect(overlay).toContain('goto(`/auth/${provider}');
		// Persist strictly precedes the redirect.
		expect(overlay.indexOf('onSaveDraft?.()')).toBeLessThan(
			overlay.indexOf('goto(`/auth/${provider}')
		);
	});

	it('the landing page claims the resumed draft and feeds it back to the creator', () => {
		expect(home).toContain("searchParams.get('resumeDraft')");
		expect(home).toContain('claimGuestDraftForUser(resumeDraftId, userId)');
		expect(home).toContain('initialDraftId={resumeDraftId}');
	});

	it('the unauthenticated onsave branch is not silent', () => {
		const onsaveStart = home.indexOf('onsave={async (templateData) => {');
		expect(onsaveStart).toBeGreaterThan(-1);
		const elseIndex = home.indexOf('} else {', onsaveStart);
		expect(elseIndex).toBeGreaterThan(-1);
		const elseBranch = home.slice(elseIndex, home.indexOf('}}', elseIndex));

		expect(elseBranch).toContain('templateSaveError =');
		expect(elseBranch).not.toContain('goto(');
		expect(elseBranch).not.toContain('showTemplateCreator = false');
		expect(elseBranch).not.toContain('sessionStorage');
	});

	it('the page adds no second template write path', () => {
		expect(home).not.toContain("fetch('/api/templates'");
		expect(home).not.toContain('fetch(`/api/templates');
	});
});

describe('the orphaned publish-seam machinery is gone from the whole source tree', () => {
	const DEAD_SYMBOLS = [
		'showTemplateAuthModal',
		'pendingTemplateToSave',
		'handleTemplateCreatorAuth',
		'AuthEventDetail',
		'pending_template_save',
		'template_saved'
	];

	const TEXT_EXT = /\.(ts|js|svelte|json|md|css|html)$/;

	function walk(dir: string, out: string[] = []): string[] {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) {
				walk(full, out);
			} else if (TEXT_EXT.test(entry)) {
				out.push(full);
			}
		}
		return out;
	}

	it('no file under src/ mentions any of the dead symbols', () => {
		const files = walk(resolve(process.cwd(), 'src'));
		expect(files.length).toBeGreaterThan(100);

		const offenders: string[] = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			for (const symbol of DEAD_SYMBOLS) {
				if (text.includes(symbol)) offenders.push(`${file} :: ${symbol}`);
			}
		}

		expect(offenders).toEqual([]);
	});

	it('the landing page dropped the imports those symbols owned', () => {
		expect(home).not.toContain("from 'zod'");
		expect(home).not.toContain('navigateTo');
		// The surviving consumers of the shared imports are untouched.
		expect(home).toContain("import { isMobile } from '$lib/utils/browserUtils';");
		expect(home).toContain("import { AppError, ERROR_CODES } from '$lib/types/errors';");
	});
});
