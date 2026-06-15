/**
 * Landing surface selection.
 *
 * The landing page offers two browsing worlds over the same templates: the
 * hue-ordered topical landscape (the default) and the flat geographic list (a
 * working fallback kept reachable without a code change). Which one shows is
 * derived purely from the `spectrum` URL parameter, so the choice is a function
 * of the URL alone — addressable, shareable, and testable without rendering the
 * page.
 *
 * The rule: the landscape is the default, and the list opens ONLY on an explicit
 * `spectrum=0`. Any other value (or no parameter) resolves to the landscape, so
 * the default cannot silently move and a typo never strands the visitor on the
 * fallback.
 */
export function shouldShowSpectrum(url: URL): boolean {
	return url.searchParams.get('spectrum') !== '0';
}
