import { env as privateEnv } from '$env/dynamic/private';

type WorkflowEmailRuntimeEnv = {
	AWS_ACCESS_KEY_ID?: string;
	AWS_SECRET_ACCESS_KEY?: string;
	WORKFLOW_FROM_EMAIL?: string;
	SES_FROM_EMAIL?: string;
	RECEIPT_FROM_EMAIL?: string;
};

export type WorkflowEmailRuntimeReadiness = {
	ready: boolean;
	missing: string[];
	dependency: string;
	perRunDependencies: string[];
	message: string;
};

export const WORKFLOW_EMAIL_RUNTIME_DEPENDENCY =
	'AWS SES credentials + configured workflow/from email + org key verifier';

export const WORKFLOW_EMAIL_PER_RUN_DEPENDENCIES = [
	'supporter cursor',
	'subscribed supporter',
	'org key decrypt',
	'per-recipient email decrypt'
] as const;

export function getWorkflowEmailRuntimeReadiness(
	env: WorkflowEmailRuntimeEnv,
	options: { orgKeyConfigured?: boolean | null } = {}
): WorkflowEmailRuntimeReadiness {
	const missing: string[] = [];
	if (!env.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID');
	if (!env.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY');
	if (!env.WORKFLOW_FROM_EMAIL && !env.SES_FROM_EMAIL && !env.RECEIPT_FROM_EMAIL) {
		missing.push('WORKFLOW_FROM_EMAIL or SES_FROM_EMAIL or RECEIPT_FROM_EMAIL');
	}
	if (options.orgKeyConfigured === false) missing.push('org key verifier');

	const ready = missing.length === 0;
	return {
		ready,
		missing,
		dependency: WORKFLOW_EMAIL_RUNTIME_DEPENDENCY,
		perRunDependencies: [...WORKFLOW_EMAIL_PER_RUN_DEPENDENCIES],
		message: ready
			? 'Workflow email arm-time runtime is ready.'
			: `Workflow email is dependency-bound. Preserved the workflow definition; configure ${missing.join(
					', '
				)} before arming email steps.`
	};
}

export function getWorkflowEmailRuntimeReadinessFromEnv(
	options: { orgKeyConfigured?: boolean | null } = {}
): WorkflowEmailRuntimeReadiness {
	return getWorkflowEmailRuntimeReadiness(
		{
			AWS_ACCESS_KEY_ID: privateEnv.AWS_ACCESS_KEY_ID,
			AWS_SECRET_ACCESS_KEY: privateEnv.AWS_SECRET_ACCESS_KEY,
			WORKFLOW_FROM_EMAIL: privateEnv.WORKFLOW_FROM_EMAIL,
			SES_FROM_EMAIL: privateEnv.SES_FROM_EMAIL,
			RECEIPT_FROM_EMAIL: privateEnv.RECEIPT_FROM_EMAIL
		},
		options
	);
}
