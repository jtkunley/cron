import { createExecutionTracker } from './createExecutionTracker';
import { createFailureReporter } from './createFailureReporter';
import { createSafeLogger } from './createSafeLogger';
import { resolveOptions } from './resolveOptions';
import { runExecution } from './runExecution';
import { scheduleTicks } from './scheduleTicks';
import type { CronController, CronOptions } from './types';

/**
 * Creates a scheduled job, stopped. Throws synchronously for invalid options or a schedule
 * `node-cron` can't parse.
 */
export function createCron(options: CronOptions): CronController {
    const {
        name,
        schedule,
        run,
        logger,
        onError,
        allowOverlap,
        waitForCompletionOnStop,
        runInContext,
    } = resolveOptions(options);
    const log = createSafeLogger(logger);
    const reportFailure = createFailureReporter(name, log, onError);
    const executions = createExecutionTracker();
    let stopScheduling: (() => void) | undefined;

    // Starts the execution and returns at once, so node-cron, which awaits its handler, never
    // sees a run in progress: its own overlap checks, error logging and busy state never come
    // into play, and this package alone decides which ticks run and how failures are reported.
    const onTick = (): void => {
        // Counts every unfinished run, including ones from before a stop, so a run left over from
        // before a restart still blocks new ones.
        if (!allowOverlap && executions.isActive()) {
            log.warn(`Cron "${name}" skipped: previous run still in progress`, { name });
            return;
        }
        executions.track(() => runExecution(run, runInContext, reportFailure));
    };

    return {
        start() {
            if (stopScheduling) return;
            stopScheduling = scheduleTicks(schedule, name, onTick);
            log.info(`Cron "${name}" started`, { name, schedule });
        },

        stop() {
            if (!stopScheduling) return Promise.resolve();
            stopScheduling();
            stopScheduling = undefined;
            // Means scheduling has stopped; runs in progress carry on and are never cancelled.
            log.info(`Cron "${name}" stopped`, { name });
            if (!waitForCompletionOnStop) return Promise.resolve();
            return executions.settled();
        },

        isStarted: () => stopScheduling !== undefined,

        isActive: () => executions.isActive(),
    };
}
