import { createTask } from 'node-cron';

/** The logger methods used; a `@jtkunley/logger` child logger fits as it is. */
export interface CronLogger {
    info(message: string, data: Record<string, unknown>): void;
    warn(message: string, data: Record<string, unknown>): void;
    error(message: string, error: Error, data: Record<string, unknown>): void;
}

export interface CronOptions {
    name: string;
    schedule: string;
    run: () => Promise<void>;

    logger?: CronLogger;

    onError?: (error: unknown) => void;

    /** Default false: a tick is skipped while the previous run is still in progress. */
    allowOverlap?: boolean;
    /** Default true: `stop()` waits for in-flight runs to finish. */
    waitForCompletionOnStop?: boolean;

    /**
     * Wraps each tick, so it can run inside a fresh context, such as
     * `(tick) => storage.run(values(), tick)`. The failure log is written inside
     * it too, so a logger that injects context values sees the tick's. A wrapper
     * that throws fails the tick without running it.
     */
    runInContext?: (tick: () => Promise<void>) => Promise<void>;
}

export interface CronController {
    start(): void;
    stop(): Promise<void>;
    isStarted(): boolean;
    isActive(): boolean;
}

function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value), { cause: value });
}

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
