import { parse } from 'node-cron';
import type { CronLogger, CronOptions, CronTick } from './types';

export interface ResolvedOptions {
    readonly name: string;
    readonly schedule: string;
    readonly run: () => Promise<void>;
    readonly logger: CronLogger | undefined;
    readonly onError: ((error: unknown) => void) | undefined;
    readonly allowOverlap: boolean;
    readonly waitForCompletionOnStop: boolean;
    readonly runInContext: ((tick: CronTick) => Promise<void>) | undefined;
}

/**
 * Validates the options and copies them, with defaults applied. The job reads only the copy,
 * so changing the caller's object afterwards can't reconfigure it.
 */
export function resolveOptions(options: CronOptions): ResolvedOptions {
    if (options === null || typeof options !== 'object') {
        throw new TypeError('createCron: options must be an object');
    }
    const {
        name,
        schedule,
        run,
        logger,
        onError,
        allowOverlap = false,
        waitForCompletionOnStop = true,
        runInContext,
    } = options;

    if (typeof name !== 'string') throw new TypeError('createCron: name must be a string');
    if (typeof schedule !== 'string') throw new TypeError('createCron: schedule must be a string');
    if (typeof run !== 'function') throw new TypeError('createCron: run must be a function');
    if (onError !== undefined && typeof onError !== 'function') {
        throw new TypeError('createCron: onError must be a function');
    }
    if (runInContext !== undefined && typeof runInContext !== 'function') {
        throw new TypeError('createCron: runInContext must be a function');
    }
    // Strictly booleans: a string such as 'false' from an environment variable would be truthy.
    if (typeof allowOverlap !== 'boolean') {
        throw new TypeError('createCron: allowOverlap must be a boolean');
    }
    if (typeof waitForCompletionOnStop !== 'boolean') {
        throw new TypeError('createCron: waitForCompletionOnStop must be a boolean');
    }
    // The same check node-cron runs when creating a task, done now so that a bad schedule fails
    // at startup rather than at the first `start()`. Throws node-cron's error.
    parse(schedule);

    return Object.freeze({
        name,
        schedule,
        run,
        logger,
        onError,
        allowOverlap,
        waitForCompletionOnStop,
        runInContext,
    });
}
