import { createTask } from 'node-cron';
import { toError } from './to-error';
import type { CronController, CronOptions } from './types';

/**
 * Creates a scheduled job on a `node-cron` task, which stays stopped until
 * `start()`. Throws if `schedule` is not a valid cron expression.
 */
export function createCron(options: CronOptions): CronController {
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

    let started = false;
    let singleRunInProgress = false;
    const pendingRuns = new Set<Promise<void>>();

    const task = createTask(
        schedule,
        () => {
            void executeTick();
        },
        { name },
    );

    function report(error: unknown): void {
        logger?.error(`Cron "${name}" run failed`, toError(error), { name });
        try {
            onError?.(error);
        } catch (hookError) {
            logger?.error(`Cron "${name}" onError hook failed`, toError(hookError), { name });
        }
    }

    async function attempt(): Promise<void> {
        try {
            await run();
        } catch (error) {
            report(error);
        }
    }

    function track(runPromise: Promise<void>): void {
        pendingRuns.add(runPromise);
        void runPromise.finally(() => {
            pendingRuns.delete(runPromise);
        });
    }

    async function executeTick(): Promise<void> {
        if (!started) {
            return;
        }
        if (!allowOverlap && singleRunInProgress) {
            logger?.warn(`Cron "${name}" skipped: previous run still in progress`, {
                name,
            });
            return;
        }

        if (!allowOverlap) {
            singleRunInProgress = true;
        }

        const runPromise = (async () => {
            try {
                await (runInContext ? runInContext(attempt) : attempt());
            } catch (error) {
                report(error);
            } finally {
                if (!allowOverlap) {
                    singleRunInProgress = false;
                }
            }
        })();

        track(runPromise);
        await runPromise;
    }

    return {
        start(): void {
            if (started) {
                return;
            }
            started = true;
            void task.start();
            logger?.info(`Cron "${name}" started`, { name, schedule });
        },

        async stop(): Promise<void> {
            if (!started) {
                return;
            }
            started = false;
            const taskStopped = task.stop();
            logger?.info(`Cron "${name}" stopped`, { name });
            await taskStopped;

            if (waitForCompletionOnStop && pendingRuns.size > 0) {
                await Promise.allSettled(pendingRuns);
            }
        },

        isStarted(): boolean {
            return started;
        },

        isActive(): boolean {
            return pendingRuns.size > 0;
        },
    };
}
