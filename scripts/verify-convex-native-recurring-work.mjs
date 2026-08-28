#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** @typedef {'essential'|'operational'|'speculative'} CronTier */
/**
 * @typedef {{name: string, tier: CronTier|null, method: string, schedule: string, handler: string, codeTombstoned: boolean, line: number}} CronJob
 */
/** @typedef {{file: string, symbol: string}} StaticTarget */
/**
 * @typedef {{absolute: string, source: string, sourceFile: ts.SourceFile, declarations: Map<string, ts.FunctionDeclaration|ts.VariableDeclaration>, imports: Map<string, StaticTarget>}} SourceModule
 */
/**
 * @typedef {{node: ts.FunctionDeclaration|ts.VariableDeclaration, sourceFile: ts.SourceFile, source: string, text: string}} NamedNode
 */

const ROOT = process.cwd();
const CRONS_PATH = path.join(ROOT, 'convex/crons.ts');
const MANIFEST_PATH = path.join(ROOT, 'config/convex-native-recurring-work.json');
const CRON_METHODS = new Set(['cron', 'daily', 'hourly', 'interval', 'weekly']);
/** @type {CronTier[]} */
const TIERS = ['essential', 'operational', 'speculative'];
const ANALYTICS_TOMBSTONES = new Set(['analytics-snapshot', 'analytics-snapshot-supervisor']);

/** @param {string} text */
function canonicalExpression(text) {
	return text.replace(/\s+/g, '').replaceAll('"', "'");
}

/** @param {ts.SourceFile} sourceFile @param {ts.Node} node */
function lineOf(sourceFile, node) {
	return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** @param {ts.Node} node @returns {CronTier|null} */
function enclosingTier(node) {
	let current = node.parent;
	while (current) {
		if (ts.isIfStatement(current)) {
			const match = /\benabled\(\s*['"](essential|operational|speculative)['"]\s*\)/.exec(
				current.expression.getText()
			);
			if (match) return /** @type {CronTier} */ (match[1]);
		}
		current = current.parent;
	}
	return null;
}

/** @param {ts.Node} node */
function enclosingConditions(node) {
	/** @type {string[]} */
	const conditions = [];
	let current = node.parent;
	while (current) {
		if (ts.isIfStatement(current)) conditions.push(current.expression.getText());
		current = current.parent;
	}
	return conditions.join(' && ');
}

/** @param {{cronPath?: string}} [options] */
export function scanConvexNativeRecurringWork({ cronPath = CRONS_PATH } = {}) {
	const source = fs.readFileSync(cronPath, 'utf8');
	const sourceFile = ts.createSourceFile(
		cronPath,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	// Cadences expressed as imported constants resolve to their integer value
	// before any text comparison or envelope arithmetic below.
	const constants = numericImportConstants(source, cronPath);
	/** @type {CronJob[]} */
	const jobs = [];
	/** @type {string[]} */
	const errors = [];
	/** @type {Set<string>} */
	const seen = new Set();

	/** @param {ts.Node} node */
	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			ts.isIdentifier(node.expression.expression) &&
			node.expression.expression.text === 'crons' &&
			CRON_METHODS.has(node.expression.name.text)
		) {
			const [nameNode, scheduleNode, handlerNode] = node.arguments;
			if (!nameNode || !ts.isStringLiteral(nameNode) || !scheduleNode || !handlerNode) {
				errors.push(`convex/crons.ts:${lineOf(sourceFile, node)} has a non-static cron contract.`);
			} else {
				const name = nameNode.text;
				const tier = enclosingTier(node);
				if (!tier)
					errors.push(`convex/crons.ts:${lineOf(sourceFile, node)} ${name} has no tier gate.`);
				if (seen.has(name)) errors.push(`Duplicate cron name: ${name}.`);
				seen.add(name);
				const conditions = enclosingConditions(node);
				jobs.push({
					name,
					tier,
					method: node.expression.name.text,
					schedule: substituteConstants(scheduleNode.getText(sourceFile), constants),
					handler: handlerNode.getText(sourceFile),
					codeTombstoned:
						ANALYTICS_TOMBSTONES.has(name) &&
						conditions.includes('ANALYTICS_SNAPSHOT_CRON_READY') &&
						/const\s+ANALYTICS_SNAPSHOT_CRON_READY\s*=\s*false\s*;/.test(source),
					line: lineOf(sourceFile, node)
				});
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return { source, sourceFile, jobs, errors };
}

/**
 * Resolve `{ minutes: SOME_CONSTANT }` back to `{ minutes: 15 }`.
 *
 * This ratchet reads cron cadences as TEXT, so a cadence expressed as an
 * imported constant reads as an unsupported schedule and the daily-envelope
 * arithmetic below cannot run at all. Moving a cadence into a named constant is
 * the right change -- convex/lib/contactAuthority.ts derives its overdue alarm
 * from the recovery interval precisely so the two cannot drift -- so resolve
 * the identifier here rather than forcing the literal back into crons.ts.
 *
 * Only integer `export const NAME = <digits>;` in modules crons.ts actually
 * imports is resolved. Anything else stays unresolved and still fails loudly.
 *
 * @param {string} source convex/crons.ts text
 * @param {string} cronsPath absolute path to convex/crons.ts
 * @returns {Map<string, string>}
 */
function numericImportConstants(source, cronsPath) {
	/** @type {Map<string, string>} */
	const resolved = new Map();
	const importRe = /import\s*\{([^}]*)\}\s*from\s*'(\.\/[^']+)'/g;
	for (const match of source.matchAll(importRe)) {
		const specifier = match[2];
		const absolute = path.resolve(path.dirname(cronsPath), `${specifier}.ts`);
		if (!fs.existsSync(absolute)) continue;
		const moduleSource = fs.readFileSync(absolute, 'utf8');
		for (const name of match[1].split(',').map((entry) => entry.trim()).filter(Boolean)) {
			const constRe = new RegExp(`export const ${name}\\s*=\\s*(\\d+)\\s*;`);
			const value = constRe.exec(moduleSource);
			if (value) resolved.set(name, value[1]);
		}
	}
	return resolved;
}

/** @param {string} schedule @param {Map<string, string>} constants @returns {string} */
function substituteConstants(schedule, constants) {
	let out = schedule;
	for (const [name, value] of constants) {
		out = out.replaceAll(name, value);
	}
	return out;
}

/** @param {{method: string, schedule: string, name: string}} job */
export function ticksPerDay(job) {
	if (job.method === 'daily') return 1;
	if (job.method === 'hourly') return 24;
	if (job.method === 'weekly') return 1 / 7;
	const schedule = canonicalExpression(job.schedule);
	if (job.method === 'interval') {
		const minuteMatch = /\{minutes:(\d+)\}/.exec(schedule);
		if (minuteMatch) return 1440 / Number(minuteMatch[1]);
		const hourMatch = /\{hours:(\d+)\}/.exec(schedule);
		if (hourMatch) return 24 / Number(hourMatch[1]);
	}
	if (job.method === 'cron') {
		const match = /^'([0-9,]+)\s+\*\s+\*\s+\*\s+\*'$/.exec(
			job.schedule.trim().replaceAll('"', "'")
		);
		if (match) return match[1].split(',').length * 24;
	}
	throw new Error(`Unsupported cadence for ${job.name}: ${job.method} ${job.schedule}`);
}

/** @param {string} absolute @param {string} name @returns {NamedNode|null} */
function findNamedNode(absolute, name) {
	const source = fs.readFileSync(absolute, 'utf8');
	const sourceFile = ts.createSourceFile(
		absolute,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	/** @type {Array<ts.FunctionDeclaration|ts.VariableDeclaration>} */
	const matches = [];
	/** @param {ts.Node} node */
	function visit(node) {
		if (matches.length > 0) return;
		if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
			matches.push(node);
		}
		if (matches.length === 0) ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	const found = matches[0];
	return found ? { node: found, sourceFile, source, text: found.getText(sourceFile) } : null;
}

/** @param {ts.Node} root */
function declarationHazards(root) {
	let collectCalls = 0;
	let awaitedForOf = 0;
	let paginateCalls = 0;
	let emptyEncryptedEmailWrites = 0;
	/** @param {ts.Node} node */
	function visit(node) {
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === 'collect'
		) {
			collectCalls++;
		}
		if (
			ts.isCallExpression(node) &&
			ts.isPropertyAccessExpression(node.expression) &&
			node.expression.name.text === 'paginate'
		) {
			paginateCalls++;
		}
		if (ts.isForOfStatement(node) && node.awaitModifier) awaitedForOf++;
		if (
			ts.isPropertyAssignment(node) &&
			((ts.isIdentifier(node.name) && node.name.text === 'encryptedEmail') ||
				(ts.isStringLiteral(node.name) && node.name.text === 'encryptedEmail')) &&
			ts.isStringLiteral(node.initializer) &&
			node.initializer.text === ''
		) {
			emptyEncryptedEmailWrites++;
		}
		ts.forEachChild(node, visit);
	}
	visit(root);
	return { collectCalls, awaitedForOf, paginateCalls, emptyEncryptedEmailWrites };
}

/** @param {ts.Expression} expression */
function unwrapExpression(expression) {
	let current = expression;
	while (
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isParenthesizedExpression(current) ||
		ts.isNonNullExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

/** @type {Map<string, SourceModule>} */
const moduleCache = new Map();

/** @param {string} absolute @returns {SourceModule} */
function loadSourceModule(absolute) {
	const normalized = path.resolve(absolute);
	const cached = moduleCache.get(normalized);
	if (cached) return cached;
	const source = fs.readFileSync(normalized, 'utf8');
	const sourceFile = ts.createSourceFile(
		normalized,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	/** @type {Map<string, ts.FunctionDeclaration|ts.VariableDeclaration>} */
	const declarations = new Map();
	/** @type {Map<string, StaticTarget>} */
	const imports = new Map();
	for (const statement of sourceFile.statements) {
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			declarations.set(statement.name.text, statement);
		}
		if (ts.isVariableStatement(statement)) {
			for (const declaration of statement.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, declaration);
			}
		}
	}
	for (const statement of sourceFile.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			!statement.moduleSpecifier.text.startsWith('.')
		) {
			continue;
		}
		const named = statement.importClause?.namedBindings;
		if (!named || !ts.isNamedImports(named)) continue;
		let targetFile = path.resolve(path.dirname(normalized), statement.moduleSpecifier.text);
		if (!path.extname(targetFile)) targetFile += '.ts';
		for (const element of named.elements) {
			imports.set(element.name.text, {
				file: targetFile,
				symbol: element.propertyName?.text ?? element.name.text
			});
		}
	}
	const loaded = { absolute: normalized, source, sourceFile, declarations, imports };
	moduleCache.set(normalized, loaded);
	return loaded;
}

/** @param {ts.Expression} raw @param {SourceModule} module @returns {StaticTarget|null} */
function staticFunctionTarget(raw, module) {
	const expression = unwrapExpression(raw);
	if (!ts.isIdentifier(expression)) {
		/** @type {string[]} */
		const parts = [];
		let current = expression;
		while (ts.isPropertyAccessExpression(current)) {
			parts.unshift(current.name.text);
			current = unwrapExpression(current.expression);
		}
		return ts.isIdentifier(current) && current.text === 'internal' && parts.length === 2
			? {
					file: path.join(ROOT, 'convex', `${parts[0]}.ts`),
					symbol: parts[1]
				}
			: null;
	}
	const imported = module.imports.get(expression.text);
	if (imported) {
		return imported.file.includes(`${path.sep}_generated${path.sep}`) ? null : imported;
	}
	const declaration = module.declarations.get(expression.text);
	if (!declaration) return null;
	if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
		const initializer = unwrapExpression(declaration.initializer);
		const initializerText = initializer.getText(module.sourceFile);
		const directInternal = /internal\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)/.exec(initializerText);
		if (directInternal) {
			return {
				file: path.join(ROOT, 'convex', `${directInternal[1]}.ts`),
				symbol: directInternal[2]
			};
		}
		if (ts.isCallExpression(initializer)) {
			const runtimeName = initializer.arguments.find(ts.isStringLiteral)?.text;
			if (runtimeName && runtimeName.includes(':')) {
				const [moduleName, symbol] = runtimeName.split(':');
				return { file: path.join(ROOT, 'convex', `${moduleName}.ts`), symbol };
			}
		}
		const runtimeMatch = /makeFunctionReference(?:<[^>]+>)?\s*\(\s*['"]([^'"]+)['"]/.exec(
			initializerText
		);
		if (runtimeMatch) {
			const [moduleName, symbol] = runtimeMatch[1].split(':');
			return { file: path.join(ROOT, 'convex', `${moduleName}.ts`), symbol };
		}
	}
	return { file: module.absolute, symbol: expression.text };
}

/**
 * Follow same-repository helper calls plus Convex runQuery/runMutation/runAction
 * and scheduler targets. This closes the helper-indirection hole left by a
 * manual proof-anchor list.
 * @param {{entryFile: string, entrySymbol: string, maximumDeclarations?: number}} input
 */
export function scanRecurringDeclarationClosure({
	entryFile,
	entrySymbol,
	maximumDeclarations = 512
}) {
	const resolvedEntryFile = path.resolve(entryFile);
	const convexRoot = path.join(ROOT, 'convex');
	const traversalRoot = resolvedEntryFile.startsWith(`${convexRoot}${path.sep}`)
		? convexRoot
		: path.dirname(resolvedEntryFile);
	/** @type {StaticTarget[]} */
	const queue = [{ file: resolvedEntryFile, symbol: entrySymbol }];
	/** @type {Set<string>} */
	const visited = new Set();
	/** @type {string[]} */
	const errors = [];
	/** @type {Array<{file: string, symbol: string, collectCalls: number, awaitedForOf: number, paginateCalls: number, emptyEncryptedEmailWrites: number}>} */
	const hazards = [];
	while (queue.length > 0) {
		const target = queue.shift();
		if (!target) break;
		const key = `${target.file}:${target.symbol}`;
		if (visited.has(key)) continue;
		visited.add(key);
		if (visited.size > maximumDeclarations) {
			errors.push(
				`${entrySymbol} recurring call graph exceeds ${maximumDeclarations} declarations.`
			);
			break;
		}
		if (!fs.existsSync(target.file)) {
			errors.push(`Recurring call target file is missing: ${target.file}:${target.symbol}.`);
			continue;
		}
		const module = loadSourceModule(target.file);
		const declaration = module.declarations.get(target.symbol);
		if (!declaration) {
			errors.push(`Recurring call target is missing: ${target.file}:${target.symbol}.`);
			continue;
		}
		const directHazards = declarationHazards(declaration);
		if (directHazards.collectCalls || directHazards.awaitedForOf) {
			hazards.push({
				file: path.relative(ROOT, target.file).split(path.sep).join('/'),
				symbol: target.symbol,
				...directHazards
			});
		}
		/** @param {ts.Node} node */
		function visit(node) {
			if (ts.isCallExpression(node)) {
				const callee = unwrapExpression(node.expression);
				/** @type {StaticTarget|null} */
				let nested = null;
				// Generic supervisors sometimes accept a typed FunctionReference and
				// invoke it later. Queue every statically declared reference passed by
				// the reachable caller so that indirection cannot hide its target.
				for (const argument of node.arguments) {
					const unwrapped = unwrapExpression(argument);
					const looksLikeReference =
						(ts.isIdentifier(unwrapped) && /Ref$/.test(unwrapped.text)) ||
						(ts.isPropertyAccessExpression(unwrapped) &&
							unwrapped.getText(module.sourceFile).includes('internal'));
					if (!looksLikeReference) continue;
					const argumentTarget = staticFunctionTarget(argument, module);
					if (argumentTarget?.file.startsWith(traversalRoot)) {
						queue.push(argumentTarget);
					}
				}
				if (ts.isIdentifier(callee)) nested = staticFunctionTarget(callee, module);
				if (ts.isPropertyAccessExpression(callee)) {
					const method = callee.name.text;
					if (['runAction', 'runMutation', 'runQuery'].includes(method)) {
						nested = node.arguments[0] ? staticFunctionTarget(node.arguments[0], module) : null;
						const targetExpression = node.arguments[0] ? unwrapExpression(node.arguments[0]) : null;
						let typedReferenceParameter = false;
						if (targetExpression && ts.isIdentifier(targetExpression)) {
							let owner = node.parent;
							while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
							typedReferenceParameter = Boolean(
								owner?.parameters.some(
									(parameter) =>
										ts.isIdentifier(parameter.name) &&
										parameter.name.text === targetExpression.text &&
										parameter.type?.getText(module.sourceFile).includes('FunctionReference')
								)
							);
						}
						if (!nested && !typedReferenceParameter) {
							errors.push(
								`${path.relative(ROOT, module.absolute)}:${lineOf(module.sourceFile, node)} has a dynamic ${method} target in recurring work.`
							);
						}
					}
					if (['runAfter', 'runAt'].includes(method)) {
						nested = node.arguments[1] ? staticFunctionTarget(node.arguments[1], module) : null;
						if (!nested) {
							errors.push(
								`${path.relative(ROOT, module.absolute)}:${lineOf(module.sourceFile, node)} has a dynamic scheduler target in recurring work.`
							);
						}
					}
				}
				if (nested && nested.file.startsWith(traversalRoot)) queue.push(nested);
			}
			ts.forEachChild(node, visit);
		}
		visit(declaration);
	}
	return { errors, hazards, visited: [...visited].sort() };
}

/** @param {ReturnType<typeof scanConvexNativeRecurringWork>} scan @param {any} job */
function cronEntryTarget(scan, job) {
	const internalMatch = /^internal\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/.exec(job.handler);
	if (internalMatch) {
		return {
			file: path.join(ROOT, 'convex', `${internalMatch[1]}.ts`),
			symbol: internalMatch[2]
		};
	}
	const module = loadSourceModule(CRONS_PATH);
	return staticFunctionTarget(ts.factory.createIdentifier(job.handler), module);
}

/** @param {string} relative */
function safeAbsolute(relative) {
	const absolute = path.resolve(ROOT, relative);
	if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) {
		throw new Error(`Proof path escapes repository: ${relative}.`);
	}
	return absolute;
}

/**
 * @param {any} manifest
 * @param {ReturnType<typeof scanConvexNativeRecurringWork>} scan
 */
export function validateConvexNativeRecurringWork(manifest, scan) {
	const errors = [...scan.errors];
	if (manifest.protocol !== 1) errors.push('Native recurring manifest protocol must be 1.');
	if (manifest.scope !== 'commons-prod-and-preview-only') {
		errors.push('Native recurring manifest must stay explicitly Commons-only.');
	}
	if (
		!String(manifest.quotaAuthority).includes('external operator gate') ||
		!String(manifest.quotaAuthority).includes('quota isolation')
	) {
		errors.push('Shared-team numeric quota authority must remain external or isolated.');
	}
	const quotaGate = manifest.sharedTeamQuotaGate;
	const requiredAttestationFields = [
		'teamId',
		'projectInventoryWithDispositionAndMaximumRemainingDatabaseIoBytes',
		'teamUsageState',
		'billingPeriodStart',
		'billingPeriodEnd',
		'databaseIoBytesUsed',
		'databaseIoBytesLimit',
		'databaseIoBytesHeadroom',
		'observedAt',
		'expiresAt',
		'signature'
	];
	if (
		quotaGate?.teamDatabaseIoEntitlementBytes !== 1_073_741_824 ||
		quotaGate?.deploymentApiDatabaseIoGbBytes !== 1_073_741_824 ||
		JSON.stringify(quotaGate?.acceptedAuthorities) !==
			JSON.stringify(['signed-operator-attestation', 'quota-isolation']) ||
		quotaGate?.attestationCredentialLocation !== 'operator-local-only' ||
		JSON.stringify(quotaGate?.attestationRequiredFields) !==
			JSON.stringify(requiredAttestationFields) ||
		quotaGate?.maximumDashboardObservationLagMs !== 600_000 ||
		quotaGate?.requiredTeamUsageState !== 'Default' ||
		quotaGate?.containedCronRemainingAllowanceBytes !== 0 ||
		quotaGate?.ciMayHoldDashboardUserToken !== false ||
		!String(quotaGate?.headroomEquation).includes('sum(siblingMaximumRemainingDatabaseIoBytes)')
	) {
		errors.push('Shared-team attestation contract is not exact or TOCTOU-safe.');
	}
	if (
		manifest.ownership?.rule !==
			'The handler module in each inventory row is the code owner; local function-reference aliases resolve to the module named by makeFunctionReference.' ||
		manifest.ownership?.operatorPolicyOwner !== 'launch-operator'
	) {
		errors.push('Native recurring ownership authority drifted.');
	}
	if (
		JSON.stringify(manifest.launchDispositionByTier) !==
		JSON.stringify({
			essential: 'not-registered-contained',
			operational: 'not-registered-contained',
			speculative: 'not-registered-contained'
		})
	) {
		errors.push('Shared-Free tier disposition must stay fully contained.');
	}
	const expectedContainedWatchdogContract = {
		handler: 'internal.observability.superviseCoordinatedPublicDiscoveryRebuildWatchdog',
		trigger: 'coordinated-rebuild-acquisition-only',
		ownerCoordinates: [
			'coordinatedRebuildToken',
			'coordinatedRebuildAttempt',
			'coordinatedRebuildWatchdogScheduledAt'
		],
		idleCalls: 0,
		maxImmediateCalls: 2,
		maxRowsRead: 1,
		maxSuccessorsPerInvocation: 1,
		minimumOwnerLeaseMs: 1_800_000,
		canUnlockPublishOrRetry: false,
		proof: [
			'convex/lib/publicDiscovery.ts:invalidatePublicDiscoveryForCoordinatedRebuild',
			'convex/lib/publicDiscovery.ts:supervisePublicDiscoveryCoordinatedRebuildWatchdog',
			'convex/observability.ts:superviseCoordinatedPublicDiscoveryRebuildWatchdog'
		]
	};
	const expectedAbsentContainedCapabilities = [
		'periodic privacy and TTL cleanup',
		'periodic orphan and stuck-work recovery sweeps',
		'periodic revocation reconciliation and alerting',
		'daily public-discovery temporal refresh',
		'all operational and speculative producers'
	];
	if (
		manifest.profile?.prelaunch !== 'contained' ||
		manifest.profile?.expectedContainedRegisteredJobs !== 0 ||
		manifest.profile?.maximumContainedRootTicksPerBackendDay !== 0 ||
		manifest.profile?.maximumContainedDatabaseIoBytesPerTwoBackend31DayMonth !== 0 ||
		JSON.stringify(manifest.containedDisposition?.registeredCronJobs) !== '[]' ||
		JSON.stringify(manifest.containedDisposition?.preservedNativeMechanisms) !==
			JSON.stringify(['write-site-scheduled-continuations'])
	) {
		errors.push('Contained profile must register zero crons and preserve only causal work.');
	}
	if (
		JSON.stringify(manifest.containedDisposition?.writeSiteScheduledContracts) !==
		JSON.stringify({
			'public-discovery-coordinated-rebuild-watchdog': expectedContainedWatchdogContract
		})
	) {
		errors.push('Contained write-site watchdog contract drifted.');
	}
	if (
		JSON.stringify(manifest.containedDisposition?.intentionallyAbsentCapabilities) !==
		JSON.stringify(expectedAbsentContainedCapabilities)
	) {
		errors.push('Contained profile absent-capability inventory drifted.');
	}
	if (
		JSON.stringify(manifest.essentialActivationAuthority) !==
		JSON.stringify({
			acceptedAuthorities: ['quota-isolation', 'paid-no-shared-hard-disable'],
			sharedFreeHeadroomAttestationIsSufficient: false
		})
	) {
		errors.push(
			'Essential activation must require isolated or paid non-disabling quota authority.'
		);
	}

	/** @type {Map<string, any>} */
	const manifestJobs = new Map();
	for (const job of manifest.jobs ?? []) {
		if (manifestJobs.has(job.name)) errors.push(`Duplicate manifest cron name: ${job.name}.`);
		manifestJobs.set(job.name, job);
	}
	/** @type {Map<string, CronJob>} */
	const scannedJobs = new Map(scan.jobs.map((job) => [job.name, job]));
	for (const job of scan.jobs) {
		const reviewed = manifestJobs.get(job.name);
		if (!reviewed) {
			errors.push(`Missing recurring-work inventory row: ${job.name}.`);
			continue;
		}
		/** @type {Array<'tier'|'method'|'handler'>} */
		const staticFields = ['tier', 'method', 'handler'];
		for (const field of staticFields) {
			if (reviewed[field] !== job[field]) errors.push(`${job.name} ${field} drifted.`);
		}
		if (canonicalExpression(reviewed.schedule) !== canonicalExpression(job.schedule)) {
			errors.push(`${job.name} schedule drifted.`);
		}
		if (Boolean(reviewed.codeTombstoned) !== job.codeTombstoned) {
			errors.push(`${job.name} code tombstone drifted.`);
		}
	}
	for (const name of manifestJobs.keys()) {
		if (!scannedJobs.has(name)) errors.push(`Stale recurring-work inventory row: ${name}.`);
	}

	/** @type {Record<CronTier, number>} */
	const tierCounts = { essential: 0, operational: 0, speculative: 0 };
	for (const job of scan.jobs) if (job.tier) tierCounts[job.tier]++;
	const profile = manifest.profile ?? {};
	if (scan.jobs.length !== profile.expectedJobs)
		errors.push('Expected cron definition count drifted.');
	if (tierCounts.essential !== profile.expectedEssentialJobs) {
		errors.push('Expected essential cron count drifted.');
	}
	if (tierCounts.operational !== profile.expectedOperationalJobs) {
		errors.push('Expected operational cron count drifted.');
	}
	if (tierCounts.speculative !== profile.expectedSpeculativeJobs) {
		errors.push('Expected speculative cron count drifted.');
	}
	if (profile.maximumDatabaseReadBytesPerConvexFunction !== 16 * 1024 * 1024) {
		errors.push('Convex per-function database-read backstop must remain 16 MiB.');
	}

	const essentialNames = scan.jobs.filter((job) => job.tier === 'essential').map((job) => job.name);
	const contracts = manifest.essentialContracts ?? {};
	for (const name of essentialNames) {
		if (!contracts[name]) errors.push(`Missing essential recurring contract: ${name}.`);
	}
	for (const name of Object.keys(contracts)) {
		if (!essentialNames.includes(name))
			errors.push(`Stale/nonessential recurring contract: ${name}.`);
	}
	let rootTicks = 0;
	let idleCalls = 0;
	for (const name of essentialNames) {
		const job = scannedJobs.get(name);
		const contract = contracts[name];
		if (!job || !contract) continue;
		/** @type {number|null} */
		let computedTicks = null;
		try {
			computedTicks = ticksPerDay(job);
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
		if (computedTicks === null || !Number.isInteger(computedTicks) || computedTicks <= 0) {
			errors.push(`${name} does not have an integral daily launch cadence.`);
			continue;
		}
		if (contract.ticksPerDay !== computedTicks) errors.push(`${name} ticks/day drifted.`);
		for (const field of ['idleCalls', 'maxImmediateCalls', 'maxRowsRead']) {
			if (!Number.isSafeInteger(contract[field]) || contract[field] < 0) {
				errors.push(`${name} ${field} must be a non-negative exact integer.`);
			}
		}
		if (contract.idleCalls < 1 || contract.maxImmediateCalls < contract.idleCalls) {
			errors.push(`${name} immediate-call envelope is below its idle path.`);
		}
		if (contract.maxRowsRead > 4096) errors.push(`${name} row envelope exceeds 4,096.`);
		if (!contract.idleMode || !Array.isArray(contract.proof) || contract.proof.length === 0) {
			errors.push(`${name} is missing idle proof metadata.`);
		}
		for (const proof of contract.proof ?? []) {
			const colon = proof.lastIndexOf(':');
			if (colon <= 0 || colon === proof.length - 1) {
				errors.push(`${name} has invalid proof anchor: ${proof}.`);
				continue;
			}
			const relative = proof.slice(0, colon);
			const symbol = proof.slice(colon + 1);
			const absolute = safeAbsolute(relative);
			if (!fs.existsSync(absolute)) {
				errors.push(`${name} proof file is missing: ${relative}.`);
				continue;
			}
			const found = findNamedNode(absolute, symbol);
			if (!found) {
				errors.push(`${name} proof symbol is missing: ${proof}.`);
				continue;
			}
			const hazards = declarationHazards(found.node);
			if (hazards.collectCalls > 0) errors.push(`${proof} uses unbounded .collect().`);
			if (hazards.awaitedForOf > 0) errors.push(`${proof} uses unbounded for-await iteration.`);
		}
		const entryTarget = cronEntryTarget(scan, job);
		if (!entryTarget) {
			errors.push(`${name} has an unresolved recurring handler target: ${job.handler}.`);
		} else {
			const closure = scanRecurringDeclarationClosure({
				entryFile: entryTarget.file,
				entrySymbol: entryTarget.symbol
			});
			errors.push(...closure.errors.map((error) => `${name}: ${error}`));
			for (const hazard of closure.hazards) {
				if (hazard.collectCalls > 0) {
					errors.push(
						`${name} transitively reaches unbounded .collect() at ${hazard.file}:${hazard.symbol}.`
					);
				}
				if (hazard.awaitedForOf > 0) {
					errors.push(
						`${name} transitively reaches unbounded for-await iteration at ${hazard.file}:${hazard.symbol}.`
					);
				}
			}
		}
		rootTicks += computedTicks;
		idleCalls += computedTicks * contract.idleCalls;
	}
	if (rootTicks !== profile.maximumEssentialRootTicksPerBackendDay) {
		errors.push('Essential root-tick daily envelope drifted.');
	}
	if (idleCalls !== profile.maximumEssentialIdleFunctionCallsPerBackendDay) {
		errors.push('Essential idle function-call daily envelope drifted.');
	}
	if (idleCalls * 2 * 31 !== profile.maximumEssentialIdleFunctionCallsPerTwoBackend31DayMonth) {
		errors.push('Two-backend 31-day idle function-call envelope drifted.');
	}

	validateFoundationalContracts(manifest, scan, errors);
	return errors;
}

/** @param {any} manifest @param {ReturnType<typeof scanConvexNativeRecurringWork>} scan @param {string[]} errors */
function validateFoundationalContracts(manifest, scan, errors) {
	const byName = new Map(scan.jobs.map((job) => [job.name, job]));
	if (byName.get('drain-contact-authority-fanout')?.schedule !== '{ minutes: 15 }') {
		errors.push('Contact-authority recovery cadence must remain 15 minutes.');
	}
	if (byName.get('sweep-stuck-processing')?.schedule !== '{ minutes: 5 }') {
		errors.push('Stuck-processing recovery cadence must remain 5 minutes.');
	}
	if (!/RAW_CRON_PROFILE\s*\?\?\s*['"]contained['"]/.test(scan.source)) {
		errors.push('Unset CRON_PROFILE must floor to contained.');
	}
	if (
		!/contained:\s*new Set<CronTier>\(\)/.test(scan.source) ||
		!/:\s*['"]contained['"]\s*;/.test(scan.source)
	) {
		errors.push('Unknown/contained profiles must resolve to an empty tier set.');
	}
	if (!/const\s+ANALYTICS_SNAPSHOT_CRON_READY\s*=\s*false\s*;/.test(scan.source)) {
		errors.push('Analytics native recurring work must stay statically tombstoned.');
	}

	const boundary = findNamedNode(safeAbsolute('convex/observability.ts'), 'getBoundaryCellRate24h');
	if (!boundary) errors.push('Boundary monitor bounded query proof is missing.');
	else {
		const hazards = declarationHazards(boundary.node);
		if (
			hazards.paginateCalls !== 1 ||
			!boundary.text.includes('maximumRowsRead: BOUNDARY_CELL_MONITOR_PAGE_ROWS + 1') ||
			!boundary.text.includes('maximumBytesRead: BOUNDARY_CELL_MONITOR_PAGE_BYTES') ||
			!boundary.text.includes("page.pageStatus === 'SplitRequired'") ||
			!boundary.text.includes('capacityExceeded = !page.isDone')
		) {
			errors.push('Boundary monitor must remain one bounded exact-or-saturated indexed page.');
		}
	}
	const boundaryRecord = findNamedNode(
		safeAbsolute('convex/observability.ts'),
		'recordBoundaryCellRateResult'
	);
	if (
		!boundaryRecord ||
		!boundaryRecord.text.includes(
			"status: args.capacityExceeded ? ('capacity_exceeded' as const)"
		) ||
		!boundaryRecord.text.includes('args.asOf - args.cutoff !== TWENTY_FOUR_HOURS_MS') ||
		!boundaryRecord.text.includes('(args.rate !== undefined) !== rateRequired') ||
		!boundaryRecord.text.includes('existing.asOf >= args.asOf') ||
		!boundaryRecord.text.includes("status: 'stale_ignored' as const")
	) {
		errors.push(
			'Boundary monitor must persist one monotonic exact-24h exact-or-capacity-exceeded result.'
		);
	}

	const supporterSweep = findNamedNode(
		safeAbsolute('convex/supporters.ts'),
		'sweepStrandedPlaceholders'
	);
	const donationSweep = findNamedNode(
		safeAbsolute('convex/donations.ts'),
		'sweepStrandedDonations'
	);
	const supporterPage = findNamedNode(
		safeAbsolute('convex/supporters.ts'),
		'getStrandedPlaceholderSupporters'
	);
	const donationPage = findNamedNode(
		safeAbsolute('convex/donations.ts'),
		'getStrandedDonationPlaceholders'
	);
	/** @type {Array<['supporter'|'donation', NamedNode|null, NamedNode|null]>} */
	const oneShotSweeps = [
		['supporter', supporterSweep, supporterPage],
		['donation', donationSweep, donationPage]
	];
	for (const [label, sweep, page] of oneShotSweeps) {
		if (!sweep || !page) {
			errors.push(`One-shot ${label} placeholder proof is missing.`);
			continue;
		}
		const activationAt = sweep.text.indexOf('strandedPlaceholderSweepActivation');
		const pageAt = sweep.text.indexOf(
			label === 'supporter' ? 'getStrandedPlaceholderSupporters' : 'getStrandedDonationPlaceholders'
		);
		const sweepHazards = declarationHazards(sweep.node);
		const pageHazards = declarationHazards(page.node);
		if (
			activationAt < 0 ||
			pageAt < 0 ||
			activationAt >= pageAt ||
			!sweep.text.includes('if (!activation.active)') ||
			sweep.text.includes('while (') ||
			pageHazards.paginateCalls !== 1 ||
			!page.text.includes('maximumRowsRead: scanRows + 1') ||
			!page.text.includes('maximumBytesRead: 512 * 1024') ||
			!page.text.includes("pageStatus === 'SplitRequired'") ||
			sweepHazards.collectCalls > 0 ||
			sweepHazards.awaitedForOf > 0
		) {
			errors.push(`One-shot ${label} placeholder sweep is no longer O(1)-idle/one-page-active.`);
		}
	}
	const activation = findNamedNode(
		safeAbsolute('convex/supporters.ts'),
		'activateStrandedPlaceholderSweeps'
	);
	const saveCheckpoint = findNamedNode(safeAbsolute('convex/supporters.ts'), 'saveSweepCheckpoint');
	const checkpointCas = findNamedNode(
		safeAbsolute('convex/lib/strandedPlaceholderSweep.ts'),
		'matchesStrandedPlaceholderSweepCas'
	);
	if (
		!activation ||
		!activation.text.includes(
			'existing?.completedVersion === STRANDED_PLACEHOLDER_SWEEP_VERSION'
		) ||
		!saveCheckpoint ||
		!saveCheckpoint.text.includes('matchesStrandedPlaceholderSweepCas(current') ||
		!checkpointCas ||
		!checkpointCas.text.includes('current.activeRunToken === expected.runToken') ||
		!checkpointCas.text.includes('current.cursorRevision === expected.expectedRevision') ||
		!checkpointCas.text.includes('current.cursor === expected.expectedCursor') ||
		!saveCheckpoint.text.includes("status: 'stale' as const") ||
		!saveCheckpoint.text.includes('activeVersion: undefined') ||
		!saveCheckpoint.text.includes('activeRunToken: undefined') ||
		!saveCheckpoint.text.includes('completedVersion: STRANDED_PLACEHOLDER_SWEEP_VERSION') ||
		!saveCheckpoint.text.includes('completedAt: Date.now()')
	) {
		errors.push('One-shot migration cannot prove activate/resume/complete/no-reopen semantics.');
	}
	const runtimeWriterFiles = manifest.oneShotMigrationPolicy?.runtimePlaceholderWriterFiles;
	if (
		JSON.stringify(runtimeWriterFiles) !==
			JSON.stringify(['convex/supporters.ts', 'convex/donations.ts']) ||
		!String(manifest.oneShotMigrationPolicy?.operatorBootstrapException).includes(
			'completed version 1 cannot be reopened'
		)
	) {
		errors.push('One-shot placeholder-writer policy drifted.');
	} else {
		for (const relative of runtimeWriterFiles) {
			const absolute = safeAbsolute(relative);
			const source = fs.readFileSync(absolute, 'utf8');
			const sourceFile = ts.createSourceFile(
				absolute,
				source,
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TS
			);
			if (declarationHazards(sourceFile).emptyEncryptedEmailWrites > 0) {
				errors.push(`${relative} reintroduced an empty encryptedEmail runtime writer.`);
			}
		}
	}

	const cronAttempt = findNamedNode(
		safeAbsolute('convex/templates.ts'),
		'rebuildHomepageSnapshotsForCron'
	);
	const cronState = findNamedNode(
		safeAbsolute('convex/templates.ts'),
		'publicDiscoveryCronAttemptState'
	);
	const temporal = findNamedNode(
		safeAbsolute('convex/templates.ts'),
		'nextPublicTemplateTemporalRebuildAt'
	);
	if (!cronAttempt || !cronState || !temporal) {
		errors.push('Homepage compact dirty/readiness/temporal proof is missing.');
	} else {
		const stateAt = cronAttempt.text.indexOf('publicDiscoveryCronAttemptStateRef');
		const rebuildAt = cronAttempt.text.indexOf('rebuildHomepageSnapshotsForCronAttemptRef');
		if (
			stateAt < 0 ||
			rebuildAt < 0 ||
			stateAt >= rebuildAt ||
			!cronAttempt.text.includes("status: 'clean' as const") ||
			!cronAttempt.text.includes('attemptState.temporalScheduleVersion !== 1') ||
			!cronAttempt.text.includes('attemptState.nextTemporalRebuildAt <= Date.now()') ||
			!cronState.text.includes("query('publicDiscoveryManifest')") ||
			!cronState.text.includes('listDirtyAt') ||
			!cronState.text.includes('relationsFailureCode') ||
			!temporal.text.includes('template._creationTime + 7 * DAILY_ARRIVAL_BUCKET_MS') ||
			!temporal.text.includes('Math.floor(newUntil) + 1') ||
			!temporal.text.includes('arrivals.some')
		) {
			errors.push('Homepage cron no longer proves clean O(1) idle plus exact clock invalidation.');
		}
	}
}

export function main() {
	const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
	const scan = scanConvexNativeRecurringWork();
	const errors = validateConvexNativeRecurringWork(manifest, scan);
	if (errors.length) {
		throw new Error(`Convex native recurring-work ratchet failed:\n- ${errors.join('\n- ')}`);
	}
	const activeOperational = scan.jobs.filter(
		(job) => job.tier === 'operational' && !job.codeTombstoned
	).length;
	console.log(
		`Convex native recurring-work ratchet passed: ${scan.jobs.length} definitions; ` +
			`${manifest.profile.expectedContainedRegisteredJobs} contained/prelaunch, ` +
			`${manifest.profile.expectedEssentialJobs} essential when quota-authorized, ` +
			`${manifest.profile.expectedEssentialJobs + activeOperational} operational-profile registered, ` +
			`${manifest.profile.maximumEssentialRootTicksPerBackendDay} root ticks/backend/day, ` +
			`${manifest.profile.maximumEssentialIdleFunctionCallsPerTwoBackend31DayMonth} idle calls/two-backend 31-day month.`
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
