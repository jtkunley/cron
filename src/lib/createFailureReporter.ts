import type { SafeLogger } from './createSafeLogger';

/**
 * Returns the one place a failed run is reported: logged first, then handed to `onError`
 * with its original value. The reporter never throws.
 */
export function createFailureReporter(
    name: string,
    log: SafeLogger,
    onError: ((error: unknown) => void) | undefined,
): (failure: unknown) => void {
    return (failure) => {
        log.error(`Cron "${name}" run failed`, failure, { name });
        if (!onError) return;
        try {
            // The hook is synchronous by contract; a returned promise is deliberately ignored.
            onError(failure);
        } catch (hookFailure) {
            // Logged only: passing it back to `onError` could recurse forever.
            log.error(`Cron "${name}" onError hook failed`, hookFailure, { name });
        }
    };
}
