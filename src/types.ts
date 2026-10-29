/** The logger methods used; a `@jtkunley/logger` child logger fits as it is. */
export interface CronLogger {
    info(message: string, data: Record<string, unknown>): void;
    warn(message: string, data: Record<string, unknown>): void;
    error(message: string, error: Error, data: Record<string, unknown>): void;
}

export interface CronOptions {
    /** Names the `node-cron` task and appears in every log line. */
    name: string;
    /**
     * A cron expression `node-cron` accepts, with an optional leading seconds
     * field. An invalid one makes `createCron` throw.
     */
    schedule: string;
    /** The work for each tick. A throw or rejection fails that tick only. */
    run: () => Promise<void>;

    /** Logs start, stop, skipped ticks and failures. Nothing is logged without it. */
    logger?: CronLogger;

    /**
     * Called with whatever a tick threw, after it is logged. A hook that throws
     * is logged too, and never escapes as an unhandled rejection.
     */
    onError?: (error: unknown) => void;

    /**
     * Default false: a tick is skipped while the previous run is still in
     * progress, including a run left over from before a restart.
     */
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
    /** Starts scheduling. Does nothing while already started. */
    start(): void;
    /**
     * Stops scheduling, then, unless `waitForCompletionOnStop` is false, waits
     * for runs in progress. Does nothing when not started.
     */
    stop(): Promise<void>;
    /** Whether the job is scheduling ticks. */
    isStarted(): boolean;
    /** Whether a run is in progress. */
    isActive(): boolean;
}
