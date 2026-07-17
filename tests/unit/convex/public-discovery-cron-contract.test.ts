import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'convex/crons.ts'), 'utf8');

describe('public discovery cron contract', () => {
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
});
