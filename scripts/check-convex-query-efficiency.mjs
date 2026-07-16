#!/usr/bin/env node

/**
 * Prevent public Convex query read debt from growing unnoticed.
 *
 * This is intentionally a syntactic, deterministic check. It scans exported
 * `query({...})` declarations and records three expensive constructs:
 *   - `.collect()` calls;
 *   - Convex query-builder `.filter()` calls (not Array.prototype.filter);
 *   - `Date.now()` calls.
 *
 * Existing debt is an exact baseline, not a blanket exemption. Every baseline
 * entry needs an owner, reason, and expiry. A new occurrence, a new hazardous
 * query, an expired entry, or stale baseline data fails the check.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONVEX_DIR = path.join(REPO_ROOT, 'convex');
const BASELINE_PATH = path.join(SCRIPT_DIR, 'convex-query-efficiency-baseline.json');
const RULES = ['collect', 'queryFilter', 'dateNow'];

function relative(filePath) {
	return path.relative(REPO_ROOT, filePath).split(path.sep).join('/');
}

function listTypeScriptFiles(directory) {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === '_generated' || entry.name === 'node_modules') continue;
		const filePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...listTypeScriptFiles(filePath));
		} else if (
			entry.isFile() &&
			entry.name.endsWith('.ts') &&
			!entry.name.endsWith('.d.ts') &&
			!entry.name.includes('.test.')
		) {
			files.push(filePath);
		}
	}
	return files.sort((a, b) => relative(a).localeCompare(relative(b)));
}

function unwrapExpression(node) {
	let current = node;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function isDbReceiver(node) {
	const current = unwrapExpression(node);
	if (!ts.isPropertyAccessExpression(current)) return false;
	if (current.name.text === 'db') return true;
	return current.name.text === 'system' && isDbReceiver(current.expression);
}

function isDbQueryCall(node) {
	const current = unwrapExpression(node);
	return (
		ts.isCallExpression(current) &&
		ts.isPropertyAccessExpression(current.expression) &&
		current.expression.name.text === 'query' &&
		isDbReceiver(current.expression.expression)
	);
}

function isQueryBuilderExpression(node, builderNames) {
	const current = unwrapExpression(node);
	if (ts.isIdentifier(current)) return builderNames.has(current.text);
	if (isDbQueryCall(current)) return true;
	if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
		return isQueryBuilderExpression(current.expression.expression, builderNames);
	}
	return false;
}

function collectBuilderNames(root) {
	const builderNames = new Set();
	let changed = true;

	while (changed) {
		changed = false;
		const visit = (node) => {
			if (
				ts.isVariableDeclaration(node) &&
				ts.isIdentifier(node.name) &&
				node.initializer &&
				isQueryBuilderExpression(node.initializer, builderNames) &&
				!builderNames.has(node.name.text)
			) {
				builderNames.add(node.name.text);
				changed = true;
			}

			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isIdentifier(node.left) &&
				isQueryBuilderExpression(node.right, builderNames) &&
				!builderNames.has(node.left.text)
			) {
				builderNames.add(node.left.text);
				changed = true;
			}

			ts.forEachChild(node, visit);
		};
		visit(root);
	}

	return builderNames;
}

function analyzePublicQuery(queryNode, sourceFile) {
	const builderNames = collectBuilderNames(queryNode);
	const lines = { collect: [], queryFilter: [], dateNow: [] };

	const visit = (node) => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const method = node.expression.name.text;
			const receiver = node.expression.expression;
			const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

			if (method === 'collect') {
				lines.collect.push(line);
			} else if (method === 'filter' && isQueryBuilderExpression(receiver, builderNames)) {
				lines.queryFilter.push(line);
			} else if (method === 'now' && ts.isIdentifier(receiver) && receiver.text === 'Date') {
				lines.dateNow.push(line);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(queryNode);

	return {
		counts: Object.fromEntries(RULES.map((rule) => [rule, lines[rule].length])),
		lines
	};
}

function selfCheckAnalyzer() {
	const source = `
		export const synthetic = query({
			handler: async (ctx) => {
				let builder = ctx.db.query('rows');
				builder = builder.withIndex('by_status', (q) => q.eq('status', 'active'));
				const rows = await builder.filter((q) => q.eq(q.field('visible'), true)).collect();
				return { count: rows.filter(Boolean).length, now: Date.now() };
			}
		});
	`;
	const sourceFile = ts.createSourceFile(
		'synthetic.ts',
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const statement = sourceFile.statements.find(ts.isVariableStatement);
	const declaration = statement?.declarationList.declarations[0];
	assert(declaration?.initializer && ts.isCallExpression(declaration.initializer));
	const result = analyzePublicQuery(declaration.initializer, sourceFile);
	assert.deepEqual(result.counts, { collect: 1, queryFilter: 1, dateNow: 1 });
}

function scanPublicQueries() {
	const findings = new Map();
	let publicQueryCount = 0;
	const modules = new Set();

	for (const filePath of listTypeScriptFiles(CONVEX_DIR)) {
		const source = fs.readFileSync(filePath, 'utf8');
		const sourceFile = ts.createSourceFile(
			filePath,
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS
		);

		for (const statement of sourceFile.statements) {
			if (
				!ts.isVariableStatement(statement) ||
				!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
			) {
				continue;
			}

			for (const declaration of statement.declarationList.declarations) {
				if (
					!ts.isIdentifier(declaration.name) ||
					!declaration.initializer ||
					!ts.isCallExpression(declaration.initializer) ||
					!ts.isIdentifier(declaration.initializer.expression) ||
					declaration.initializer.expression.text !== 'query'
				) {
					continue;
				}

				publicQueryCount += 1;
				modules.add(relative(filePath));
				const analysis = analyzePublicQuery(declaration.initializer, sourceFile);
				if (!RULES.some((rule) => analysis.counts[rule] > 0)) continue;

				const key = `${relative(filePath)}::${declaration.name.text}`;
				findings.set(key, {
					file: relative(filePath),
					query: declaration.name.text,
					...analysis
				});
			}
		}
	}

	return { findings, publicQueryCount, moduleCount: modules.size };
}

function todayUtc() {
	const override = process.env.CONVEX_QUERY_EFFICIENCY_TODAY;
	if (override) return override;
	return new Date().toISOString().slice(0, 10);
}

function isValidDateOnly(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function currentBaselineJson(scan) {
	const owner = process.env.CONVEX_QUERY_BASELINE_OWNER || '@ejmockler';
	const expires = process.env.CONVEX_QUERY_BASELINE_EXPIRES || '2027-01-31';
	const entries = {};
	for (const key of [...scan.findings.keys()].sort()) {
		const finding = scan.findings.get(key);
		entries[key] = {
			rules: Object.fromEntries(
				RULES.filter((rule) => finding.counts[rule] > 0).map((rule) => [rule, finding.counts[rule]])
			),
			owner,
			expires,
			reason: 'Pre-existing debt captured by the 2026-07-16 app-wide Convex query audit.'
		};
	}
	return {
		version: 1,
		description:
			'Exact baseline for syntactic hazards in exported public Convex queries. Counts may only change with a reviewed baseline update.',
		entries
	};
}

function validateBaselineShape(baseline, today) {
	const errors = [];
	if (
		!baseline ||
		baseline.version !== 1 ||
		!baseline.entries ||
		typeof baseline.entries !== 'object'
	) {
		return ['Baseline must be an object with version: 1 and an entries object.'];
	}

	const keys = Object.keys(baseline.entries);
	const sortedKeys = [...keys].sort();
	if (keys.some((key, index) => key !== sortedKeys[index])) {
		errors.push('Baseline entries must be sorted lexicographically by key.');
	}

	for (const [key, entry] of Object.entries(baseline.entries)) {
		if (!key.includes('::')) errors.push(`${key}: key must use convex/file.ts::queryName.`);
		if (!entry || typeof entry !== 'object') {
			errors.push(`${key}: entry must be an object.`);
			continue;
		}
		if (typeof entry.owner !== 'string' || entry.owner.trim().length === 0) {
			errors.push(`${key}: owner is required.`);
		}
		if (typeof entry.reason !== 'string' || entry.reason.trim().length < 12) {
			errors.push(`${key}: a specific reason of at least 12 characters is required.`);
		}
		if (!isValidDateOnly(entry.expires)) {
			errors.push(`${key}: expires must be YYYY-MM-DD.`);
		} else if (entry.expires < today) {
			errors.push(`${key}: allowlist expired on ${entry.expires} (today is ${today}).`);
		}
		if (!entry.rules || typeof entry.rules !== 'object') {
			errors.push(`${key}: rules object is required.`);
			continue;
		}
		const unknownRules = Object.keys(entry.rules).filter((rule) => !RULES.includes(rule));
		if (unknownRules.length > 0) {
			errors.push(`${key}: unknown rules: ${unknownRules.join(', ')}.`);
		}
		let nonzeroRules = 0;
		for (const rule of RULES) {
			const value = entry.rules[rule] ?? 0;
			if (!Number.isInteger(value) || value < 0) {
				errors.push(`${key}: ${rule} must be a non-negative integer.`);
			} else if (value > 0) {
				nonzeroRules += 1;
			}
		}
		if (nonzeroRules === 0) errors.push(`${key}: at least one rule count must be nonzero.`);
	}
	return errors;
}

function formatFinding(finding) {
	return RULES.filter((rule) => finding.counts[rule] > 0)
		.map((rule) => `${rule}=${finding.counts[rule]} @ ${finding.lines[rule].join(',')}`)
		.join('; ');
}

function compare(scan, baseline) {
	const errors = [];
	const baselineEntries = baseline.entries;

	for (const [key, finding] of scan.findings) {
		const allowed = baselineEntries[key];
		if (!allowed) {
			errors.push(`NEW ${key}: ${formatFinding(finding)}`);
			continue;
		}
		for (const rule of RULES) {
			const actual = finding.counts[rule];
			const expected = allowed.rules[rule] ?? 0;
			if (actual !== expected) {
				errors.push(
					`${key}: ${rule} changed ${expected} -> ${actual}; source lines: ${finding.lines[rule].join(',') || 'none'}.`
				);
			}
		}
	}

	for (const key of Object.keys(baselineEntries)) {
		if (!scan.findings.has(key)) {
			errors.push(`STALE ${key}: no current hazard remains; remove this baseline entry.`);
		}
	}

	return errors;
}

function summarize(scan) {
	const totals = Object.fromEntries(RULES.map((rule) => [rule, { calls: 0, queries: 0 }]));
	for (const finding of scan.findings.values()) {
		for (const rule of RULES) {
			if (finding.counts[rule] > 0) {
				totals[rule].queries += 1;
				totals[rule].calls += finding.counts[rule];
			}
		}
	}
	return totals;
}

selfCheckAnalyzer();
const scan = scanPublicQueries();
if (process.argv.includes('--print-current')) {
	process.stdout.write(`${JSON.stringify(currentBaselineJson(scan), null, 2)}\n`);
	process.exit(0);
}

let baseline;
try {
	baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
} catch (error) {
	console.error(
		`Unable to read ${relative(BASELINE_PATH)}: ${error instanceof Error ? error.message : String(error)}`
	);
	process.exit(1);
}

const today = todayUtc();
const errors = isValidDateOnly(today)
	? [...validateBaselineShape(baseline, today)]
	: [`CONVEX_QUERY_EFFICIENCY_TODAY must be a valid YYYY-MM-DD date; received ${today}.`];
if (errors.length === 0) errors.push(...compare(scan, baseline));

const totals = summarize(scan);
console.log(
	`Convex query efficiency: ${scan.publicQueryCount} public queries in ${scan.moduleCount} modules; ` +
		`${totals.collect.calls} collect calls/${totals.collect.queries} queries, ` +
		`${totals.queryFilter.calls} query filters/${totals.queryFilter.queries} queries, ` +
		`${totals.dateNow.calls} Date.now calls/${totals.dateNow.queries} queries.`
);

if (errors.length > 0) {
	console.error('\nConvex query efficiency guardrail failed:');
	for (const error of errors) console.error(`- ${error}`);
	console.error(
		'\nRemove the hazard, or add/update an exact baseline entry with a real owner, specific reason, and near-term expiry.'
	);
	process.exit(1);
}

console.log(
	`PASS: ${scan.findings.size} hazard-bearing public queries exactly match the reviewed, non-expired baseline (${today}).`
);
