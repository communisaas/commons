/**
 * Isolate-wide single-flight coordination that no request can be stranded by.
 *
 * A module-level promise map outlives the request that filled it. On the
 * Workers runtime, cancelling a request (client disconnect, caller timeout)
 * drops that request's pending I/O: the promise it placed in the map never
 * settles, its cleanup never evicts the entry, and every later request in the
 * isolate that joins the key awaits it forever. Steady traffic keeps the
 * isolate warm, so one cancelled owner can stall a surface for hours. Timers
 * the owner armed (`AbortSignal.timeout`, `setTimeout`) die with it, so no
 * bound on the owner's side can rescue a joiner.
 *
 * Three rules close that:
 *  - Every flight declares a maximum duration. The owner's result is raced
 *    against it, so a live owner always settles by its deadline.
 *  - A joiner arms its own timer for the flight's remaining duration. A flight
 *    still unsettled past its deadline has lost its owner: the joiner evicts it
 *    and fails with a typed error rather than waiting on it, and a flight found
 *    already past its deadline is replaced instead of joined.
 *  - When the caller supplies `waitUntil`, the owner's work is registered with
 *    it, so an owner whose client disconnects does not take the work down.
 */

/** Slack for a live owner whose result lands on its own deadline. */
const SHARED_FLIGHT_DEADLINE_GRACE_MS = 100;

export class SharedFlightTimeoutError extends Error {
	readonly label: string;

	constructor(label: string) {
		super(`SHARED_FLIGHT_TIMEOUT:${label}`);
		this.name = 'SharedFlightTimeoutError';
		this.label = label;
	}
}

export type SharedFlightOptions = {
	/** Stable name carried by timeout errors. */
	label: string;
	/** Longest a live owner may take; also every joiner's wait bound. */
	maxDurationMs: number;
	/** Oldest entries are forgotten (not cancelled) past this many keys. */
	maxEntries: number;
};

export type SharedFlightStart<M> = {
	/**
	 * Time this flight spends waiting on another before its own work, added to
	 * its maximum duration. Pass that flight's `remainingMs` so a chain of waits
	 * never compounds into a deadline the owner cannot meet.
	 */
	precededByMs?: number;
	meta?: M;
	waitUntil?: (promise: Promise<unknown>) => void;
};

/** The platform's `waitUntil`, bound to its execution context, when one exists. */
export function platformWaitUntil(
	platform: { context?: { waitUntil?(promise: Promise<unknown>): void } } | undefined
): ((promise: Promise<unknown>) => void) | undefined {
	const context = platform?.context;
	const waitUntil = context?.waitUntil;
	if (!context || typeof waitUntil !== 'function') return undefined;
	return (promise) => waitUntil.call(context, promise);
}

type Entry<T, M> = {
	deadlineAt: number;
	meta: M | undefined;
	promise: Promise<T>;
};

function raceDeadline<T>(promise: Promise<T>, waitMs: number, label: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	return Promise.race([
		promise,
		new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => reject(new SharedFlightTimeoutError(label)), Math.max(0, waitMs));
		})
	]).finally(() => {
		if (timeout !== undefined) clearTimeout(timeout);
	});
}

export class SharedFlights<T, M = undefined> {
	readonly #entries = new Map<string, Entry<T, M>>();
	readonly #options: SharedFlightOptions;

	constructor(options: SharedFlightOptions) {
		if (
			!Number.isSafeInteger(options.maxDurationMs) ||
			options.maxDurationMs <= 0 ||
			!Number.isSafeInteger(options.maxEntries) ||
			options.maxEntries <= 0
		) {
			throw new Error(`SHARED_FLIGHT_OPTIONS_INVALID:${options.label}`);
		}
		this.#options = options;
	}

	get size(): number {
		return this.#entries.size;
	}

	has(key: string): boolean {
		return this.#live(key) !== undefined;
	}

	/**
	 * Join the live flight for `key`, bounded by that flight's own deadline.
	 * Returns undefined when there is none, or when `accepts` rejects its meta.
	 */
	join(key: string, accepts?: (meta: M | undefined) => boolean): Promise<T> | undefined {
		const entry = this.#live(key);
		if (!entry || (accepts && !accepts(entry.meta))) return undefined;
		return this.#bounded(key, entry);
	}

	/** Time left before the live flight for `key` reaches its deadline. */
	remainingMs(key: string): number | undefined {
		const entry = this.#live(key);
		return entry ? Math.max(0, entry.deadlineAt - Date.now()) : undefined;
	}

	/** Start a flight owned by the caller, replacing any entry for `key`. */
	start(key: string, work: () => Promise<T>, init?: SharedFlightStart<M>): Promise<T> {
		const precededByMs = init?.precededByMs ?? 0;
		if (!Number.isSafeInteger(precededByMs) || precededByMs < 0) {
			throw new Error(`SHARED_FLIGHT_OPTIONS_INVALID:${this.#options.label}`);
		}
		const maxDurationMs = this.#options.maxDurationMs + precededByMs;
		const deadlineAt = Date.now() + maxDurationMs;
		// Defer by one microtask so the entry is visible before work begins.
		const task = Promise.resolve().then(work);
		init?.waitUntil?.(task.catch(() => undefined));
		const entry: Entry<T, M> = {
			deadlineAt,
			meta: init?.meta,
			promise: raceDeadline(task, maxDurationMs, this.#options.label).finally(() => {
				if (this.#entries.get(key) === entry) this.#entries.delete(key);
			})
		};
		this.#entries.delete(key);
		this.#entries.set(key, entry);
		while (this.#entries.size > this.#options.maxEntries) {
			const oldest = this.#entries.keys().next();
			if (oldest.done) break;
			this.#entries.delete(oldest.value);
		}
		return entry.promise;
	}

	/** Join the live flight for `key`, or start one. */
	run(
		key: string,
		work: () => Promise<T>,
		init?: SharedFlightStart<M> & { accepts?: (meta: M | undefined) => boolean }
	): Promise<T> {
		return this.join(key, init?.accepts) ?? this.start(key, work, init);
	}

	/**
	 * Remove the flight for `key` so no later caller joins it, returning a
	 * handle that still settles by the flight's deadline.
	 */
	detach(key: string): Promise<T> | undefined {
		const entry = this.#live(key);
		if (!entry) return undefined;
		this.#entries.delete(key);
		return raceDeadline(
			entry.promise,
			entry.deadlineAt + SHARED_FLIGHT_DEADLINE_GRACE_MS - Date.now(),
			this.#options.label
		);
	}

	clear(): void {
		this.#entries.clear();
	}

	#live(key: string): Entry<T, M> | undefined {
		const entry = this.#entries.get(key);
		if (!entry) return undefined;
		if (Date.now() >= entry.deadlineAt + SHARED_FLIGHT_DEADLINE_GRACE_MS) {
			this.#entries.delete(key);
			return undefined;
		}
		return entry;
	}

	#bounded(key: string, entry: Entry<T, M>): Promise<T> {
		return raceDeadline(
			entry.promise,
			entry.deadlineAt + SHARED_FLIGHT_DEADLINE_GRACE_MS - Date.now(),
			this.#options.label
		).catch((error: unknown) => {
			if (error instanceof SharedFlightTimeoutError && this.#entries.get(key) === entry) {
				this.#entries.delete(key);
			}
			throw error;
		});
	}
}
