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

const CONVEX_DIR = path.resolve(process.cwd(), 'convex');

type SourceTable = 'templates' | 'templateEndorsements' | 'debates' | 'organizations';

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

const SOURCE_TABLES = new Set<SourceTable>(Object.keys(SOURCE_FIELDS) as SourceTable[]);
const DIRTY_HELPER_RE =
	/markPublicDiscovery(?:ListDirty|RelationsDirty|ListAndRelationsDirty)\s*\(/;

type Boundary = { file: string; name: string; body: string };
type Detection = { key: string; table: SourceTable | 'dynamic'; operation: string };

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
	for (const statement of parsed.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			result.push({ file, name: statement.name.text, body: statement.getText(parsed) });
			continue;
		}
		if (!ts.isVariableStatement(statement)) continue;
		if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
			result.push({
				file,
				name: declaration.name.text,
				body: declaration.initializer.getText(parsed)
			});
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

function dbMethod(call: ts.CallExpression, parsed: ts.SourceFile): string | null {
	if (!ts.isPropertyAccessExpression(call.expression)) return null;
	const receiver = call.expression.expression.getText(parsed);
	return /(?:^|\.)ctx\.db$/.test(receiver) ? call.expression.name.text : null;
}

function literalTableCall(
	node: ts.Node,
	parsed: ts.SourceFile,
	method: 'insert' | 'query' | 'normalizeId'
): SourceTable | null {
	let found: SourceTable | null = null;
	const visit = (child: ts.Node): void => {
		if (found) return;
		if (ts.isCallExpression(child) && dbMethod(child, parsed) === method) {
			const first = child.arguments[0];
			if (first && ts.isStringLiteral(first) && SOURCE_TABLES.has(first.text as SourceTable)) {
				found = first.text as SourceTable;
				return;
			}
		}
		ts.forEachChild(child, visit);
	};
	visit(node);
	return found;
}

function nameTable(name: string): SourceTable | null {
	const lower = name.toLowerCase();
	if (lower.includes('templateendorsement') || lower.includes('endorsement')) {
		return 'templateEndorsements';
	}
	if (lower.includes('template')) return 'templates';
	if (lower.includes('debate')) return 'debates';
	if (/^(?:org|organization)/.test(lower)) return 'organizations';
	return null;
}

function analyzeBoundary(boundary: Boundary): Detection[] {
	const parsed = ts.createSourceFile(
		`${boundary.file}:${boundary.name}.ts`,
		boundary.body,
		ts.ScriptTarget.Latest,
		true
	);
	const idArgs = new Map<string, SourceTable>();
	const tableByVariable = new Map<string, SourceTable>();
	const variableInitializers = new Map<string, ts.Expression>();
	const assignedFields = new Map<string, Set<string>>();

	const precollect = (node: ts.Node): void => {
		if (ts.isPropertyAssignment(node) && ts.isCallExpression(node.initializer)) {
			const callText = node.initializer.expression.getText(parsed);
			const table = node.initializer.arguments[0];
			const name = propertyName(node.name);
			if (
				name &&
				callText === 'v.id' &&
				table &&
				ts.isStringLiteral(table) &&
				SOURCE_TABLES.has(table.text as SourceTable)
			) {
				idArgs.set(name, table.text as SourceTable);
			}
		}
		if (
			(ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
			ts.isIdentifier(node.name)
		) {
			if (node.initializer) variableInitializers.set(node.name.text, node.initializer);
			const typeText = node.type?.getText(parsed) ?? '';
			const match = typeText.match(/(?:Id|GenericId|Doc)<['"]([^'"]+)['"]>/);
			if (match && SOURCE_TABLES.has(match[1] as SourceTable)) {
				tableByVariable.set(node.name.text, match[1] as SourceTable);
			}
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
		ts.forEachChild(node, precollect);
	};
	precollect(parsed);

	const inferTable = (raw: ts.Expression): SourceTable | null => {
		const expression = unwrap(raw);
		if (ts.isIdentifier(expression)) {
			return tableByVariable.get(expression.text) ?? idArgs.get(expression.text) ?? nameTable(expression.text);
		}
		if (ts.isPropertyAccessExpression(expression)) {
			if (ts.isIdentifier(expression.expression) && expression.expression.text === 'args') {
				return idArgs.get(expression.name.text) ?? nameTable(expression.name.text);
			}
			if (expression.name.text === '_id') return inferTable(expression.expression);
			return nameTable(expression.name.text);
		}
		return null;
	};

	// Resolve query/get/insert-derived local rows and ids. Repeat because a local
	// can derive from an earlier typed/query-derived local.
	for (let pass = 0; pass < 4; pass++) {
		const resolve = (node: ts.Node): void => {
			if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
				const variableName = node.name.text;
				const literal =
					literalTableCall(node.initializer, parsed, 'query') ??
					literalTableCall(node.initializer, parsed, 'insert') ??
					literalTableCall(node.initializer, parsed, 'normalizeId');
				if (literal) tableByVariable.set(variableName, literal);
				const visitGet = (child: ts.Node): void => {
					if (ts.isCallExpression(child) && dbMethod(child, parsed) === 'get' && child.arguments[0]) {
						const table = inferTable(child.arguments[0]);
						if (table) tableByVariable.set(variableName, table);
					}
					ts.forEachChild(child, visitGet);
				};
				visitGet(node.initializer);
			}
			if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
				const declaration = node.initializer.declarations[0];
				if (declaration && ts.isIdentifier(declaration.name)) {
					const table =
						literalTableCall(node.expression, parsed, 'query') ??
						(ts.isIdentifier(unwrap(node.expression))
							? tableByVariable.get((unwrap(node.expression) as ts.Identifier).text) ?? null
							: null);
					if (table) tableByVariable.set(declaration.name.text, table);
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
	let dynamicRecorded = false;
	const visitWrites = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const method = dbMethod(node, parsed);
			if (method === 'insert') {
				const tableArg = node.arguments[0];
				if (tableArg && ts.isStringLiteral(tableArg) && SOURCE_TABLES.has(tableArg.text as SourceTable)) {
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table: tableArg.text as SourceTable,
						operation: 'insert'
					});
				}
			} else if (
				(method === 'patch' || method === 'replace') &&
				node.arguments[0] &&
				node.arguments[1]
			) {
				const table = inferTable(node.arguments[0]);
				const fields = fieldsFor(node.arguments[1]);
				if (table) {
					const projected = [...fields].some((field) => SOURCE_FIELDS[table].has(field));
					const dynamic = hasDynamicFields(node.arguments[1]);
					if (method === 'replace' || projected || dynamic) {
						detections.push({
							key: `${boundary.file}:${boundary.name}`,
							table,
							operation:
								method === 'replace'
									? 'replace'
									: dynamic
										? 'dynamic-patch'
										: 'projected-patch'
						});
					}
				} else if (
					!dynamicRecorded &&
					/normalizeId\(\s*table\b/.test(boundary.body) &&
					fields.size === 0
				) {
					dynamicRecorded = true;
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table: 'dynamic',
						operation: 'generic-normalized-patch'
					});
				}
			} else if (method === 'delete' && node.arguments[0]) {
				const table = inferTable(node.arguments[0]);
				if (table) {
					detections.push({
						key: `${boundary.file}:${boundary.name}`,
						table,
						operation: 'delete'
					});
				}
			}
		}
		ts.forEachChild(node, visitWrites);
	};
	visitWrites(parsed);

	if (
		/PUBLIC_DISCOVERY_SOURCE_TABLES\.has\(table\)/.test(boundary.body) &&
		/ctx\.db\.delete\(/.test(boundary.body)
	) {
		detections.push({
			key: `${boundary.file}:${boundary.name}`,
			table: 'dynamic',
			operation: 'fail-closed-source-clear'
		});
	}

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
	'seed.ts:backfillScopes': /markPublicDiscoveryListDirty\s*\(/,
	'seed.ts:clearTable': /PUBLIC_DISCOVERY_SOURCE_TABLES\.has\(table\)/,
	'seed.ts:patchSeedRecord': /ALLOWED_SEED_TABLES\.includes/,
	'backfill.ts:patchRow': /ALLOWED_BACKFILL_TABLES\.includes/
};

const DELEGATE_CONTRACT: Record<string, RegExp> = {
	'templates.ts:updateEmbeddings': /patchTemplateEmbeddingValues\s*\(/,
	'templates.ts:completePublicTemplateEmbeddings': /patchTemplateEmbeddingValues\s*\(/,
	'templates.ts:updateMissingEmbeddingsForBackfill': /patchTemplateEmbeddingValues\s*\(/,
	'templates.ts:patchEmbeddings': /patchTemplateEmbeddingValues\s*\(/
};

describe('public-discovery source writer contract', () => {
	const allBoundaries = listConvexSources().flatMap(({ file, src }) => boundaries(file, src));
	const boundaryByKey = new Map(allBoundaries.map((boundary) => [`${boundary.file}:${boundary.name}`, boundary]));

	it('detects every projection-source writer across Convex and requires an explicit contract', () => {
		const detections = allBoundaries.flatMap(analyzeBoundary);
		const detectedKeys = [...new Set(detections.map(({ key }) => key))].sort();
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
		expect(clearTable).toMatch(/PUBLIC_DISCOVERY_STATE_TABLES/);
		expect(clearTable).toMatch(/ctx\.db\.delete\(row\._id\)/);
	});

	it('detects synthetic typed, helper, inserted, replaced, and dynamic unmarked writers', () => {
		const synthetic = `
async function helper(ctx, id: Id<"templates">) {
  await ctx.db.patch(id, { title: "unsafe" });
}
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
export const replaced = mutation({
  args: { templateId: v.id("templates"), value: v.any() },
  handler: async (ctx, args) => ctx.db.replace(args.templateId, args.value),
});`;
		const detected = boundaries('synthetic.ts', synthetic)
			.flatMap(analyzeBoundary)
			.map(({ key, operation }) => `${key}:${operation}`)
			.sort();
		expect(detected).toEqual([
			'synthetic.ts:computedPatch:dynamic-patch',
			'synthetic.ts:dynamicPatch:dynamic-patch',
			'synthetic.ts:helper:projected-patch',
			'synthetic.ts:inserted:insert',
			'synthetic.ts:replaced:replace',
			'synthetic.ts:typedPatch:projected-patch'
		]);
		expect(synthetic).not.toMatch(DIRTY_HELPER_RE);
	});
});
