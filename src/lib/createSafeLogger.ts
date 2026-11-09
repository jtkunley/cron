import { toError } from './toError';
import type { CronLogger, LogData } from './types';

/** The package's view of the caller's logger: every call is optional and none can throw. */
export interface SafeLogger {
    info(message: string, data: LogData): void;
    warn(message: string, data: LogData): void;
    /** Takes any failure value; it reaches the logger as an `Error`. */
    error(message: string, failure: unknown, data: LogData): void;
}

const silent: SafeLogger = { info() {}, warn() {}, error() {} };

/**
 * Wraps the caller's logger so that logging can never break the job: a throwing logger
 * must not escape `start()` or `stop()`, skip the work, lose the failure for `onError`,
 * or leave a run counted as active.
 */
export function createSafeLogger(logger: CronLogger | undefined): SafeLogger {
    // Without a logger the package makes no logging calls at all, not even to the console.
    if (!logger) return silent;
    return {
        info: (message, data) => ignoreFailure(() => logger.info(message, data)),
        warn: (message, data) => ignoreFailure(() => logger.warn(message, data)),
        error: (message, failure, data) =>
            ignoreFailure(() => logger.error(message, toError(failure), data)),
    };
}

function ignoreFailure(log: () => unknown): void {
    try {
        const result = log();
        // TypeScript accepts an async method where a void one is expected; its rejection would
        // otherwise be unhandled, which crashes the process by default.
        if (isThenable(result)) result.then(undefined, () => {});
    } catch {
        // Ignored: see createSafeLogger.
    }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}
