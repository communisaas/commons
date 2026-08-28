#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = process.cwd();
const DEFAULT_CONVEX_DIR = path.join(ROOT, 'convex');
const DEFAULT_POLICY_PATH = path.join(ROOT, 'config/convex-paid-provider-egress.json');

const PROVIDER_DOMAINS = [
	'generativelanguage.googleapis.com',
	'api.openai.com',
	'api.anthropic.com',
	'api.groq.com',
	'api.firecrawl.dev',
	'api.exa.ai',
	'api.together.xyz',
	'api.mistral.ai',
	'api.cohere.com',
	'api.perplexity.ai',
	'api.deepseek.com',
	'api.replicate.com',
	'api-inference.huggingface.co',
	'openrouter.ai/api',
	'aiplatform.googleapis.com',
	'api.ai21.com',
	'bedrock-runtime.',
	'openai.azure.com',
	'services.ai.azure.com',
	'api.x.ai',
	'api.stability.ai'
];

const PROVIDER_PACKAGES = [
	'@google/genai',
	'@google/generative-ai',
	'openai',
	'@anthropic-ai/sdk',
	'groq-sdk',
	'@mendable/firecrawl-js',
	'exa-js',
	'together-ai',
	'@mistralai/mistralai',
	'cohere-ai',
	'replicate',
	'@google-cloud/vertexai',
	'@aws-sdk/client-bedrock-runtime',
	'@azure/openai',
	'ai21',
	'@ai21/ai21',
	'@xai-org/xai-sdk',
	'stability-ai'
];

const PROVIDER_CREDENTIAL_RE =
	/^(?:GEMINI|GOOGLE_GENERATIVE_AI|VERTEX_AI|OPENAI|AZURE_OPENAI|ANTHROPIC|GROQ|FIRECRAWL|EXA|TOGETHER|MISTRAL|COHERE|PERPLEXITY|DEEPSEEK|REPLICATE|HUGGINGFACE|OPENROUTER|AI21|BEDROCK|XAI|STABILITY_AI)_(?:[A-Z0-9_]*_)?(?:API_KEY|TOKEN)$/;
const EXECUTABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

/**
 * @typedef {{file: string, symbol: string, kind: string, indicator: string}} ProviderFindingIdentity
 * @typedef {ProviderFindingIdentity & {line: number}} ProviderFinding
 * @typedef {ProviderFindingIdentity & {authority?: string}} ApprovedProviderCapability
 * @typedef {{protocol?: number, approvedCapabilities?: ApprovedProviderCapability[], retiredCapabilities?: string[]}} PaidProviderEgressPolicy
 * @typedef {{files: string[], findings: ProviderFinding[], executableTokens: Set<string>}} PaidProviderEgressScan
 */

/** @param {string} value */
function toPosix(value) {
	return value.split(path.sep).join('/');
}

/** @param {string} absolute */
function isExecutableSource(absolute) {
	const base = path.basename(absolute);
	return (
		EXECUTABLE_EXTENSIONS.has(path.extname(base)) &&
		!base.endsWith('.d.ts') &&
		!/(?:^|\.)test\.[^.]+$/.test(base) &&
		!/(?:^|\.)spec\.[^.]+$/.test(base) &&
		!toPosix(absolute).includes('/_generated/')
	);
}

/** @param {string} directory */
function executableFiles(directory) {
	/** @type {string[]} */
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...executableFiles(absolute));
		else if (entry.isFile() && isExecutableSource(absolute)) files.push(absolute);
	}
	return files.sort();
}

/** @param {ts.Node} node */
function enclosingSymbol(node) {
	let current = node;
	while (current.parent && !ts.isSourceFile(current.parent)) current = current.parent;
	if (ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current)) {
		return current.name?.text ?? '<anonymous>';
	}
	if (ts.isVariableStatement(current)) {
		const declaration = current.declarationList.declarations.find(
			(candidate) => candidate.getStart() <= node.getStart() && candidate.getEnd() >= node.getEnd()
		);
		return declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : '<module>';
	}
	return '<module>';
}

/** @param {ts.Node} node */
function literalText(node) {
	if (ts.isStringLiteralLike(node)) return node.text;
	if (ts.isTemplateExpression(node)) {
		return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('${}');
	}
	return null;
}

/** @param {ts.Node} node */
function moduleSpecifierText(node) {
	if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
		return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
			? node.moduleSpecifier.text
			: null;
	}
	if (!ts.isCallExpression(node) || node.arguments.length !== 1) return null;
	const argument = node.arguments[0];
	if (!argument || !ts.isStringLiteralLike(argument)) return null;
	if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return argument.text;
	return ts.isIdentifier(node.expression) && node.expression.text === 'require'
		? argument.text
		: null;
}

/** @param {string} moduleName */
function providerPackage(moduleName) {
	return PROVIDER_PACKAGES.find(
		(candidate) => moduleName === candidate || moduleName.startsWith(`${candidate}/`)
	);
}

/** @param {ProviderFindingIdentity} finding */
function findingKey(finding) {
	return [finding.file, finding.symbol, finding.kind, finding.indicator].join('|');
}

/**
 * Scan the complete Convex executable-source tree. TypeScript's syntax tree is
 * intentional here: comments and documentation cannot create an executable
 * finding, while nested helpers and subdirectories cannot evade inventory.
 */
export function scanConvexPaidProviderEgress({
	convexDir = DEFAULT_CONVEX_DIR,
	repositoryRoot = ROOT
} = {}) {
	/** @type {ProviderFinding[]} */
	const findings = [];
	/** @type {Set<string>} */
	const seen = new Set();
	/** @type {Set<string>} */
	const executableTokens = new Set();
	const files = executableFiles(convexDir);

	for (const absolute of files) {
		const source = fs.readFileSync(absolute, 'utf8');
		const sourceFile = ts.createSourceFile(
			absolute,
			source,
			ts.ScriptTarget.Latest,
			true,
			absolute.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
		);
		const file = toPosix(path.relative(repositoryRoot, absolute));

		/**
		 * @param {ts.Node} node
		 * @param {string} kind
		 * @param {string} indicator
		 */
		function add(node, kind, indicator) {
			const finding = {
				file,
				symbol: enclosingSymbol(node),
				kind,
				indicator,
				line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
			};
			const key = findingKey(finding);
			if (!seen.has(key)) {
				seen.add(key);
				findings.push(finding);
			}
		}

		/** @param {ts.Node} node */
		function visit(node) {
			if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) {
				executableTokens.add(`${file}:${node.text}`);
			}
			const moduleName = moduleSpecifierText(node);
			if (moduleName) {
				const matchedPackage = providerPackage(moduleName);
				if (matchedPackage) add(node, 'provider-sdk', matchedPackage);
			}

			const text = literalText(node);
			if (text !== null) {
				for (const domain of PROVIDER_DOMAINS) {
					if (text.toLowerCase().includes(domain)) add(node, 'provider-domain', domain);
				}
				if (
					ts.isStringLiteralLike(node) &&
					PROVIDER_CREDENTIAL_RE.test(node.text) &&
					ts.isElementAccessExpression(node.parent) &&
					node.parent.argumentExpression === node
				) {
					add(node, 'provider-environment-key', node.text);
				}
			}

			if (ts.isIdentifier(node) && PROVIDER_CREDENTIAL_RE.test(node.text)) {
				add(node, 'provider-environment-key', node.text);
			}
			ts.forEachChild(node, visit);
		}
		visit(sourceFile);
	}

	return {
		files,
		findings: findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b))),
		executableTokens
	};
}

/**
 * @param {PaidProviderEgressPolicy} policy
 * @param {PaidProviderEgressScan} scan
 */
export function validateConvexPaidProviderEgress(policy, scan) {
	/** @type {string[]} */
	const errors = [];
	if (policy?.protocol !== 1) errors.push('Paid-provider egress policy protocol must be 1.');
	if (!Array.isArray(policy?.approvedCapabilities)) {
		return [...errors, 'Paid-provider egress approvedCapabilities must be an array.'];
	}
	if (policy.approvedCapabilities.length !== 0) {
		errors.push('Convex paid-provider egress approvals must remain empty.');
	}
	if (!Array.isArray(policy?.retiredCapabilities)) {
		errors.push('Paid-provider egress retiredCapabilities must be an array.');
	}

	const approved = new Map();
	for (const capability of policy.approvedCapabilities) {
		const key = findingKey(capability);
		if (approved.has(key)) errors.push(`Duplicate approved provider capability: ${key}.`);
		if (typeof capability.authority !== 'string' || capability.authority.length < 40) {
			errors.push(`Approved provider capability has no concrete authority proof: ${key}.`);
		}
		approved.set(key, capability);
	}

	const actual = new Map(scan.findings.map((finding) => [findingKey(finding), finding]));
	for (const [key, finding] of actual) {
		if (!approved.has(key)) {
			errors.push(
				`Unapproved Convex paid-provider egress: ${finding.file}:${finding.line} ` +
					`${finding.symbol} ${finding.kind} ${finding.indicator}.`
			);
		}
	}
	for (const key of approved.keys()) {
		if (!actual.has(key)) errors.push(`Stale approved Convex paid-provider capability: ${key}.`);
	}

	const retired = new Set(policy.retiredCapabilities ?? []);
	for (const required of [
		'convex/templates.ts:generateQueryEmbedding',
		'convex/templates.ts:GEMINI_API_KEY',
		'convex/templates.ts:backfillTagEmbeddings',
		'convex/intelligence.ts:ingest',
		'convex/crons.ts:tag-concept-embedding-backfill'
	]) {
		if (!retired.has(required)) errors.push(`Missing retired provider capability: ${required}.`);
		if (scan.executableTokens.has(required)) {
			errors.push(`Retired provider capability remains executable: ${required}.`);
		}
	}

	return errors;
}

export function main() {
	const policy = JSON.parse(fs.readFileSync(DEFAULT_POLICY_PATH, 'utf8'));
	const scan = scanConvexPaidProviderEgress();
	const errors = validateConvexPaidProviderEgress(policy, scan);
	if (errors.length > 0) {
		throw new Error(`Convex paid-provider egress ratchet failed:\n- ${errors.join('\n- ')}`);
	}
	console.log(
		`Convex paid-provider egress ratchet passed: ${scan.files.length} executable modules, ` +
			`${scan.findings.length} reviewed findings, zero uncoordinated capabilities.`
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
