import { createTask } from "node-cron";

export interface CronLogger {
  info(message: string, data: Record<string, unknown>): void;
  warn(message: string, data: Record<string, unknown>): void;
  error(message: string, error: Error, data: Record<string, unknown>): void;
}

export interface CronOptions {
  name: string;
  schedule: string;
  run: () => Promise<void>;
  logger?: CronLogger | undefined;
  onError?: ((error: unknown) => void) | undefined;
  allowOverlap?: boolean | undefined;
  waitForCompletionOnStop?: boolean | undefined;
  runInContext?: ((tick: () => Promise<void>) => Promise<void>) | undefined;
}

export interface CronController {
  start(): void;
  stop(): Promise<void>;
  isStarted(): boolean;
  isActive(): boolean;
}

export function createCron(options: CronOptions): CronController {
  if (options === null || typeof options !== "object") {
    throw new TypeError("createCron: options must be an object");
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

  if (typeof name !== "string") {
    throw new TypeError("createCron: name must be a string");
  }
  if (typeof schedule !== "string") {
    throw new TypeError("createCron: schedule must be a string");
  }
  if (typeof run !== "function") {
    throw new TypeError("createCron: run must be a function");
  }
  if (onError !== undefined && typeof onError !== "function") {
    throw new TypeError("createCron: onError must be a function");
  }
  if (runInContext !== undefined && typeof runInContext !== "function") {
    throw new TypeError("createCron: runInContext must be a function");
  }

  let started = false;
  let activeCount = 0;
  const active = new Set<Promise<void>>();

  const logInfo = (message: string, data: Record<string, unknown>): void => {
    if (!logger) return;
    try {
      logger.info(message, data);
    } catch {
      // Logger failures must never affect scheduling or execution.
    }
  };

  const logWarn = (message: string, data: Record<string, unknown>): void => {
    if (!logger) return;
    try {
      logger.warn(message, data);
    } catch {
      // Logger failures must never affect scheduling or execution.
    }
  };

  const logError = (message: string, failure: unknown): void => {
    if (!logger) return;
    try {
      logger.error(message, toError(failure), { name });
    } catch {
      // Logger failures must never affect scheduling or execution.
    }
  };

  const reportFailure = (failure: unknown): void => {
    logError(`Cron "${name}" run failed`, failure);
    if (!onError) return;
    try {
      onError(failure);
    } catch (hookFailure) {
      logError(`Cron "${name}" onError hook failed`, hookFailure);
    }
  };

  const runWork = async (): Promise<void> => {
    try {
      await run();
    } catch (failure) {
      reportFailure(failure);
    }
  };

  const execute = async (): Promise<void> => {
    if (!runInContext) {
      await runWork();
      return;
    }
    let tickPromise: Promise<void> | undefined;
    const tick = (): Promise<void> => {
      tickPromise ??= runWork();
      return tickPromise;
    };
    try {
      await runInContext(tick);
    } catch (failure) {
      reportFailure(failure);
    }
    // Keeps the execution active even if the wrapper settles before the work does.
    await tickPromise;
  };

  const onTick = (): void => {
    try {
      if (!started) return;
      if (!allowOverlap && activeCount > 0) {
        logWarn(`Cron "${name}" skipped: previous run still in progress`, { name });
        return;
      }
      activeCount++;
      const execution: Promise<void> = execute().finally(() => {
        activeCount--;
        active.delete(execution);
      });
      active.add(execution);
    } catch {
      // Never let a tick failure escape into node-cron.
    }
  };

  // Throws synchronously for schedules node-cron cannot parse. Created tasks stay stopped until start().
  const task = createTask(schedule, onTick, { name });

  return {
    start(): void {
      if (started) return;
      started = true;
      task.start();
      logInfo(`Cron "${name}" started`, { name, schedule });
    },

    stop(): Promise<void> {
      if (!started) return Promise.resolve();
      started = false;
      task.stop();
      logInfo(`Cron "${name}" stopped`, { name });
      if (!waitForCompletionOnStop || active.size === 0) return Promise.resolve();
      return Promise.all([...active]).then(() => undefined);
    },

    isStarted(): boolean {
      return started;
    },

    isActive(): boolean {
      return activeCount > 0;
    },
  };
}

const isError: (value: unknown) => value is Error =
  (Error as { isError?: (value: unknown) => value is Error }).isError ??
  ((value: unknown): value is Error => value instanceof Error);

function toError(value: unknown): Error {
  if (isError(value)) return value;
  let message: string;
  try {
    message = String(value);
  } catch {
    message = "Non-Error failure value (string conversion failed)";
  }
  return new Error(message, { cause: value });
}
