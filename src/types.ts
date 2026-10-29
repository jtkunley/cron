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
