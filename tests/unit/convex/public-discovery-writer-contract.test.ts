/**
 * Fail-closed CI ratchet for the public-discovery no-drop contract.
 *
 * The AST pass scans every Convex source file. It resolves source tables from
 * literal inserts/queries, `v.id("table")` args, `Id<"table">` annotations,
 * query/get/insert-derived locals, and typed `_id` writes. Patches are
 * field-sensitive. A dynamic patch against a known source table, or a generic
 * normalizeId patch primitive, requires an explicit classification below.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
	PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
	PUBLIC_DISCOVERY_LIST_FRESHNESS_MAX_DELAY_MS,
	PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
	PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_BODY,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_HEADER,
	PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_PROTOCOL,
	PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS,
	PUBLIC_DISCOVERY_SOURCE_FAMILIES,
	publicDiscoveryManifestControlAttemptCoordinates,
	publicDiscoveryManifestControlRetryDelayMs,
	publicDiscoveryManifestControlRetryDisposition,
	type PublicDiscoverySourceTable
} from '../../../convex/lib/publicDiscovery';

const CONVEX_DIR = path.resolve(process.cwd(), 'convex');

type SourceTable = PublicDiscoverySourceTable;

const SOURCE_FIELDS: Record<SourceTable, ReadonlySet<string>> = {
	templates: new Set([
		'slug',
		'title',
		'description',
		'domain',
		'category',
		'domainHue',
		'topics',
		'type',
		'deliveryMethod',
		'messageBody',
		'preview',
		'orgId',
		'endorsementCount',
		'verifiedSends',
		'uniqueDistricts',
		'dailyArrivals',
		'dailyArrivalsLastDay',
		'districtCounts',
		'districtCountsSuppressedDistricts',
		'districtCountsSuppressedCount',
		'tierCounts',
		'deliveryConfig',
		'cwcConfig',
		'recipientConfig',
		'campaignId',
		'status',
		'isPublic',
		'jurisdictions',
		'scopes',
		'topicEmbedding',
		'tagEmbeddings'
	]),
	templateEndorsements: new Set(['templateId', 'orgId', 'endorsedAt']),
	debates: new Set([
		'templateId',
		'status',
		'winningStance',
		'uniqueParticipants',
		'argumentCount',
		'deadline'
	]),
	organizations: new Set(['name', 'slug', 'avatar'])
};

const SOURCE_TABLES = new Set<SourceTable>(
	Object.keys(PUBLIC_DISCOVERY_SOURCE_FAMILIES) as SourceTable[]
);
const DIRTY_HELPER_RE =
	/(?:markPublicDiscovery(?:ListDirty|RelationsDirty|ListAndRelationsDirty)|invalidatePublicDiscoveryAfterDestructiveSourceChange)\s*\(/;
const AGGREGATE_LIST_DIRTY_RE =
	/markPublicDiscoveryListDirty\s*\(\s*ctx,\s*['"]aggregate['"]/;
const AUTHORED_LIST_DIRTY_RE =
	/markPublicDiscoveryList(?:AndRelations)?Dirty\s*\(\s*ctx,\s*['"]authored['"]/;
const VISIBILITY_LIST_DIRTY_RE =
	/markPublicDiscoveryListDirty\s*\(\s*ctx,\s*['"]visibility['"]/;
const DISCRETE_STATUS_LIST_DIRTY_RE =
	/markPublicDiscoveryListDirty\s*\(\s*ctx,\s*['"]discreteStatus['"]/;
const AGGREGATE_LIST_AND_RELATIONS_DIRTY_RE =
	/markPublicDiscoveryListAndRelationsDirty\s*\(\s*ctx,\s*['"]aggregate['"]/;
const AGGREGATE_DEBATE_SYNC_RE =
	/syncDebateReadModel\s*\([\s\S]*['"]aggregate['"]\s*\)/;
const VISIBILITY_DEBATE_SYNC_RE =
	/syncDebateReadModel\s*\([\s\S]*['"]visibility['"]\s*\)/;
const DISCRETE_STATUS_DEBATE_SYNC_RE =
	/syncDebateReadModel\s*\([\s\S]*['"]discreteStatus['"]\s*\)/;

type Boundary = { file: string; name: string; body: string };
type Detection = { key: string; table: SourceTable | 'dynamic'; operation: string };
type TableCandidates = ReadonlySet<string>;

function mergeTableCandidates(...groups: Array<TableCandidates | undefined>): Set<string> {
	const merged = new Set<string>();
	for (const group of groups) {
		if (!group) continue;
		for (const table of group) merged.add(table);
	}
	return merged;
}

function singleTable(table: string | null): Set<string> {
	return table ? new Set([table]) : new Set();
}

function source(file: string): string {
	return readFileSync(path.join(CONVEX_DIR, file), 'utf8');
}

function listConvexSources(directory = CONVEX_DIR, prefix = ''): Array<{ file: string; src: string }> {
	const result: Array<{ file: string; src: string }> = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === '_generated') continue;
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			result.push(...listConvexSources(absolute, relative));
		} else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			result.push({ file: relative, src: readFileSync(absolute, 'utf8') });
		}
	}
	return result;
}

function boundaries(file: string, src: string): Boundary[] {
	const parsed = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
	const result: Boundary[] = [];
	const memberName = (node: ts.PropertyName | undefined, fallback: string): string =>
		(node && propertyName(node)) ?? fallback;
	const addObjectMembers = (prefix: string, object: ts.ObjectLiteralExpression): void => {
		for (const member of object.properties) {
			if (
				ts.isMethodDeclaration(member) ||
				ts.isGetAccessorDeclaration(member) ||
				ts.isSetAccessorDeclaration(member)
			) {
				result.push({
					file,
					name: `${prefix}.${memberName(member.name, member.name.getText(parsed))}`,
					body: `({${member.getText(parsed)}})`
				});
				continue;
			}
			if (!ts.isPropertyAssignment(member)) continue;
			const name = memberName(member.name, member.name.getText(parsed));
			const initializer = unwrap(member.initializer);
			if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
				result.push({
					file,
					name: `${prefix}.${name}`,
					body: initializer.getText(parsed)
				});
			} else if (ts.isObjectLiteralExpression(initializer)) {
				addObjectMembers(`${prefix}.${name}`, initializer);
			}
		}
	};
	for (const statement of parsed.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			result.push({ file, name: statement.name.text, body: statement.getText(parsed) });
			continue;
		}
		if (ts.isClassDeclaration(statement) && statement.name) {
			for (const member of statement.members) {
				if (
					ts.isMethodDeclaration(member) ||
					ts.isGetAccessorDeclaration(member) ||
					ts.isSetAccessorDeclaration(member)
				) {
					result.push({
						file,
						name: `${statement.name.text}.${memberName(member.name, member.name.getText(parsed))}`,
						body: `({${member.getText(parsed)}})`
					});
				} else if (ts.isConstructorDeclaration(member)) {
					result.push({
						file,
						name: `${statement.name.text}.constructor`,
						body: `({${member.getText(parsed)}})`
					});
				} else if (ts.isPropertyDeclaration(member) && member.initializer) {
					const initializer = unwrap(member.initializer);
					if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
						result.push({
							file,
							name: `${statement.name.text}.${memberName(member.name, member.name.getText(parsed))}`,
							body: initializer.getText(parsed)
						});
					}
				}
			}
			continue;
		}
		if (!ts.isVariableStatement(statement)) continue;
		const exported = statement.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
		);
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
			const initializer = unwrap(declaration.initializer);
			if (
				!exported &&
				!ts.isArrowFunction(initializer) &&
				!ts.isFunctionExpression(initializer) &&
				!ts.isObjectLiteralExpression(initializer)
			) {
				continue;
			}
			if (ts.isObjectLiteralExpression(initializer)) {
				addObjectMembers(declaration.name.text, initializer);
			} else {
				result.push({
					file,
					name: declaration.name.text,
					body: initializer.getText(parsed)
				});
			}
		}
	}
	return result;
}

function propertyName(node: ts.PropertyName): string | null {
	if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
		return node.text;
	}
	return null;
}

function unwrap(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (
		ts.isAwaitExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isParenthesizedExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function dbMethod(
	call: ts.CallExpression,
	parsed: ts.SourceFile,
	dbAliases: ReadonlySet<string> = new Set()
): string | null {
	if (!ts.isPropertyAccessExpression(call.expression)) return null;
	const receiver = call.expression.expression.getText(parsed);
	return /(?:^|\.)db$/.test(receiver) || dbAliases.has(receiver)
		? call.expression.name.text
		: null;
}

function literalTableCalls(
	node: ts.Node,
	parsed: ts.SourceFile,
	method: 'insert' | 'query' | 'normalizeId',
	dbAliases: ReadonlySet<string>
): Set<string> {
	const found = new Set<string>();
	const visit = (child: ts.Node): void => {
		if (ts.isCallExpression(child) && dbMethod(child, parsed, dbAliases) === method) {
			const first = child.arguments[0];
			if (first && ts.isStringLiteral(first)) {
				found.add(first.text);
			}
		}
		ts.forEachChild(child, visit);
	};
	visit(node);
	return found;
}

function nameTable(name: string): string | null {
	const lower = name.toLowerCase();
	if (lower.includes('templateendorsement') || lower.includes('endorsement')) {
		return 'templateEndorsements';
	}
	if (lower.includes('template')) return 'templates';
	if (lower.includes('debate')) return 'debates';
	if (/^(?:org|organization)/.test(lower)) return 'organizations';
	// Source-looking names may conservatively create false positives, but never
	// guess that an unresolved target belongs to a non-source table: a bad guess
	// there would silently exempt a real projection writer from the ratchet.
	return null;
}

function analyzeBoundary(boundary: Boundary): Detection[] {
	const parsed = ts.createSourceFile(
		`${boundary.file}:${boundary.name}.ts`,
		`(${boundary.body});`,
		ts.ScriptTarget.Latest,
		true
	);
	const idArgs = new Map<string, Set<string>>();
	const tableByVariable = new Map<string, Set<string>>();
	const variableInitializers = new Map<string, ts.Expression>();
	const assignedFields = new Map<string, Set<string>>();
	const dynamicAssignedVariables = new Set<string>();
	const dbAliases = new Set<string>();
	const addCandidates = (
		map: Map<string, Set<string>>,
		name: string,
		candidates: TableCandidates
	): void => {
		if (candidates.size === 0) return;
		map.set(name, mergeTableCandidates(map.get(name), candidates));
	};
	const isDatabaseExpression = (raw: ts.Expression): boolean => {
		const expression = unwrap(raw);
		const text = expression.getText(parsed);
		return /(?:^|\.)db$/.test(text) || (ts.isIdentifier(expression) && dbAliases.has(text));
	};
	// Track direct and chained aliases (`const store = ctx.db`) before scanning
	// calls. An alias cannot make a write disappear merely because it is not
	// literally spelled `ctx.db`.
	for (let pass = 0; pass < 4; pass++) {
		const collectAliases = (node: ts.Node): void => {
			if (ts.isVariableDeclaration(node) && node.initializer) {
				if (ts.isIdentifier(node.name) && isDatabaseExpression(node.initializer)) {
					dbAliases.add(node.name.text);
				} else if (
					ts.isObjectBindingPattern(node.name) &&
					unwrap(node.initializer).getText(parsed) === 'ctx'
				) {
					for (const element of node.name.elements) {
						const sourceName = element.propertyName?.getText(parsed) ?? element.name.getText(parsed);
						if (sourceName === 'db' && ts.isIdentifier(element.name)) dbAliases.add(element.name.text);
					}
				}
			}
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isIdentifier(node.left) &&
				isDatabaseExpression(node.right)
			) {
				dbAliases.add(node.left.text);
			}
			ts.forEachChild(node, collectAliases);
		};
		collectAliases(parsed);
	}
	const validatorTables = (node: ts.Node): Set<string> => {
		const tables = new Set<string>();
		const visit = (child: ts.Node): void => {
			if (ts.isCallExpression(child) && child.expression.getText(parsed) === 'v.id') {
				const argument = child.arguments[0];
				if (argument && ts.isStringLiteral(argument)) tables.add(argument.text);
			}
			ts.forEachChild(child, visit);
		};
		visit(node);
		return tables;
	};

	const precollect = (node: ts.Node): void => {
		if (ts.isPropertyAssignment(node)) {
			const tables = validatorTables(node.initializer);
			const name = propertyName(node.name);
			if (name) addCandidates(idArgs, name, tables);
		}
		if (
			(ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
			ts.isIdentifier(node.name)
		) {
			if (node.initializer) variableInitializers.set(node.name.text, node.initializer);
			const typeText = node.type?.getText(parsed) ?? '';
			const typedTables = new Set(
				[...typeText.matchAll(/(?:Id|GenericId|Doc)<['"]([^'"]+)['"]>/g)].map(
					(match) => match[1]
				)
			);
			addCandidates(tableByVariable, node.name.text, typedTables);
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isPropertyAccessExpression(node.left) &&
			ts.isIdentifier(node.left.expression)
		) {
			const fields = assignedFields.get(node.left.expression.text) ?? new Set<string>();
			fields.add(node.left.name.text);
			assignedFields.set(node.left.expression.text, fields);
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isElementAccessExpression(node.left) &&
			ts.isIdentifier(node.left.expression)
		) {
			dynamicAssignedVariables.add(node.left.expression.text);
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isIdentifier(node.left)
		) {
			dynamicAssignedVariables.add(node.left.text);
		}
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.expression.getText(parsed) === 'Object' &&
			node.expression.name.text === 'assign' &&
			node.arguments[0] &&
			ts.isIdentifier(unwrap(node.arguments[0]))
		) {
			dynamicAssignedVariables.add(unwrap(node.arguments[0]).getText(parsed));
		}
		ts.forEachChild(node, precollect);
	};
	precollect(parsed);

	const inferTables = (raw: ts.Expression): Set<string> => {
		const expression = unwrap(raw);
		if (ts.isIdentifier(expression)) {
			return mergeTableCandidates(
				tableByVariable.get(expression.text),
				idArgs.get(expression.text),
				singleTable(nameTable(expression.text))
			);
		}
		if (ts.isPropertyAccessExpression(expression)) {
			if (ts.isIdentifier(expression.expression) && expression.expression.text === 'args') {
				return mergeTableCandidates(
					idArgs.get(expression.name.text),
					singleTable(nameTable(expression.name.text))
				);
			}
			if (expression.name.text === '_id') return inferTables(expression.expression);
			return singleTable(nameTable(expression.name.text));
		}
		if (ts.isElementAccessExpression(expression)) {
			return inferTables(expression.expression);
		}
		if (
			ts.isCallExpression(expression) &&
			ts.isPropertyAccessExpression(expression.expression)
		) {
			return inferTables(expression.expression.expression);
		}
		if (ts.isConditionalExpression(expression)) {
			return mergeTableCandidates(
				inferTables(expression.whenTrue),
				inferTables(expression.whenFalse)
			);
		}
		return new Set();
	};

	// Resolve query/get/insert-derived local rows and ids. Repeat because a local
	// can derive from an earlier typed/query-derived local.
	for (let pass = 0; pass < 4; pass++) {
		const resolve = (node: ts.Node): void => {
			const resolveExpression = (variableName: string, expression: ts.Expression): void => {
				addCandidates(tableByVariable, variableName, inferTables(expression));
				addCandidates(
					tableByVariable,
					variableName,
					mergeTableCandidates(
						literalTableCalls(expression, parsed, 'query', dbAliases),
						literalTableCalls(expression, parsed, 'insert', dbAliases),
						literalTableCalls(expression, parsed, 'normalizeId', dbAliases)
					)
				);
				const visitGet = (child: ts.Node): void => {
					if (
						ts.isCallExpression(child) &&
						dbMethod(child, parsed, dbAliases) === 'get' &&
						child.arguments[0]
					) {
						addCandidates(tableByVariable, variableName, inferTables(child.arguments[0]));
					}
					ts.forEachChild(child, visitGet);
				};
				visitGet(expression);
			};
			if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
				resolveExpression(node.name.text, node.initializer);
			}
			if (
				ts.isBinaryExpression(node) &&
				node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				ts.isIdentifier(node.left)
			) {
				resolveExpression(node.left.text, node.right);
			}
			if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
				const declaration = node.initializer.declarations[0];
				if (declaration && ts.isIdentifier(declaration.name)) {
					const iterable = unwrap(node.expression);
					const pagedContainerTables =
						ts.isPropertyAccessExpression(iterable) &&
						['page', 'items', 'rows'].includes(iterable.name.text) &&
						ts.isIdentifier(iterable.expression)
							? tableByVariable.get(iterable.expression.text)
							: undefined;
					addCandidates(
						tableByVariable,
						declaration.name.text,
						mergeTableCandidates(
							literalTableCalls(node.expression, parsed, 'query', dbAliases),
							inferTables(node.expression),
							pagedContainerTables
						)
					);
				}
			}
			ts.forEachChild(node, resolve);
		};
		resolve(parsed);
	}

	const fieldsFor = (raw: ts.Expression, seen = new Set<string>()): Set<string> => {
		const expression = unwrap(raw);
		const result = new Set<string>();
		if (ts.isIdentifier(expression)) {
			if (seen.has(expression.text)) return result;
			seen.add(expression.text);
			const initializer = variableInitializers.get(expression.text);
			if (initializer) for (const field of fieldsFor(initializer, seen)) result.add(field);
			for (const field of assignedFields.get(expression.text) ?? []) result.add(field);
			return result;
		}
		if (ts.isObjectLiteralExpression(expression)) {
			for (const property of expression.properties) {
				if (ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
					const name = propertyName(property.name);
					if (name) result.add(name);
				} else if (ts.isShorthandPropertyAssignment(property)) {
					result.add(property.name.text);
				} else if (ts.isSpreadAssignment(property)) {
					for (const field of fieldsFor(property.expression, seen)) result.add(field);
				}
			}
			return result;
		}
		if (ts.isConditionalExpression(expression)) {
			for (const field of fieldsFor(expression.whenTrue, seen)) result.add(field);
			for (const field of fieldsFor(expression.whenFalse, seen)) result.add(field);
		}
		return result;
	};

	const hasDynamicFields = (raw: ts.Expression, seen = new Set<string>()): boolean => {
		const expression = unwrap(raw);
		if (ts.isIdentifier(expression)) {
			if (seen.has(expression.text)) return false;
			seen.add(expression.text);
			if (dynamicAssignedVariables.has(expression.text)) return true;
			const initializer = variableInitializers.get(expression.text);
			if (initializer) return hasDynamicFields(initializer, seen);
			return !assignedFields.has(expression.text);
		}
		if (ts.isObjectLiteralExpression(expression)) {
			return expression.properties.some((property) => {
				if (ts.isSpreadAssignment(property)) {
					return hasDynamicFields(property.expression, new Set(seen));
				}
				if (
					ts.isPropertyAssignment(property) ||
					ts.isMethodDeclaration(property) ||
					ts.isShorthandPropertyAssignment(property)
				) {
					return propertyName(property.name) === null;
				}
				return true;
			});
		}
		if (ts.isConditionalExpression(expression)) {
			return (
				hasDynamicFields(expression.whenTrue, new Set(seen)) ||
				hasDynamicFields(expression.whenFalse, new Set(seen))
			);
		}
		return true;
	};

	const detections: Detection[] = [];
	const unresolvedOperations = new Set<string>();
	const visitWrites = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const method = dbMethod(node, parsed, dbAliases);
			if (method === 'insert') {
				const tableArg = node.arguments[0];
				if (tableArg && ts.isStringLiteral(tableArg) && SOURCE_TABLES.has(tableArg.text as SourceTable)) {
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table: tableArg.text as SourceTable,
						operation: 'insert'
					});
				} else if (tableArg && !ts.isStringLiteral(tableArg)) {
					const operation = `unresolved-insert-target:${tableArg.getText(parsed)}`;
					if (unresolvedOperations.has(operation)) return;
					unresolvedOperations.add(operation);
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table: 'dynamic',
						operation
					});
				}
			} else if (
				(method === 'patch' || method === 'replace') &&
				node.arguments[0] &&
				node.arguments[1]
			) {
				const tables = inferTables(node.arguments[0]);
				const table = tables.size === 1 ? [...tables][0] : undefined;
				const fields = fieldsFor(node.arguments[1]);
				if (table && SOURCE_TABLES.has(table as SourceTable)) {
					const sourceTable = table as SourceTable;
					const projected = [...fields].some((field) => SOURCE_FIELDS[sourceTable].has(field));
					const dynamic = hasDynamicFields(node.arguments[1]);
					if (method === 'replace' || projected || dynamic) {
						detections.push({
							key: `${boundary.file}:${boundary.name}`,
							table: sourceTable,
							operation:
								method === 'replace'
									? 'replace'
									: dynamic
										? 'dynamic-patch'
										: 'projected-patch'
						});
					}
				} else if (tables.size !== 1) {
					const operation = `unresolved-${method}-target:${node.arguments[0].getText(parsed)}`;
					if (unresolvedOperations.has(operation)) return;
					unresolvedOperations.add(operation);
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table: 'dynamic',
						operation
					});
				}
			} else if (method === 'delete' && node.arguments[0]) {
				const tables = inferTables(node.arguments[0]);
				const table = tables.size === 1 ? [...tables][0] : undefined;
				if (table && SOURCE_TABLES.has(table as SourceTable)) {
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table: table as SourceTable,
						operation: 'delete'
					});
				} else if (tables.size !== 1) {
					const operation = `unresolved-delete-target:${node.arguments[0].getText(parsed)}`;
					if (unresolvedOperations.has(operation)) return;
					unresolvedOperations.add(operation);
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table: 'dynamic',
						operation
					});
				}
			}
		}
		ts.forEachChild(node, visitWrites);
	};
	visitWrites(parsed);

	return detections;
}

function directPropertyReads(boundary: Boundary, receivers: ReadonlySet<string>): Set<string> {
	const parsed = ts.createSourceFile(
		`${boundary.file}:${boundary.name}.ts`,
		boundary.body,
		ts.ScriptTarget.Latest,
		true
	);
	const fields = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (
			ts.isPropertyAccessExpression(node) &&
			ts.isIdentifier(node.expression) &&
			receivers.has(node.expression.text)
		) {
			fields.add(node.name.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(parsed);
	return fields;
}

const CONTRACT: Record<string, RegExp> = {
	'templates.ts:endorse': /persistEndorsementCount\s*\(/,
	'templates.ts:removeEndorsement': /persistEndorsementCount\s*\(/,
	'templates.ts:patchTemplateEmbeddingValues': AGGREGATE_LIST_AND_RELATIONS_DIRTY_RE,
	'templates.ts:createTemplate': AUTHORED_LIST_DIRTY_RE,
	'templates.ts:deleteTemplate': /invalidatePublicDiscoveryAfterDestructiveSourceChange\s*\(/,
	'templates.ts:patchMetadata': AUTHORED_LIST_DIRTY_RE,
	'templates.ts:patchTagEmbeddings': /markPublicDiscoveryRelationsDirty\s*\(/,
	'templates.ts:_patchDomainHue': AGGREGATE_LIST_DIRTY_RE,
	'templates.ts:persistEndorsementCount': AGGREGATE_LIST_DIRTY_RE,
	'templates.ts:migrateEndorsementCounts': AGGREGATE_LIST_DIRTY_RE,
	'submissions.ts:incrementTemplateReach': AGGREGATE_LIST_DIRTY_RE,
	'submissions.ts:_backfillOneTemplate': AGGREGATE_LIST_DIRTY_RE,
	'debates.ts:createArgument': AGGREGATE_DEBATE_SYNC_RE,
	'debates.ts:cosign': AGGREGATE_DEBATE_SYNC_RE,
	'debates.ts:updateStatus': DISCRETE_STATUS_DEBATE_SYNC_RE,
	'debates.ts:insertDebate': VISIBILITY_DEBATE_SYNC_RE,
	'debates.ts:_spawnDebateIfEligibleForce': VISIBILITY_DEBATE_SYNC_RE,
	'debates.ts:_spawnDebateIfEligible': VISIBILITY_DEBATE_SYNC_RE,
	// A newly-created organization ID cannot already be referenced by a template;
	// the later template/endorsement writer owns invalidation when it links one.
	'organizations.ts:create': /ctx\.db\.insert\(\s*['"]organizations['"]/,
	'organizations.ts:update': VISIBILITY_LIST_DIRTY_RE,
	'seed.ts:zeroTemplateMetrics': AGGREGATE_LIST_DIRTY_RE,
	'seed.ts:insertOrgs': /ctx\.db\.insert\(\s*['"]organizations['"]/,
	'seed.ts:insertTemplates': AGGREGATE_LIST_AND_RELATIONS_DIRTY_RE,
	'seed.ts:insertDebates': AGGREGATE_LIST_DIRTY_RE,
	'seed.ts:backfillScopes': AGGREGATE_LIST_DIRTY_RE
};

const DELEGATE_CONTRACT: Record<string, RegExp> = {
	'templates.ts:completePublicTemplateEmbeddings': /patchTemplateEmbeddingValues\s*\(/,
	'templates.ts:updateMissingEmbeddingsForBackfill': /patchTemplateEmbeddingValues\s*\(/
};

const COMPACT_TEMPLATE_SOURCE_CONTRACT: Record<string, RegExp> = {
	'templates.ts:persistEndorsementCount': /upsertCompactDiscoveryProjection\s*\(/,
	'templates.ts:migrateEndorsementCounts': /upsertCompactDiscoveryProjection\s*\(/,
	'templates.ts:patchMetadata': /upsertCompactDiscoveryProjection\s*\(/,
	'templates.ts:setCwcVerification': /upsertCompactDiscoveryProjection\s*\(/,
	'templates.ts:_patchDomainHue': /upsertCompactDiscoveryProjection\s*\(/,
	'templates.ts:migratePublicDiscoverySourcePage': /upsertCompactDiscoverySource\s*\(/,
	'templates.ts:patchTemplateEmbeddingValues': /upsertCompactDiscoverySource\s*\(/,
	'templates.ts:createTemplate': /upsertCompactDiscoverySource\s*\(/,
	'templates.ts:patchTagEmbeddings': /upsertCompactDiscoverySource\s*\(/,
	'submissions.ts:incrementTemplateReach': /syncCompactPublicDiscoveryProjection\s*\(/,
	'submissions.ts:_backfillOneTemplate': /syncCompactPublicDiscoveryProjection\s*\(/,
	'seed.ts:zeroTemplateMetrics': /syncCompactPublicDiscoveryProjection\s*\(/,
	'seed.ts:insertTemplates': /syncCompactPublicDiscoverySource\s*\(/,
	'seed.ts:backfillScopes': /syncCompactPublicDiscoveryProjection\s*\(/,
	'seed.ts:clearTable': /deleteCompactPublicDiscoverySource\s*\(/
};

const SAFE_DYNAMIC_CONTRACT: Record<string, RegExp> = {
	'_rateLimit.ts:cleanupExpired:unresolved-delete-target:row._id':
		/query\(["']rateLimits["']\)[\s\S]*ctx\.db\.delete\(row\._id\)/,
	'accountabilityReadModel.ts:activate:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'accountabilityReadModel.ts:migrate:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'accountabilityReadModel.ts:reprojectSupporterIdentityReceipts:unresolved-patch-target:_id':
		/ctx\.db\.patch\(\s*_id/,
	'analytics.ts:activateSnapshotPlane:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'analytics.ts:blockSnapshotRun:unresolved-patch-target:run._id':
		/ctx\.db\.patch\(\s*run\._id/,
	'analytics.ts:migrateAggregateRowsPage:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'analytics.ts:migrateBudgetRowsPage:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'analytics.ts:migrateBudgetRowsPage:unresolved-patch-target:run._id':
		/ctx\.db\.patch\(\s*run\._id/,
	'analytics.ts:migrateSnapshotPlane:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'analytics.ts:migrateSnapshotRowsPage:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'authOps.ts:backfillTokenIdentifier:unresolved-patch-target:user._id':
		/db\.patch\(user\._id/,
	'authOps.ts:upsertFromOAuth:unresolved-patch-target:existingAccount.userId':
		/db\.patch\(existingAccount\.userId/,
	'backfill.ts:patchRow:unresolved-patch-target:normalizedId':
		/ALLOWED_BACKFILL_TABLES\.includes/,
	'donations.ts:activateDonationConfirmationSummaries:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'donations.ts:updateStatus:unresolved-patch-target:donation.campaignId':
		/ctx\.db\.patch\(donation\.campaignId/,
	'email.ts:queueExactServerDispatch:unresolved-patch-target:args.blastId':
		/ctx\.db\.patch\(args\.blastId/,
	'email.ts:suppressReportedBounce:unresolved-patch-target:fanout.jobId':
		/ctx\.db\.patch\(\s*fanout\.jobId/,
	'ground.ts:persistGroundBundle:unresolved-patch-target:vault._id':
		/ctx\.db\.patch\(vault\._id/,
	'legislation.ts:backfillVoteReceiptResponses:unresolved-patch-target:receipt._id':
		/ctx\.db\.patch\(\s*receipt\._id/,
	'legislation.ts:importRepresentatives:unresolved-patch-target:dm._id':
		/ctx\.db\.patch\(dm\._id/,
	'legislation.ts:pruneDependentTableBatch:unresolved-delete-target:row._id':
		/PRUNE_ALL_DEPENDENT_TABLES\.includes/,
	'legislation.ts:pruneDependentTableBatch:unresolved-patch-target:row._id':
		/PRUNE_ALL_DEPENDENT_TABLES\.includes/,
	'lib/accountabilityReadModelDb.ts:writeUserProjectionForIdentity:unresolved-delete-target:existing._id':
		/ctx\.db\.delete\(\s*existing\._id/,
	'lib/accountabilityReadModelDb.ts:writeUserProjectionForIdentity:unresolved-patch-target:existing._id':
		/ctx\.db\.patch\(\s*existing\._id/,
	'lib/campaignReadModelDb.ts:applyCampaignActionReadModel:unresolved-patch-target:model._id':
		/ctx\.db\.patch\(\s*model\._id/,
	'lib/campaignReadModelDb.ts:applyCampaignDeliveryTransitionReadModel:unresolved-patch-target:baseline.model._id':
		/ctx\.db\.patch\(\s*baseline\.model\._id/,
	'lib/campaignReadModelDb.ts:applyCampaignVerifyClickReadModel:unresolved-patch-target:baseline.model._id':
		/ctx\.db\.patch\(\s*baseline\.model\._id/,
	'lib/campaignReadModelDb.ts:baselineDelivery:unresolved-patch-target:model._id':
		/ctx\.db\.patch\(\s*model\._id/,
	'lib/coalitionMetrics.ts:applyCoalitionActionTransition:unresolved-patch-target:after._id':
		/ctx\.db\.patch\(\s*after\._id/,
	'lib/coalitionMetrics.ts:applyCoalitionReceiptProjection:unresolved-patch-target:receipt._id':
		/ctx\.db\.patch\(\s*receipt\._id/,
	'lib/coalitionMetrics.ts:applyCoalitionSupporterTransition:unresolved-patch-target:mergedAfter._id':
		/ctx\.db\.patch\(\s*mergedAfter\._id/,
	'lib/coalitionMetrics.ts:applyCoalitionSupporterTransitionsBatch:unresolved-patch-target:mergedAfter._id':
		/ctx\.db\.patch\(\s*mergedAfter\._id/,
	'lib/coalitionMetrics.ts:applyOrgMetricDelta:unresolved-patch-target:current._id':
		/ctx\.db\.patch\(\s*current\._id/,
	'lib/contactAuthority.ts:writeContactAuthority:unresolved-patch-target:existing._id':
		/ctx\.db\.patch\(\s*existing\._id/,
	'lib/debateReadModel.ts:syncDebateReadModel:unresolved-replace-target:existing._id':
		/ctx\.db\.replace\(\s*existing\._id/,
	'lib/orgWebhookPolicy.ts:deleteDeliveryPage:unresolved-delete-target:row._id':
		/ctx\.db\.delete\(\s*row\._id/,
	'lib/orgWebhookPolicy.ts:deleteOwnedOrgWebhook:unresolved-delete-target:webhook._id':
		/ctx\.db\.delete\(\s*webhook\._id/,
	'lib/orgWebhookPolicy.ts:rotateOwnedOrgWebhookSecret:unresolved-patch-target:webhook._id':
		/ctx\.db\.patch\(\s*webhook\._id/,
	'lib/orgWebhookPolicy.ts:updateOwnedOrgWebhook:unresolved-patch-target:webhook._id':
		/ctx\.db\.patch\(\s*webhook\._id/,
	'lib/planUsageReservations.ts:reconcileEmailReservation:unresolved-patch-target:reservation._id':
		/ctx\.db\.patch\(\s*reservation\._id/,
	'lib/publicDiscovery.ts:activatePublicDiscoveryManifestAuthority:unresolved-replace-target:authority._id':
		/toPublicDiscoveryManifestAuthorityProjection\(manifest\)[\s\S]*ctx\.db\.replace\(authority\._id/,
	'lib/publicDiscovery.ts:assertPublicDiscoveryCoordinatedRebuildAuthorized:unresolved-patch-target:manifest._id':
		/getPublicDiscoveryManifestRow\(ctx\)[\s\S]*ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:commitPublicDiscoveryListPublication:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:commitPublicDiscoveryRelationsPublication:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:completePublicDiscoveryCoordinatedRebuild:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:invalidatePublicDiscoveryAfterDestructiveSourceChange:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:invalidatePublicDiscoveryForCoordinatedRebuild:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:markPublicDiscoveryFamiliesDirty:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:reschedulePublicDiscoveryListRefresh:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:reschedulePublicDiscoveryRelationsRefresh:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:schedulePublicDiscoveryManifestControlPush:unresolved-patch-target:manifest._id':
		/manifestControlPushToken[\s\S]*ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:supervisePublicDiscoveryCoordinatedRebuildLeaseRow:unresolved-patch-target:manifest._id':
		/coordinatedRebuildFailureAt[\s\S]*ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:supervisePublicDiscoveryCoordinatedRebuildWatchdog:unresolved-patch-target:manifest._id':
		/getPublicDiscoveryManifestRow\(ctx\)[\s\S]*coordinatedRebuildWatchdogScheduledAt[\s\S]*ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:syncPublicDiscoveryManifestAuthorityIfActive:unresolved-replace-target:authority._id':
		/toPublicDiscoveryManifestAuthorityProjection\(manifest\)[\s\S]*ctx\.db\.replace\(authority\._id/,
	'templates.ts:claimPublicDiscoveryManifestControlPush:unresolved-patch-target:manifest._id':
		/manifestControlPushToken[\s\S]*ctx\.db\.patch\(manifest\._id/,
	'templates.ts:requeuePublicDiscoveryManifestControlPush:unresolved-patch-target:manifest._id':
		/manifestControlPushToken[\s\S]*ctx\.db\.patch\(manifest\._id/,
	'lib/publicOrganizationDirectory.ts:syncPublicOrganizationDirectory:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'lib/publicTemplateDiscoverySource.ts:deleteCompactPublicDiscoverySource:unresolved-delete-target:source._id':
		/query\(["']publicTemplateDiscoverySources["']\)[\s\S]*ctx\.db\.delete\(source\._id/,
	'lib/publicTemplateDiscoverySource.ts:deleteCompactPublicDiscoverySource:unresolved-delete-target:topic._id':
		/query\(["']publicTemplateTopicVectors["']\)[\s\S]*ctx\.db\.delete\(topic\._id/,
	'lib/publicTemplateDiscoverySource.ts:deleteCompactPublicDiscoverySource:unresolved-delete-target:detail._id':
		/query\(["']publicTemplateDetailProjections["']\)[\s\S]*ctx\.db\.delete\(detail\._id/,
	'lib/publicTemplateDiscoverySource.ts:deleteCompactPublicDiscoverySource:unresolved-delete-target:pageCoordinate._id':
		/query\(["']publicTemplatePageArtifactCoordinates["']\)[\s\S]*ctx\.db\.delete\(pageCoordinate\._id/,
	'lib/publicTemplateDiscoverySource.ts:syncCompactPublicDiscoveryProjectionRow:unresolved-delete-target:existingDetail._id':
		/query\(["']publicTemplateDetailProjections["']\)[\s\S]*ctx\.db\.delete\(existingDetail\._id/,
	'lib/publicTemplateDiscoverySource.ts:syncCompactPublicDiscoveryProjectionRow:unresolved-delete-target:existingSource._id':
		/query\(["']publicTemplateDiscoverySources["']\)[\s\S]*ctx\.db\.delete\(existingSource\._id/,
	'lib/publicTemplateDiscoverySource.ts:syncCompactPublicDiscoveryProjectionRow:unresolved-patch-target:existingDetail._id':
		/query\(["']publicTemplateDetailProjections["']\)[\s\S]*ctx\.db\.patch\(existingDetail\._id/,
	'lib/publicTemplateDiscoverySource.ts:syncCompactPublicDiscoveryProjectionRow:unresolved-patch-target:existingSource._id':
		/query\(["']publicTemplateDiscoverySources["']\)[\s\S]*ctx\.db\.patch\(existingSource\._id/,
	'lib/recipientMetrics.ts:persistSummary:unresolved-patch-target:existing._id':
		/existing: Awaited<ReturnType<typeof metricSummary>>[\s\S]*ctx\.db\.patch\(existing\._id[\s\S]*ctx\.db\.insert\(["']templateRecipientMetrics["']/,
	'lib/sessionAuthority.ts:syncSessionAuthority:unresolved-delete-target:existing._id':
		/ctx\.db\.delete\(\s*existing\._id/,
	'lib/sessionAuthority.ts:syncSessionAuthority:unresolved-patch-target:existing._id':
		/ctx\.db\.patch\(\s*existing\._id/,
	'lib/supporterBrowse.ts:attachSupporterTagProjection:unresolved-patch-target:supporter._id':
		/ctx\.db\.patch\(\s*supporter\._id/,
	'lib/supporterBrowse.ts:detachAllSupporterTagProjections:unresolved-delete-target:link._id':
		/ctx\.db\.delete\(\s*link\._id/,
	'lib/supporterBrowse.ts:detachSupporterTagProjection:unresolved-patch-target:supporter._id':
		/ctx\.db\.patch\(\s*supporter\._id/,
	'messageJobs.ts:checkpointPhase:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:completeEncrypted:unresolved-patch-target:job._id':
		/ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:expireJob:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:fail:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:markRunning:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'networks.ts:continueCoalitionCleanup:unresolved-delete-target:row._id':
		/ctx\.db\.delete\(\s*row\._id/,
	'networks.ts:remove:unresolved-patch-target:m._id': /ctx\.db\.patch\(\s*m\._id/,
	'orgWebhooks.ts:expireOldDeliveryHistory:unresolved-delete-target:row._id':
		/ctx\.db\.delete\(\s*row\._id/,
	'orgWebhooks.ts:expireOldEvents:unresolved-delete-target:row._id':
		/ctx\.db\.delete\(\s*row\._id/,
	'orgWebhooks.ts:markDeliveryDead:unresolved-patch-target:delivery.webhookId':
		/ctx\.db\.patch\(delivery\.webhookId/,
	'orgWebhooks.ts:markDeliverySuccess:unresolved-patch-target:delivery.webhookId':
		/ctx\.db\.patch\(delivery\.webhookId/,
	'organizations.ts:activatePublicOrganizationDirectory:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'planUsage.ts:adoptCampaignDeliveriesPage:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'planUsage.ts:adoptWorkflowEmailsPage:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'planUsage.ts:applyCarrierEvidenceToSource:unresolved-patch-target:row._id':
		/ctx\.db\.patch\(\s*row\._id/,
	'planUsage.ts:auditLegacyEmailBlastsPage:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'planUsage.ts:finalizeRepair:unresolved-patch-target:repair._id':
		/ctx\.db\.patch\(\s*repair\._id/,
	'planUsage.ts:restartOrFinalizeOrganization:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'planUsage.ts:restartRepair:unresolved-patch-target:repair._id':
		/ctx\.db\.patch\(\s*repair\._id/,
	'planUsage.ts:scanRepairPage:unresolved-patch-target:repair._id':
		/ctx\.db\.patch\(\s*repair\._id/,
	'planUsage.ts:scanSourcePage:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'planUsage.ts:scheduleRepair:unresolved-patch-target:repair._id':
		/ctx\.db\.patch\(\s*repair\._id/,
	'planUsage.ts:selectOrganization:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'seed.ts:clearTable:unresolved-delete-target:doc._id':
		/SEED_TABLES\.includes/,
	'seed.ts:clearTable:unresolved-patch-target:templateId':
		/table === ["']templateEndorsements["'][\s\S]*ctx\.db\.patch\(templateId[\s\S]*syncCompactPublicDiscoveryProjection/,
	'seed.ts:patchSeedRecord:unresolved-patch-target:normalizedId': /ALLOWED_SEED_TABLES\.includes/,
	'seed.ts:patchSeedRecord:unresolved-patch-target:supporterId':
		/table === ['"]supporters['"][\s\S]*ctx\.db\.patch\(\s*supporterId/,
	'sessionAuthority.ts:activateSessionAuthorities:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'sessionAuthority.ts:migrateSessionAuthorities:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'sms.ts:activateSmsReplySummaries:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'subscriptions.ts:updateByStripeId:unresolved-patch-target:sub._id':
		/ctx\.db\.patch\(\s*sub\._id/,
	'subscriptions.ts:updateMyStripeCustomerId:unresolved-patch-target:userId':
		/ctx\.db\.patch\(userId/,
	'subscriptions.ts:upsertFromStripe:unresolved-patch-target:existing._id':
		/ctx\.db\.patch\(\s*existing\._id/,
	'subscriptions.ts:upsertIndividualFromStripe:unresolved-patch-target:existing._id':
		/ctx\.db\.patch\(\s*existing\._id/,
	'supporters.ts:migrateSupporterBrowse:unresolved-delete-target:link._id':
		/ctx\.db\.delete\(\s*link\._id/,
	'supporters.ts:migrateSupporterBrowse:unresolved-patch-target:link._id':
		/ctx\.db\.patch\(\s*link\._id/,
	'supporters.ts:migrateSupporterBrowse:unresolved-patch-target:supporter._id':
		/ctx\.db\.patch\(\s*supporter\._id/,
	'supporters.ts:migrateSupporterBrowse:unresolved-patch-target:tag._id':
		/ctx\.db\.patch\(\s*tag\._id/,
	'templates.ts:activatePublicDiscoverySourcePlane:unresolved-patch-target:migration._id':
		/publicDiscoverySourceMigrationRow\(ctx\)[\s\S]*ctx\.db\.patch\(migration\._id/,
	'templates.ts:activateTemplateListProjection:unresolved-patch-target:migration._id':
		/getTemplateListProjectionMigration\(ctx\)[\s\S]*ctx\.db\.patch\(migration\._id/,
	'templates.ts:flushScheduledPublicTemplateRefresh:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'templates.ts:flushScheduledPublicTemplateRefresh:unresolved-patch-target:publishedManifest._id':
		/ctx\.db\.patch\(publishedManifest\._id/,
	'templates.ts:flushScheduledPublicTemplateRelationsRefresh:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'templates.ts:flushScheduledPublicTemplateRelationsRefresh:unresolved-patch-target:publishedManifest._id':
		/ctx\.db\.patch\(publishedManifest\._id/,
	'templates.ts:migratePublicDiscoverySourcePage:unresolved-patch-target:existing._id':
		/publicDiscoverySourceMigrationRow\(ctx\)[\s\S]*ctx\.db\.patch\(existing\._id/,
	'templates.ts:migratePublicDiscoverySourcePage:unresolved-patch-target:migration._id':
		/publicDiscoverySourceMigrationRow\(ctx\)[\s\S]*ctx\.db\.patch\(migration\._id/,
	'templates.ts:migrateTemplateListProjection:unresolved-patch-target:migration._id':
		/getTemplateListProjectionMigration\(ctx\)[\s\S]*ctx\.db\.patch\(migration\._id/,
	'templates.ts:publishPublicTemplateSnapshotPlan:unresolved-patch-target:committedManifest._id':
		/getPublicDiscoveryManifestRow\(ctx\)[\s\S]*ctx\.db\.patch\(committedManifest\._id/,
	'templatePage.ts:migrateRecipientMetrics:unresolved-patch-target:message._id':
		/query\(["']messages["']\)[\s\S]*ctx\.db\.patch\(message\._id/,
	'templatePage.ts:migrateRecipientMetrics:unresolved-patch-target:registration._id':
		/query\(["']positionRegistrations["']\)[\s\S]*ctx\.db\.patch\(registration\._id/,
	'templates.ts:publishRelationSnapshotRebuild:unresolved-patch-target:existing._id':
		/ctx\.db\.patch\(existing\._id/,
	'users.ts:connectWallet:unresolved-patch-target:userId': /ctx\.db\.patch\(userId/,
	'users.ts:disconnectWallet:unresolved-patch-target:userId': /ctx\.db\.patch\(userId/,
	'users.ts:updateProfile:unresolved-patch-target:userId': /ctx\.db\.patch\(userId/,
	'users.ts:verifyAddress:unresolved-patch-target:cred._id': /ctx\.db\.patch\(\s*cred\._id/,
	'v1api.ts:authenticateApiKey:unresolved-patch-target:keyBucket._id':
		/ctx\.db\.patch\(\s*keyBucket\._id/,
	'webhooks.ts:completeDonation:unresolved-patch-target:campaign._id':
		/ctx\.db\.patch\(campaign\._id/,
	'webhooks.ts:handleInboundSms:unresolved-patch-target:result.jobId':
		/ctx\.db\.patch\(\s*result\.jobId/,
	'webhooks.ts:recordSoftBounces:unresolved-patch-target:result.jobId':
		/ctx\.db\.patch\(\s*result\.jobId/,
	'webhooks.ts:refundDonation:unresolved-patch-target:campaign._id':
		/ctx\.db\.patch\(campaign\._id/,
	'webhooks.ts:resetSoftBounce:unresolved-patch-target:result.jobId':
		/ctx\.db\.patch\(\s*result\.jobId/,
	'webhooks.ts:updateSmsStatus:unresolved-patch-target:blast._id':
		/ctx\.db\.patch\(blast\._id/,
	'webhooks.ts:updateSupporterEmailStatus:unresolved-patch-target:result.jobId':
		/ctx\.db\.patch\(\s*result\.jobId/,
	'workflows.ts:activateWorkflowExecutionCounts:unresolved-patch-target:migration._id':
		/ctx\.db\.patch\(\s*migration\._id/,
	'workflows.ts:migrateWorkflowExecutionCounts:unresolved-patch-target:execution._id':
		/ctx\.db\.patch\(\s*execution\._id/,
	'workflows.ts:migrateWorkflowExecutionCounts:unresolved-patch-target:workflow._id':
		/ctx\.db\.patch\(\s*workflow\._id/
};

describe('public-discovery source writer contract', () => {
	const allBoundaries = listConvexSources().flatMap(({ file, src }) => boundaries(file, src));
	const boundaryByKey = new Map(allBoundaries.map((boundary) => [`${boundary.file}:${boundary.name}`, boundary]));

	it('codifies prompt product freshness separately from aggregate cost ceilings', () => {
		expect(PUBLIC_DISCOVERY_LIST_FRESHNESS_MAX_DELAY_MS).toEqual({
			authored: PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
			visibility: PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
			discreteStatus: PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS,
			aggregate: PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS
		});
		expect(PUBLIC_DISCOVERY_LIST_DEBOUNCE_MS).toBe(60_000);
		expect(PUBLIC_DISCOVERY_LIST_MIN_REBUILD_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
		expect(PUBLIC_DISCOVERY_RELATIONS_MIN_REBUILD_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
	});

	it('detects every projection-source writer across Convex and requires an explicit contract', () => {
		const detections = allBoundaries.flatMap(analyzeBoundary);
		const detectedKeys = [
			...new Set(
				detections.filter(({ table }) => table !== 'dynamic').map(({ key }) => key)
			)
		].sort();
		expect(
			detectedKeys,
			`A Convex mutation/helper gained or lost a projected source write. Add a same-boundary ` +
				`dirty marker, or explicitly classify a safe dynamic/fail-closed primitive.`
		).toEqual(Object.keys(CONTRACT).sort());

		for (const [key, required] of Object.entries(CONTRACT)) {
			const boundary = boundaryByKey.get(key);
			expect(boundary, `${key} is classified but no longer exists`).toBeDefined();
			expect(boundary!.body, `${key} no longer satisfies its invalidation/classification`).toMatch(
				required
			);
		}
	});

	it('pins delegated writer boundaries to the marked shared helper', () => {
		for (const [key, required] of Object.entries(DELEGATE_CONTRACT)) {
			const boundary = boundaryByKey.get(key);
			expect(boundary, `${key} is classified but no longer exists`).toBeDefined();
			expect(boundary!.body).toMatch(required);
		}
	});

	it('keeps template-owned compact sources atomic with submission and seed writers', () => {
		for (const [key, required] of Object.entries(COMPACT_TEMPLATE_SOURCE_CONTRACT)) {
			const boundary = boundaryByKey.get(key);
			expect(boundary, `${key} is classified but no longer exists`).toBeDefined();
			expect(boundary!.body, `${key} no longer maintains its compact source row`).toMatch(
				required
			);
		}

		for (const key of [
			'templates.ts:persistEndorsementCount',
			'templates.ts:migrateEndorsementCounts',
			'templates.ts:patchMetadata',
			'templates.ts:_patchDomainHue',
			'submissions.ts:incrementTemplateReach',
			'submissions.ts:_backfillOneTemplate',
			'seed.ts:zeroTemplateMetrics',
			'seed.ts:backfillScopes'
		]) {
			const body = boundaryByKey.get(key)!.body;
			expect(body.indexOf('ctx.db.patch'), `${key} must patch the template first`).toBeLessThan(
				Math.max(
					body.indexOf('syncCompactPublicDiscoveryProjection'),
					body.indexOf('upsertCompactDiscoveryProjection')
				)
			);
			const syncIndex = Math.max(
				body.indexOf('syncCompactPublicDiscoveryProjection'),
				body.indexOf('upsertCompactDiscoveryProjection')
			);
			expect(
				syncIndex,
				`${key} must sync before it dirties the materialized view`
			).toBeLessThan(body.indexOf('markPublicDiscoveryList'));
		}

		const cwcVerification = boundaryByKey.get('templates.ts:setCwcVerification')!.body;
		expect(cwcVerification.indexOf('ctx.db.patch')).toBeLessThan(
			cwcVerification.indexOf('upsertCompactDiscoveryProjection')
		);

		const clear = boundaryByKey.get('seed.ts:clearTable')!.body;
		expect(clear).toMatch(
			/table === ["']templates["'][\s\S]*deleteCompactPublicDiscoverySource\(ctx, doc\._id/
		);
		expect(clear.indexOf('deleteCompactPublicDiscoverySource')).toBeLessThan(
			clear.indexOf('ctx.db.delete')
		);
		expect(clear).toMatch(/catch \(err\)[\s\S]*table === ["']templates["'][\s\S]*throw err/);
		expect(clear).toMatch(/publicTemplateDiscoverySources/);
		expect(clear).toMatch(/publicTemplateTopicVectors/);
		expect(clear).not.toMatch(/publicTagEmbeddingVectors/);
	});

	it('routes published deletion through immediate fail-closed list and relation invalidation', () => {
		const deletion = boundaryByKey.get('templates.ts:deleteTemplate')!.body;
		const sourceDeleteAt = deletion.indexOf('deleteCompactDiscoveryRows');
		const templateDeleteAt = deletion.indexOf('ctx.db.delete');
		const invalidateAt = deletion.indexOf('invalidatePublicDiscoveryAfterDestructiveSourceChange');
		expect(sourceDeleteAt).toBeGreaterThanOrEqual(0);
		expect(sourceDeleteAt).toBeLessThan(templateDeleteAt);
		expect(templateDeleteAt).toBeLessThan(invalidateAt);
		expect(deletion).toMatch(
			/invalidatePublicDiscoveryAfterDestructiveSourceChange\(ctx,\s*\{\s*list:\s*true,\s*relations:\s*true\s*\}\)/
		);

		const destructive = boundaryByKey.get(
			'lib/publicDiscovery.ts:invalidatePublicDiscoveryAfterDestructiveSourceChange'
		)!.body;
		expect(destructive).toMatch(/listReady:\s*false/);
		expect(destructive).toMatch(/relationsReady:\s*false/);
		expect(destructive).toMatch(/listRefreshUrgency:\s*['"]urgent['"]/);
		expect(destructive).toMatch(/relationsRefreshUrgency:\s*['"]urgent['"]/);
	});

	it('requires an exact classification for every unresolved database target', () => {
		const detections = allBoundaries
			.flatMap(analyzeBoundary)
			.filter(({ table }) => table === 'dynamic')
			.map(({ key, operation }) => `${key}:${operation}`)
			.sort();
		expect(detections).toEqual(Object.keys(SAFE_DYNAMIC_CONTRACT).sort());
		for (const [id, required] of Object.entries(SAFE_DYNAMIC_CONTRACT)) {
			const separator = id.indexOf(':unresolved-');
			const key = separator === -1 ? id.slice(0, id.lastIndexOf(':')) : id.slice(0, separator);
			const boundary = boundaryByKey.get(key);
			expect(boundary, `${id} is classified but its boundary no longer exists`).toBeDefined();
			expect(boundary!.body, `${id} lost its safe dynamic-table guard`).toMatch(required);
		}
	});

	it('pins the unconditional manifest read that carries the empty-patch OCC invariant', () => {
		const boundary = boundaryByKey.get(
			'lib/publicDiscovery.ts:markPublicDiscoveryFamiliesDirty'
		);
		expect(boundary).toBeDefined();
		expect(boundary!.body).toMatch(/LOAD-BEARING NO-DROP READ/);
		expect(
			boundary!.body.match(/getPublicDiscoveryManifestRow\(ctx\)/g)
		).toHaveLength(1);
		expect(boundary!.body.indexOf('getPublicDiscoveryManifestRow(ctx)')).toBeLessThan(
			boundary!.body.indexOf('planListRefresh')
		);
		expect(boundary!.body).toMatch(/coordinatedRebuildToken[\s\S]*COORDINATED_REBUILD_LOCKED/);
		expect(boundary!.body.indexOf('coordinatedRebuildToken')).toBeLessThan(
			boundary!.body.indexOf('planListRefresh')
		);
	});

	it('keeps the coordinated lock private and represented honestly in schema', () => {
		const schemaSource = source('schema.ts');
		const manifestSchema = schemaSource.slice(
			schemaSource.indexOf('publicDiscoveryManifest: defineTable'),
			schemaSource.indexOf(".index('by_key'", schemaSource.indexOf('publicDiscoveryManifest: defineTable'))
		);
		expect(manifestSchema).toMatch(/coordinatedRebuildToken:\s*v\.optional\(v\.string\(\)\)/);
		expect(manifestSchema).toMatch(/coordinatedRebuildStartedAt:\s*v\.optional\(v\.number\(\)\)/);
		expect(manifestSchema).toMatch(
			/coordinatedRebuildWatchdogScheduledAt:\s*v\.optional\(v\.number\(\)\)/
		);

		const discoverySource = source('lib/publicDiscovery.ts');
		const publicProjection = discoverySource.slice(
			discoverySource.indexOf('export function toPublicDiscoveryManifestPayload'),
			discoverySource.indexOf('export async function getPublicDiscoveryManifestRow')
		);
		expect(publicProjection).not.toMatch(
			/coordinatedRebuildToken|coordinatedRebuildStartedAt|coordinatedRebuildWatchdogScheduledAt/
		);
	});

	it('coalesces producer manifest pushes through one durable, token-fenced slot', () => {
		const schemaSource = source('schema.ts');
		expect(schemaSource).toMatch(/manifestControlPushToken:\s*v\.optional\(v\.string\(\)\)/);
		expect(schemaSource).toMatch(
			/manifestControlPushLastOutcome:\s*v\.optional\([\s\S]*v\.literal\('contained'\)[\s\S]*v\.literal\('attemptsExhausted'\)[\s\S]*v\.literal\('ageExhausted'\)/
		);
		for (const coordinate of [
			'manifestControlPushLastOutcomeAt',
			'manifestControlPushLastOutcomeAttempt',
			'manifestControlPushLastOutcomeStartedAt'
		]) {
			expect(schemaSource).toMatch(new RegExp(`${coordinate}:\\s*v\\.optional\\(v\\.number\\(\\)\\)`));
		}

		const scheduler = boundaryByKey.get(
			'lib/publicDiscovery.ts:schedulePublicDiscoveryManifestControlPush'
		);
		expect(scheduler).toBeDefined();
		expect(scheduler!.body).toMatch(/manifestControlPushToken\s*!==\s*undefined[\s\S]*return/);
		expect(scheduler!.body).toMatch(/crypto\.randomUUID\(\)/);
		expect(scheduler!.body).toMatch(
			/ctx\.db\.patch\(manifest\._id,\s*\{\s*manifestControlPushToken:\s*token\s*\}\)/
		);
		expect(scheduler!.body).toMatch(
			/ctx\.scheduler\.runAfter\(0,\s*pushPublicDiscoveryManifestControlRef,\s*\{[\s\S]*attempt:\s*1[\s\S]*startedAt[\s\S]*token/
		);

		const claim = boundaryByKey.get('templates.ts:claimPublicDiscoveryManifestControlPush');
		expect(claim).toBeDefined();
		expect(claim!.body).toMatch(/manifestControlPushToken\s*!==\s*args\.token[\s\S]*return false/);
		expect(claim!.body).toMatch(/manifestControlPushToken:\s*undefined/);
		const requeue = boundaryByKey.get('templates.ts:requeuePublicDiscoveryManifestControlPush');
		expect(requeue).toBeDefined();
		expect(requeue!.body).toMatch(
			/manifestControlPushToken\s*!==\s*undefined[\s\S]*superseded:\s*true/
		);
		expect(requeue!.body).toMatch(/manifestControlPushToken:\s*args\.token/);
		expect(requeue!.body).toMatch(
			/ctx\.scheduler\.runAfter\(args\.delayMs,\s*pushPublicDiscoveryManifestControlRef/
		);
		expect(requeue!.body).toMatch(
			/args\.outcome\s*!==\s*undefined[\s\S]*manifestControlPushLastOutcome:\s*args\.outcome/
		);
		const action = boundaryByKey.get('templates.ts:pushPublicDiscoveryManifestControl');
		expect(action).toBeDefined();
		expect(action!.body.indexOf('ctx.runMutation')).toBeLessThan(
			action!.body.indexOf('process.env.PUBLIC_DISCOVERY_MANIFEST_REFRESH_URL')
		);
		expect(action!.body).toMatch(/DISCOVERY_MANIFEST_REFRESH_SECRET/);
		expect(action!.body).not.toMatch(/DISCOVERY_MANIFEST_REFRESH_SECRET_PREVIOUS/);
		expect(action!.body).toMatch(/new TextEncoder\(\)\.encode\(secret\)\.byteLength\s*<\s*32/);
		expect(action!.body).not.toMatch(/process\.env\.INTERNAL_API_SECRET/);
		expect(action!.body).toMatch(/readBoundedManifestRefreshFailure\(response\)/);
		expect(action!.body).not.toMatch(/response\.text\(\)/);
		expect(action!.body).toMatch(
			/response\.status\s*===\s*202[\s\S]*PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER[\s\S]*publicDiscoveryManifestControlRetryDelayMs[\s\S]*requeuePublicDiscoveryManifestControlPushRef/
		);
		expect(action!.body).toMatch(
			/isExactPublicDiscoveryManifestRefreshContainment\(response\)[\s\S]*settle\('contained'\)[\s\S]*retryScheduled:\s*false/
		);
		expect(action!.body).toMatch(
			/publicDiscoveryManifestControlAttemptCoordinates[\s\S]*publicDiscoveryManifestControlRetryDisposition/
		);
		expect(action!.body).toMatch(
			/PUBLIC_DISCOVERY_MANIFEST_REFRESH_PAGE_CONTINUATION_PURPOSE[\s\S]*PUBLIC_DISCOVERY_PAGE_BACKFILL_CONTINUATION_HEADER[\s\S]*continuation:\s*true/
		);
		expect(action!.body).toMatch(
			/response\.ok[\s\S]*PUBLIC_DISCOVERY_MANIFEST_REFRESH_GATE_PROTOCOL_HEADER[\s\S]*refreshed:\s*true/
		);
		expect(action!.body).toMatch(
			/catch\s*\(error\)[\s\S]*PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS[\s\S]*requeuePublicDiscoveryManifestControlPushRef[\s\S]*throw error/
		);
	});

	it('bounds a cadence-coalesced producer retry to the gate contract', () => {
		expect(publicDiscoveryManifestControlRetryDelayMs(null)).toBeNull();
		expect(publicDiscoveryManifestControlRetryDelayMs('0')).toBeNull();
		expect(publicDiscoveryManifestControlRetryDelayMs('001')).toBeNull();
		expect(publicDiscoveryManifestControlRetryDelayMs('301')).toBeNull();
		expect(publicDiscoveryManifestControlRetryDelayMs('1.5')).toBeNull();
		expect(publicDiscoveryManifestControlRetryDelayMs('1')).toBe(2_000);
		expect(
			publicDiscoveryManifestControlRetryDelayMs(
				String(PUBLIC_DISCOVERY_MANIFEST_CONTROL_RETRY_MAX_SECONDS)
			)
		).toBe(301_000);
	});

	it('caps every producer chain and defaults legacy coordinates to one terminal attempt', () => {
		expect(PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS).toBe(19);
		expect(PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS).toBe(2 * 60 * 60 * 1_000);
		expect(publicDiscoveryManifestControlAttemptCoordinates(undefined, undefined, 10_000)).toEqual({
			attempt: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
			legacy: true,
			startedAt: 10_000
		});
		expect(publicDiscoveryManifestControlAttemptCoordinates(1, 9_000, 10_000)).toEqual({
			attempt: 1,
			legacy: false,
			startedAt: 9_000
		});
		expect(
			publicDiscoveryManifestControlRetryDisposition({
				attempt: 1,
				delayMs: 301_000,
				now: 10_000,
				startedAt: 9_000
			})
		).toEqual({ retry: true, nextAttempt: 2 });
		expect(
			publicDiscoveryManifestControlRetryDisposition({
				attempt: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_ATTEMPTS,
				delayMs: 1_000,
				now: 10_000,
				startedAt: 9_000
			})
		).toEqual({ retry: false, outcome: 'attemptsExhausted' });
		expect(
			publicDiscoveryManifestControlRetryDisposition({
				attempt: 1,
				delayMs: 1_000,
				now: PUBLIC_DISCOVERY_MANIFEST_CONTROL_MAX_AGE_MS - 1,
				startedAt: 0
			})
		).toEqual({ retry: false, outcome: 'ageExhausted' });
		expect(PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_HEADER).toBe(
			'x-public-discovery-manifest-refresh-contained'
		);
		expect(PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_SIGNAL_PROTOCOL).toBe('1');
		expect(PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED_BODY).toBe(
			'{"status":"maintenance","mode":"containment","code":"PUBLIC_DISCOVERY_MANIFEST_REFRESH_CONTAINED","retry":false}\n'
		);
	});

	it('authorizes both sides of publication and releases only a complete composite', () => {
		for (const key of [
			'lib/publicDiscovery.ts:preparePublicDiscoveryListPublication',
			'lib/publicDiscovery.ts:commitPublicDiscoveryListPublication',
			'lib/publicDiscovery.ts:preparePublicDiscoveryRelationsPublication',
			'lib/publicDiscovery.ts:commitPublicDiscoveryRelationsPublication'
		]) {
			expect(boundaryByKey.get(key)!.body).toMatch(
				/assertPublicDiscoveryPublicationAuthorized/
			);
		}

		const complete = boundaryByKey.get(
			'lib/publicDiscovery.ts:completePublicDiscoveryCoordinatedRebuild'
		)!.body;
		expect(complete).toMatch(/!manifest\.listReady\s*\|\|\s*!manifest\.relationsReady/);
		expect(complete.indexOf('!manifest.listReady')).toBeLessThan(complete.indexOf('ctx.db.patch'));

		const composite = boundaryByKey.get('templates.ts:rebuildHomepageSnapshotsImpl')!.body;
		expect(composite.indexOf('publishPublicTemplateSnapshotPlan')).toBeLessThan(
			composite.indexOf('publishRelationSnapshotRebuild')
		);
		expect(composite.indexOf('publishRelationSnapshotRebuild')).toBeLessThan(
			composite.indexOf('completePublicDiscoveryCoordinatedRebuild')
		);
	});

	it('pins newest-first compact source membership required by the no-drop OCC proof', () => {
		const boundary = boundaryByKey.get('templates.ts:preparePublicTemplateSnapshotPlan');
		expect(boundary).toBeDefined();
		expect(boundary!.body).toMatch(
			/query\(['"]publicTemplateDiscoverySources['"]\)[\s\S]*withIndex\(['"]by_generation_templateCreatedAt_templateId['"][\s\S]*q\.eq\(['"]generation['"],\s*migration\.runToken\)[\s\S]*\.order\(['"]desc['"]\)[\s\S]*\.take\(PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP\)/
		);
		expect(boundary!.body).not.toMatch(/\bcandidates\s*\.\s*(?:sort|toSorted)\s*\(/);
	});

	it('reuses the verified source-plane generation without duplicate control-row reads', () => {
		const ready = boundaryByKey.get('templates.ts:compactDiscoveryPlaneReady');
		expect(ready).toBeDefined();
		expect(ready!.body.match(/publicDiscoverySourceMigrationRow\(ctx\)/g)).toHaveLength(1);
		expect(ready!.body).toMatch(/return migration/);

		for (const key of [
			'templates.ts:preparePublicTemplateSnapshotPlan',
			'templates.ts:recomputeRelatednessCalibration',
			'templates.ts:preparePublishedPublicTemplateRelationSelection',
			'templates.ts:getByIds',
			'templates.ts:textSearch',
			'templates.ts:listMissingTagEmbeddings'
		]) {
			const boundary = boundaryByKey.get(key);
			expect(boundary, `${key} source-plane reader is missing`).toBeDefined();
			expect(boundary!.body.match(/compactDiscoveryPlaneReady\(ctx\)/g)).toHaveLength(1);
			expect(boundary!.body).not.toMatch(/publicDiscoverySourceMigrationRow\(ctx\)/);
		}

		const relationInput = boundaryByKey.get('templates.ts:prepareRelationVariantInput')!;
		expect(relationInput.body).not.toMatch(
			/compactDiscoveryPlaneReady|publicDiscoverySourceMigrationRow/
		);
		expect(relationInput.body).toMatch(/row\?\.generation === sourceGeneration/);

		const relationRebuild = boundaryByKey.get('templates.ts:prepareRelationSnapshotRebuild')!;
		expect(relationRebuild.body).not.toMatch(/compactDiscoveryPlaneReady/);
		expect(relationRebuild.body).toMatch(/resolvedSelection\.sourceGeneration/);
	});

	it('couples materializer source reads to the field-sensitive writer classifier', () => {
		const projectedReads: Record<SourceTable, Array<[string, ReadonlySet<string>]>> = {
			templates: [
				['templates.ts:resolveDomain', new Set(['doc'])],
				['templates.ts:enrichPublicTemplates', new Set(['template', 't'])],
				['templates.ts:rebuildPublicTemplateSnapshotsImpl', new Set(['template'])],
				['templates.ts:buildRelationSnapshotVariant', new Set(['template', 't'])],
				['templates.ts:rebuildRelationSnapshotImpl', new Set(['template'])]
			],
			templateEndorsements: [
				['templates.ts:enrichPublicTemplates', new Set(['e'])]
			],
			debates: [['templates.ts:enrichPublicTemplates', new Set(['debate'])]],
			organizations: [['templates.ts:enrichPublicTemplates', new Set(['org'])]]
		};
		// `id` is read only from the already-enriched public payload map; Convex
		// source documents use `_id`.
		// `recipientCount` is derived once from recipientConfig when the compact
		// source is synchronized; it is not a writable templates-table field.
		const systemFields = new Set(['_id', '_creationTime', 'id', 'recipientCount']);

		for (const [table, reads] of Object.entries(projectedReads) as Array<
			[SourceTable, Array<[string, ReadonlySet<string>]>]
		>) {
			const observed = new Set<string>();
			for (const [key, receivers] of reads) {
				const boundary = boundaryByKey.get(key);
				expect(boundary, `${key} materializer helper is missing`).toBeDefined();
				for (const field of directPropertyReads(boundary!, receivers)) observed.add(field);
			}
			const unclassified = [...observed].filter(
				(field) => !systemFields.has(field) && !SOURCE_FIELDS[table].has(field)
			);
			expect(
				unclassified,
				`${table} gained a projected field that the writer detector does not classify`
			).toEqual([]);
		}

		// Index membership is expressed as query-builder string literals rather
		// than property access, so pin those load-bearing source coordinates too.
		expect(SOURCE_FIELDS.templates.has('status')).toBe(true);
		expect(SOURCE_FIELDS.templates.has('isPublic')).toBe(true);
		expect(SOURCE_FIELDS.templateEndorsements.has('templateId')).toBe(true);
		expect(SOURCE_FIELDS.debates.has('templateId')).toBe(true);
	});

	it('keeps generic dynamic patch primitives unable to target discovery sources', () => {
		expect(source('backfill.ts')).toMatch(
			/const ALLOWED_BACKFILL_TABLES = \[['"]supporters['"]\] as const/
		);
		expect(source('seed.ts')).toMatch(
			/const ALLOWED_SEED_TABLES = \[['"]supporters['"], ['"]donations['"], ['"]orgInvites['"]\] as const/
		);
		const clearTable = boundaryByKey.get('seed.ts:clearTable')!.body;
		expect(clearTable).toMatch(/PUBLIC_DISCOVERY_SOURCE_FAMILIES/);
		expect(clearTable).toMatch(/invalidatePublicDiscoveryAfterDestructiveSourceChange\s*\(/);
		expect(clearTable).toMatch(/!suppressDiscoveryRefresh/);
		expect(clearTable).not.toMatch(/publicTemplateSnapshots|templateRelationSnapshots/);
		const seedSource = source('seed.ts');
		const seedTables = seedSource.slice(
			seedSource.indexOf('const SEED_TABLES = ['),
			seedSource.indexOf('] as const;', seedSource.indexOf('const SEED_TABLES = ['))
		);
		expect(seedTables).not.toMatch(
			/publicDiscoveryManifest|publicTemplateSnapshots|templateRelationSnapshots/
		);
	});

	it('requires the active owner token before every suppressed seed write', () => {
		for (const key of [
			'seed.ts:clearTable',
			'seed.ts:insertTemplates',
			'seed.ts:insertDebates'
		]) {
			const body = boundaryByKey.get(key)!.body;
			expect(body).toMatch(/suppressDiscoveryRefresh[\s\S]*assertPublicDiscoveryCoordinatedRebuildAuthorized/);
			const authorizationAt = body.indexOf('assertPublicDiscoveryCoordinatedRebuildAuthorized');
			const firstWriteAt = Math.min(
				...['ctx.db.insert', 'ctx.db.patch', 'ctx.db.delete']
					.map((operation) => body.indexOf(operation))
					.filter((position) => position >= 0)
			);
			expect(authorizationAt, `${key} must authorize before its first source write`).toBeGreaterThanOrEqual(0);
			expect(authorizationAt, `${key} authorizes after a source write`).toBeLessThan(firstWriteAt);
		}
	});

	it('pins clearSeed to one gated publication around suppressed table clears', () => {
		const clearSeed = boundaryByKey.get('seed.ts:clearSeed')!.body;
		const drainSeedTable = boundaryByKey.get('seed.ts:drainSeedTable')!.body;
		const invalidateAt = clearSeed.indexOf('beginCoordinatedPublicDiscoveryRebuild');
		const clearLoopAt = clearSeed.indexOf('for (const table of SEED_TABLES)');
		const publishAt = clearSeed.indexOf('internal.templates.rebuildHomepageSnapshots');
		expect(invalidateAt).toBeGreaterThanOrEqual(0);
		expect(invalidateAt).toBeLessThan(clearLoopAt);
		expect(clearLoopAt).toBeLessThan(publishAt);
		expect(clearSeed).toMatch(/crypto\.randomUUID\(\)/);
		expect(clearSeed).toMatch(/drainSeedTable\(ctx,\s*table,\s*coordinatedRebuildToken\)/);
		expect(drainSeedTable).toMatch(
			/suppressDiscoveryRefresh:\s*true,\s*coordinatedRebuildToken/
		);
		expect(drainSeedTable).toMatch(/if \(result\.isDone\)/);
		const failureGateAt = clearSeed.indexOf('if (totalFailed > 0 || failedTables > 0)');
		expect(failureGateAt).toBeGreaterThanOrEqual(0);
		expect(failureGateAt).toBeLessThan(publishAt);
		expect(clearSeed).toMatch(/CLEAR_SEED_PARTIAL_FAILURE/);
	});

	it('threads one action-generated owner through every reseed suppression and final publish', () => {
		const reseed = boundaryByKey.get('seed.ts:reseedTemplates')!.body;
		expect(reseed).toMatch(/const coordinatedRebuildToken = crypto\.randomUUID\(\)/);
		expect(reseed).toMatch(
			/beginCoordinatedPublicDiscoveryRebuild[\s\S]*coordinatedRebuildToken/
		);
		const suppressions = reseed.match(/suppressDiscoveryRefresh:\s*true/g) ?? [];
		const authorizedSuppressions =
			reseed.match(/suppressDiscoveryRefresh:\s*true,\s*coordinatedRebuildToken/g) ?? [];
		expect(suppressions.length).toBeGreaterThan(0);
		expect(authorizedSuppressions).toHaveLength(suppressions.length);
		expect(reseed).toMatch(/rebuildHomepageSnapshots[\s\S]*coordinatedRebuildToken/);
		expect(reseed).toMatch(
			/if \(!result\.isDone \|\| result\.failed > 0\)[\s\S]*RESEED_TEMPLATES_CLEAR_PARTIAL_FAILURE/
		);
		expect(reseed.indexOf('RESEED_TEMPLATES_CLEAR_PARTIAL_FAILURE')).toBeLessThan(
			reseed.indexOf('rebuildHomepageSnapshots')
		);
	});

	it('allows stale lock takeover only through a fresh coordinated begin', () => {
		const discoverySource = source('lib/publicDiscovery.ts');
		expect(discoverySource).toMatch(
			/export const PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS = \d+ \* 60 \* 1000/
		);
		const begin = boundaryByKey.get(
			'lib/publicDiscovery.ts:invalidatePublicDiscoveryForCoordinatedRebuild'
		)!.body;
		expect(begin).toMatch(/coordinatedRebuildStartedAt/);
		expect(begin).toMatch(/PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCK_TTL_MS/);
		expect(begin).toMatch(/PUBLIC_DISCOVERY_COORDINATED_REBUILD_LOCKED/);
		expect(begin).toMatch(/coordinatedRebuildWatchdogScheduledAt/);
		expect(begin).toMatch(
			/scheduler\.runAt\([\s\S]*superviseCoordinatedPublicDiscoveryRebuildWatchdogRef[\s\S]*coordinatedRebuildToken[\s\S]*coordinatedRebuildAttempt[\s\S]*scheduledAt/
		);
		const destructive = boundaryByKey.get(
			'lib/publicDiscovery.ts:invalidatePublicDiscoveryAfterDestructiveSourceChange'
		)!.body;
		expect(destructive).toMatch(/coordinatedRebuildToken[\s\S]*COORDINATED_REBUILD_LOCKED/);
		expect(destructive).not.toMatch(/LOCK_TTL|coordinatedRebuildStartedAt/);
	});

	it('fences the zero-idle rebuild watchdog by token, attempt, and durable slot', () => {
		const discoverySource = source('lib/publicDiscovery.ts');
		const watchdogStart = discoverySource.indexOf(
			'export async function supervisePublicDiscoveryCoordinatedRebuildWatchdog'
		);
		const watchdog = discoverySource.slice(
			watchdogStart,
			discoverySource.indexOf('function manifestInsertBase', watchdogStart)
		);
		expect(watchdogStart).toBeGreaterThanOrEqual(0);
		expect(watchdog.match(/getPublicDiscoveryManifestRow\(ctx\)/g)).toHaveLength(1);
		for (const coordinate of [
			'coordinatedRebuildToken',
			'coordinatedRebuildAttempt',
			'coordinatedRebuildWatchdogScheduledAt'
		]) {
			expect(watchdog).toContain(coordinate);
		}
		expect(watchdog).toMatch(/now < coordinates\.scheduledAt[\s\S]*status: 'early'/);
		expect(watchdog).toMatch(
			/coordinatedRebuildWatchdogScheduledAt: leaseExpiresAt[\s\S]*scheduler\.runAt\([\s\S]*scheduledAt: leaseExpiresAt/
		);
		expect(watchdog).toMatch(
			/supervisePublicDiscoveryCoordinatedRebuildLeaseRow\([\s\S]*manifest[\s\S]*now[\s\S]*true/
		);
		expect(watchdog).not.toMatch(/\b(?:for|while)\s*\(/);

		const observability = source('observability.ts');
		const endpointStart = observability.indexOf(
			'export const superviseCoordinatedPublicDiscoveryRebuildWatchdog'
		);
		const endpoint = observability.slice(
			endpointStart,
			observability.indexOf(
				'export const reportCoordinatedPublicDiscoveryRebuildLeaseFailure',
				endpointStart
			)
		);
		expect(endpoint).toMatch(/internalMutation\([\s\S]*supervisePublicDiscoveryCoordinatedRebuildWatchdog/);
		expect(endpoint).toMatch(/result\.status === 'stale'[\s\S]*result\.shouldAlert/);
		expect(endpoint).toMatch(/enqueueCoordinatedPublicDiscoveryRebuildLeaseAlert/);
	});

	it('detects synthetic typed, helper, inserted, replaced, and dynamic unmarked writers', () => {
		const synthetic = `
async function helper(ctx, id: Id<"templates">) {
  await ctx.db.patch(id, { title: "unsafe" });
}
const arrowHelper = async (ctx, id: Id<"templates">) => {
  await ctx.db.patch(id, { title: "unsafe" });
};
export const delegated = mutation({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => arrowHelper(ctx, args.templateId),
});
export const inserted = mutation({
  handler: async (ctx) => ctx.db.insert("templates", { title: "unsafe" }),
});
export const typedPatch = mutation({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => ctx.db.patch(args.templateId, { title: "unsafe" }),
});
export const dynamicPatch = mutation({
  args: { templateId: v.id("templates"), patch: v.any() },
  handler: async (ctx, args) => ctx.db.patch(args.templateId, { updatedAt: Date.now(), ...args.patch }),
});
export const computedPatch = mutation({
  args: { templateId: v.id("templates"), field: v.string(), value: v.any() },
  handler: async (ctx, args) => ctx.db.patch(args.templateId, { [args.field]: args.value }),
});
export const mutatedComputedPatch = mutation({
  args: { templateId: v.id("templates"), field: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    const patch = { updatedAt: Date.now() };
    patch[args.field] = args.value;
    await ctx.db.patch(args.templateId, patch);
  },
});
export const objectAssignedPatch = mutation({
  args: { templateId: v.id("templates"), patch: v.any() },
  handler: async (ctx, args) => {
    const next = { updatedAt: Date.now() };
    Object.assign(next, args.patch);
    await ctx.db.patch(args.templateId, next);
  },
});
export const reassignedPatchData = mutation({
  args: { templateId: v.id("templates"), patch: v.any() },
  handler: async (ctx, args) => {
    let next = { updatedAt: Date.now() };
    next = args.patch;
    await ctx.db.patch(args.templateId, next);
  },
});
export const replaced = mutation({
  args: { templateId: v.id("templates"), value: v.any() },
  handler: async (ctx, args) => ctx.db.replace(args.templateId, args.value),
});
export const indexedRowPatch = mutation({
  handler: async (ctx) => {
    const rows = await ctx.db.query("templates").collect();
    await ctx.db.patch(rows[0]._id, { title: "unsafe" });
  },
});
export const unionIdPatch = mutation({
  args: { id: v.union(v.id("users"), v.id("templates")) },
  handler: async (ctx, args) => ctx.db.patch(args.id, { title: "unsafe" }),
});
export const conditionalRowPatch = mutation({
  args: { useTemplate: v.boolean() },
  handler: async (ctx, args) => {
    const row = args.useTemplate
      ? await ctx.db.query("templates").first()
      : await ctx.db.query("users").first();
    if (row) await ctx.db.patch(row._id, { title: "unsafe" });
  },
});
export const reassignedRowPatch = mutation({
  handler: async (ctx) => {
    let row = await ctx.db.query("users").first();
    row = await ctx.db.query("templates").first();
    if (row) await ctx.db.patch(row._id, { title: "unsafe" });
  },
});
const aliasedDbHelper = async (ctx, id: Id<"templates">) => {
  const store = ctx.db;
  await store.patch(id, { title: "unsafe" });
};
const assignedDbAliasHelper = async (ctx, id: Id<"templates">) => {
  let store;
  store = ctx.db;
  await store.patch(id, { title: "unsafe" });
};
class ClassWriter {
  async run(ctx, id: Id<"templates">) {
    await ctx.db.patch(id, { title: "unsafe" });
  }
}
class SplitClassWriter {
  mark(ctx) {
    markPublicDiscoveryListDirty(ctx);
  }
  async unsafe(ctx, id: Id<"templates">) {
    await ctx.db.patch(id, { title: "unsafe" });
  }
}
const objectWriter = {
  async run(ctx, id: Id<"templates">) {
    await ctx.db.patch(id, { title: "unsafe" });
  },
};
const splitObjectWriter = {
  mark(ctx) {
    markPublicDiscoveryListDirty(ctx);
  },
  async unsafe(ctx, id: Id<"templates">) {
    await ctx.db.patch(id, { title: "unsafe" });
  },
};
async function unresolvedHelper(ctx, id) {
  await ctx.db.patch(id, { title: "unsafe" });
}
async function unresolvedInsert(ctx, table) {
  await ctx.db.insert(table, { title: "unsafe" });
}`;
			const syntheticBoundaries = boundaries('synthetic.ts', synthetic);
			const detected = syntheticBoundaries
				.flatMap(analyzeBoundary)
			.map(({ key, operation }) => `${key}:${operation}`)
			.sort();
			expect(detected).toEqual([
				'synthetic.ts:ClassWriter.run:projected-patch',
				'synthetic.ts:SplitClassWriter.unsafe:projected-patch',
				'synthetic.ts:aliasedDbHelper:projected-patch',
				'synthetic.ts:arrowHelper:projected-patch',
				'synthetic.ts:assignedDbAliasHelper:projected-patch',
				'synthetic.ts:computedPatch:dynamic-patch',
				'synthetic.ts:conditionalRowPatch:unresolved-patch-target:row._id',
				'synthetic.ts:dynamicPatch:dynamic-patch',
				'synthetic.ts:helper:projected-patch',
				'synthetic.ts:indexedRowPatch:projected-patch',
				'synthetic.ts:inserted:insert',
				'synthetic.ts:mutatedComputedPatch:dynamic-patch',
				'synthetic.ts:objectAssignedPatch:dynamic-patch',
				'synthetic.ts:objectWriter.run:projected-patch',
				'synthetic.ts:reassignedPatchData:dynamic-patch',
				'synthetic.ts:reassignedRowPatch:unresolved-patch-target:row._id',
				'synthetic.ts:replaced:replace',
				'synthetic.ts:splitObjectWriter.unsafe:projected-patch',
				'synthetic.ts:typedPatch:projected-patch',
			'synthetic.ts:unionIdPatch:unresolved-patch-target:args.id',
			'synthetic.ts:unresolvedHelper:unresolved-patch-target:id',
			'synthetic.ts:unresolvedInsert:unresolved-insert-target:table'
			]);
			expect(
				syntheticBoundaries.find(({ name }) => name === 'SplitClassWriter.unsafe')?.body
			).not.toMatch(DIRTY_HELPER_RE);
			expect(
				syntheticBoundaries.find(({ name }) => name === 'splitObjectWriter.unsafe')?.body
			).not.toMatch(DIRTY_HELPER_RE);
		});

	it('fails the blocking ratchet when a projection-source writer omits same-transaction dirtying', () => {
		const omittedDirtyCall = `
export const newlyAddedWriter = mutation({
  args: { templateId: v.id("templates") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, { title: "changed without invalidation" });
  },
});`;
		const unclassified = boundaries('synthetic-omission.ts', omittedDirtyCall)
			.flatMap(analyzeBoundary)
			.map(({ key }) => key)
			.filter((key) => !Object.prototype.hasOwnProperty.call(CONTRACT, key));

		expect(unclassified).toEqual(['synthetic-omission.ts:newlyAddedWriter']);
		expect(omittedDirtyCall).not.toMatch(DIRTY_HELPER_RE);
	});
});
