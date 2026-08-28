import {
	PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_BYTES,
	readCachedPublicTemplateDetail,
	type CachedPublicTemplateDetail
} from './public-template-detail-cache';
import {
	PUBLIC_TEMPLATE_PAGE_AGGREGATE_MAX_BYTES,
	buildPublicTemplatePageAggregate,
	readPublicTemplatePageAggregate,
	type PublicTemplatePageAggregate
} from './public-template-page-cache';
import { isValidPublicTemplateSlug } from './public-template-detail-path';

export const PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES = 250;
export const PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_BYTES = 128 * 1024;
export const PUBLIC_TEMPLATE_PAGE_ARTIFACT_MAX_BYTES =
	PUBLIC_TEMPLATE_DETAIL_CACHE_MAX_BYTES + PUBLIC_TEMPLATE_PAGE_AGGREGATE_MAX_BYTES + 16 * 1024;

export type PublicTemplatePageArtifact = {
	version: 1;
	slug: string;
	detail: CachedPublicTemplateDetail;
	aggregate: PublicTemplatePageAggregate;
};

export type PublicTemplatePageInventory = {
	version: 1;
	revision: number;
	updatedAt: number;
	entries: Array<{ slug: string; artifactRevision: string }>;
};

function record(value: unknown, code: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:${code}`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:${code}-prototype`);
	}
	return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], code: string): void {
	const keys = new Set(allowed);
	if (Object.keys(value).some((key) => !keys.has(key))) {
		throw new Error(`PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:${code}-unknown-key`);
	}
}

function bytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function artifact(value: unknown, strict: boolean): PublicTemplatePageArtifact {
	const container = record(value, 'container');
	if (strict) onlyKeys(container, ['version', 'slug', 'detail', 'aggregate'], 'container');
	if (container.version !== 1 || !isValidPublicTemplateSlug(container.slug)) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:coordinate');
	}
	const slug = container.slug as string;
	const detail = readCachedPublicTemplateDetail(container.detail, slug);
	const aggregate = strict
		? readPublicTemplatePageAggregate(container.aggregate)
		: buildPublicTemplatePageAggregate(container.aggregate);
	if (String(detail.id) !== aggregate.templateId) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:template-mismatch');
	}
	const projected: PublicTemplatePageArtifact = { version: 1, slug, detail, aggregate };
	if (bytes(projected) > PUBLIC_TEMPLATE_PAGE_ARTIFACT_MAX_BYTES) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:oversize');
	}
	return projected;
}

/** Producer boundary: drops every non-public nested field before the R2 PUT. */
export function buildPublicTemplatePageArtifact(value: unknown): PublicTemplatePageArtifact {
	const raw = record(value, 'producer-container');
	return artifact(
		{
			version: 1,
			slug: raw.slug,
			detail: raw.detail,
			aggregate: raw.aggregate
		},
		false
	);
}

/** Consumer boundary: rejects unknown keys at every nested public projection. */
export function readPublicTemplatePageArtifact(value: unknown): PublicTemplatePageArtifact {
	return artifact(value, true);
}

function inventory(value: unknown, strict: boolean): PublicTemplatePageInventory {
	const container = record(value, 'inventory');
	if (strict) onlyKeys(container, ['version', 'revision', 'updatedAt', 'entries'], 'inventory');
	if (
		container.version !== 1 ||
		!Number.isSafeInteger(container.revision) ||
		(container.revision as number) < 1 ||
		!Number.isSafeInteger(container.updatedAt) ||
		(container.updatedAt as number) < 0 ||
		!Array.isArray(container.entries) ||
		container.entries.length > PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_ENTRIES
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:inventory-shape');
	}
	const entries = container.entries.map((rawEntry) => {
		const entry = record(rawEntry, 'inventory-entry');
		if (strict) onlyKeys(entry, ['slug', 'artifactRevision'], 'inventory-entry');
		if (
			!isValidPublicTemplateSlug(entry.slug) ||
			typeof entry.artifactRevision !== 'string' ||
			!/^\d{1,16}$/.test(entry.artifactRevision) ||
			!Number.isSafeInteger(Number(entry.artifactRevision)) ||
			Number(entry.artifactRevision) < 1
		) {
			throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:inventory-entry');
		}
		return { slug: entry.slug, artifactRevision: entry.artifactRevision };
	});
	const canonical = [...entries].sort((a, b) => a.slug.localeCompare(b.slug));
	if (
		new Set(entries.map(({ slug }) => slug)).size !== entries.length ||
		canonical.some(
			(entry, index) =>
				entry.slug !== entries[index]?.slug ||
				entry.artifactRevision !== entries[index]?.artifactRevision
		)
	) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:inventory-order');
	}
	const projected: PublicTemplatePageInventory = {
		version: 1,
		revision: container.revision as number,
		updatedAt: container.updatedAt as number,
		entries: canonical
	};
	if (bytes(projected) > PUBLIC_TEMPLATE_PAGE_INVENTORY_MAX_BYTES) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:inventory-oversize');
	}
	return projected;
}

export function buildPublicTemplatePageInventory(value: unknown): PublicTemplatePageInventory {
	return inventory(value, false);
}

export function readPublicTemplatePageInventory(value: unknown): PublicTemplatePageInventory {
	return inventory(value, true);
}

export function publicTemplatePageArtifactLogicalKey(slug: string): string {
	if (!isValidPublicTemplateSlug(slug)) {
		throw new Error('PUBLIC_TEMPLATE_PAGE_ARTIFACT_INVALID:logical-key-slug');
	}
	return `template-page:slug=${slug}`;
}

export const PUBLIC_TEMPLATE_PAGE_INVENTORY_LOGICAL_KEY = 'template-pages:inventory';
