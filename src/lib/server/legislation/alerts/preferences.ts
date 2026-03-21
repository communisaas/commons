/**
 * Alert Preferences: org-configurable thresholds for alert fatigue mitigation.
 *
 * Since Organization has no JSON settings column and we cannot modify the schema,
 * preferences are stored in a well-known OrgIssueDomain row with reserved label
 * "__alert_preferences__". The description column holds the JSON payload.
 */

import { db } from '$lib/core/db';

const PREFS_LABEL = '__alert_preferences__';

export interface AlertPreferences {
	minRelevanceScore: number;
	digestOnly: boolean;
	autoArchiveDays: number;
}

export const ALERT_PREF_DEFAULTS: AlertPreferences = {
	minRelevanceScore: 0.6,
	digestOnly: false,
	autoArchiveDays: 30
};

export async function getAlertPreferences(orgId: string): Promise<AlertPreferences> {
	const row = await db.orgIssueDomain.findUnique({
		where: { orgId_label: { orgId, label: PREFS_LABEL } },
		select: { description: true }
	});

	if (!row?.description) return { ...ALERT_PREF_DEFAULTS };

	try {
		const parsed = JSON.parse(row.description);
		return {
			minRelevanceScore:
				typeof parsed.minRelevanceScore === 'number'
					? Math.min(1.0, Math.max(0.5, parsed.minRelevanceScore))
					: ALERT_PREF_DEFAULTS.minRelevanceScore,
			digestOnly:
				typeof parsed.digestOnly === 'boolean'
					? parsed.digestOnly
					: ALERT_PREF_DEFAULTS.digestOnly,
			autoArchiveDays:
				typeof parsed.autoArchiveDays === 'number'
					? Math.max(1, Math.round(parsed.autoArchiveDays))
					: ALERT_PREF_DEFAULTS.autoArchiveDays
		};
	} catch {
		return { ...ALERT_PREF_DEFAULTS };
	}
}

export async function saveAlertPreferences(
	orgId: string,
	prefs: AlertPreferences
): Promise<void> {
	const serialized = JSON.stringify(prefs);

	await db.orgIssueDomain.upsert({
		where: { orgId_label: { orgId, label: PREFS_LABEL } },
		create: {
			orgId,
			label: PREFS_LABEL,
			description: serialized,
			weight: 0
		},
		update: {
			description: serialized
		}
	});
}
