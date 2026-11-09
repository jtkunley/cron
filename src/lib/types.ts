export type LogData = Record<string, unknown>;

/** A child logger from `@jtkunley/logger` fits as it is; adapt loggers that take the data first, such as pino. */
export interface CronLogger {
    info(message: string, data: LogData): void;
    warn(message: string, data: LogData): void;
    error(message: string, error: Error, data: LogData): void;
}

/** The work for one execution, as handed to `runInContext`. Never rejects; failures are reported inside it. */
export type CronTick = () => Promise<void>;

export interface CronOptions {
    /** Identifies the job in every log line. */
    name: string;
    /** A `node-cron` expression: five fields, or six with leading seconds. Uses the process's timezone. */
    schedule: string;
    /** The work, called with no arguments on every accepted tick. */
    run: () => Promise<void>;
    /** Without one, the package logs nothing. */
    logger?: CronLogger;
    /** Called synchronously with the original failure value of a run. Its return value is ignored. */
    onError?: (error: unknown) => void;
    /** Let a tick start while an earlier run is unfinished. Defaults to `false`: such ticks are skipped. */
    allowOverlap?: boolean;
    /** Whether `stop()` waits for runs already in progress. Defaults to `true`. */
    waitForCompletionOnStop?: boolean;
    /**
     * Wraps every accepted execution, to give each its own context such as an `AsyncLocalStorage` store.
     * Must call `tick` exactly once and return a promise covering it and any work of its own.
     */
    runInContext?: (tick: CronTick) => Promise<void>;
}

export interface CronController {
    /** Enables scheduled runs. Does not run the work now. */
    start(): void;
    /**
     * Disables scheduled runs before returning. Resolves once the runs in progress have finished,
     * or at once with `waitForCompletionOnStop: false`. Never rejects. Inside `run`, don't await it:
     * the run would be waiting for itself.
     */
    stop(): Promise<void>;
    /** Whether scheduling is enabled. */
    isStarted(): boolean;
    /** Whether at least one run is unfinished, which may be true after `stop()`. */
    isActive(): boolean;
}
