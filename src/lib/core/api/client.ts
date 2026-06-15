/**
 * Unified API Client for Commons
 *
 * Consolidated API client combining the best features from both implementations:
 * - Comprehensive error handling with typed errors
 * - Automatic retries with exponential backoff
 * - Request timeout support
 * - Toast notifications (optional)
 * - Loading state callbacks
 * - Standardized response format
 */

import { browser } from '$app/environment';
import { toast } from '$lib/stores/toast.svelte';
import type { ApiError } from '$lib/types/errors';
import type { UnknownRecord as _UnknownRecord } from '$lib/types/any-replacements';
import { formatErrorMessage } from '$lib/utils/error-formatting';

export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	errors?: ApiError[];
	status?: number;
}

// Type guard for error response data
interface ErrorResponseData {
	error?: string;
	message?: string;
	errors?: ApiError[];
}

// Type guard function
function _isErrorResponseData(data: unknown): data is ErrorResponseData {
	return typeof data === 'object' && data !== null;
}

// Type guard for success response data
function _isSuccessResponseData(data: unknown): data is { success: boolean } {
	return (
		typeof data === 'object' &&
		data !== null &&
		'success' in data &&
		typeof (data as { success: unknown }).success === 'boolean'
	);
}

export interface ApiOptions extends Omit<RequestInit, 'body'> {
	timeout?: number;
	retries?: number;
	retryDelay?: number;
	showToast?: boolean;
	skipErrorLogging?: boolean;
	onLoadingChange?: (loading: boolean) => void;
	body?: unknown;
}

export class ApiClientError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly response?: Response,
		public readonly errors?: ApiError[]
	) {
		super(message);
		this.name = 'ApiClientError';
	}
}

class UnifiedApiClient {
	private baseURL = '';
	private defaultTimeout = 10000; // 10 seconds
	private defaultRetries = 2;
	private defaultRetryDelay = 1000; // 1 second

	constructor(baseURL: string = '') {
		this.baseURL = baseURL;
	}

	/**
	 * Make an API request with automatic error handling and retries
	 */
	async request<T = unknown>(endpoint: string, options: ApiOptions = {}): Promise<ApiResponse<T>> {
		const {
			timeout = this.defaultTimeout,
			retries = this.defaultRetries,
			retryDelay = this.defaultRetryDelay,
			showToast = true,
			skipErrorLogging = false,
			onLoadingChange,
			...fetchOptions
		} = options;

		// Ensure proper path joining
		const normalizedBase = this.baseURL.endsWith('/') ? this.baseURL.slice(0, -1) : this.baseURL;
		const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
		const url = `${normalizedBase}${normalizedEndpoint}`;

		// Set default headers
		const headers = new Headers(fetchOptions.headers);
		if (!headers.has('Content-Type') && fetchOptions.body) {
			headers.set('Content-Type', 'application/json');
		}

		// Prepare fetch options
		const config: RequestInit = {
			...fetchOptions,
			headers,
			body: fetchOptions.body
				? typeof fetchOptions.body === 'string' ||
					fetchOptions.body instanceof FormData ||
					fetchOptions.body instanceof URLSearchParams ||
					fetchOptions.body instanceof Blob ||
					fetchOptions.body instanceof ArrayBuffer
					? (fetchOptions.body as BodyInit)
					: JSON.stringify(fetchOptions.body)
				: undefined
		};

		// Start loading
		onLoadingChange?.(true);

		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= retries; attempt++) {
			const controller = new AbortController();
			const timeoutId = setTimeout(
				() => controller.abort('Request timed out'),
				timeout
			);

			try {
				const response = await fetch(url, {
					...config,
					signal: controller.signal
				});

				clearTimeout(timeoutId);

				// Handle response
				const result = await this.handleResponse<T>(response);

				// Show success toast if enabled
				if (
					showToast &&
					result.success &&
					fetchOptions.method &&
					['POST', 'PUT', 'DELETE'].includes(fetchOptions.method)
				) {
					toast.success('Operation completed successfully');
				}

				onLoadingChange?.(false);
				return result;
			} catch (error) {
				clearTimeout(timeoutId);
				lastError = error instanceof Error ? error : new Error(String(error));

				// Client errors (4xx) are not transient — fail fast WITHOUT retrying
				// and surface the structured error (code via `errors[]`) to the
				// caller. Retrying a 403 quota response is wasteful and would
				// otherwise swallow the typed code (e.g. AUTHORING_QUOTA_EXCEEDED)
				// the at-cap upgrade UX keys on. 429 still retries (rate-limit
				// backoff is the intended behavior there).
				if (
					error instanceof ApiClientError &&
					typeof error.status === 'number' &&
					error.status >= 400 &&
					error.status < 500 &&
					error.status !== 429
				) {
					onLoadingChange?.(false);
					if (showToast) toast.error(error.message);
					return {
						success: false,
						error: error.message,
						errors: error.errors,
						status: error.status
					};
				}

				// Don't retry on abort errors — for mutating requests the server
				// may have already processed it (template publish, etc.)
				if (error instanceof Error && error.name === 'AbortError') {
					lastError = new Error(
						'This is taking longer than expected. Your changes may have been saved — please refresh to check.'
					);
					lastError.name = 'TimeoutError';
					break;
				}

				// Wait before retrying (exponential backoff)
				if (attempt < retries) {
					await this.sleep(retryDelay * Math.pow(2, attempt));
				}
			}
		}

		// All retries failed
		onLoadingChange?.(false);

		const errorMessage = formatErrorMessage(lastError, 'Request failed');

		if (!skipErrorLogging && browser) {
			console.error(`API Error: ${errorMessage}`, { url, error: lastError });
		}

		if (showToast) {
			toast.error(errorMessage);
		}

		return {
			success: false,
			error: errorMessage,
			status: 0
		};
	}

	/**
	 * Handle API response and extract data
	 */
	private async handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
		let data: unknown;

		try {
			const contentType = response.headers.get('content-type');
			if (contentType?.includes('application/json')) {
				data = await response.json();
			} else {
				data = await response.text();
			}
		} catch (error) {
			// Response might be empty
			data = null;
		}

		// Type guard for objects with properties
		const isErrorResponse = (
			obj: unknown
		): obj is { error?: string; message?: string; errors?: ApiError[] } => {
			return typeof obj === 'object' && obj !== null;
		};

		if (!response.ok) {
			const errorData = isErrorResponse(data) ? data : {};
			const rawError = errorData.error || errorData.message || `HTTP ${response.status}`;
			const _error = formatErrorMessage(rawError, `HTTP ${response.status} - Request failed`);
			const errors = errorData.errors;

			throw new ApiClientError(_error, response.status, response, errors);
		}

		// Type guard for standard API response format
		const isStandardResponse = (obj: unknown): obj is ApiResponse<T> => {
			return typeof obj === 'object' && obj !== null && 'success' in obj;
		};

		// Check if response has standard format
		if (isStandardResponse(data)) {
			return data;
		}

		// Wrap non-standard responses
		return {
			success: true,
			data: data as T,
			status: response.status
		};
	}

	/**
	 * Convenience methods
	 */
	async get<T = unknown>(
		endpoint: string,
		options?: Omit<ApiOptions, 'method'>
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { ...options, method: 'GET' });
	}

	async post<T = unknown>(
		endpoint: string,
		body?: string | object | FormData | URLSearchParams | null,
		options?: Omit<ApiOptions, 'method' | 'body'>
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { ...options, method: 'POST', body });
	}

	async put<T = unknown>(
		endpoint: string,
		body?: string | object | FormData | URLSearchParams | null,
		options?: Omit<ApiOptions, 'method' | 'body'>
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { ...options, method: 'PUT', body });
	}

	async patch<T = unknown>(
		endpoint: string,
		body?: string | object | FormData | URLSearchParams | null,
		options?: Omit<ApiOptions, 'method' | 'body'>
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
	}

	async delete<T = unknown>(
		endpoint: string,
		options?: Omit<ApiOptions, 'method'>
	): Promise<ApiResponse<T>> {
		return this.request<T>(endpoint, { ...options, method: 'DELETE' });
	}

	/**
	 * Stream SSE events from an endpoint
	 *
	 * @param endpoint - API endpoint path
	 * @param body - Request body (for POST)
	 * @param onEvent - Callback for each SSE event
	 * @returns Promise that resolves when stream ends
	 *
	 * @example
	 * ```typescript
	 * await api.stream('/agents/stream-subject', { message: 'My issue...' }, (event) => {
	 *   if (event.type === 'thought') console.log('Thinking:', event.data);
	 *   if (event.type === 'complete') console.log('Done:', event.data);
	 * });
	 * ```
	 */
	async stream<T = unknown>(
		endpoint: string,
		body: object,
		onEvent: (event: { type: string; data: T }) => void
	): Promise<void> {
		const normalizedBase = this.baseURL.endsWith('/') ? this.baseURL.slice(0, -1) : this.baseURL;
		const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
		const url = `${normalizedBase}${normalizedEndpoint}`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			const message = errorData.error || errorData.message || `HTTP ${response.status}`;
			throw new ApiClientError(message, response.status, response);
		}

		const reader = response.body?.getReader();
		if (!reader) {
			throw new ApiClientError('No response body');
		}

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Parse SSE events from buffer
				const lines = buffer.split('\n');
				buffer = lines.pop() || ''; // Keep incomplete line in buffer

				let currentEventType = '';
				for (const line of lines) {
					if (line.startsWith('event: ')) {
						currentEventType = line.slice(7).trim();
					} else if (line.startsWith('data: ')) {
						const dataStr = line.slice(6);
						try {
							const parsed = JSON.parse(dataStr);
							// Basic validation - ensure we have a valid event structure
							const eventData = { type: currentEventType, data: parsed as T };
							onEvent(eventData);
						} catch (error) {
							console.warn('[api-client] Failed to parse SSE data:', error);
							// Skip invalid JSON
						}
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Utility: Sleep for specified milliseconds
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// Export singleton instance
export const api = new UnifiedApiClient('/api');

// Export class for custom instances
export { UnifiedApiClient as ApiClient };
