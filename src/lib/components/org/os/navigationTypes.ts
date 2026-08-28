import type { SpaceId } from './orgOS.svelte';

/** A real route folded under one mounted workspace. */
export interface SecondaryLink {
	href: string;
	label: string;
	/** Real loaded count. Null means the slice was not read. */
	count?: number | null;
	/** One plain-language limit sentence for a bounded action. */
	note?: string;
}

export interface WorkspaceMark {
	id: SpaceId;
	label: string;
	href: string;
	/** Real loaded count. Null means the slice was not read. */
	count?: number | null;
	secondary?: SecondaryLink[];
}

export interface SpotlightDestination {
	id: string;
	label: string;
	group: string;
	kind: 'space' | 'route';
	spaceId?: SpaceId;
	href?: string;
	/** Real loaded count. Null means the slice was not read. */
	count?: number | null;
	/** One plain-language limit sentence for a bounded action. */
	note?: string;
}
