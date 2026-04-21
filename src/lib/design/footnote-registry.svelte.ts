/**
 * Footnote Registry — reactive cross-component state for Cite footnotes.
 *
 * Artifact provides an instance via Svelte context.
 * Cite form="footnote" registers entries during initialization.
 * Artifact reads entries reactively and renders them at its bottom.
 */

export const FOOTNOTE_CTX = Symbol('artifact-footnotes');

export interface FootnoteEntry {
	id: string;
	/** String provenance (for rendering in footnote list) */
	content: string;
}

export class FootnoteRegistry {
	entries: FootnoteEntry[] = $state([]);

	register(id: string, content: string): number {
		const index = this.entries.length + 1;
		this.entries.push({ id, content });
		return index;
	}

	unregister(id: string): void {
		const idx = this.entries.findIndex((e) => e.id === id);
		if (idx !== -1) this.entries.splice(idx, 1);
	}
}
