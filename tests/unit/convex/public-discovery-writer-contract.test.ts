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
	PUBLIC_DISCOVERY_SOURCE_FAMILIES,
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
	/markPublicDiscovery(?:ListDirty|RelationsDirty|ListAndRelationsDirty)\s*\(/;

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
					addCandidates(
						tableByVariable,
						declaration.name.text,
						mergeTableCandidates(
							literalTableCalls(node.expression, parsed, 'query', dbAliases),
							inferTables(node.expression)
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
	'templates.ts:endorse': /markPublicDiscoveryListDirty\s*\(/,
	'templates.ts:removeEndorsement': /markPublicDiscoveryListDirty\s*\(/,
	'templates.ts:patchTemplateEmbeddingValues': DIRTY_HELPER_RE,
	'templates.ts:createTemplate': /markPublicDiscoveryListAndRelationsDirty\s*\(/,
	'templates.ts:deleteTemplate': /markPublicDiscoveryListAndRelationsDirty\s*\(/,
	'templates.ts:patchMetadata': /markPublicDiscoveryListAndRelationsDirty\s*\(/,
	'templates.ts:patchTagEmbeddings': /markPublicDiscoveryRelationsDirty\s*\(/,
	'templates.ts:_patchDomainHue': /markPublicDiscoveryListDirty\s*\(/,
	'submissions.ts:incrementTemplateReach': /markPublicDiscoveryListDirty\s*\(/,
	'submissions.ts:_backfillOneTemplate': /markPublicDiscoveryListDirty\s*\(/,
	'debates.ts:createArgument': /markPublicDiscoveryListDirty\s*\(/,
	'debates.ts:cosign': /markPublicDiscoveryListDirty\s*\(/,
	'debates.ts:updateStatus': /markPublicDiscoveryListDirty\s*\(/,
	'debates.ts:insertDebate': /markPublicDiscoveryListDirty\s*\(/,
	'debates.ts:_spawnDebateIfEligibleForce': /markPublicDiscoveryListDirty\s*\(/,
	'debates.ts:_spawnDebateIfEligible': /markPublicDiscoveryListDirty\s*\(/,
	// A newly-created organization ID cannot already be referenced by a template;
	// the later template/endorsement writer owns invalidation when it links one.
	'organizations.ts:create': /ctx\.db\.insert\(\s*['"]organizations['"]/,
	'organizations.ts:update': /markPublicDiscoveryListDirty\s*\(/,
	'seed.ts:zeroTemplateMetrics': /markPublicDiscoveryListDirty\s*\(/,
	'seed.ts:insertOrgs': /ctx\.db\.insert\(\s*['"]organizations['"]/,
	'seed.ts:insertTemplates': /markPublicDiscoveryListAndRelationsDirty\s*\(/,
	'seed.ts:insertTemplatesPublic': /markPublicDiscoveryListAndRelationsDirty\s*\(/,
	'seed.ts:insertDebates': /markPublicDiscoveryListDirty\s*\(/,
	'seed.ts:backfillScopes': /markPublicDiscoveryListDirty\s*\(/
};

const DELEGATE_CONTRACT: Record<string, RegExp> = {
	'templates.ts:completePublicTemplateEmbeddings': /patchTemplateEmbeddingValues\s*\(/,
	'templates.ts:updateMissingEmbeddingsForBackfill': /patchTemplateEmbeddingValues\s*\(/
};

const SAFE_DYNAMIC_CONTRACT: Record<string, RegExp> = {
	'authOps.ts:backfillTokenIdentifier:unresolved-patch-target:user._id':
		/db\.patch\(user\._id/,
	'authOps.ts:upsertFromOAuth:unresolved-patch-target:existingAccount.userId':
		/db\.patch\(existingAccount\.userId/,
	'backfill.ts:patchRow:unresolved-patch-target:normalizedId':
		/ALLOWED_BACKFILL_TABLES\.includes/,
	'donations.ts:updateStatus:unresolved-patch-target:donation.campaignId':
		/ctx\.db\.patch\(donation\.campaignId/,
	'email.ts:queueExactServerDispatch:unresolved-patch-target:args.blastId':
		/ctx\.db\.patch\(args\.blastId/,
	'ground.ts:persistGroundBundle:unresolved-patch-target:vault._id':
		/ctx\.db\.patch\(vault\._id/,
	'legislation.ts:importRepresentatives:unresolved-patch-target:dm._id':
		/ctx\.db\.patch\(dm\._id/,
	'legislation.ts:pruneBillsBatch:unresolved-delete-target:bill._id':
		/ctx\.db\.delete\(bill\._id/,
	'legislation.ts:pruneDependentTableBatch:unresolved-delete-target:row._id':
		/PRUNE_ALL_DEPENDENT_TABLES\.includes/,
	'legislation.ts:pruneDependentTableBatch:unresolved-patch-target:row._id':
		/PRUNE_ALL_DEPENDENT_TABLES\.includes/,
	'lib/publicDiscovery.ts:commitPublicDiscoveryListPublication:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'lib/publicDiscovery.ts:commitPublicDiscoveryRelationsPublication:unresolved-patch-target:manifest._id':
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
	'messageJobs.ts:checkpointPhase:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:completeEncrypted:unresolved-patch-target:job._id':
		/ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:expireJob:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:fail:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'messageJobs.ts:markRunning:unresolved-patch-target:job._id': /ctx\.db\.patch\(job\._id/,
	'orgWebhooks.ts:markDeliveryDead:unresolved-patch-target:delivery.webhookId':
		/ctx\.db\.patch\(delivery\.webhookId/,
	'orgWebhooks.ts:markDeliverySuccess:unresolved-patch-target:delivery.webhookId':
		/ctx\.db\.patch\(delivery\.webhookId/,
	'seed.ts:clearTable:unresolved-delete-target:doc._id':
		/SEED_TABLES\.includes/,
	'seed.ts:patchSeedRecord:unresolved-patch-target:normalizedId': /ALLOWED_SEED_TABLES\.includes/,
	'subscriptions.ts:updateMyStripeCustomerId:unresolved-patch-target:userId':
		/ctx\.db\.patch\(userId/,
	'templates.ts:flushScheduledPublicTemplateRefresh:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'templates.ts:flushScheduledPublicTemplateRefresh:unresolved-patch-target:publishedManifest._id':
		/ctx\.db\.patch\(publishedManifest\._id/,
	'templates.ts:flushScheduledPublicTemplateRelationsRefresh:unresolved-patch-target:manifest._id':
		/ctx\.db\.patch\(manifest\._id/,
	'templates.ts:flushScheduledPublicTemplateRelationsRefresh:unresolved-patch-target:publishedManifest._id':
		/ctx\.db\.patch\(publishedManifest\._id/,
	'templates.ts:publishRelationSnapshotRebuild:unresolved-patch-target:existing._id':
		/ctx\.db\.patch\(existing\._id/,
	'users.ts:connectWallet:unresolved-patch-target:userId': /ctx\.db\.patch\(userId/,
	'users.ts:disconnectWallet:unresolved-patch-target:userId': /ctx\.db\.patch\(userId/,
	'users.ts:updateProfile:unresolved-patch-target:userId': /ctx\.db\.patch\(userId/,
	'v1api.ts:confirmEmailDelivery:unresolved-patch-target:submission._id':
		/ctx\.db\.patch\(submission\._id/,
	'v1api.ts:submitDelegationReview:unresolved-patch-target:review._id':
		/ctx\.db\.patch\(review\._id/,
	'v1api.ts:updateDelegationGrant:unresolved-patch-target:grant._id':
		/ctx\.db\.patch\(grant\._id/,
	'webhooks.ts:completeDonation:unresolved-patch-target:campaign._id':
		/ctx\.db\.patch\(campaign\._id/,
	'webhooks.ts:refundDonation:unresolved-patch-target:campaign._id':
		/ctx\.db\.patch\(campaign\._id/,
	'webhooks.ts:updateSmsStatus:unresolved-patch-target:blast._id':
		/ctx\.db\.patch\(blast\._id/
};

describe('public-discovery source writer contract', () => {
	const allBoundaries = listConvexSources().flatMap(({ file, src }) => boundaries(file, src));
	const boundaryByKey = new Map(allBoundaries.map((boundary) => [`${boundary.file}:${boundary.name}`, boundary]));

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
	});

	it('pins newest-first source membership required by the no-drop OCC proof', () => {
		const boundary = boundaryByKey.get('templates.ts:preparePublicTemplateSnapshotPlan');
		expect(boundary).toBeDefined();
		expect(boundary!.body).toMatch(
			/query\(['"]templates['"]\)[\s\S]*withIndex\(['"]by_status_isPublic['"][\s\S]*\.order\(['"]desc['"]\)[\s\S]*\.take\(PUBLIC_TEMPLATE_SNAPSHOT_SCAN_CAP\)/
		);
		expect(boundary!.body).not.toMatch(/\bcandidates\s*\.\s*(?:sort|toSorted)\s*\(/);
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
		const systemFields = new Set(['_id', '_creationTime', 'id']);

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
			/const ALLOWED_BACKFILL_TABLES = \["supporters"\] as const/
		);
		expect(source('seed.ts')).toMatch(
			/const ALLOWED_SEED_TABLES = \["supporters", "donations", "orgInvites"\] as const/
		);
		const clearTable = boundaryByKey.get('seed.ts:clearTable')!.body;
		expect(clearTable).toMatch(/PUBLIC_DISCOVERY_SOURCE_FAMILIES/);
		expect(clearTable).toMatch(/invalidatePublicDiscoveryAfterDestructiveSourceChange\s*\(/);
		expect(clearTable).toMatch(/!suppressDiscoveryRefresh/);
		expect(clearTable).not.toMatch(/publicTemplateSnapshots|templateRelationSnapshots/);
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
