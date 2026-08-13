/**
 * Truncation Recovery Utilities
 *
 * Graceful handling of LLM output truncation using a three-tier strategy:
 * 1. Partial JSON recovery (0 extra API calls)
 * 2. Continuation prompting (1 targeted call)
 * 3. Full retry (last resort)
 *
 * Philosophy: Treat truncation as a pause, not a failure.
 * Don't throw away work—preserve partial results.
 */

import { z } from 'zod';
import { disableErrorLogging, parse as parsePartialJson } from 'best-effort-json-parser';

// The dependency's default logger includes the raw malformed input and parsed
// fragments. Provider output can contain credentials or private user content,
// so recovery must never let that diagnostic escape to application logs.
disableErrorLogging();

export interface TruncationRecoveryResult<T> {
	/** The recovered data (may be partial) */
	data: Partial<T>;
	/** Whether the response was truncated */
	wasTruncated: boolean;
	/** Fields that are missing or incomplete */
	missingFields: string[];
	/** Whether we have enough data to proceed */
	isUsable: boolean;
	/** Raw text for continuation prompting if needed */
	lastChars: string;
}

/**
 * Attempt to recover data from a potentially truncated JSON response
 *
 * Uses best-effort parsing to extract whatever valid data exists,
 * then checks if critical fields are present.
 *
 * @param text - Raw response text (may be truncated JSON)
 * @param criticalFields - Fields that must be present for result to be usable
 * @param schema - Optional Zod schema for validation
 * @returns Recovery result with extracted data and metadata
 */
export function recoverTruncatedJson<T extends Record<string, unknown>>(
	text: string,
	criticalFields: (keyof T)[],
	schema?: z.ZodType<T>
): TruncationRecoveryResult<T> {
	// First, try standard parse with validation
	try {
		const parsed = JSON.parse(text);

		// Validate with Zod if schema provided
		if (schema) {
			const result = schema.safeParse(parsed);
			if (!result.success) {
				console.error('[truncation-recovery] Structured validation failed:', {
					issueCount: result.error.issues.length
				});
				// Fall through to recovery logic
			} else {
				return {
					data: result.data,
					wasTruncated: false,
					missingFields: [],
					isUsable: true,
					lastChars: ''
				};
			}
		} else {
			// No schema, accept as-is
			return {
				data: parsed as T,
				wasTruncated: false,
				missingFields: [],
				isUsable: true,
				lastChars: ''
			};
		}
	} catch {
		// Standard parse failed, try recovery
	}

	// Attempt best-effort partial JSON parsing
	let data: Partial<T> = {};
	try {
		data = parsePartialJson(text) as Partial<T>;
	} catch {
		// Even partial parsing failed - response is likely severely malformed
		return {
			data: {},
			wasTruncated: true,
			missingFields: criticalFields as string[],
			isUsable: false,
			lastChars: text.slice(-100)
		};
	}

	// Check which critical fields are missing
	const missingFields = criticalFields.filter((field) => {
		const value = data[field];
		if (value === undefined || value === null) return true;
		if (typeof value === 'string' && value.trim() === '') return true;
		return false;
	});

	return {
		data,
		wasTruncated: true,
		missingFields: missingFields as string[],
		isUsable: missingFields.length === 0,
		lastChars: text.slice(-100)
	};
}

/**
 * Build a continuation prompt for completing truncated JSON
 *
 * Designed to be parsimonious - only asks for the missing portion,
 * providing context from the truncation point.
 *
 * @param originalPrompt - The original user prompt
 * @param lastChars - Last characters of the truncated response
 * @param missingFields - Fields that need to be completed
 * @returns Continuation prompt
 */
export function buildContinuationPrompt(
	originalPrompt: string,
	lastChars: string,
	missingFields: string[]
): string {
	return `Your previous JSON response was truncated. Here's what was cut off:

...${lastChars}

Complete ONLY the remaining JSON from that exact point. The missing fields are: ${missingFields.join(', ')}.

Do not restart. Do not repeat what was already generated. Continue from exactly where you left off to close the JSON properly.`;
}

/**
 * Merge a continuation response into the original partial data
 *
 * @param original - Partial data from truncated response
 * @param continuation - Data from continuation response
 * @returns Merged data
 */
export function mergeContinuation<T extends Record<string, unknown>>(
	original: Partial<T>,
	continuation: Partial<T>
): Partial<T> {
	// Continuation data takes precedence for missing fields
	return {
		...original,
		...Object.fromEntries(
			Object.entries(continuation).filter(
				([key, value]) =>
					value !== undefined &&
					value !== null &&
					(original[key] === undefined || original[key] === null)
			)
		)
	} as Partial<T>;
}

/**
 * Subject-line specific critical fields
 *
 * These are the fields that MUST be present for a usable response.
 * If these are all present, we can proceed even with partial data.
 */
export const SUBJECT_LINE_CRITICAL_FIELDS = ['needs_clarification', 'inferred_context'] as const;

/**
 * Subject-line generation-mode critical fields
 *
 * When needs_clarification=false, these fields must also be present.
 */
export const SUBJECT_LINE_GENERATION_FIELDS = [
	'subject_line',
	'core_message',
	'topics',
	'url_slug'
] as const;
