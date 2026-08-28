#!/usr/bin/env node

/**
 * READ-ONLY audit of the stored `templates.deliveryMethod` vocabulary.
 *
 * `convex/schema.ts` closes that column to a `v.union(...)`. Convex validates
 * EVERY existing document against the declared schema when functions are pushed,
 * so a single row holding a value outside the union fails the WHOLE deploy — and
 * it fails without naming the rows. This audit names them first.
 *
 * Why a standalone script and not a deployed audit function: getting an audit
 * function onto the deployment requires the very push that the stray row makes
 * fail. A system read query needs no push at all, so this can run BEFORE the
 * deploy it guards. That is why it reads through `_system/cli/tableData` — the
 * same function `npx convex data` drives — instead of any application function.
 * The corollary is a hard constraint: this audit may never depend on anything
 * having been deployed, which is what rules out reusing the deployed enum audit.
 *
 * READ-ONLY here is structural, not a matter of discipline: the only Convex call
 * in this file is `client.query` against a `_system/...` function reference.
 * There is no write surface anywhere in the file, so a future edit that adds one
 * appears as a new call rather than a changed flag. Keep it that way.
 *
 * Data minimization: rows arrive whole over the wire, but only `_id`, `slug` and
 * `deliveryMethod` are ever retained or printed, and nothing is written to disk.
 * This is a report, not an export of the templates table onto a workstation.
 *
 * The vocabulary lives in exactly one place, `convex/lib/templateDeliveryMethod.ts`.
 * It is imported below and never restated here, so adding a delivery method stays
 * an edit to that module plus the schema union and never grows a third copy.
 *
 * Usage:
 *   CONVEX_URL=... CONVEX_ADMIN_KEY=... node scripts/audit-template-delivery-method.mjs
 *   node scripts/audit-template-delivery-method.mjs --self-check
 *
 * Exit codes:
 *   0  every row conforms — safe to push
 *   1  operational failure or an INCONCLUSIVE read (missing credentials, stalled
 *      pagination, malformed page). A scan that cannot prove it was complete
 *      never reports clean.
 *   2  offending rows found — stop the deploy
 */

import { pathToFileURL } from 'node:url';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import {
	TEMPLATE_DELIVERY_METHODS,
	isTemplateDeliveryMethod
} from '../convex/lib/templateDeliveryMethod.ts';

/**
 * Convex omits the internal `setAdminAuth` method from its published declaration
 * file even though the runtime client exposes it. Only the read surface this
 * audit needs is named here.
 * @typedef {{setAdminAuth: (key: string) => void, query: (reference: unknown, args: Record<string, unknown>) => Promise<unknown>}} TableReadClient
 */

/** @typedef {{id: string, slug: string|null, value: string}} OffendingRow */
/** @typedef {{scanned: number, byValue: Record<string, number>, offending: OffendingRow[], blockingDeploy: boolean}} DeliveryMethodAuditReport */

const READ_TABLE_DATA = makeFunctionReference('_system/cli/tableData:default');

export const TEMPLATE_DELIVERY_METHOD_AUDIT_TABLE = 'templates';
export const TEMPLATE_DELIVERY_METHOD_AUDIT_PAGE_SIZE = 512;
/** Longest stored value echoed into the report; a stray column is not a payload channel. */
export const TEMPLATE_DELIVERY_METHOD_AUDIT_LABEL_MAX = 64;

export const TEMPLATE_DELIVERY_METHOD_AUDIT_EXIT = Object.freeze({
	conforms: 0,
	inconclusive: 1,
	blockingDeploy: 2
});

const USAGE =
	'Usage: CONVEX_URL=... CONVEX_ADMIN_KEY=... node scripts/audit-template-delivery-method.mjs [--self-check]';

/** @param {unknown} condition @param {string} message @returns {asserts condition} */
function invariant(condition, message) {
	if (!condition) throw new Error(message);
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Render a stored value as a bounded, printable label.
 *
 * Strings keep their quotes so an empty string and a missing column stay
 * distinguishable in the report; non-strings collapse to their kind rather than
 * their contents.
 * @param {unknown} value
 * @returns {string}
 */
export function labelTemplateDeliveryMethodValue(value) {
	if (value === undefined) return '<missing>';
	if (value === null) return '<null>';
	if (typeof value !== 'string') return `<${typeof value}>`;
	const bounded =
		value.length > TEMPLATE_DELIVERY_METHOD_AUDIT_LABEL_MAX
			? `${value.slice(0, TEMPLATE_DELIVERY_METHOD_AUDIT_LABEL_MAX)}…`
			: value;
	return JSON.stringify(bounded);
}

/**
 * Classify rows against the imported vocabulary.
 *
 * Pure and network-free, which is what lets `--self-check` exercise it.
 * @param {unknown[]} rows
 * @param {DeliveryMethodAuditReport} [into]
 * @returns {DeliveryMethodAuditReport}
 */
export function classifyTemplateDeliveryMethodRows(
	rows,
	into = { scanned: 0, byValue: {}, offending: [], blockingDeploy: false }
) {
	for (const row of rows) {
		invariant(
			record(row) && typeof row._id === 'string',
			'TEMPLATE_DELIVERY_METHOD_AUDIT_ROW_INVALID: a templates row arrived without a string _id.'
		);
		into.scanned += 1;
		const value = row.deliveryMethod;
		const label = labelTemplateDeliveryMethodValue(value);
		into.byValue[label] = (into.byValue[label] ?? 0) + 1;
		if (isTemplateDeliveryMethod(value)) continue;
		into.offending.push({
			id: row._id,
			slug: typeof row.slug === 'string' ? row.slug : null,
			value: label
		});
	}
	into.blockingDeploy = into.offending.length > 0;
	return into;
}

/**
 * Validate one system pagination page without inspecting anything but the three
 * audited fields.
 * @param {unknown} raw
 * @returns {{page: unknown[], isDone: boolean, continueCursor: unknown}}
 */
export function validateTemplateDeliveryMethodPage(raw) {
	invariant(
		record(raw) && Array.isArray(raw.page) && typeof raw.isDone === 'boolean',
		'TEMPLATE_DELIVERY_METHOD_AUDIT_PAGE_INVALID: the system table read returned an unrecognized page shape.'
	);
	return { page: raw.page, isDone: raw.isDone, continueCursor: raw.continueCursor };
}

/**
 * Read every templates row through the deployment's system table query.
 * @param {{client: TableReadClient, pageSize?: number}} input
 * @returns {Promise<DeliveryMethodAuditReport>}
 */
export async function auditTemplateDeliveryMethods({
	client,
	pageSize = TEMPLATE_DELIVERY_METHOD_AUDIT_PAGE_SIZE
}) {
	/** @type {string|null} */
	let cursor = null;
	const seenCursors = new Set();
	const report = classifyTemplateDeliveryMethodRows([]);
	for (;;) {
		const page = validateTemplateDeliveryMethodPage(
			await client.query(READ_TABLE_DATA, {
				table: TEMPLATE_DELIVERY_METHOD_AUDIT_TABLE,
				order: 'asc',
				paginationOpts: { cursor, numItems: pageSize }
			})
		);
		classifyTemplateDeliveryMethodRows(page.page, report);
		if (page.isDone) break;
		// A cursor that is absent, repeated, or unchanged means the scan cannot
		// prove it saw the whole table. Report INCONCLUSIVE rather than clean.
		invariant(
			typeof page.continueCursor === 'string' &&
				page.continueCursor.length > 0 &&
				page.continueCursor !== cursor &&
				!seenCursors.has(page.continueCursor),
			'TEMPLATE_DELIVERY_METHOD_AUDIT_CURSOR_STALLED: pagination did not advance; the templates scan is incomplete.'
		);
		seenCursors.add(page.continueCursor);
		cursor = page.continueCursor;
	}
	return report;
}

/**
 * Bind the credentials the sibling Convex proofs already require. No defaults:
 * a silently wrong deployment is worse than a named failure.
 * @param {{convexUrl: string|undefined, adminKey: string|undefined, clientFactory?: (url: string) => TableReadClient}} input
 * @returns {TableReadClient}
 */
export function connectTemplateDeliveryMethodAudit({
	convexUrl,
	adminKey,
	clientFactory = (url) =>
		/** @type {TableReadClient} */ (
			/** @type {unknown} */ (new ConvexHttpClient(url, { logger: false }))
		)
}) {
	invariant(
		typeof convexUrl === 'string' && /^https:\/\/[^\s]+$/.test(convexUrl),
		'TEMPLATE_DELIVERY_METHOD_AUDIT_MISSING_CREDENTIALS: CONVEX_URL is required. Export it for the deployment you are about to push.'
	);
	invariant(
		typeof adminKey === 'string' && adminKey.length >= 16,
		'TEMPLATE_DELIVERY_METHOD_AUDIT_MISSING_CREDENTIALS: CONVEX_ADMIN_KEY is required. Export it for the deployment you are about to push.'
	);
	const client = clientFactory(convexUrl);
	client.setAdminAuth(adminKey);
	return client;
}

/**
 * The fixture the classifier is proved against: one row per canonical value,
 * plus the value the authoring flow used to write and three shapes a column that
 * accepted arbitrary input could be holding.
 * @returns {unknown[]}
 */
export function buildTemplateDeliveryMethodSelfCheckRows() {
	/** @type {unknown[]} */
	const rows = TEMPLATE_DELIVERY_METHODS.map((method, index) => ({
		_id: `canonical-${index}`,
		slug: `canonical-${index}`,
		deliveryMethod: method
	}));
	rows.push(
		{ _id: 'stray-channel', slug: 'stray-channel', deliveryMethod: 'certified' },
		{ _id: 'stray-empty', slug: 'stray-empty', deliveryMethod: '' },
		{ _id: 'stray-null', slug: 'stray-null', deliveryMethod: null },
		{ _id: 'stray-number', slug: 'stray-number', deliveryMethod: 42 }
	);
	return rows;
}

/** Exactly the labels the fixture must flag — no more, no fewer. */
export const TEMPLATE_DELIVERY_METHOD_SELF_CHECK_OFFENDING = Object.freeze([
	'"certified"',
	'""',
	'<null>',
	'<number>'
]);

/**
 * Prove the classifier over the fixture. Touches no network and no deployment.
 *
 * This is what makes the audit non-vacuous: `node --check` only parses the file,
 * and the live path needs a deployment. Running this also proves at runtime that
 * the cross-runtime import of the vocabulary module actually resolves.
 * @returns {{selfCheck: 'pass'|'fail', failedAssertions: string[], scanned: number, offending: OffendingRow[]}}
 */
export function runTemplateDeliveryMethodSelfCheck() {
	const rows = buildTemplateDeliveryMethodSelfCheckRows();
	const report = classifyTemplateDeliveryMethodRows(rows);
	const offendingLabels = report.offending.map((entry) => entry.value);
	/** @type {[string, boolean][]} */
	const assertions = [
		['SCANNED_EVERY_FIXTURE_ROW', report.scanned === rows.length],
		[
			'OFFENDING_SET_EXACT',
			offendingLabels.length === TEMPLATE_DELIVERY_METHOD_SELF_CHECK_OFFENDING.length &&
				offendingLabels.every(
					(label, index) => label === TEMPLATE_DELIVERY_METHOD_SELF_CHECK_OFFENDING[index]
				)
		],
		[
			'CANONICAL_ROWS_NOT_FLAGGED',
			report.offending.every((entry) => !entry.id.startsWith('canonical-'))
		],
		[
			'OFFENDING_ROWS_IDENTIFIED',
			report.offending.every((entry) => typeof entry.id === 'string' && entry.slug !== undefined)
		],
		['BLOCKING_DEPLOY_SET', report.blockingDeploy === true],
		[
			'BY_VALUE_TOTALS_MATCH',
			Object.values(report.byValue).reduce((sum, count) => sum + count, 0) === rows.length
		]
	];
	const failedAssertions = assertions.filter(([, ok]) => !ok).map(([name]) => name);
	return {
		selfCheck: failedAssertions.length === 0 ? 'pass' : 'fail',
		failedAssertions,
		scanned: report.scanned,
		offending: report.offending
	};
}

/** @param {string[]} argv @returns {{selfCheck: boolean}} */
export function parseTemplateDeliveryMethodAuditOptions(argv) {
	let selfCheck = false;
	for (const flag of argv) {
		invariant(flag === '--self-check', USAGE);
		invariant(!selfCheck, USAGE);
		selfCheck = true;
	}
	return { selfCheck };
}

/** @param {unknown} error @param {(string|undefined)[]} secrets @returns {string} */
function redactedMessage(error, secrets) {
	let message = error instanceof Error ? error.message : String(error);
	for (const secret of secrets) {
		if (secret && secret.length >= 8) message = message.split(secret).join('[REDACTED]');
	}
	return message;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
	const adminKey = process.env.CONVEX_ADMIN_KEY;
	try {
		const { selfCheck } = parseTemplateDeliveryMethodAuditOptions(process.argv.slice(2));
		if (selfCheck) {
			const result = runTemplateDeliveryMethodSelfCheck();
			console.log(JSON.stringify(result, null, 2));
			process.exitCode =
				result.selfCheck === 'pass'
					? TEMPLATE_DELIVERY_METHOD_AUDIT_EXIT.conforms
					: TEMPLATE_DELIVERY_METHOD_AUDIT_EXIT.blockingDeploy;
		} else {
			const client = connectTemplateDeliveryMethodAudit({
				convexUrl: process.env.CONVEX_URL,
				adminKey
			});
			const report = await auditTemplateDeliveryMethods({ client });
			console.log(JSON.stringify(report, null, 2));
			process.exitCode = report.blockingDeploy
				? TEMPLATE_DELIVERY_METHOD_AUDIT_EXIT.blockingDeploy
				: TEMPLATE_DELIVERY_METHOD_AUDIT_EXIT.conforms;
		}
	} catch (error) {
		console.error(redactedMessage(error, [adminKey]));
		process.exitCode = TEMPLATE_DELIVERY_METHOD_AUDIT_EXIT.inconclusive;
	}
}
