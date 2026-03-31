// Svelte 5 Templates Store - migrated from Svelte 4 store patterns
import type { Template } from '$lib/types/template';
import { formatErrorMessage } from '$lib/utils/error-formatting';
import { api, type ApiResponse } from '$lib/core/api';

// Templates API wrapper (domain-specific response unwrapping)
const templatesApi = {
	async list<T = unknown>(): Promise<ApiResponse<T>> {
		return api.get('/templates');
	},

	async create<T = unknown>(template: Record<string, unknown>): Promise<ApiResponse<T>> {
		const res = await api.post('/templates', template, { showToast: false });
		if (
			res.success &&
			res.data &&
			typeof res.data === 'object' &&
			res.data !== null &&
			'template' in res.data
		) {
			const templateData = (res.data as { template: T }).template;
			return { success: true, data: templateData, status: res.status };
		}
		return res as ApiResponse<T>;
	},

	async update<T = unknown>(
		id: string,
		template: Record<string, unknown>
	): Promise<ApiResponse<T>> {
		const res = await api.put(`/templates/${id}`, template);
		if (
			res.success &&
			res.data &&
			typeof res.data === 'object' &&
			res.data !== null &&
			'template' in res.data
		) {
			const templateData = (res.data as { template: T }).template;
			return { success: true, data: templateData, status: res.status };
		}
		return res as ApiResponse<T>;
	},

	async delete<T = unknown>(id: string): Promise<ApiResponse<T>> {
		return api.delete(`/templates/${id}`);
	}
};

// Type guard for Template with enhanced debugging
function isTemplate(obj: unknown): obj is Template {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}

	const template = obj as Template;
	const validations = [
		// Required string fields
		{ field: 'id', valid: typeof template.id === 'string', actual: typeof template.id },
		{ field: 'slug', valid: typeof template.slug === 'string', actual: typeof template.slug },
		{ field: 'title', valid: typeof template.title === 'string', actual: typeof template.title },
		{
			field: 'description',
			valid: typeof template.description === 'string',
			actual: typeof template.description
		},
		{
			field: 'category',
			valid: typeof template.category === 'string',
			actual: typeof template.category
		},
		{ field: 'type', valid: typeof template.type === 'string', actual: typeof template.type },
		{
			field: 'message_body',
			valid: typeof template.message_body === 'string',
			actual: typeof template.message_body
		},
		{
			field: 'preview',
			valid: typeof template.preview === 'string',
			actual: typeof template.preview
		},
		{ field: 'status', valid: typeof template.status === 'string', actual: typeof template.status },
		// Required boolean fields
		{
			field: 'is_public',
			valid: typeof template.is_public === 'boolean',
			actual: typeof template.is_public
		},
		{
			field: 'isNew',
			valid: typeof template.isNew === 'boolean',
			actual: typeof template.isNew
		},
		// Required number fields
		{
			field: 'send_count',
			valid: typeof template.send_count === 'number',
			actual: typeof template.send_count
		},
		{
			field: 'coordinationScale',
			valid: typeof template.coordinationScale === 'number',
			actual: typeof template.coordinationScale
		},
		// Required enum field
		{
			field: 'deliveryMethod',
			valid: typeof template.deliveryMethod === 'string' && template.deliveryMethod.length > 0,
			actual: template.deliveryMethod
		},
		// Optional array fields (Phase 2+: migrating to TemplateJurisdiction)
		{
			field: 'applicable_countries',
			valid:
				template.applicable_countries === null ||
				template.applicable_countries === undefined ||
				Array.isArray(template.applicable_countries),
			actual: Array.isArray(template.applicable_countries)
				? 'array'
				: typeof template.applicable_countries
		},
		{
			field: 'specific_locations',
			valid:
				template.specific_locations === null ||
				template.specific_locations === undefined ||
				Array.isArray(template.specific_locations),
			actual: Array.isArray(template.specific_locations)
				? 'array'
				: typeof template.specific_locations
		},
		{
			field: 'delivery_config',
			valid: typeof template.delivery_config !== 'undefined',
			actual: typeof template.delivery_config
		},
		{
			field: 'recipient_config',
			valid: typeof template.recipient_config !== 'undefined',
			actual: typeof template.recipient_config
		},
		// Optional/nullable fields validation
		{
			field: 'subject',
			valid:
				template.title === undefined ||
				template.title === null ||
				typeof template.title === 'string',
			actual: typeof template.title
		},
		{
			field: 'cwc_config',
			valid:
				template.cwc_config === undefined ||
				template.cwc_config === null ||
				typeof template.cwc_config === 'object',
			actual: typeof template.cwc_config
		},
		{
			field: 'campaign_id',
			valid:
				template.campaign_id === undefined ||
				template.campaign_id === null ||
				typeof template.campaign_id === 'string',
			actual: typeof template.campaign_id
		},
		{
			field: 'jurisdiction_level',
			valid:
				template.jurisdiction_level === undefined ||
				template.jurisdiction_level === null ||
				typeof template.jurisdiction_level === 'string',
			actual: typeof template.jurisdiction_level
		}
	];

	const failures = validations.filter((v) => !v.valid);

	if (failures.length > 0) {
		return false;
	}

	return true;
}

// Type guard for Template array
function isTemplateArray(obj: unknown): obj is Template[] {
	return Array.isArray(obj) && obj.every(isTemplate);
}

interface TemplateState {
	templates: Template[];
	selectedId: string | null;
	loading: boolean;
	error: string | null;
	lastUpdated?: Date;
	initialized: boolean;
}

function createTemplateStore() {
	// Convert writable store to $state rune
	const state = $state<TemplateState>({
		templates: [],
		selectedId: null,
		loading: false,
		error: null,
		initialized: false
	});

	return {
		// Getters - replace subscribe pattern
		get templates() {
			return state.templates;
		},
		get selectedId() {
			return state.selectedId;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		get lastUpdated() {
			return state.lastUpdated;
		},
		get initialized() {
			return state.initialized;
		},

		// Core template management
		selectTemplate(id: string): void {
			state.selectedId = id;
		},

		selectTemplateBySlug(slug: string): void {
			const template = state.templates.find((t) => t.slug === slug);
			if (template) {
				state.selectedId = template.id;
			}
		},

		// Auto-select first template when templates change
		autoSelectFirst(): void {
			if (state.templates.length > 0 && !state.selectedId) {
				state.selectedId = state.templates[0].id;
			}
		},

		/**
		 * Hydrate store from SSR page data (no network fetch needed).
		 * Accepts a wider type than Template[] because SSR responses exclude
		 * expensive columns (updatedAt) and use raw DB shapes for scope/scopes.
		 */
		hydrateFromSSR(templates: Record<string, unknown>[]): void {
			if (state.initialized && state.templates.length > 0) return; // Already hydrated
			state.templates = templates as unknown as Template[];
			state.loading = false;
			state.error = null;
			state.lastUpdated = new Date();
			state.initialized = true;
			if (!state.selectedId && templates.length > 0) {
				state.selectedId = (templates[0] as { id: string }).id;
			}
		},

		// API Integration with progressive enhancement
		async fetchTemplates(): Promise<void> {
			state.loading = true;
			state.error = null;

			try {
				const result = await templatesApi.list<Template[]>();

				if (!result.success) {
					console.error('Template fetch failed:', result.error);
					throw new Error(result.error || 'Failed to fetch templates');
				}

				const data = result.data;

				// Type guard validation
				if (!isTemplateArray(data)) {
					throw new Error('Invalid template data received from API');
				}

				// Update state directly with $state
				state.templates = data;
				state.loading = false;
				state.error = null;
				state.lastUpdated = new Date();
				state.initialized = true;

				// Auto-select first template if none selected or selected template no longer exists
				if (!state.selectedId || !data.find((t) => t.id === state.selectedId)) {
					state.selectedId = data[0]?.id || null;
				}
			} catch (error) {
				const errorMessage = formatErrorMessage(error, 'Failed to fetch templates');
				console.error('Template fetch failed:', errorMessage);
				state.loading = false;
				state.error = errorMessage;
			}
		},

		// Template CRUD operations
		async addTemplate(template: Omit<Template, 'id'>): Promise<Template> {
			try {
				const result = await templatesApi.create(template);

				if (!result.success) {
					throw new Error(result.error || 'Failed to create template');
				}

				const newTemplate = result.data as Template;

				// Type guard validation
				if (!isTemplate(newTemplate)) {
					throw new Error('Invalid template data received from API');
				}

				// Update state directly
				state.templates = [...state.templates, newTemplate];
				state.selectedId = newTemplate.id; // Auto-select newly created template
				state.error = null;

				return newTemplate;
			} catch (error) {
				// Preserve the original error message for user feedback
				const message = error instanceof Error ? error.message : 'Template could not be added.';
				state.error = message;
				throw error instanceof Error ? error : new Error(message);
			}
		},

		async updateTemplate(id: string, updates: Partial<Template>): Promise<Template> {
			try {
				const result = await templatesApi.update(id, updates);

				if (!result.success) {
					throw new Error(result.error || 'Failed to update template');
				}

				const updatedTemplate = result.data as Template;

				// Type guard validation
				if (!isTemplate(updatedTemplate)) {
					throw new Error('Invalid template data received from API');
				}

				// Update state directly
				state.templates = state.templates.map((t) => (t.id === id ? updatedTemplate : t));
				state.error = null;

				return updatedTemplate;
			} catch (error) {
				state.error = 'Failed to update template';
				throw new Error('Failed to update template');
			}
		},

		async deleteTemplate(id: string): Promise<void> {
			try {
				const result = await templatesApi.delete(id);

				if (!result.success) {
					throw new Error(result.error || 'Failed to delete template');
				}

				// Update state directly
				const newTemplates = state.templates.filter((t) => t.id !== id);
				const newSelectedId =
					state.selectedId === id ? newTemplates[0]?.id || null : state.selectedId;

				state.templates = newTemplates;
				state.selectedId = newSelectedId;
				state.error = null;
			} catch (error) {
				state.error = 'Failed to delete template';
				throw new Error('Failed to delete template');
			}
		},

		// Development helpers
		reset(): void {
			state.templates = [];
			state.selectedId = null;
			state.loading = false;
			state.error = null;
			state.initialized = false;
		}
	};
}

export const templateStore = createTemplateStore();
