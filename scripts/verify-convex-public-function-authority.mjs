#!/usr/bin/env node

/**
 * Exhaustive authority inventory for every client-callable Convex function.
 *
 * Convex `query`, `mutation`, and `action` exports are reachable at the Convex
 * origin even when the intended caller is SvelteKit. Cloudflare therefore
 * cannot be the authority boundary for these functions. This verifier derives
 * the public runtime surface from the TypeScript AST and requires every export
 * to fit exactly one fail-closed authority class:
 *
 *   - server-secret: INTERNAL_API_SECRET is checked as handler statement one;
 *   - authenticated-role: identity/role authority precedes material I/O;
 *   - server-hmac: a server proof is verified before material I/O;
 *   - pre-io-tombstone: the first handler statement unconditionally throws; or
 *   - explicitly-io-free: the handler performs no material or unknown I/O.
 *
 * The checked-in manifest is an exact ratchet. New, removed, renamed, stale,
 * multiply classified, or unclassified public exports fail CI. Server-secret
 * call sites under `src/` are also checked for a trusted `_secret` argument.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parse as parseSvelte } from 'svelte/compiler';
import ts from 'typescript';

/** @typedef {import('typescript').Node} TsNode */
/** @typedef {import('typescript').Expression} TsExpression */
/** @typedef {import('typescript').SourceFile} TsSourceFile */
/** @typedef {import('typescript').CallExpression} TsCallExpression */
/** @typedef {import('typescript').ConciseBody} TsConciseBody */
/** @typedef {import('typescript').ObjectLiteralExpression} TsObjectLiteralExpression */
/** @typedef {import('typescript').FunctionLikeDeclaration} TsFunctionLikeDeclaration */
/** @typedef {'query' | 'mutation' | 'action'} PublicFunctionKind */
/** @typedef {'authenticated-role' | 'explicitly-io-free' | 'pre-io-tombstone' | 'server-hmac' | 'server-secret'} AuthorityClass */
/**
 * @typedef {object} PublicDefinition
 * @property {string} exportName
 * @property {string} filePath
 * @property {PublicFunctionKind} kind
 * @property {number} line
 * @property {TsObjectLiteralExpression | null} options
 * @property {TsSourceFile} sourceFile
 */
/**
 * @typedef {object} CallFact
 * @property {TsCallExpression} call
 * @property {string | null} name
 * @property {number} position
 * @property {string | null} target
 * @property {string} text
 */
/**
 * @typedef {object} AuthorityEntry
 * @property {string} runtimeName
 * @property {string} source
 * @property {string} exportName
 * @property {PublicFunctionKind} kind
 * @property {AuthorityClass} authority
 * @property {string} guard
 */
/** @typedef {{ guard: string, position: number }} GuardSuccess */
/** @typedef {GuardSuccess | { error: string }} GuardResult */
/** @typedef {{ authority: AuthorityClass, guard: string } | { error: string }} Classification */
/** @typedef {{ runtimeName: string, caller: string, kind: string, callCount: number, workBound?: string }} BrowserResidual */
/** @typedef {{ version: number, generatedBy: string, categories: AuthorityClass[], counts: Record<AuthorityClass, number>, browserDirectAuthenticatedResiduals: BrowserResidual[], entries: AuthorityEntry[] }} AuthorityManifest */
/** @typedef {{ type?: string, [key: string]: any }} EstreeNode */

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const CONVEX_ROOT = path.join(ROOT, 'convex');
const SOURCE_ROOT = path.join(ROOT, 'src');
const MANIFEST_PATH = path.join(ROOT, 'config/convex-public-function-authority.json');
const SCRIPT_NAME = 'scripts/verify-convex-public-function-authority.mjs';

/** @type {readonly AuthorityClass[]} */
export const AUTHORITY_CLASSES = Object.freeze([
	'authenticated-role',
	'explicitly-io-free',
	'pre-io-tombstone',
	'server-hmac',
	'server-secret'
]);

/** @type {Set<PublicFunctionKind>} */
const PUBLIC_FACTORIES = new Set(['query', 'mutation', 'action']);
const DB_METHODS = new Set([
	'collect',
	'delete',
	'first',
	'get',
	'insert',
	'normalizeId',
	'paginate',
	'patch',
	'query',
	'replace',
	'take',
	'unique'
]);
const REVIEWED_LOCAL_AUTH_GUARDS = new Map([
	['convex/messageJobs.ts::loadOwnedJob', 'standard'],
	['convex/networks.ts::requireNetworkAccess', 'secret-or-standard'],
	['convex/templates.ts::currentTemplateListUser', 'standard']
]);
const REVIEWED_INTERNAL_AUTHORITY_GUARDS = new Map([
	[
		'convex/legislation.ts::requireRescoreBillsAuthRef',
		{ runtimeName: 'legislation:requireRescoreBillsAuth', exportName: 'requireRescoreBillsAuth' }
	],
	[
		'convex/organizations.ts::internal.organizations.verifyOwner',
		{ runtimeName: 'organizations:verifyOwner', exportName: 'verifyOwner' }
	],
	[
		'convex/segments.ts::getOrgForSegmentActionRef',
		{ runtimeName: 'segments:getOrgForSegmentAction', exportName: 'getOrgForSegmentAction' }
	],
	[
		'convex/segments.ts::requireExportAuthRef',
		{ runtimeName: 'segments:requireExportAuth', exportName: 'requireExportAuth' }
	]
]);
// Pure, byte-bounded validators may run before an authority lookup so an
// attacker cannot force database work with an oversized payload. Each entry is
// bound to one exact source export, and its transitive body is re-proved free of
// ctx access, awaits, and unknown calls on every verifier run.
const REVIEWED_PRE_AUTH_PURE_HELPERS = new Set([
	'convex/lib/emailInputBudget.ts::assertEmailDraftInput'
]);
const PURE_CALL_ROOTS = new Set([
	'Array',
	'BigInt',
	'Boolean',
	'Date',
	'JSON',
	'Math',
	'Number',
	'Object',
	'RegExp',
	'String',
	'console'
]);
const PURE_GLOBAL_CALLS = new Set([
	'atob',
	'btoa',
	'decodeURIComponent',
	'encodeURIComponent',
	'isFinite',
	'isNaN',
	'parseFloat',
	'parseInt',
	'structuredClone'
]);
const PURE_METHOD_CALLS = new Set([
	'charCodeAt',
	'encode',
	'filter',
	'join',
	'map',
	'normalize',
	'replace',
	'slice',
	'some',
	'substring',
	'test',
	'toLocaleLowerCase',
	'toLowerCase',
	'toString',
	'toUpperCase',
	'trim'
]);
const REVIEWED_BROWSER_DIRECT_RESIDUALS = Object.freeze([
	{
		runtimeName: 'blasts:getEncryptedSupportersForBlast',
		caller: 'src/routes/org/[slug]/emails/compose/+page.svelte',
		workBound: 'one cursor page; 10,000-recipient and 10,000-scan cohort ceilings'
	},
	{
		runtimeName: 'blasts:recordBlastReceipts',
		caller: 'src/routes/org/[slug]/emails/compose/+page.svelte',
		workBound: '200 receipts per mutation; exact blast receipt ceiling'
	},
	{
		runtimeName: 'blasts:updateClientBlastProgress',
		caller: 'src/routes/org/[slug]/emails/compose/+page.svelte',
		workBound: 'one blast row; counters bounded by persisted cohort size'
	},
	{
		runtimeName: 'organizations:rotateOrgPassphrase',
		caller: 'src/routes/org/[slug]/settings/+page.svelte',
		workBound: 'owner role; fixed org-key rows'
	},
	{
		runtimeName: 'organizations:sealOrgKey',
		caller: 'src/routes/org/[slug]/settings/+page.svelte',
		workBound: 'owner verification before fixed-size key sealing and one patch'
	},
	{
		runtimeName: 'organizations:setOrgKeyVerifier',
		caller: 'src/routes/org/[slug]/settings/+page.svelte',
		workBound: 'owner role; fixed org-key fields'
	},
	{
		runtimeName: 'segments:list',
		caller: 'src/routes/org/[slug]/supporters/+page.svelte',
		workBound: 'member role; fixed MAX_SEGMENTS_PER_ORG ceiling'
	},
	{
		runtimeName: 'sms:advanceEmptyDispatchPage',
		caller: 'src/routes/org/[slug]/sms/[id]/+page.svelte',
		workBound: 'one byte-bounded recipient page; cumulative scan ceiling'
	},
	{
		runtimeName: 'sms:getEncryptedRecipientsForBlast',
		caller: 'src/routes/org/[slug]/sms/[id]/+page.svelte',
		workBound: 'one byte-bounded recipient page; cumulative scan ceiling'
	},
	{
		runtimeName: 'supporters:get',
		caller: 'src/routes/org/[slug]/supporters/+page.svelte',
		workBound: 'one supporter plus at most 100 tag links and point reads'
	},
	{
		runtimeName: 'supporters:list',
		caller: 'src/routes/org/[slug]/supporters/+page.svelte',
		workBound: '100 rows and 512 KiB per cursor page'
	},
	{
		runtimeName: 'supporters:searchByEmail',
		caller: 'src/routes/org/[slug]/supporters/+page.svelte',
		workBound: 'one indexed supporter plus at most 100 tag links and point reads'
	}
]);

/** @param {string} filePath */
function relative(filePath) {
	return path.relative(ROOT, filePath).split(path.sep).join('/');
}

/** @param {string} directory @param {(filePath: string) => boolean} predicate @returns {string[]} */
function walk(directory, predicate) {
	/** @type {string[]} */
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '_generated') continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...walk(absolute, predicate));
		else if (entry.isFile() && predicate(absolute)) files.push(absolute);
	}
	return files.sort((a, b) => relative(a).localeCompare(relative(b)));
}

function convexFiles() {
	return walk(
		CONVEX_ROOT,
		(filePath) =>
			filePath.endsWith('.ts') &&
			!filePath.endsWith('.d.ts') &&
			!filePath.includes('.test.') &&
			!filePath.includes('.convex.test.')
	);
}

function sourceFiles() {
	return walk(SOURCE_ROOT, (filePath) => /\.(?:js|ts)$/.test(filePath));
}

function browserSourceFiles() {
	return walk(SOURCE_ROOT, (filePath) => {
		if (!/\.(?:js|svelte|ts)$/.test(filePath)) return false;
		const name = relative(filePath);
		return !(
			name.includes('/lib/server/') ||
			/(?:^|\/)(?:hooks|[^/]+)\.server\.[jt]s$/.test(name) ||
			/\+(?:layout|page|server)\.server\.[jt]s$/.test(name) ||
			/\/\+server\.[jt]s$/.test(name)
		);
	});
}

/** @param {string} filePath @param {string} [source] @returns {TsSourceFile} */
function sourceFileFor(filePath, source = fs.readFileSync(filePath, 'utf8')) {
	return ts.createSourceFile(
		filePath,
		source,
		ts.ScriptTarget.Latest,
		true,
		filePath.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS
	);
}

/** @param {TsExpression} node @returns {TsExpression} */
function unwrap(node) {
	let current = node;
	while (
		current &&
		(ts.isParenthesizedExpression(current) ||
			ts.isAsExpression(current) ||
			ts.isTypeAssertionExpression(current) ||
			ts.isNonNullExpression(current) ||
			ts.isSatisfiesExpression(current))
	) {
		current = current.expression;
	}
	return current;
}

/** @param {TsNode} node */
function hasExportModifier(node) {
	return ts.canHaveModifiers(node)
		? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
				false)
		: false;
}

/** @param {import('typescript').PropertyName | import('typescript').BindingName | undefined} node @returns {string | null} */
function propertyName(node) {
	if (!node) return null;
	if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
	if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
	return null;
}

/** @param {TsObjectLiteralExpression | null} object @param {string} name @returns {import('typescript').ObjectLiteralElementLike | null} */
function objectProperty(object, name) {
	if (!object || !ts.isObjectLiteralExpression(object)) return null;
	for (const property of object.properties) {
		if (
			(ts.isPropertyAssignment(property) ||
				ts.isMethodDeclaration(property) ||
				ts.isGetAccessorDeclaration(property)) &&
			propertyName(property.name) === name
		) {
			return property;
		}
	}
	return null;
}

/** @param {import('typescript').ObjectLiteralElementLike | null} property @returns {TsExpression | import('typescript').MethodDeclaration | import('typescript').GetAccessorDeclaration | null} */
function propertyValue(property) {
	if (!property) return null;
	if (ts.isPropertyAssignment(property)) return unwrap(property.initializer);
	if (ts.isMethodDeclaration(property) || ts.isGetAccessorDeclaration(property)) return property;
	return null;
}

/** @param {{ options: TsObjectLiteralExpression | null }} definition @returns {TsFunctionLikeDeclaration | null} */
function handlerFunction(definition) {
	const handler = propertyValue(objectProperty(definition.options, 'handler'));
	if (!handler) return null;
	if (
		ts.isArrowFunction(handler) ||
		ts.isFunctionExpression(handler) ||
		ts.isFunctionDeclaration(handler) ||
		ts.isMethodDeclaration(handler)
	) {
		return handler;
	}
	return null;
}

/** @param {{ options: TsObjectLiteralExpression | null }} definition @returns {TsConciseBody | null} */
function handlerBody(definition) {
	return handlerFunction(definition)?.body ?? null;
}

/** @param {TsSourceFile} sourceFile @param {string} localName @returns {{ importedName: string, moduleName: string } | null} */
function importBinding(sourceFile, localName) {
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
			continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			if (element.name.text !== localName) continue;
			return {
				importedName: element.propertyName?.text ?? element.name.text,
				moduleName: statement.moduleSpecifier.text
			};
		}
	}
	return null;
}

/** @param {TsSourceFile} sourceFile @param {string} localName @param {string} importedName @param {string} moduleName */
function isExactImport(sourceFile, localName, importedName, moduleName) {
	const binding = importBinding(sourceFile, localName);
	return binding?.importedName === importedName && binding?.moduleName === moduleName;
}

/** @param {TsSourceFile} sourceFile @param {string} moduleName @returns {string | null} */
function modulePathFromSpecifier(sourceFile, moduleName) {
	if (moduleName.startsWith('$lib/')) {
		return path.join(SOURCE_ROOT, 'lib', moduleName.slice('$lib/'.length));
	}
	if (moduleName.startsWith('.')) {
		return path.resolve(path.dirname(sourceFile.fileName), moduleName);
	}
	return null;
}

/** @param {TsSourceFile} sourceFile @param {string} [localName] */
function isTrustedInternalSecretImport(sourceFile, localName = 'getInternalSecret') {
	const binding = importBinding(sourceFile, localName);
	if (binding?.importedName !== 'getInternalSecret') return false;
	const importedPath = modulePathFromSpecifier(sourceFile, binding.moduleName);
	if (!importedPath) return false;
	const withoutExtension = importedPath.replace(/\.(?:[cm]?[jt]s)$/, '');
	return withoutExtension === path.join(SOURCE_ROOT, 'lib/server/internal/secret-auth');
}

/** @param {TsCallExpression} call */
function isAwaitedOrReturned(call) {
	/** @type {TsNode} */
	let current = call;
	while (
		current.parent &&
		(ts.isParenthesizedExpression(current.parent) ||
			ts.isAsExpression(current.parent) ||
			ts.isNonNullExpression(current.parent) ||
			ts.isSatisfiesExpression(current.parent))
	) {
		current = current.parent;
	}
	if (current.parent && ts.isAwaitExpression(current.parent)) return true;
	return Boolean(current.parent && ts.isReturnStatement(current.parent));
}

/** @param {TsExpression} node @returns {string | null} */
function expressionPath(node) {
	let current = unwrap(node);
	/** @type {string[]} */
	const parts = [];
	while (
		current &&
		(ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
	) {
		if (ts.isPropertyAccessExpression(current)) parts.unshift(current.name.text);
		else if (current.argumentExpression && ts.isStringLiteral(current.argumentExpression)) {
			parts.unshift(current.argumentExpression.text);
		} else return null;
		current = unwrap(current.expression);
	}
	if (!current || !ts.isIdentifier(current)) return null;
	parts.unshift(current.text);
	return parts.join('.');
}

/** @param {TsExpression} node @param {Set<string>} [roots] @returns {string | null} */
function staticFunctionReference(node, roots = new Set(['api', 'convexApi'])) {
	const fullPath = expressionPath(node);
	if (!fullPath) return null;
	const parts = fullPath.split('.');
	if (!roots.has(parts[0]) || parts.length < 3) return null;
	return `${parts.slice(1, -1).join('/')}:${parts.at(-1)}`;
}

/** @param {string} filePath @returns {PublicDefinition[]} */
function exportedPublicDefinitions(filePath) {
	const sourceFile = sourceFileFor(filePath);
	/** @type {Map<string, PublicFunctionKind>} */
	const factories = new Map();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
			continue;
		if (!/(?:^|\/)_generated\/server$/.test(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			const imported = element.propertyName?.text ?? element.name.text;
			if (imported === 'query' || imported === 'mutation' || imported === 'action') {
				factories.set(element.name.text, imported);
			}
		}
	}

	/** @type {PublicDefinition[]} */
	const definitions = [];
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement) || !hasExportModifier(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
			const initializer = unwrap(declaration.initializer);
			if (!ts.isCallExpression(initializer)) continue;
			const callee = unwrap(initializer.expression);
			if (!ts.isIdentifier(callee)) continue;
			const kind = factories.get(callee.text);
			if (!kind) continue;
			const options = unwrap(initializer.arguments[0]);
			if (!options || !ts.isObjectLiteralExpression(options)) {
				definitions.push({
					exportName: declaration.name.text,
					filePath,
					kind,
					line: sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1,
					options: null,
					sourceFile
				});
				continue;
			}
			definitions.push({
				exportName: declaration.name.text,
				filePath,
				kind,
				line: sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile)).line + 1,
				options,
				sourceFile
			});
		}
	}
	return definitions;
}

/** @param {string} fromFile @param {string} specifier @returns {string | null} */
function resolveRelativeTypeScript(fromFile, specifier) {
	if (!specifier.startsWith('.')) return null;
	const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.[cm]?js$/, ''));
	for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

/** @param {string} filePath @returns {Set<string>} */
function registeredLocalNames(filePath) {
	const sourceFile = sourceFileFor(filePath);
	const factories = new Set();
	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
			continue;
		if (!/(?:^|\/)_generated\/server$/.test(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			const imported = element.propertyName?.text ?? element.name.text;
			if (
				[...PUBLIC_FACTORIES, 'internalQuery', 'internalMutation', 'internalAction'].includes(
					imported
				)
			) {
				factories.add(element.name.text);
			}
		}
	}
	const names = new Set();
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
			const value = unwrap(declaration.initializer);
			const factory = ts.isCallExpression(value) ? unwrap(value.expression) : null;
			if (factory && ts.isIdentifier(factory) && factories.has(factory.text)) {
				names.add(declaration.name.text);
			}
		}
	}
	return names;
}

/** @param {string[]} files @returns {string[]} */
function factorySurfaceErrors(files) {
	/** @type {string[]} */
	const errors = [];
	for (const filePath of files) {
		const sourceFile = sourceFileFor(filePath);
		/** @type {Set<string>} */
		const publicFactoryLocals = new Set();
		for (const statement of sourceFile.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
				continue;
			if (!/(?:^|\/)_generated\/server$/.test(statement.moduleSpecifier.text)) continue;
			const clause = statement.importClause;
			if (clause?.name) {
				errors.push(`${relative(filePath)} forbids a default generated-server import.`);
			}
			if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
				errors.push(`${relative(filePath)} forbids a namespace generated-server import.`);
			}
			if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
			for (const element of clause.namedBindings.elements) {
				if (element.isTypeOnly) continue;
				const imported = element.propertyName?.text ?? element.name.text;
				if (imported !== 'query' && imported !== 'mutation' && imported !== 'action') continue;
				publicFactoryLocals.add(element.name.text);
				if (element.propertyName) {
					errors.push(
						`${relative(filePath)} forbids aliased generated-server factory import ${imported} as ${element.name.text}.`
					);
				}
			}
		}

		for (const statement of sourceFile.statements) {
			if (ts.isVariableStatement(statement)) {
				for (const declaration of statement.declarationList.declarations) {
					if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
					const value = unwrap(declaration.initializer);
					if (ts.isIdentifier(value) && publicFactoryLocals.has(value.text)) {
						errors.push(
							`${relative(filePath)} forbids dynamic factory alias ${declaration.name.text} = ${value.text}.`
						);
					}
				}
			}
			if (ts.isExportAssignment(statement)) {
				let containsFactory = false;
				/** @param {TsNode} node */
				function visit(node) {
					if (ts.isIdentifier(node) && publicFactoryLocals.has(node.text)) containsFactory = true;
					ts.forEachChild(node, visit);
				}
				visit(statement.expression);
				if (containsFactory) {
					errors.push(`${relative(filePath)} forbids default-exported registered functions.`);
				}
			}
			if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
			const targetPath =
				statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
					? resolveRelativeTypeScript(filePath, statement.moduleSpecifier.text)
					: filePath;
			if (!targetPath) continue;
			const registered = registeredLocalNames(targetPath);
			if (!statement.exportClause) {
				if (registered.size > 0) {
					errors.push(`${relative(filePath)} forbids star re-exports of registered functions.`);
				}
				continue;
			}
			if (!ts.isNamedExports(statement.exportClause)) continue;
			for (const element of statement.exportClause.elements) {
				if (element.isTypeOnly) continue;
				const localName = element.propertyName?.text ?? element.name.text;
				if (registered.has(localName)) {
					errors.push(
						`${relative(filePath)} forbids re-exported registered function ${localName}.`
					);
				}
			}
		}
	}
	return errors;
}

/** @param {TsNode} node */
function isNestedFunction(node) {
	return (
		ts.isArrowFunction(node) ||
		ts.isFunctionExpression(node) ||
		ts.isFunctionDeclaration(node) ||
		ts.isMethodDeclaration(node)
	);
}

/** @param {TsNode} body @returns {TsNode[]} */
function executedNodes(body) {
	/** @type {TsNode[]} */
	const nodes = [];
	/** @param {TsNode} node @param {boolean} [root] */
	function visit(node, root = false) {
		nodes.push(node);
		if (!root && isNestedFunction(node)) return;
		ts.forEachChild(node, (child) => visit(child, false));
	}
	visit(body, true);
	return nodes;
}

/** @param {TsNode} body @param {TsSourceFile} sourceFile @returns {CallFact[]} */
function callFacts(body, sourceFile) {
	return executedNodes(body)
		.filter(ts.isCallExpression)
		.map((call) => {
			const target = expressionPath(call.expression);
			const name = target?.split('.').at(-1) ?? null;
			return {
				call,
				name,
				position: call.getStart(sourceFile),
				target,
				text: call.getText(sourceFile)
			};
		})
		.sort((a, b) => a.position - b.position);
}

/** @param {string | null} target */
function isCtxMaterialIo(target) {
	return (
		target === 'ctx.runAction' ||
		target === 'ctx.runMutation' ||
		target === 'ctx.runQuery' ||
		target?.startsWith('ctx.db.') ||
		target?.startsWith('ctx.scheduler.') ||
		target?.startsWith('ctx.storage.')
	);
}

/** @param {string | null} target */
function isDbAliasMaterialIo(target) {
	if (!target) return false;
	const parts = target.split('.');
	const method = parts.at(-1);
	return parts[0] === 'db' && Boolean(method && DB_METHODS.has(method));
}

/** @param {CallFact} fact */
function isMaterialIo(fact) {
	return (
		fact.target === 'fetch' || isCtxMaterialIo(fact.target) || isDbAliasMaterialIo(fact.target)
	);
}

/** @param {TsNode} body */
function containsCtxReference(body) {
	return executedNodes(body).some((node) => ts.isIdentifier(node) && node.text === 'ctx');
}

/** @param {TsConciseBody} body @returns {import('typescript').Statement | null} */
function firstHandlerStatement(body) {
	return ts.isBlock(body) ? (body.statements[0] ?? null) : null;
}

/** @param {TsConciseBody} body @returns {TsCallExpression | null} */
function firstStatementCall(body) {
	const statement = firstHandlerStatement(body);
	if (!statement || !ts.isExpressionStatement(statement)) return null;
	const expression = unwrap(statement.expression);
	if (!ts.isCallExpression(expression)) return null;
	return expression;
}

/** @param {PublicDefinition} definition @returns {{ kind: 'property' | 'identifier', parameter: string } | null} */
function handlerSecretBinding(definition) {
	const handler = handlerFunction(definition);
	const parameter = handler?.parameters[1]?.name;
	if (!parameter) return null;
	if (ts.isIdentifier(parameter)) return { kind: 'property', parameter: parameter.text };
	if (!ts.isObjectBindingPattern(parameter)) return null;
	for (const element of parameter.elements) {
		if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
		const sourceName = propertyName(element.propertyName ?? element.name);
		if (sourceName === '_secret') return { kind: 'identifier', parameter: element.name.text };
	}
	return null;
}

/** @param {TsExpression} expression @param {{ kind: 'property' | 'identifier', parameter: string } | null} binding @returns {boolean} */
function isExactSecretDerivation(expression, binding) {
	const value = unwrap(expression);
	if (
		ts.isBinaryExpression(value) &&
		value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
	) {
		const fallback = unwrap(value.right);
		return (
			isExactSecretDerivation(value.left, binding) &&
			ts.isStringLiteral(fallback) &&
			fallback.text === ''
		);
	}
	if (binding?.kind === 'identifier') {
		return ts.isIdentifier(value) && value.text === binding.parameter;
	}
	return Boolean(
		binding?.kind === 'property' && expressionPath(value) === `${binding.parameter}._secret`
	);
}

/** @param {TsObjectLiteralExpression} options */
function hasSecretValidator(options) {
	const args = propertyValue(objectProperty(options, 'args'));
	return Boolean(args && ts.isObjectLiteralExpression(args) && objectProperty(args, '_secret'));
}

/** @param {TsObjectLiteralExpression} options */
function hasRequiredSecretValidator(options) {
	const args = propertyValue(objectProperty(options, 'args'));
	if (!args || !ts.isObjectLiteralExpression(args)) return false;
	const secret = propertyValue(objectProperty(args, '_secret'));
	if (!secret) return false;
	return !(ts.isCallExpression(secret) && expressionPath(secret.expression) === 'v.optional');
}

/** @param {TsNode} node @returns {boolean} */
function terminalFailClosed(node) {
	if (ts.isThrowStatement(node) || ts.isReturnStatement(node)) return true;
	if (ts.isBlock(node)) return node.statements.some(terminalFailClosed);
	if (ts.isIfStatement(node)) {
		return Boolean(
			node.elseStatement &&
			terminalFailClosed(node.thenStatement) &&
			terminalFailClosed(node.elseStatement)
		);
	}
	return false;
}

/** @param {TsExpression} node */
function isNullishLiteral(node) {
	const value = unwrap(node);
	return (
		value.kind === ts.SyntaxKind.NullKeyword ||
		(ts.isIdentifier(value) && value.text === 'undefined')
	);
}

/** @param {TsExpression} node @param {string} identityName @returns {boolean} */
function conditionRejectsMissingIdentity(node, identityName) {
	const value = unwrap(node);
	const unaryOperand = ts.isPrefixUnaryExpression(value) ? unwrap(value.operand) : null;
	if (
		ts.isPrefixUnaryExpression(value) &&
		value.operator === ts.SyntaxKind.ExclamationToken &&
		unaryOperand &&
		ts.isIdentifier(unaryOperand) &&
		unaryOperand.text === identityName
	) {
		return true;
	}
	if (ts.isBinaryExpression(value)) {
		if (value.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
			return (
				conditionRejectsMissingIdentity(value.left, identityName) ||
				conditionRejectsMissingIdentity(value.right, identityName)
			);
		}
		if (
			value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
			value.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
		) {
			const left = unwrap(value.left);
			const right = unwrap(value.right);
			return (
				(ts.isIdentifier(left) && left.text === identityName && isNullishLiteral(value.right)) ||
				(ts.isIdentifier(right) && right.text === identityName && isNullishLiteral(value.left))
			);
		}
	}
	return false;
}

/** @param {TsNode} body @param {TsSourceFile} sourceFile @returns {number | null} */
function directIdentityGuard(body, sourceFile) {
	/** @type {Map<string, number>} */
	const identityBindings = new Map();
	for (const node of executedNodes(body)) {
		if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer)
			continue;
		let value = unwrap(node.initializer);
		if (ts.isAwaitExpression(value)) value = unwrap(value.expression);
		if (
			ts.isAwaitExpression(unwrap(node.initializer)) &&
			ts.isCallExpression(value) &&
			expressionPath(value.expression) === 'ctx.auth.getUserIdentity'
		) {
			identityBindings.set(node.name.text, node.getStart(sourceFile));
		}
	}
	for (const node of executedNodes(body)) {
		if (!ts.isIfStatement(node) || !terminalFailClosed(node.thenStatement)) continue;
		for (const name of identityBindings.keys()) {
			if (conditionRejectsMissingIdentity(node.expression, name)) {
				return node.getStart(sourceFile);
			}
		}
	}
	return null;
}

/** @param {TsCallExpression} call @returns {string | null} */
function internalReference(call) {
	const first = call.arguments[0];
	return first ? expressionPath(first) : null;
}

/** @param {CallFact[]} facts @param {TsSourceFile} sourceFile @returns {GuardResult | null} */
function importedAuthGuard(facts, sourceFile) {
	for (const fact of facts) {
		if (!fact.name || !isAwaitedOrReturned(fact.call)) continue;
		const binding = importBinding(sourceFile, fact.name);
		if (
			binding?.moduleName === './_authHelpers' &&
			(binding.importedName === 'requireAuth' || binding.importedName === 'requireOrgRole')
		) {
			return {
				guard: `call:${binding.importedName}`,
				position: fact.position
			};
		}
	}
	return null;
}

/** @param {CallFact[]} facts @param {TsSourceFile} sourceFile @param {number} [minimumPosition] @returns {CallFact | undefined} */
function firstSensitiveWork(facts, sourceFile, minimumPosition = Number.NEGATIVE_INFINITY) {
	return [...facts.filter(isMaterialIo), ...unknownIoCalls(facts, sourceFile)]
		.filter((fact) => fact.position >= minimumPosition)
		.sort((a, b) => a.position - b.position)[0];
}

/** @param {TsNode} body @param {TsSourceFile} sourceFile @param {number} [minimumPosition] @returns {GuardResult | null} */
function standardBodyAuthGuard(body, sourceFile, minimumPosition = Number.NEGATIVE_INFINITY) {
	const facts = callFacts(body, sourceFile).filter((fact) => fact.position >= minimumPosition);
	const imported = importedAuthGuard(facts, sourceFile);
	const direct = directIdentityGuard(body, sourceFile);
	const candidate =
		imported ??
		(direct === null || direct < minimumPosition
			? null
			: { guard: 'ctx.auth.getUserIdentity+fail-closed', position: direct });
	if (!candidate) return null;
	if ('error' in candidate) return candidate;
	const firstWork = firstSensitiveWork(facts, sourceFile, minimumPosition);
	return firstWork && candidate.position > firstWork.position
		? { error: `material/unknown work precedes ${candidate.guard}` }
		: candidate;
}

/** @param {TsSourceFile} sourceFile @param {string} name @returns {TsFunctionLikeDeclaration | null} */
function topLevelFunctionNode(sourceFile, name) {
	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (
				!ts.isIdentifier(declaration.name) ||
				declaration.name.text !== name ||
				!declaration.initializer
			) {
				continue;
			}
			const value = unwrap(declaration.initializer);
			if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return value;
		}
	}
	return null;
}

/** @param {TsExpression} node @param {string} secretName */
function isSecretPresentCondition(node, secretName) {
	const value = unwrap(node);
	if (!ts.isBinaryExpression(value)) return false;
	if (
		value.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken &&
		value.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
	) {
		return false;
	}
	const left = unwrap(value.left);
	const right = unwrap(value.right);
	return (
		(ts.isIdentifier(left) && left.text === secretName && isNullishLiteral(value.right)) ||
		(ts.isIdentifier(right) && right.text === secretName && isNullishLiteral(value.left))
	);
}

/** @param {PublicDefinition} definition @param {CallFact[]} facts @returns {GuardResult | null} */
function reviewedLocalAuthGuard(definition, facts) {
	for (const fact of facts) {
		if (!fact.name || !isAwaitedOrReturned(fact.call)) continue;
		const key = `${relative(definition.filePath)}::${fact.name}`;
		const mode = REVIEWED_LOCAL_AUTH_GUARDS.get(key);
		if (!mode) continue;
		const helper = topLevelFunctionNode(definition.sourceFile, fact.name);
		if (!helper?.body || !ts.isBlock(helper.body)) {
			return { error: `${fact.name} is not a static reviewed local function` };
		}
		if (mode === 'standard') {
			const inner = standardBodyAuthGuard(helper.body, definition.sourceFile);
			if (!inner || 'error' in inner) {
				return { error: `${fact.name} no longer proves imported/direct authentication first` };
			}
			return { guard: `call:${fact.name}`, position: fact.position };
		}

		const secretParameter = helper.parameters[3]?.name;
		const first = helper.body.statements[0];
		if (
			!secretParameter ||
			!ts.isIdentifier(secretParameter) ||
			!first ||
			!ts.isIfStatement(first) ||
			!isSecretPresentCondition(first.expression, secretParameter.text) ||
			!terminalFailClosed(first.thenStatement)
		) {
			return { error: `${fact.name} secret branch is not fail-closed` };
		}
		const secretCall = callFacts(first.thenStatement, definition.sourceFile).find(
			(candidate) => candidate.target === 'requireInternalSecret'
		);
		const secretArgument = secretCall?.call.arguments[0]
			? unwrap(secretCall.call.arguments[0])
			: null;
		const workBeforeSecret = firstSensitiveWork(
			callFacts(first.thenStatement, definition.sourceFile),
			definition.sourceFile
		);
		if (
			!secretCall ||
			!isExactImport(
				definition.sourceFile,
				'requireInternalSecret',
				'requireInternalSecret',
				'./_internalAuth'
			) ||
			secretCall.call.arguments.length !== 1 ||
			!secretArgument ||
			!ts.isIdentifier(secretArgument) ||
			secretArgument.text !== secretParameter.text ||
			Boolean(workBeforeSecret && workBeforeSecret.position < secretCall.position)
		) {
			return { error: `${fact.name} secret branch does not verify the exact secret before work` };
		}
		const fallback = standardBodyAuthGuard(helper.body, definition.sourceFile, first.end);
		if (!fallback || 'error' in fallback) {
			return { error: `${fact.name} fallback branch no longer proves role authority first` };
		}
		return { guard: `call:${fact.name}`, position: fact.position };
	}
	return null;
}

/** @param {TsSourceFile} sourceFile @param {string} name @returns {TsExpression | null} */
function topLevelInitializer(sourceFile, name) {
	for (const statement of sourceFile.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
				return declaration.initializer ? unwrap(declaration.initializer) : null;
			}
		}
	}
	return null;
}

/** @param {TsSourceFile} sourceFile @param {string} filePath @param {string} exportName @returns {{ filePath: string, sourceFile: TsSourceFile, exportName: string, options: TsObjectLiteralExpression } | null} */
function registeredDefinition(sourceFile, filePath, exportName) {
	const initializer = topLevelInitializer(sourceFile, exportName);
	if (!initializer || !ts.isCallExpression(initializer)) return null;
	const callee = unwrap(initializer.expression);
	if (!ts.isIdentifier(callee)) return null;
	const binding = importBinding(sourceFile, callee.text);
	if (
		binding?.moduleName !== './_generated/server' ||
		!['internalQuery', 'internalMutation'].includes(binding.importedName)
	) {
		return null;
	}
	const options = unwrap(initializer.arguments[0]);
	if (!options || !ts.isObjectLiteralExpression(options)) return null;
	return { filePath, sourceFile, exportName, options };
}

/** @param {PublicDefinition} definition @param {CallFact[]} facts @returns {GuardResult | null} */
function reviewedInternalAuthGuard(definition, facts) {
	for (const fact of facts) {
		if (
			(fact.target !== 'ctx.runQuery' && fact.target !== 'ctx.runMutation') ||
			!isAwaitedOrReturned(fact.call)
		) {
			continue;
		}
		const reference = internalReference(fact.call);
		if (!reference) continue;
		const key = `${relative(definition.filePath)}::${reference}`;
		const reviewed = REVIEWED_INTERNAL_AUTHORITY_GUARDS.get(key);
		if (!reviewed) continue;

		if (!reference.includes('.')) {
			const initializer = topLevelInitializer(definition.sourceFile, reference);
			const referencedName =
				initializer && ts.isCallExpression(initializer) ? unwrap(initializer.arguments[0]) : null;
			if (
				!initializer ||
				!ts.isCallExpression(initializer) ||
				expressionPath(initializer.expression) !== 'makeFunctionReference' ||
				!referencedName ||
				!ts.isStringLiteral(referencedName) ||
				referencedName.text !== reviewed.runtimeName
			) {
				return { error: `${reference} no longer resolves exactly to ${reviewed.runtimeName}` };
			}
		} else if (reference !== `internal.${reviewed.runtimeName.replace(':', '.')}`) {
			return { error: `${reference} no longer resolves exactly to ${reviewed.runtimeName}` };
		}

		const target = registeredDefinition(
			definition.sourceFile,
			definition.filePath,
			reviewed.exportName
		);
		const targetBody = target ? handlerBody(target) : null;
		const inner = targetBody ? standardBodyAuthGuard(targetBody, definition.sourceFile) : null;
		if (!inner || 'error' in inner) {
			return {
				error: `${reviewed.runtimeName} no longer proves imported/direct authentication first`
			};
		}
		return { guard: `call:${reference}`, position: fact.position };
	}
	return null;
}

/** @param {PublicDefinition} definition @param {CallFact[]} facts @param {TsNode} body @returns {GuardResult | null} */
function authGuard(definition, facts, body) {
	const imported = importedAuthGuard(facts, definition.sourceFile);
	if (imported) return imported;
	const local = reviewedLocalAuthGuard(definition, facts);
	if (local) return local;
	const internal = reviewedInternalAuthGuard(definition, facts);
	if (internal) return internal;
	const direct = directIdentityGuard(body, definition.sourceFile);
	return direct === null
		? null
		: { guard: 'ctx.auth.getUserIdentity+fail-closed', position: direct };
}

/** @param {TsExpression} node @param {string} name */
function conditionIsTruthyIdentifier(node, name) {
	const value = unwrap(node);
	return ts.isIdentifier(value) && value.text === name;
}

/** @param {TsNode} node @param {string} name */
function blockAssignsTrue(node, name) {
	return executedNodes(node).some((candidate) => {
		if (!ts.isBinaryExpression(candidate)) return false;
		const left = unwrap(candidate.left);
		return (
			candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isIdentifier(left) &&
			left.text === name &&
			unwrap(candidate.right).kind === ts.SyntaxKind.TrueKeyword
		);
	});
}

/** @param {TsNode} body @param {TsSourceFile} sourceFile @returns {number | null} */
function verifiedBooleanFlow(body, sourceFile) {
	/** @type {string[]} */
	const candidateNames = [];
	for (const node of executedNodes(body)) {
		if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer)
			continue;
		let value = unwrap(node.initializer);
		if (ts.isAwaitExpression(value)) value = unwrap(value.expression);
		if (ts.isCallExpression(value) && expressionPath(value.expression) === 'crypto.subtle.verify') {
			candidateNames.push(node.name.text);
		}
	}
	if (candidateNames.length === 0) return null;
	const accepts = executedNodes(body).some(
		(node) =>
			ts.isIfStatement(node) &&
			candidateNames.some((name) => conditionIsTruthyIdentifier(node.expression, name)) &&
			blockAssignsTrue(node.thenStatement, 'valid')
	);
	if (!accepts) return null;
	const rejection = executedNodes(body).find(
		(node) =>
			ts.isIfStatement(node) &&
			conditionRejectsMissingIdentity(node.expression, 'valid') &&
			terminalFailClosed(node.thenStatement)
	);
	return rejection ? rejection.getStart(sourceFile) : null;
}

/** @param {PublicDefinition} definition @param {TsCallExpression} call */
function handlerProofExpression(definition, call) {
	const handler = handlerFunction(definition);
	const parameter = handler?.parameters[1]?.name;
	const proof = call.arguments.at(-1);
	if (!parameter || !proof) return false;
	if (ts.isIdentifier(parameter)) return expressionPath(proof) === `${parameter.text}.proof`;
	if (!ts.isObjectBindingPattern(parameter)) return false;
	const binding = parameter.elements.find(
		(element) => propertyName(element.propertyName ?? element.name) === 'proof'
	);
	return Boolean(
		binding && ts.isIdentifier(binding.name) && expressionPath(proof) === binding.name.text
	);
}

/** @param {PublicDefinition} definition @param {CallFact[]} facts @param {TsNode} body @returns {GuardResult | null} */
function hmacGuard(definition, facts, body) {
	const helper = facts.find((fact) => fact.target === 'verifyServerProof');
	if (helper) {
		if (
			relative(definition.filePath) !== 'convex/passkeys.ts' ||
			!isAwaitedOrReturned(helper.call) ||
			!handlerProofExpression(definition, helper.call)
		) {
			return { error: 'verifyServerProof is not the awaited reviewed passkey proof gate' };
		}
		const helperNode = topLevelFunctionNode(definition.sourceFile, 'verifyServerProof');
		const helperBody = helperNode?.body;
		const helperText = helperNode?.getText(definition.sourceFile) ?? '';
		if (
			!helperBody ||
			verifiedBooleanFlow(helperBody, definition.sourceFile) === null ||
			!helperText.includes('SESSION_CREATION_SECRET') ||
			!helperText.includes('SESSION_CREATION_SECRET_PREVIOUS') ||
			callFacts(helperBody, definition.sourceFile).some(isMaterialIo)
		) {
			return { error: 'reviewed passkey proof helper no longer verifies and rejects before I/O' };
		}
		return { guard: 'verifyServerProof', position: helper.position };
	}
	if (
		definition.exportName !== 'createSession' ||
		relative(definition.filePath) !== 'convex/authOps.ts'
	) {
		return null;
	}
	const rejection = verifiedBooleanFlow(body, definition.sourceFile);
	if (
		rejection === null ||
		callFacts(body, definition.sourceFile).filter(isMaterialIo)[0]?.position < rejection
	) {
		return { error: 'inline session HMAC no longer verifies and rejects before I/O' };
	}
	return { guard: 'crypto.subtle.verify+fail-closed', position: rejection };
}

/** @param {TsSourceFile} sourceFile @returns {Map<string, TsConciseBody>} */
function localFunctionBodies(sourceFile) {
	/** @type {Map<string, TsConciseBody>} */
	const bodies = new Map();
	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
			bodies.set(statement.name.text, statement.body);
		}
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
			const value = unwrap(declaration.initializer);
			if ((ts.isArrowFunction(value) || ts.isFunctionExpression(value)) && value.body) {
				bodies.set(declaration.name.text, value.body);
			}
		}
	}
	return bodies;
}

/** @param {string} name @param {TsSourceFile} sourceFile @param {Map<string, TsConciseBody>} bodies @param {Set<string>} [visiting] @returns {boolean} */
function isProvablyPureLocalCall(name, sourceFile, bodies, visiting = new Set()) {
	if (name === 'authOpsDb') return true;
	const body = bodies.get(name);
	if (!body || visiting.has(name)) return false;
	const nextVisiting = new Set(visiting);
	nextVisiting.add(name);
	if (containsCtxReference(body)) return false;
	for (const fact of callFacts(body, sourceFile)) {
		const expression = unwrap(fact.call.expression);
		const methodName =
			fact.name ?? (ts.isPropertyAccessExpression(expression) ? expression.name.text : null);
		const root = fact.target?.split('.')[0];
		if (
			(root && PURE_CALL_ROOTS.has(root)) ||
			(fact.target && PURE_GLOBAL_CALLS.has(fact.target)) ||
			(methodName && PURE_METHOD_CALLS.has(methodName))
		) {
			continue;
		}
		if (fact.name && isProvablyPureLocalCall(fact.name, sourceFile, bodies, nextVisiting)) {
			continue;
		}
		return false;
	}
	return !executedNodes(body).some(ts.isAwaitExpression);
}

/** @param {CallFact} fact @param {TsSourceFile} sourceFile @returns {boolean} */
function isReviewedPreAuthPureImportedCall(fact, sourceFile) {
	if (!fact.name) return false;
	const binding = importBinding(sourceFile, fact.name);
	if (!binding) return false;
	const importedPath = resolveRelativeTypeScript(sourceFile.fileName, binding.moduleName);
	if (!importedPath) return false;
	const key = `${relative(importedPath)}::${binding.importedName}`;
	if (!REVIEWED_PRE_AUTH_PURE_HELPERS.has(key)) return false;
	const importedSource = sourceFileFor(importedPath);
	return isProvablyPureLocalCall(
		binding.importedName,
		importedSource,
		localFunctionBodies(importedSource)
	);
}

/** @param {CallFact[]} facts @param {TsSourceFile} sourceFile @returns {CallFact[]} */
function unknownIoCalls(facts, sourceFile) {
	const bodies = localFunctionBodies(sourceFile);
	return facts.filter((fact) => {
		if (isMaterialIo(fact)) return false;
		if (fact.target === 'ctx.auth.getUserIdentity') return false;
		if (!fact.target) return true;
		const root = fact.target.split('.')[0];
		if (PURE_CALL_ROOTS.has(root) || PURE_GLOBAL_CALLS.has(fact.target) || root === 'v')
			return false;
		if (fact.name && isProvablyPureLocalCall(fact.name, sourceFile, bodies)) return false;
		if (isReviewedPreAuthPureImportedCall(fact, sourceFile)) return false;
		return true;
	});
}

/** @param {PublicDefinition} definition @returns {Classification} */
export function classifyDefinition(definition) {
	const location = `${relative(definition.filePath)}:${definition.line}`;
	if (!definition.options) {
		return { error: `${location} ${definition.exportName} does not use a static options object.` };
	}
	const body = handlerBody(definition);
	if (!body) return { error: `${location} ${definition.exportName} has no static handler body.` };
	const first = firstHandlerStatement(body);
	const firstCall = firstStatementCall(body);
	const firstCallTarget = firstCall ? expressionPath(firstCall.expression) : null;
	const facts = callFacts(body, definition.sourceFile);
	const material = facts.filter(isMaterialIo);
	const firstIo = material[0]?.position ?? Number.POSITIVE_INFINITY;
	const unknown = unknownIoCalls(facts, definition.sourceFile);
	const firstAuthSensitiveWork =
		[...material, ...unknown].sort((a, b) => a.position - b.position)[0]?.position ??
		Number.POSITIVE_INFINITY;

	if (first && ts.isThrowStatement(first)) {
		return { authority: 'pre-io-tombstone', guard: 'throw:first-statement' };
	}

	if (hasSecretValidator(definition.options) && firstCallTarget === 'requireInternalSecret') {
		if (
			!firstCall ||
			!isExactImport(
				definition.sourceFile,
				'requireInternalSecret',
				'requireInternalSecret',
				'./_internalAuth'
			) ||
			firstCall.arguments.length !== 1 ||
			!isExactSecretDerivation(firstCall.arguments[0], handlerSecretBinding(definition))
		) {
			return {
				error: `${location} ${definition.exportName} does not verify the exact handler args._secret value.`
			};
		}
		return { authority: 'server-secret', guard: 'requireInternalSecret:first-statement' };
	}

	if (hasRequiredSecretValidator(definition.options)) {
		if (firstCallTarget !== 'requireInternalSecret') {
			return {
				error: `${location} ${definition.exportName} declares _secret but does not call requireInternalSecret as handler statement one.`
			};
		}
	}

	const hmac = hmacGuard(definition, facts, body);
	if (hmac) {
		if ('error' in hmac) {
			return {
				error: `${location} ${definition.exportName} has an invalid HMAC guard: ${hmac.error}.`
			};
		}
		if (hmac.position > firstIo) {
			return {
				error: `${location} ${definition.exportName} performs material I/O before ${hmac.guard}.`
			};
		}
		return { authority: 'server-hmac', guard: hmac.guard };
	}

	const auth = authGuard(definition, facts, body);
	if (auth) {
		if ('error' in auth) {
			return {
				error: `${location} ${definition.exportName} has an invalid authority guard: ${auth.error}.`
			};
		}
		if (auth.position > firstAuthSensitiveWork) {
			return {
				error: `${location} ${definition.exportName} performs material/unknown work before ${auth.guard}.`
			};
		}
		return { authority: 'authenticated-role', guard: auth.guard };
	}

	if (material.length === 0 && unknown.length === 0 && !containsCtxReference(body)) {
		return { authority: 'explicitly-io-free', guard: 'no-material-or-unknown-io' };
	}

	const firstWork = material[0]?.text ?? unknown[0]?.text ?? 'ctx reference';
	return {
		error: `${location} ${definition.exportName} is unclassified; first material/unknown work: ${firstWork.slice(0, 160)}.`
	};
}

/** @param {PublicDefinition} definition */
function runtimeName(definition) {
	const moduleName = relative(definition.filePath)
		.replace(/^convex\//, '')
		.replace(/\.ts$/, '');
	return `${moduleName}:${definition.exportName}`;
}

/** @param {PublicDefinition} definition @param {{ authority: AuthorityClass, guard: string }} classification @returns {AuthorityEntry} */
function manifestEntry(definition, classification) {
	return {
		runtimeName: runtimeName(definition),
		source: relative(definition.filePath),
		exportName: definition.exportName,
		kind: definition.kind,
		authority: classification.authority,
		guard: classification.guard
	};
}

/** @param {TsSourceFile} sourceFile @returns {Map<string, TsExpression>} */
function variableInitializers(sourceFile) {
	/** @type {Map<string, TsExpression>} */
	const initializers = new Map();
	/** @param {TsNode} node */
	function visit(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			initializers.set(node.name.text, unwrap(node.initializer));
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return initializers;
}

/** @param {TsExpression} expression @param {TsSourceFile} sourceFile @param {Map<string, TsExpression>} initializers @param {Set<string>} [seen] @returns {boolean} */
function trustedSecretExpression(expression, sourceFile, initializers, seen = new Set()) {
	const value = unwrap(expression);
	if (ts.isCallExpression(value)) {
		const target = expressionPath(value.expression);
		if (target === 'getInternalSecret' && isTrustedInternalSecretImport(sourceFile)) {
			return true;
		}
		if (target === 'internalSecret') {
			const helper = topLevelFunctionNode(sourceFile, 'internalSecret');
			return Boolean(
				helper?.body &&
				isTrustedInternalSecretImport(sourceFile) &&
				callFacts(helper.body, sourceFile).some((fact) => fact.target === 'getInternalSecret')
			);
		}
	}
	if (ts.isIdentifier(value) && !seen.has(value.text)) {
		seen.add(value.text);
		const initializer = initializers.get(value.text);
		return Boolean(
			initializer && trustedSecretExpression(initializer, sourceFile, initializers, seen)
		);
	}
	return false;
}

/** @param {TsExpression} args @returns {TsExpression | null} */
function secretProperty(args) {
	const object = unwrap(args);
	if (!ts.isObjectLiteralExpression(object)) return null;
	for (const property of object.properties) {
		if (ts.isPropertyAssignment(property) && propertyName(property.name) === '_secret') {
			return property.initializer;
		}
		if (ts.isShorthandPropertyAssignment(property) && property.name.text === '_secret') {
			return property.name;
		}
	}
	return null;
}

/** @param {string} filePath @param {TsSourceFile} sourceFile @param {TsCallExpression} call @param {TsExpression} callee */
function isReviewedBudgetAdapterDynamicCall(filePath, sourceFile, call, callee) {
	if (relative(filePath) !== 'src/lib/server/convex-work-budget.ts') return false;
	if (!ts.isIdentifier(callee)) return false;
	/** @type {Record<string, { imported: string, wrapper: string }>} */
	const adapters = {
		unbudgetedServerAction: { imported: 'serverAction', wrapper: 'serverAction' },
		unbudgetedServerMutation: { imported: 'serverMutation', wrapper: 'serverMutation' },
		unbudgetedServerQuery: { imported: 'serverQuery', wrapper: 'serverQuery' }
	};
	const adapter = adapters[callee.text];
	if (!adapter || !isExactImport(sourceFile, callee.text, adapter.imported, 'convex-sveltekit')) {
		return false;
	}
	const ref = unwrap(call.arguments[0]);
	if (!ts.isIdentifier(ref) || ref.text !== 'ref') return false;
	let owner = call.parent;
	while (owner && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
	if (!owner?.name || owner.name.text !== adapter.wrapper) return false;
	const parameter = owner.parameters[0]?.name;
	return Boolean(parameter && ts.isIdentifier(parameter) && parameter.text === ref.text);
}

/** @param {AuthorityEntry[]} entries @param {string[]} [files] */
export function scanServerSecretCallers(entries, files = sourceFiles()) {
	const secretRuntimeNames = new Set(
		entries.filter((entry) => entry.authority === 'server-secret').map((entry) => entry.runtimeName)
	);
	/** @type {string[]} */
	const errors = [];
	/** @type {Map<string, string[]>} */
	const callers = new Map();
	for (const filePath of files) {
		const sourceFile = sourceFileFor(filePath);
		const initializers = variableInitializers(sourceFile);
		/** @type {Set<string>} */
		const serverHelpers = new Set();
		for (const statement of sourceFile.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
				continue;
			if (
				statement.moduleSpecifier.text !== '$lib/server/convex-work-budget' &&
				statement.moduleSpecifier.text !== 'convex-sveltekit'
			) {
				continue;
			}
			const bindings = statement.importClause?.namedBindings;
			if (!bindings || !ts.isNamedImports(bindings)) continue;
			for (const element of bindings.elements) {
				const imported = element.propertyName?.text ?? element.name.text;
				if (
					['budgetedServerQuery', 'serverAction', 'serverMutation', 'serverQuery'].includes(
						imported
					)
				) {
					serverHelpers.add(element.name.text);
				}
			}
		}
		for (const [name, initializer] of initializers) {
			if (ts.isIdentifier(initializer) && serverHelpers.has(initializer.text)) {
				errors.push(`${relative(filePath)} forbids dynamic server Convex helper alias ${name}.`);
			}
		}
		/** @param {TsNode} node */
		function visit(node) {
			if (ts.isCallExpression(node) && node.arguments.length > 0) {
				const operation = staticFunctionReference(node.arguments[0]);
				const callee = unwrap(node.expression);
				if (
					ts.isIdentifier(callee) &&
					serverHelpers.has(callee.text) &&
					!operation &&
					!isReviewedBudgetAdapterDynamicCall(filePath, sourceFile, node, callee)
				) {
					const location = `${relative(filePath)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
					errors.push(`${location} forbids a dynamic server Convex function reference.`);
				}
				const second = node.arguments[1] ? unwrap(node.arguments[1]) : null;
				const isBudgetCallback = Boolean(
					second && (ts.isArrowFunction(second) || ts.isFunctionExpression(second))
				);
				if (operation && secretRuntimeNames.has(operation) && !isBudgetCallback) {
					const location = `${relative(filePath)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
					const list = callers.get(operation) ?? [];
					list.push(location);
					callers.set(operation, list);
					const value = node.arguments[1] ? secretProperty(node.arguments[1]) : null;
					if (!value)
						errors.push(`${location} ${operation} is missing an explicit _secret argument.`);
					else if (!trustedSecretExpression(value, sourceFile, initializers)) {
						errors.push(`${location} ${operation} does not use the trusted server secret source.`);
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}
	return { callers, errors };
}

/** @param {EstreeNode | null | undefined} node @returns {string | null} */
function estreePropertyName(node) {
	if (!node) return null;
	if (node.type === 'Identifier') return node.name;
	if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
	return null;
}

/** @param {EstreeNode | null | undefined} node @returns {EstreeNode | null | undefined} */
function unwrapEstree(node) {
	let value = node;
	while (
		value &&
		typeof value.type === 'string' &&
		['ChainExpression', 'TSAsExpression', 'TSNonNullExpression', 'TSSatisfiesExpression'].includes(
			value.type
		)
	) {
		value = value.expression;
	}
	return value;
}

/** @param {EstreeNode | null | undefined} node @returns {string | null} */
function estreeStaticFunctionReference(node) {
	let current = unwrapEstree(node);
	/** @type {string[]} */
	const parts = [];
	while (current?.type === 'MemberExpression') {
		const name = current.computed
			? current.property?.type === 'Literal'
				? String(current.property.value)
				: null
			: estreePropertyName(current.property);
		if (!name) return null;
		parts.unshift(name);
		current = unwrapEstree(current.object);
	}
	if (current?.type !== 'Identifier' || !['api', 'convexApi'].includes(current.name)) return null;
	if (parts.length < 2) return null;
	return `${parts.slice(0, -1).join('/')}:${parts.at(-1)}`;
}

/** @param {EstreeNode} root @param {(node: EstreeNode) => void} visitor */
function visitEstree(root, visitor) {
	/** @type {Set<EstreeNode>} */
	const seen = new Set();
	/** @param {any} node */
	function visit(node) {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		if (typeof node.type === 'string') visitor(node);
		for (const [key, value] of Object.entries(node)) {
			if (
				['comments', 'leadingComments', 'loc', 'metadata', 'parent', 'trailingComments'].includes(
					key
				)
			) {
				continue;
			}
			if (Array.isArray(value)) value.forEach(visit);
			else visit(value);
		}
	}
	visit(root);
}

/** @param {string} filePath @returns {{ calls: { runtimeName: string, kind: string }[], errors: string[] }} */
function svelteBrowserCalls(filePath) {
	const source = fs.readFileSync(filePath, 'utf8');
	const ast = parseSvelte(source, { filename: filePath, modern: true });
	const program = ast.instance?.content;
	if (!program) return { calls: [], errors: [] };
	/** @type {Set<string>} */
	const clients = new Set();
	/** @type {string[]} */
	const errors = [];
	visitEstree(program, (node) => {
		if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier') return;
		const value = unwrapEstree(node.init);
		if (
			value?.type === 'CallExpression' &&
			value.callee?.type === 'Identifier' &&
			['getConvexClient', 'useConvexClient'].includes(value.callee.name)
		) {
			clients.add(node.id.name);
			return;
		}
		if (value?.type === 'Identifier' && clients.has(value.name)) {
			errors.push(`${relative(filePath)} forbids browser Convex client alias ${node.id.name}.`);
		}
	});

	/** @type {{ runtimeName: string, kind: string }[]} */
	const calls = [];
	visitEstree(program, (node) => {
		if (node.type !== 'CallExpression') return;
		const callee = unwrapEstree(node.callee);
		if (callee?.type !== 'MemberExpression') return;
		const kind = estreePropertyName(callee.property);
		if (kind !== 'query' && kind !== 'mutation' && kind !== 'action') return;
		const object = unwrapEstree(callee.object);
		const trackedClient =
			(object?.type === 'Identifier' && clients.has(object.name)) ||
			(object?.type === 'CallExpression' &&
				object.callee?.type === 'Identifier' &&
				['getConvexClient', 'useConvexClient'].includes(object.callee.name));
		const runtimeName = estreeStaticFunctionReference(node.arguments?.[0]);
		if (trackedClient && !runtimeName) {
			errors.push(`${relative(filePath)} forbids a dynamic browser Convex function reference.`);
			return;
		}
		if (trackedClient && runtimeName) calls.push({ runtimeName, kind });
	});
	return { calls, errors };
}

/** @param {string} filePath @returns {{ calls: { runtimeName: string, kind: string }[], errors: string[] }} */
function typescriptBrowserCalls(filePath) {
	const sourceFile = sourceFileFor(filePath);
	/** @type {Set<string>} */
	const clients = new Set();
	/** @type {string[]} */
	const errors = [];
	/** @param {TsNode} node */
	function collect(node) {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const value = unwrap(node.initializer);
			const factory = ts.isCallExpression(value) ? unwrap(value.expression) : null;
			if (
				factory &&
				ts.isIdentifier(factory) &&
				['getConvexClient', 'useConvexClient'].includes(factory.text)
			) {
				clients.add(node.name.text);
			} else if (ts.isIdentifier(value) && clients.has(value.text)) {
				errors.push(`${relative(filePath)} forbids browser Convex client alias ${node.name.text}.`);
			}
		}
		ts.forEachChild(node, collect);
	}
	collect(sourceFile);
	/** @type {{ runtimeName: string, kind: string }[]} */
	const calls = [];
	/** @param {TsNode} node */
	function visit(node) {
		if (ts.isCallExpression(node)) {
			const callee = unwrap(node.expression);
			if (!ts.isPropertyAccessExpression(callee)) {
				ts.forEachChild(node, visit);
				return;
			}
			const kind = callee.name.text;
			if (['query', 'mutation', 'action'].includes(kind)) {
				const object = unwrap(callee.expression);
				const trackedClient =
					(ts.isIdentifier(object) && clients.has(object.text)) ||
					(ts.isCallExpression(object) &&
						ts.isIdentifier(unwrap(object.expression)) &&
						['getConvexClient', 'useConvexClient'].includes(
							unwrap(object.expression).getText(sourceFile)
						));
				const runtimeName = node.arguments[0] ? staticFunctionReference(node.arguments[0]) : null;
				if (trackedClient && !runtimeName) {
					errors.push(`${relative(filePath)} forbids a dynamic browser Convex function reference.`);
				} else if (trackedClient && runtimeName) calls.push({ runtimeName, kind });
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return { calls, errors };
}

/** @param {AuthorityEntry[]} entries @param {string[]} [files] */
export function scanBrowserDirectResiduals(entries, files = browserSourceFiles()) {
	const entryByName = new Map(entries.map((entry) => [entry.runtimeName, entry]));
	/** @type {Map<string, BrowserResidual>} */
	const observed = new Map();
	/** @type {string[]} */
	const errors = [];
	for (const filePath of files) {
		const caller = relative(filePath);
		const result = filePath.endsWith('.svelte')
			? svelteBrowserCalls(filePath)
			: typescriptBrowserCalls(filePath);
		errors.push(...result.errors);
		for (const { runtimeName, kind } of result.calls) {
			const key = `${caller}\u0000${runtimeName}`;
			const current = observed.get(key);
			if (current) current.callCount += 1;
			else observed.set(key, { runtimeName, caller, kind, callCount: 1 });
		}
	}

	const reviewedByKey = new Map(
		REVIEWED_BROWSER_DIRECT_RESIDUALS.map((entry) => [
			`${entry.caller}\u0000${entry.runtimeName}`,
			entry
		])
	);
	for (const [key, call] of observed) {
		if (!reviewedByKey.has(key)) {
			errors.push(`Unreviewed browser-direct Convex call: ${call.caller} -> ${call.runtimeName}.`);
			continue;
		}
		const authority = entryByName.get(call.runtimeName);
		if (!authority)
			errors.push(`Browser-direct residual references unknown export ${call.runtimeName}.`);
		else if (authority.kind !== call.kind) {
			errors.push(
				`Browser-direct call kind drift for ${call.runtimeName}: ${call.kind} != ${authority.kind}.`
			);
		} else if (authority.authority !== 'authenticated-role') {
			errors.push(`Browser-direct residual ${call.runtimeName} is not authenticated-role.`);
		}
	}
	for (const [key, reviewed] of reviewedByKey) {
		if (!observed.has(key)) {
			errors.push(
				`Stale reviewed browser-direct residual: ${reviewed.caller} -> ${reviewed.runtimeName}.`
			);
		}
	}

	const residuals = [...observed.values()]
		.map((call) => ({
			...call,
			workBound:
				reviewedByKey.get(`${call.caller}\u0000${call.runtimeName}`)?.workBound ?? 'UNREVIEWED'
		}))
		.sort((a, b) => a.runtimeName.localeCompare(b.runtimeName) || a.caller.localeCompare(b.caller));
	return { residuals, errors };
}

/** @param {string[]} [files] */
export function deriveAuthorityInventory(files = convexFiles()) {
	const definitions = files.flatMap(exportedPublicDefinitions);
	/** @type {AuthorityEntry[]} */
	const entries = [];
	const errors = factorySurfaceErrors(files);
	const seen = new Set();
	for (const definition of definitions) {
		const name = runtimeName(definition);
		if (seen.has(name)) {
			errors.push(
				`${relative(definition.filePath)}:${definition.line} duplicates public runtime name ${name}.`
			);
			continue;
		}
		seen.add(name);
		const classification = classifyDefinition(definition);
		if ('error' in classification) errors.push(classification.error);
		else entries.push(manifestEntry(definition, classification));
	}
	entries.sort((a, b) => a.runtimeName.localeCompare(b.runtimeName));
	return { definitions, entries, errors };
}

/** @param {AuthorityEntry[]} entries @param {BrowserResidual[]} [browserDirectAuthenticatedResiduals] @returns {AuthorityManifest} */
export function expectedManifest(entries, browserDirectAuthenticatedResiduals = []) {
	/** @type {Record<AuthorityClass, number>} */
	const counts = {
		'authenticated-role': 0,
		'explicitly-io-free': 0,
		'pre-io-tombstone': 0,
		'server-hmac': 0,
		'server-secret': 0
	};
	for (const entry of entries) counts[entry.authority] += 1;
	return {
		version: 1,
		generatedBy: SCRIPT_NAME,
		categories: [...AUTHORITY_CLASSES],
		counts,
		browserDirectAuthenticatedResiduals,
		entries
	};
}

/** @param {unknown} value */
function stableJson(value) {
	return `${JSON.stringify(value, null, '\t')}\n`;
}

/** @param {AuthorityManifest} actual @param {AuthorityManifest} expected @returns {string[]} */
export function validateManifest(actual, expected) {
	/** @type {string[]} */
	const errors = [];
	if (stableJson(actual) !== stableJson(expected)) {
		const expectedNames = new Set(expected.entries.map((entry) => entry.runtimeName));
		const actualEntries = Array.isArray(actual?.entries) ? actual.entries : [];
		const actualNames = new Set(actualEntries.map((entry) => entry.runtimeName));
		for (const name of expectedNames) {
			if (!actualNames.has(name)) errors.push(`Manifest is missing public export ${name}.`);
		}
		for (const name of actualNames) {
			if (!expectedNames.has(name)) errors.push(`Manifest contains stale public export ${name}.`);
		}
		if (errors.length === 0) {
			errors.push(
				`Manifest authority, kind, source, guard, count, or ordering drifted; run ${SCRIPT_NAME} --write and review the diff.`
			);
		}
	}
	return errors;
}

/** @param {string[]} [argv] */
export function main(argv = process.argv.slice(2)) {
	const write = argv.includes('--write');
	const inventory = deriveAuthorityInventory();
	if (inventory.errors.length > 0) {
		throw new Error(
			`Convex public authority classification failed:\n- ${inventory.errors.join('\n- ')}`
		);
	}
	const callers = scanServerSecretCallers(inventory.entries);
	if (callers.errors.length > 0) {
		throw new Error(
			`Convex server-secret caller verification failed:\n- ${callers.errors.join('\n- ')}`
		);
	}
	const browserDirect = scanBrowserDirectResiduals(inventory.entries);
	if (browserDirect.errors.length > 0) {
		throw new Error(
			`Convex browser-direct residual verification failed:\n- ${browserDirect.errors.join('\n- ')}`
		);
	}
	const expected = expectedManifest(inventory.entries, browserDirect.residuals);
	if (write) {
		fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
		fs.writeFileSync(MANIFEST_PATH, stableJson(expected));
		console.log(
			`Wrote ${relative(MANIFEST_PATH)} with ${inventory.entries.length} public exports.`
		);
		return expected;
	}
	if (!fs.existsSync(MANIFEST_PATH)) {
		throw new Error(
			`Missing ${relative(MANIFEST_PATH)}; run ${SCRIPT_NAME} --write and review it.`
		);
	}
	/** @type {AuthorityManifest} */
	const actual = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
	const manifestErrors = validateManifest(actual, expected);
	if (manifestErrors.length > 0) {
		throw new Error(`Convex public authority manifest failed:\n- ${manifestErrors.join('\n- ')}`);
	}
	const counts = Object.entries(expected.counts)
		.map(([authority, count]) => `${authority}=${count}`)
		.join(', ');
	console.log(
		`Convex public authority passed: ${inventory.entries.length} exports; ${counts}; ` +
			`${[...callers.callers.values()].flat().length} server-secret callers and ` +
			`${browserDirect.residuals.length} authenticated browser-direct residuals verified.`
	);
	return expected;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
