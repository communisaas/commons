import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { CONTACT_FANOUT_RECOVERY_INTERVAL_MINUTES } from '../../../convex/lib/contactAuthority';
import ts from 'typescript';

const source = readFileSync(resolve(process.cwd(), 'convex/crons.ts'), 'utf8');

describe('public discovery cron contract', () => {
	it('parses cleanly and registers the homepage rebuild under essential only', () => {
		const transpiled = ts.transpileModule(source, {
			fileName: 'convex/crons.ts',
			reportDiagnostics: true,
			compilerOptions: {
				module: ts.ModuleKind.ESNext,
				target: ts.ScriptTarget.Latest
			}
		});
		expect(transpiled.diagnostics ?? []).toEqual([]);

		const sourceFile = ts.createSourceFile(
			'convex/crons.ts',
			source,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS
		);

		let registration: ts.CallExpression | undefined;
		const visit = (node: ts.Node): void => {
			if (
				ts.isCallExpression(node) &&
				node.arguments.some(
					(argument) =>
						ts.isStringLiteral(argument) &&
						argument.text === 'public-homepage-snapshot-rebuild'
				)
			) {
				registration = node;
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
		expect(registration).toBeDefined();

		const enclosingConditions: string[] = [];
		for (let node: ts.Node | undefined = registration?.parent; node; node = node.parent) {
			if (ts.isIfStatement(node)) {
				enclosingConditions.push(node.expression.getText(sourceFile));
			}
		}
		expect(enclosingConditions).toEqual(["enabled('essential')"]);
	});

	it('supervises coordinated rebuild leases on the essential profile', () => {
		const cleanupStart = source.indexOf('cleanup-rate-limit-buckets');
		const legislationStart = source.indexOf('legislation-sync', cleanupStart);
		const essentialSection = source.slice(cleanupStart, legislationStart);

		expect(cleanupStart).toBeGreaterThanOrEqual(0);
		expect(legislationStart).toBeGreaterThan(cleanupStart);
		expect(essentialSection).toContain('supervise-public-discovery-rebuild-lease');
		expect(essentialSection).toContain('{ minutes: 15 }');
		expect(essentialSection).toContain(
			'internal.observability.superviseCoordinatedPublicDiscoveryRebuildLease'
		);
	});

	it('runs one daily atomic homepage refresh after tag maintenance', () => {
		expect(source.match(/internal\.templates\.rebuildHomepageSnapshotsForCron/g)).toHaveLength(1);
		expect(source).not.toContain('internal.templates.rebuildPublicTemplateSnapshotsForCron');
		expect(source).not.toContain('internal.templates.rebuildRelationSnapshotForCron');

		const registrationStart = source.indexOf('public-homepage-snapshot-rebuild');
		const registration = source.slice(
			registrationStart,
			registrationStart + 300
		);
		expect(registration).toContain('{ hourUTC: 4, minuteUTC: 17 }');
		expect(registration).toContain('internal.templates.rebuildHomepageSnapshotsForCron');
	});

	it('keeps billing reservations, grace expiry, and contact authority on the essential profile', () => {
		const cleanupStart = source.indexOf('cleanup-rate-limit-buckets');
		const legislationStart = source.indexOf('legislation-sync', cleanupStart);
		const essentialSection = source.slice(cleanupStart, legislationStart);

		expect(essentialSection).toContain('subscription-past-due-grace-sweep');
		expect(essentialSection).toContain("{ minuteUTC: 49 }");
		expect(essentialSection).toContain('plan-usage-stale-sweep');
		expect(essentialSection).toContain('plan-usage-reservation-lease-sweep');
		expect(essentialSection).toContain("{ minutes: 15 }");
		expect(essentialSection).toContain('drain-contact-authority-fanout');
		expect(essentialSection).toContain('resume-contact-authority-migration');
		for (const job of ['drain-contact-authority-fanout', 'resume-contact-authority-migration']) {
			const start = essentialSection.indexOf(job);
			expect(start, job).toBeGreaterThanOrEqual(0);
			// The cadence is now a shared constant, because the overdue alarm in
			// contactFanoutReadiness is derived from it. Assert the reference here
			// and the VALUE where it is defined — inlining 15 again would let the
			// alarm and its only responder drift apart, which is how they ended up
			// 3x mismatched.
			expect(essentialSection.slice(start, start + 220), `${job} recovery cadence`).toContain(
				'{ minutes: CONTACT_FANOUT_RECOVERY_INTERVAL_MINUTES }'
			);
		}
		expect(essentialSection).not.toContain('{ minutes: 1 }');
		expect(CONTACT_FANOUT_RECOVERY_INTERVAL_MINUTES).toBe(15);
	});
});
