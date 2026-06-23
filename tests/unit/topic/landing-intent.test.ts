import { describe, it, expect } from 'vitest';
import { selectLandingIntent } from '$lib/core/topic/landing-intent';

/**
 * The landing can be entered with one of two intents over the same writing
 * surface: AUTHOR a new campaign (the default front door — write-new) or FIND an
 * existing campaign to join (the explicit opt-in at `?intent=find`). The author
 * default is also reachable explicitly at `?intent=author`. `selectLandingIntent`
 * is the pure rule the page derives that choice from — a function of the URL
 * alone — and is orthogonal to the landing surface (`?view=`). These tests
 * exercise the REAL function over real URLs, so they catch behavioural drift (a
 * moved default, a flipped opt-in, a precedence change) rather than pinning
 * source text.
 */

/** The intent the page opens on for a given path+query, via the real util. */
function intent(href: string) {
	return selectLandingIntent(new URL(href, 'https://commons.email'));
}

describe('selectLandingIntent', () => {
	it('authors a new campaign by default (the bare landing path)', () => {
		expect(intent('/')).toBe('author');
	});

	it('opens find-existing on the explicit opt-in (?intent=find)', () => {
		expect(intent('/?intent=find')).toBe('find');
	});

	it('keeps author on its explicit selector (?intent=author, same as default)', () => {
		expect(intent('/?intent=author')).toBe('author');
	});

	it('treats the opt-in as case-sensitive (?intent=Find falls through to author)', () => {
		expect(intent('/?intent=Find')).toBe('author');
	});

	it('resolves an empty or unrecognised intent value to the author default', () => {
		expect(intent('/?intent=')).toBe('author');
		expect(intent('/?intent=nonsense')).toBe('author');
	});

	it('keeps the author default for an unrelated parameter', () => {
		expect(intent('/?template=restore-clinic-hours')).toBe('author');
	});

	it('resolves the find opt-in independently of the surface (?view=graph&intent=find)', () => {
		expect(intent('/?view=graph&intent=find')).toBe('find');
	});
});
