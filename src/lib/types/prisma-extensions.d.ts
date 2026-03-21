import type {
	template_campaign as TemplateCampaign
} from '@prisma/client';

declare module '@prisma/client' {
	interface template {
		template_campaign?: TemplateCampaign[];
	}

	interface user {
		coordinates?: unknown;
		preferences?: unknown;
	}
}

// Export empty object to make this a module
export {};
