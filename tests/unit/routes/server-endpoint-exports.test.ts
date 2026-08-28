import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const ROUTES_ROOT = 'src/routes';
const VALID_SERVER_EXPORTS = new Set([
	'GET',
	'POST',
	'PATCH',
	'PUT',
	'DELETE',
	'OPTIONS',
	'HEAD',
	'fallback',
	'prerender',
	'trailingSlash',
	'config',
	'entries'
]);

function serverRouteFiles(directory = ROUTES_ROOT): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return serverRouteFiles(path);
		return entry.isFile() && entry.name === '+server.ts' ? [path] : [];
	});
}

function isExported(node: ts.Node): boolean {
	return ts.canHaveModifiers(node)
		? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
				false)
		: false;
}

function bindingNames(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	return name.elements.flatMap((element) =>
		ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
	);
}

function runtimeExportNames(path: string): string[] {
	const source = ts.createSourceFile(
		path,
		readFileSync(path, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const names: string[] = [];

	for (const statement of source.statements) {
		if (ts.isExportAssignment(statement)) {
			names.push('default');
			continue;
		}
		if (ts.isExportDeclaration(statement)) {
			if (statement.isTypeOnly) continue;
			if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
				names.push('*');
				continue;
			}
			for (const element of statement.exportClause.elements) {
				if (!element.isTypeOnly) names.push(element.name.text);
			}
			continue;
		}
		if (!isExported(statement)) continue;
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				names.push(...bindingNames(declaration.name));
			}
			continue;
		}
		if (
			(ts.isFunctionDeclaration(statement) ||
				ts.isClassDeclaration(statement) ||
				ts.isEnumDeclaration(statement)) &&
			statement.name
		) {
			names.push(statement.name.text);
		}
	}

	return names;
}

describe('SvelteKit server endpoint exports', () => {
	it('keeps every runtime export within the endpoint contract', () => {
		const invalid = serverRouteFiles()
			.flatMap((path) =>
				runtimeExportNames(path).map((name) => ({
					path: relative('.', path),
					name
				}))
			)
			.filter(({ name }) => !name.startsWith('_') && !VALID_SERVER_EXPORTS.has(name));

		expect(invalid).toEqual([]);
	});
});
