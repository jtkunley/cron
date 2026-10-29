import { createTask } from 'node-cron';
import { toError } from './to-error';
import type { CronController, CronOptions } from './types';

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
    let stopRequested = false;
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

    async function executeTick(): Promise<void> {
        if (stopRequested) {
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

        pendingRuns.add(runPromise);
        void runPromise.finally(() => {
            pendingRuns.delete(runPromise);
        });

        if (!allowOverlap) {
            await runPromise;
        }
    }

    return {
        start(): void {
            if (started) {
                return;
            }
            stopRequested = false;
            void task.start();
            started = true;
            logger?.info(`Cron "${name}" started`, { name, schedule });
        },

        async stop(): Promise<void> {
            if (!started) {
                return;
            }
            stopRequested = true;
            await task.stop();
            started = false;
            logger?.info(`Cron "${name}" stopped`, { name });

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
