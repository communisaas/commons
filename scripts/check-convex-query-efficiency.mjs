#!/usr/bin/env node

/**
 * Prevent public Convex query read debt from growing unnoticed.
 *
 * This is intentionally a syntactic, deterministic check. It scans exported
 * `query({...})` declarations and records three expensive constructs:
 *   - `.collect()` calls;
 *   - Convex query-builder `.filter()` calls (not Array.prototype.filter);
 *   - wall-clock reads (`Date.now()`, zero-argument `new Date()`, `Date()`,
 *     `performance.now()`, and `Temporal.Now.*()`).
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

function hasExportModifier(node) {
	return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function isGeneratedServerModule(specifier) {
	return /(?:^|\/)\_generated\/server(?:\.[cm]?[jt]s)?$/.test(specifier);
}

function buildModuleInfo(filePath, source) {
	const sourceFile = ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const info = {
		filePath: path.resolve(filePath),
		sourceFile,
		bindings: new Map(),
		imports: new Map(),
		namespaceImports: new Map(),
		exports: new Map(),
		queryFactories: new Set(),
		queryNamespaces: new Set()
	};

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
			const specifier = statement.moduleSpecifier.text;
			const clause = statement.importClause;
			if (!clause) continue;
			if (clause.name) {
				info.imports.set(clause.name.text, { specifier, importedName: 'default' });
			}
			if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
				const localName = clause.namedBindings.name.text;
				info.namespaceImports.set(localName, specifier);
				if (isGeneratedServerModule(specifier)) info.queryNamespaces.add(localName);
			}
			if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
				for (const element of clause.namedBindings.elements) {
					const importedName = element.propertyName?.text ?? element.name.text;
					const localName = element.name.text;
					info.imports.set(localName, { specifier, importedName });
					if (isGeneratedServerModule(specifier) && importedName === 'query') {
						info.queryFactories.add(localName);
					}
				}
			}
			continue;
		}

		if (ts.isFunctionDeclaration(statement) && statement.name) {
			info.bindings.set(statement.name.text, statement);
			if (hasExportModifier(statement)) {
				info.exports.set(statement.name.text, { kind: 'local', localName: statement.name.text });
			}
			continue;
		}

		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
				info.bindings.set(declaration.name.text, declaration.initializer);
				if (hasExportModifier(statement)) {
					info.exports.set(declaration.name.text, {
						kind: 'local',
						localName: declaration.name.text
					});
				}
			}
			continue;
		}

		if (
			ts.isExportDeclaration(statement) &&
			statement.exportClause &&
			ts.isNamedExports(statement.exportClause)
		) {
			const specifier =
				statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
					? statement.moduleSpecifier.text
					: null;
			for (const element of statement.exportClause.elements) {
				const exportedName = element.name.text;
				const importedName = element.propertyName?.text ?? exportedName;
				info.exports.set(
					exportedName,
					specifier
						? { kind: 'reexport', specifier, importedName }
						: { kind: 'local', localName: importedName }
				);
			}
			continue;
		}

		if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
			info.exports.set('default', { kind: 'expression', expression: statement.expression });
		}
	}

	return info;
}

function resolveRelativeModule(info, specifier, modulesByPath) {
	if (!specifier.startsWith('.')) return null;
	const base = path.resolve(path.dirname(info.filePath), specifier);
	const withoutJs = base.replace(/\.[cm]?js$/, '');
	for (const candidate of [base, `${base}.ts`, `${withoutJs}.ts`, path.join(base, 'index.ts')]) {
		const resolved = modulesByPath.get(path.resolve(candidate));
		if (resolved) return resolved;
	}
	return null;
}

function buildModuleGraph(sources) {
	const modules = sources.map(({ filePath, source }) => buildModuleInfo(filePath, source));
	return { modules, modulesByPath: new Map(modules.map((info) => [info.filePath, info])) };
}

function localBinding(info, name) {
	return info.bindings.get(name) ?? null;
}

function resolveExportExpression(info, exportedName, graph, seen = new Set()) {
	const key = `${info.filePath}::${exportedName}`;
	if (seen.has(key)) return null;
	seen.add(key);
	const descriptor = info.exports.get(exportedName);
	if (!descriptor) return null;
	if (descriptor.kind === 'expression') return { info, expression: descriptor.expression };
	if (descriptor.kind === 'local') {
		const expression = localBinding(info, descriptor.localName);
		if (expression) return { info, expression };
		const imported = info.imports.get(descriptor.localName);
		if (!imported) return null;
		const target = resolveRelativeModule(info, imported.specifier, graph.modulesByPath);
		return target ? resolveExportExpression(target, imported.importedName, graph, seen) : null;
	}
	const target = resolveRelativeModule(info, descriptor.specifier, graph.modulesByPath);
	return target ? resolveExportExpression(target, descriptor.importedName, graph, seen) : null;
}

function isQueryFactoryExpression(expression, info, graph, seen = new Set()) {
	const current = unwrapExpression(expression);
	if (ts.isIdentifier(current)) {
		if (info.queryFactories.has(current.text)) return true;
		const key = `${info.filePath}::${current.text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		const binding = localBinding(info, current.text);
		return binding ? isQueryFactoryExpression(binding, info, graph, seen) : false;
	}
	return (
		ts.isPropertyAccessExpression(current) &&
		ts.isIdentifier(current.expression) &&
		info.queryNamespaces.has(current.expression.text) &&
		current.name.text === 'query'
	);
}

function resolveQueryCall(expression, info, graph, seen = new Set()) {
	const current = unwrapExpression(expression);
	if (ts.isCallExpression(current) && isQueryFactoryExpression(current.expression, info, graph)) {
		return { info, call: current };
	}
	if (!ts.isIdentifier(current)) return null;
	const key = `${info.filePath}::${current.text}`;
	if (seen.has(key)) return null;
	seen.add(key);
	const binding = localBinding(info, current.text);
	return binding ? resolveQueryCall(binding, info, graph, seen) : null;
}

function isFunctionLike(node) {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node)
	);
}

function resolveCallable(expression, info, graph, seen = new Set()) {
	const current = unwrapExpression(expression);
	if (isFunctionLike(current)) return { info, node: current };
	if (ts.isIdentifier(current)) {
		const key = `${info.filePath}::${current.text}`;
		if (seen.has(key)) return null;
		seen.add(key);
		const binding = localBinding(info, current.text);
		if (binding) return resolveCallable(binding, info, graph, seen);
		const imported = info.imports.get(current.text);
		if (!imported) return null;
		const targetModule = resolveRelativeModule(info, imported.specifier, graph.modulesByPath);
		if (!targetModule) return null;
		const exported = resolveExportExpression(targetModule, imported.importedName, graph);
		return exported ? resolveCallable(exported.expression, exported.info, graph, seen) : null;
	}
	if (
		ts.isPropertyAccessExpression(current) &&
		ts.isIdentifier(current.expression) &&
		info.namespaceImports.has(current.expression.text)
	) {
		const targetModule = resolveRelativeModule(
			info,
			info.namespaceImports.get(current.expression.text),
			graph.modulesByPath
		);
		const exported = targetModule
			? resolveExportExpression(targetModule, current.name.text, graph)
			: null;
		return exported ? resolveCallable(exported.expression, exported.info, graph, seen) : null;
	}
	return null;
}

function resolveObjectLiteral(expression, info) {
	let current = unwrapExpression(expression);
	const seen = new Set();
	while (ts.isIdentifier(current)) {
		const key = `${info.filePath}::${current.text}`;
		if (seen.has(key)) return null;
		seen.add(key);
		const binding = localBinding(info, current.text);
		if (!binding) return null;
		current = unwrapExpression(binding);
	}
	return ts.isObjectLiteralExpression(current) ? current : null;
}

function findHandlerExpression(queryCall, info) {
	const definition = queryCall.arguments[0]
		? resolveObjectLiteral(queryCall.arguments[0], info)
		: null;
	if (!definition) return null;
	for (const property of definition.properties) {
		const name = property.name && ts.isIdentifier(property.name) ? property.name.text : null;
		if (name !== 'handler') continue;
		if (ts.isPropertyAssignment(property)) return property.initializer;
		if (ts.isShorthandPropertyAssignment(property)) return property.name;
		if (ts.isMethodDeclaration(property)) return property;
	}
	return null;
}

function targetKey(target) {
	return `${target.info.filePath}:${target.node.pos}:${target.node.end}`;
}

function discoverReachableRoots(queryCall, queryInfo, graph) {
	const roots = [{ info: queryInfo, node: queryCall }];
	const callEdges = [];
	const errors = [];
	const seenTargets = new Set();
	const handler = findHandlerExpression(queryCall, queryInfo);
	if (!handler) {
		errors.push('query definition has no statically analyzable handler');
	} else {
		const currentHandler = unwrapExpression(handler);
		const target = isFunctionLike(currentHandler)
			? { info: queryInfo, node: currentHandler }
			: resolveCallable(handler, queryInfo, graph);
		if (!target) errors.push('query handler identifier could not be resolved');
		else {
			seenTargets.add(targetKey(target));
			roots.push(target);
		}
	}

	for (let index = 0; index < roots.length; index += 1) {
		const root = roots[index];
		const visit = (node) => {
			if (ts.isCallExpression(node)) {
				const target = resolveCallable(node.expression, root.info, graph);
				if (target) {
					callEdges.push({ call: node, callerInfo: root.info, target });
					const key = targetKey(target);
					if (!seenTargets.has(key)) {
						seenTargets.add(key);
						roots.push(target);
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(root.node);
	}

	return { roots, callEdges, errors };
}

function collectDbNames(roots, callEdges) {
	const names = new Set();
	let changed = true;
	while (changed) {
		changed = false;
		const add = (name) => {
			if (!names.has(name)) {
				names.add(name);
				changed = true;
			}
		};
		for (const root of roots) {
			const visit = (node) => {
				if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === 'db') {
					add(node.name.text);
				}
				if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) {
					const sourceName =
						node.propertyName && ts.isIdentifier(node.propertyName)
							? node.propertyName.text
							: node.name.text;
					if (sourceName === 'db') add(node.name.text);
				}
				if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
					const value = unwrapExpression(node.initializer);
					if (
						(ts.isPropertyAccessExpression(value) && value.name.text === 'db') ||
						(ts.isIdentifier(value) && names.has(value.text))
					) {
						add(node.name.text);
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(root.node);
		}
		for (const { call, target } of callEdges) {
			for (let index = 0; index < call.arguments.length; index += 1) {
				if (!isDbReceiver(call.arguments[index], names)) continue;
				const parameter = target.node.parameters?.[index];
				if (parameter && ts.isIdentifier(parameter.name)) add(parameter.name.text);
			}
		}
	}
	return names;
}

function isDbReceiver(node, dbNames) {
	const current = unwrapExpression(node);
	if (ts.isIdentifier(current)) return dbNames.has(current.text);
	if (!ts.isPropertyAccessExpression(current)) return false;
	if (current.name.text === 'db') return true;
	return current.name.text === 'system' && isDbReceiver(current.expression, dbNames);
}

function isDbQueryCall(node, dbNames) {
	const current = unwrapExpression(node);
	return (
		ts.isCallExpression(current) &&
		ts.isPropertyAccessExpression(current.expression) &&
		current.expression.name.text === 'query' &&
		isDbReceiver(current.expression.expression, dbNames)
	);
}

function isQueryBuilderExpression(node, builderNames, dbNames) {
	const current = unwrapExpression(node);
	if (ts.isIdentifier(current)) return builderNames.has(current.text);
	if (isDbQueryCall(current, dbNames)) return true;
	if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
		return isQueryBuilderExpression(current.expression.expression, builderNames, dbNames);
	}
	return false;
}

function collectBuilderNames(roots, callEdges, dbNames) {
	const builderNames = new Set();
	let changed = true;
	while (changed) {
		changed = false;
		const add = (name) => {
			if (!builderNames.has(name)) {
				builderNames.add(name);
				changed = true;
			}
		};
		for (const root of roots) {
			const visit = (node) => {
				if (
					ts.isVariableDeclaration(node) &&
					ts.isIdentifier(node.name) &&
					node.initializer &&
					isQueryBuilderExpression(node.initializer, builderNames, dbNames)
				) {
					add(node.name.text);
				}
				if (
					ts.isBinaryExpression(node) &&
					node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
					ts.isIdentifier(node.left) &&
					isQueryBuilderExpression(node.right, builderNames, dbNames)
				) {
					add(node.left.text);
				}
				ts.forEachChild(node, visit);
			};
			visit(root.node);
		}
		for (const { call, target } of callEdges) {
			for (let index = 0; index < call.arguments.length; index += 1) {
				if (!isQueryBuilderExpression(call.arguments[index], builderNames, dbNames)) continue;
				const parameter = target.node.parameters?.[index];
				if (parameter && ts.isIdentifier(parameter.name)) add(parameter.name.text);
			}
		}
	}
	return builderNames;
}

function isIdentifierNamed(node, name) {
	const current = unwrapExpression(node);
	return ts.isIdentifier(current) && current.text === name;
}

function isTemporalNowReceiver(node) {
	const current = unwrapExpression(node);
	return (
		ts.isPropertyAccessExpression(current) &&
		current.name.text === 'Now' &&
		isIdentifierNamed(current.expression, 'Temporal')
	);
}

/**
 * Keep the legacy `dateNow` baseline key stable while covering equivalent
 * zero-input clock reads. Constructing Date from an explicit value remains
 * deterministic and is intentionally not flagged.
 */
function isWallClockRead(node) {
	if (ts.isNewExpression(node)) {
		return isIdentifierNamed(node.expression, 'Date') && (node.arguments?.length ?? 0) === 0;
	}
	if (!ts.isCallExpression(node)) return false;

	const callee = unwrapExpression(node.expression);
	if (ts.isIdentifier(callee)) return callee.text === 'Date';
	if (!ts.isPropertyAccessExpression(callee)) return false;

	const method = callee.name.text;
	const receiver = callee.expression;
	return (
		(method === 'now' &&
			(isIdentifierNamed(receiver, 'Date') || isIdentifierNamed(receiver, 'performance'))) ||
		isTemporalNowReceiver(receiver)
	);
}

function analyzePublicQuery(queryNode, queryInfo, graph) {
	const reachable = discoverReachableRoots(queryNode, queryInfo, graph);
	const dbNames = collectDbNames(reachable.roots, reachable.callEdges);
	const builderNames = collectBuilderNames(reachable.roots, reachable.callEdges, dbNames);
	const lines = { collect: [], queryFilter: [], dateNow: [] };
	const counted = new Set();
	for (const root of reachable.roots) {
		const location = (node) => {
			const line =
				root.info.sourceFile.getLineAndCharacterOfPosition(node.getStart(root.info.sourceFile))
					.line + 1;
			return `${relative(root.info.filePath)}:${line}`;
		};
		const record = (rule, node) => {
			const key = `${rule}:${root.info.filePath}:${node.pos}:${node.end}`;
			if (counted.has(key)) return;
			counted.add(key);
			lines[rule].push(location(node));
		};
		const visit = (node) => {
			if (isWallClockRead(node)) record('dateNow', node);
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
				const method = node.expression.name.text;
				const receiver = node.expression.expression;
				if (method === 'collect') record('collect', node);
				else if (method === 'filter' && isQueryBuilderExpression(receiver, builderNames, dbNames)) {
					record('queryFilter', node);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(root.node);
	}

	return {
		counts: Object.fromEntries(RULES.map((rule) => [rule, lines[rule].length])),
		lines,
		errors: reachable.errors
	};
}

function selfCheckAnalyzer() {
	const root = path.join(REPO_ROOT, '__query_efficiency_self_test__');
	const graph = buildModuleGraph([
		{
			filePath: path.join(root, 'helper.ts'),
			source: `
				export function importedHazard({ db: database }) {
					const importedBuilder = database.query('rows');
					return importedBuilder.filter(Boolean).collect();
				}
			`
		},
		{
			filePath: path.join(root, 'main.ts'),
			source: `
				import { query as publicQuery } from './_generated/server';
				import * as server from './_generated/server';
				import { importedHazard as remoteHazard } from './helper';
				const clockHazard = () => new Date().valueOf();
				const delegatedBuilder = (builder) => builder.filter(Boolean).collect();
				const delegatedDb = (database) => database.query('rows').filter(Boolean).collect();
				const localHazard = async ({ db }) => {
					const localBuilder = db.query('rows');
					await localBuilder.filter(Boolean).collect();
					await delegatedBuilder(db.query('rows'));
					await delegatedDb(db);
					await remoteHazard({ db });
					return { now: clockHazard(), deterministic: new Date(0).toISOString() };
				};
				const definition = { handler: localHazard };
				const definePublicQuery = publicQuery;
				const endpoint = definePublicQuery(definition);
				export { endpoint as synthetic };
				export const namespaceQuery = server.query({
					handler: async ({ db: store }) => store.query('rows').filter(Boolean).collect()
				});
			`
		},
		{
			filePath: path.join(root, 'forwarded.ts'),
			source: `
				import { synthetic as endpoint } from './main';
				export { endpoint as forwarded };
			`
		}
	]);
	const scan = scanPublicQueries(graph);
	assert.equal(scan.publicQueryCount, 3);
	assert.deepEqual(scan.errors, []);
	assert.deepEqual(scan.findings.get('__query_efficiency_self_test__/main.ts::synthetic')?.counts, {
		collect: 4,
		queryFilter: 4,
		dateNow: 1
	});
	assert.deepEqual(
		scan.findings.get('__query_efficiency_self_test__/forwarded.ts::forwarded')?.counts,
		{
			collect: 4,
			queryFilter: 4,
			dateNow: 1
		}
	);
	assert.deepEqual(
		scan.findings.get('__query_efficiency_self_test__/main.ts::namespaceQuery')?.counts,
		{ collect: 1, queryFilter: 1, dateNow: 0 }
	);
}

function scanPublicQueries(graph) {
	const findings = new Map();
	let publicQueryCount = 0;
	const modules = new Set();
	const errors = [];

	for (const info of graph.modules) {
		for (const [exportedName] of info.exports) {
			const exported = resolveExportExpression(info, exportedName, graph);
			if (!exported) continue;
			const resolved = resolveQueryCall(exported.expression, exported.info, graph);
			if (!resolved) continue;
			publicQueryCount += 1;
			modules.add(relative(info.filePath));
			const analysis = analyzePublicQuery(resolved.call, resolved.info, graph);
			const key = `${relative(info.filePath)}::${exportedName}`;
			for (const error of analysis.errors) errors.push(`${key}: ${error}.`);
			if (!RULES.some((rule) => analysis.counts[rule] > 0)) continue;
			findings.set(key, {
				file: relative(info.filePath),
				query: exportedName,
				...analysis
			});
		}
	}

	return { findings, publicQueryCount, moduleCount: modules.size, errors };
}

function todayUtc() {
	return new Date().toISOString().slice(0, 10);
}

function isValidDateOnly(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function findingRules(finding) {
	return Object.fromEntries(
		RULES.filter((rule) => finding.counts[rule] > 0).map((rule) => [rule, finding.counts[rule]])
	);
}

function rulesMatch(left, right) {
	return RULES.every((rule) => (left?.[rule] ?? 0) === (right?.[rule] ?? 0));
}

function baselineUpdateMetadata(env, today) {
	const owner = env.CONVEX_QUERY_BASELINE_OWNER?.trim();
	const reason = env.CONVEX_QUERY_BASELINE_REASON?.trim();
	const expires = env.CONVEX_QUERY_BASELINE_EXPIRES?.trim();
	if (!owner || !/^@[A-Za-z0-9-]+$/.test(owner)) {
		throw new Error('CONVEX_QUERY_BASELINE_OWNER must be an explicit GitHub @handle.');
	}
	if (!reason || reason.length < 24) {
		throw new Error(
			'CONVEX_QUERY_BASELINE_REASON must explicitly justify the debt (at least 24 characters).'
		);
	}
	if (!isValidDateOnly(expires) || expires <= today) {
		throw new Error('CONVEX_QUERY_BASELINE_EXPIRES must be a future YYYY-MM-DD date.');
	}
	return { owner, reason, expires };
}

function currentBaselineJson(scan, baseline, metadata) {
	const entries = {};
	for (const key of [...scan.findings.keys()].sort()) {
		const finding = scan.findings.get(key);
		const rules = findingRules(finding);
		const existing = baseline.entries[key];
		entries[key] =
			existing && rulesMatch(existing.rules, rules)
				? { ...existing, rules }
				: { rules, ...metadata };
	}
	return {
		version: 1,
		description:
			'Exact baseline for syntactic hazards in exported public Convex queries. Counts may only change with a reviewed baseline update.',
		entries
	};
}

function selfCheckBaselineRegeneration() {
	assert.throws(() => baselineUpdateMetadata({}, '2026-07-18'), /CONVEX_QUERY_BASELINE_OWNER/);
	assert.deepEqual(
		baselineUpdateMetadata(
			{
				CONVEX_QUERY_BASELINE_OWNER: '@reviewer',
				CONVEX_QUERY_BASELINE_REASON: 'Bounded legacy query retained for migration.',
				CONVEX_QUERY_BASELINE_EXPIRES: '2026-08-01'
			},
			'2026-07-18'
		),
		{
			owner: '@reviewer',
			reason: 'Bounded legacy query retained for migration.',
			expires: '2026-08-01'
		}
	);
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
selfCheckBaselineRegeneration();
const graph = buildModuleGraph(
	listTypeScriptFiles(CONVEX_DIR).map((filePath) => ({
		filePath,
		source: fs.readFileSync(filePath, 'utf8')
	}))
);
const scan = scanPublicQueries(graph);

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
const printCurrent = process.argv.includes('--print-current');
const acceptBaselineUpdate = process.argv.includes('--accept-baseline-update');
const clockOverrideError =
	process.env.CONVEX_QUERY_EFFICIENCY_TODAY === undefined
		? null
		: 'CONVEX_QUERY_EFFICIENCY_TODAY is not supported; expiry checks always use the runner UTC clock.';
if (printCurrent) {
	if (clockOverrideError) {
		console.error(clockOverrideError);
		process.exit(1);
	}
	if (!acceptBaselineUpdate) {
		console.error(
			'--print-current requires the explicit --accept-baseline-update acknowledgement.'
		);
		process.exit(1);
	}
	if (scan.errors.length > 0) {
		for (const error of scan.errors) console.error(`- ${error}`);
		process.exit(1);
	}
	try {
		const metadata = baselineUpdateMetadata(process.env, today);
		process.stdout.write(
			`${JSON.stringify(currentBaselineJson(scan, baseline, metadata), null, 2)}\n`
		);
		process.exit(0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

const errors = [
	...scan.errors,
	...validateBaselineShape(baseline, today),
	...(clockOverrideError ? [clockOverrideError] : [])
];
if (errors.length === 0) errors.push(...compare(scan, baseline));

const totals = summarize(scan);
console.log(
	`Convex query efficiency: ${scan.publicQueryCount} public queries in ${scan.moduleCount} modules; ` +
		`${totals.collect.calls} collect calls/${totals.collect.queries} queries, ` +
		`${totals.queryFilter.calls} query filters/${totals.queryFilter.queries} queries, ` +
		`${totals.dateNow.calls} clock reads/${totals.dateNow.queries} queries.`
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
