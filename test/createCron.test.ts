import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCron, type CronController, type CronLogger, type CronOptions } from "../src/index.js";

const EVERY_SECOND = "* * * * * *";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockLogger() {
  return {
    info: vi.fn<CronLogger["info"]>(),
    warn: vi.fn<CronLogger["warn"]>(),
    error: vi.fn<CronLogger["error"]>(),
  };
}

const tick = (count = 1) => vi.advanceTimersByTimeAsync(1000 * count);
const flush = () => vi.advanceTimersByTimeAsync(0);

const jobs: CronController[] = [];
function make(options: Partial<CronOptions> & Pick<CronOptions, "run">): CronController {
  const job = createCron({ name: "job", schedule: EVERY_SECOND, ...options });
  jobs.push(job);
  return job;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 0, 1, 0, 0, 0, 0) });
});

afterEach(async () => {
  for (const job of jobs.splice(0)) void job.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("creation", () => {
  it("creates a stopped, inactive job without invoking the work", async () => {
    const run = vi.fn(async () => {});
    const job = make({ run });
    expect(job.isStarted()).toBe(false);
    expect(job.isActive()).toBe(false);
    await tick(3);
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts five-field and six-field expressions", () => {
    expect(() => make({ schedule: "*/5 * * * *", run: async () => {} })).not.toThrow();
    expect(() => make({ schedule: "*/10 * * * * *", run: async () => {} })).not.toThrow();
  });

  it("rejects invalid schedules synchronously", () => {
    expect(() => createCron({ name: "bad", schedule: "not a cron", run: async () => {} })).toThrow();
    expect(() => createCron({ name: "bad", schedule: "99 * * * *", run: async () => {} })).toThrow();
  });

  it("rejects missing required options", () => {
    expect(() => createCron({ name: "x", schedule: EVERY_SECOND } as unknown as CronOptions)).toThrow(TypeError);
    expect(() => createCron({ schedule: EVERY_SECOND, run: async () => {} } as unknown as CronOptions)).toThrow(
      TypeError,
    );
  });

  it("fixes configuration at creation", async () => {
    const run = vi.fn(async () => {});
    const replacement = vi.fn(async () => {});
    const logger = mockLogger();
    const options: CronOptions = { name: "original", schedule: EVERY_SECOND, run, logger };
    const job = createCron(options);
    jobs.push(job);
    options.name = "changed";
    options.schedule = "0 0 1 1 *";
    options.run = replacement;
    options.logger = undefined;
    options.allowOverlap = true;

    job.start();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('Cron "original" started', { name: "original", schedule: EVERY_SECOND });
  });

  it("keeps state independent between jobs", async () => {
    const a = deferred();
    const runA = vi.fn(() => a.promise);
    const runB = vi.fn(async () => {});
    const jobA = make({ name: "a", run: runA });
    const jobB = make({ name: "b", run: runB });
    jobA.start();
    jobB.start();
    await tick(2);
    expect(runA).toHaveBeenCalledTimes(1);
    expect(runB).toHaveBeenCalledTimes(2);
    expect(jobA.isActive()).toBe(true);
    expect(jobB.isActive()).toBe(false);
    a.resolve();
  });
});

describe("start", () => {
  it("enables scheduled executions without invoking the work directly", async () => {
    const run = vi.fn(async () => {});
    const job = make({ run });
    job.start();
    expect(job.isStarted()).toBe(true);
    expect(run).not.toHaveBeenCalled();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith();
    await tick(2);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("ignores repeated start calls", async () => {
    const run = vi.fn(async () => {});
    const logger = mockLogger();
    const job = make({ run, logger });
    job.start();
    job.start();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('Cron "job" started', { name: "job", schedule: EVERY_SECOND });
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("activity and overlap", () => {
  it("reports activity independently of scheduling, including synchronous work", async () => {
    let activeDuringRun: boolean | undefined;
    const d = deferred();
    const job = make({
      run: () => {
        activeDuringRun = job.isActive();
        return d.promise;
      },
    });
    job.start();
    await tick();
    expect(activeDuringRun).toBe(true);
    expect(job.isActive()).toBe(true);
    void job.stop();
    expect(job.isStarted()).toBe(false);
    expect(job.isActive()).toBe(true);
    d.resolve();
    await flush();
    expect(job.isActive()).toBe(false);
  });

  it("skips overlapping ticks by default and logs a warning for each", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const logger = mockLogger();
    const job = make({ run, logger });
    job.start();
    await tick(3);
    expect(run).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('Cron "job" skipped: previous run still in progress', { name: "job" });

    d.resolve();
    await flush();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("accepts later ticks after a failed execution", async () => {
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    const job = make({ run, onError: () => {} });
    job.start();
    await tick(3);
    expect(run).toHaveBeenCalledTimes(3);
    expect(job.isActive()).toBe(false);
  });

  it("permits overlap when allowOverlap is true and stays active until all finish", async () => {
    const pending: Deferred[] = [];
    const run = vi.fn(() => {
      const d = deferred();
      pending.push(d);
      return d.promise;
    });
    const logger = mockLogger();
    const job = make({ run, logger, allowOverlap: true });
    job.start();
    await tick(3);
    expect(run).toHaveBeenCalledTimes(3);
    expect(logger.warn).not.toHaveBeenCalled();

    pending[0]!.resolve();
    pending[1]!.resolve();
    await flush();
    expect(job.isActive()).toBe(true);
    pending[2]!.resolve();
    await flush();
    expect(job.isActive()).toBe(false);
  });
});

describe("stop", () => {
  it("disables scheduling synchronously and ignores later ticks", async () => {
    const run = vi.fn(async () => {});
    const logger = mockLogger();
    const job = make({ run, logger });
    job.start();
    await tick();
    const stopped = job.stop();
    expect(job.isStarted()).toBe(false);
    expect(logger.info).toHaveBeenLastCalledWith('Cron "job" stopped', { name: "job" });
    await stopped;
    await tick(3);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("waits for active executions by default without cancelling them", async () => {
    const d = deferred();
    let finished = false;
    const job = make({
      run: async () => {
        await d.promise;
        finished = true;
      },
    });
    job.start();
    await tick();

    let resolved = false;
    const stopped = job.stop().then(() => {
      resolved = true;
    });
    await tick(5);
    expect(resolved).toBe(false);

    d.resolve();
    await stopped;
    expect(finished).toBe(true);
    expect(resolved).toBe(true);
  });

  it("does not reject when a waited-for execution fails", async () => {
    const d = deferred();
    const job = make({ run: () => d.promise, onError: () => {} });
    job.start();
    await tick();
    const stopped = job.stop();
    d.reject(new Error("fail"));
    await expect(stopped).resolves.toBeUndefined();
  });

  it("does not wait when waitForCompletionOnStop is false", async () => {
    const d = deferred();
    const job = make({ run: () => d.promise, waitForCompletionOnStop: false });
    job.start();
    await tick();
    await expect(job.stop()).resolves.toBeUndefined();
    expect(job.isActive()).toBe(true);
    d.resolve();
    await flush();
    expect(job.isActive()).toBe(false);
  });

  it("resolves immediately when already stopped, without logging or joining an earlier wait", async () => {
    const d = deferred();
    const logger = mockLogger();
    const job = make({ run: () => d.promise, logger });
    await expect(job.stop()).resolves.toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();

    job.start();
    await tick();
    let firstResolved = false;
    const first = job.stop().then(() => {
      firstResolved = true;
    });
    logger.info.mockClear();
    await expect(job.stop()).resolves.toBeUndefined();
    expect(firstResolved).toBe(false);
    expect(logger.info).not.toHaveBeenCalled();
    d.resolve();
    await first;
  });
});

describe("restart", () => {
  it("allows restarting before an earlier stop resolves", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const job = make({ run, allowOverlap: true });
    job.start();
    await tick();
    const stopped = job.stop();
    job.start();
    d.resolve();
    await stopped;
    expect(job.isStarted()).toBe(true);
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not extend an earlier stop wait with executions begun after restarting", async () => {
    const pending: Deferred[] = [];
    const job = make({
      allowOverlap: true,
      run: () => {
        const d = deferred();
        pending.push(d);
        return d.promise;
      },
    });
    job.start();
    await tick();
    let resolved = false;
    const stopped = job.stop().then(() => {
      resolved = true;
    });
    job.start();
    await tick();
    expect(pending).toHaveLength(2);
    pending[0]!.resolve();
    await stopped;
    expect(resolved).toBe(true);
    expect(job.isActive()).toBe(true);
    pending[1]!.resolve();
  });

  it("preserves overlap protection across restarts", async () => {
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const logger = mockLogger();
    const job = make({ run, logger, waitForCompletionOnStop: false });
    job.start();
    await tick();
    await job.stop();
    job.start();
    await tick(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    d.resolve();
    await flush();
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("error handling", () => {
  it("catches synchronous throws and rejections and preserves the failure identity", async () => {
    const syncFailure = { code: 42 };
    const asyncFailure = new TypeError("async");
    let call = 0;
    const onError = vi.fn();
    const job = make({
      allowOverlap: true,
      onError,
      run: (() => {
        call++;
        if (call === 1) throw syncFailure;
        return Promise.reject(asyncFailure);
      }) as () => Promise<void>,
    });
    job.start();
    await tick(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]![0]).toBe(syncFailure);
    expect(onError.mock.calls[1]![0]).toBe(asyncFailure);
  });

  it("does not retry failed work", async () => {
    const run = vi.fn(async () => {
      throw new Error("x");
    });
    const job = make({ run, onError: () => {} });
    job.start();
    await tick();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("logs the failure before invoking onError", async () => {
    const order: string[] = [];
    const failure = new Error("boom");
    const logger = mockLogger();
    logger.error.mockImplementation(() => {
      order.push("log");
    });
    const job = make({
      logger,
      run: async () => {
        throw failure;
      },
      onError: () => order.push("hook"),
    });
    job.start();
    await tick();
    expect(order).toEqual(["log", "hook"]);
    expect(logger.error).toHaveBeenCalledWith('Cron "job" run failed', failure, { name: "job" });
    expect(logger.error.mock.calls[0]![1]).toBe(failure);
  });

  it("invokes onError without a logger and makes no logging calls", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const onError = vi.fn();
    const d = deferred();
    const job = make({
      run: vi.fn().mockRejectedValueOnce("first").mockReturnValueOnce(d.promise),
      onError,
    });
    job.start();
    await tick(3);
    const stopped = job.stop();
    d.resolve();
    await stopped;
    expect(onError).toHaveBeenCalledWith("first");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("still invokes onError when the logger throws", async () => {
    const failure = new Error("boom");
    const logger = mockLogger();
    logger.error.mockImplementation(() => {
      throw new Error("logger broke");
    });
    const onError = vi.fn();
    const run = vi.fn(async () => {
      throw failure;
    });
    const job = make({ logger, run, onError, allowOverlap: true });
    job.start();
    await tick(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(job.isActive()).toBe(false);
  });

  it("reports a throwing onError hook separately without recursion or disabling scheduling", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const failure = new Error("work");
      const hookFailure = new Error("hook");
      const logger = mockLogger();
      const onError = vi.fn(() => {
        throw hookFailure;
      });
      const run = vi.fn(async () => {
        throw failure;
      });
      const job = make({ logger, run, onError });
      job.start();
      await tick(2);
      expect(run).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledWith(failure);
      expect(logger.error).toHaveBeenCalledWith('Cron "job" onError hook failed', hookFailure, { name: "job" });
      expect(logger.error).toHaveBeenCalledTimes(4);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("wraps non-Error failures for the logger with String(value) and cause", async () => {
    const failure = { toString: () => "custom failure" };
    const logger = mockLogger();
    const onError = vi.fn();
    const job = make({
      logger,
      onError,
      run: async () => {
        throw failure;
      },
    });
    job.start();
    await tick();
    const logged = logger.error.mock.calls[0]![1];
    expect(logged).toBeInstanceOf(Error);
    expect(logged.message).toBe("custom failure");
    expect(logged.cause).toBe(failure);
    expect(onError.mock.calls[0]![0]).toBe(failure);
  });

  it("still preserves the failure when string conversion throws", async () => {
    const failure = Object.create(null) as object;
    const logger = mockLogger();
    const onError = vi.fn();
    const run = vi.fn(async () => {
      throw failure;
    });
    const job = make({ logger, onError, run });
    job.start();
    await tick(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[0]![0]).toBe(failure);
    expect(logger.error.mock.calls[0]![1]).toBeInstanceOf(Error);
    expect(logger.error.mock.calls[0]![1].cause).toBe(failure);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe("logger failures", () => {
  it("never escape lifecycle calls or disrupt scheduling", async () => {
    const logger: CronLogger = {
      info: () => {
        throw new Error("info");
      },
      warn: () => {
        throw new Error("warn");
      },
      error: () => {
        throw new Error("error");
      },
    };
    const d = deferred();
    const run = vi.fn(() => d.promise);
    const job = make({ logger, run });
    expect(() => job.start()).not.toThrow();
    await tick(3);
    expect(run).toHaveBeenCalledTimes(1);
    expect(job.isActive()).toBe(true);
    let stopped!: Promise<void>;
    expect(() => {
      stopped = job.stop();
    }).not.toThrow();
    expect(job.isStarted()).toBe(false);
    d.resolve();
    await expect(stopped).resolves.toBeUndefined();
    expect(job.isActive()).toBe(false);
  });
});

describe("runInContext", () => {
  it("invokes the wrapper once per accepted execution and exposes its context", async () => {
    const storage = new AsyncLocalStorage<number>();
    let next = 0;
    const seen: { run?: number | undefined; log?: number | undefined; hook?: number | undefined }[] = [];
    const logger = mockLogger();
    logger.error.mockImplementation(() => {
      seen.at(-1)!.log = storage.getStore();
    });
    const runInContext = vi.fn((t: () => Promise<void>) => storage.run(++next, t));
    const job = make({
      logger,
      runInContext,
      run: async () => {
        await Promise.resolve();
        seen.push({ run: storage.getStore() });
        throw new Error("fail");
      },
      onError: () => {
        seen.at(-1)!.hook = storage.getStore();
      },
    });
    job.start();
    await tick(2);
    expect(runInContext).toHaveBeenCalledTimes(2);
    expect(seen).toEqual([
      { run: 1, log: 1, hook: 1 },
      { run: 2, log: 2, hook: 2 },
    ]);
  });

  it("is not invoked for stopped or overlap-skipped ticks", async () => {
    const d = deferred();
    const runInContext = vi.fn((t: () => Promise<void>) => t());
    const job = make({ runInContext, run: () => d.promise });
    job.start();
    await tick(3);
    expect(runInContext).toHaveBeenCalledTimes(1);
    d.resolve();
    await job.stop();
    await tick(3);
    expect(runInContext).toHaveBeenCalledTimes(1);
  });

  it("treats work before and after the tick as active", async () => {
    const before = deferred();
    const after = deferred();
    const run = vi.fn(async () => {});
    const job = make({
      run,
      runInContext: async (t) => {
        await before.promise;
        await t();
        await after.promise;
      },
    });
    job.start();
    await tick();
    expect(job.isActive()).toBe(true);
    expect(run).not.toHaveBeenCalled();
    before.resolve();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(job.isActive()).toBe(true);
    after.resolve();
    await flush();
    expect(job.isActive()).toBe(false);
  });

  it("reports wrapper failures before the tick without running the work", async () => {
    const failure = new Error("context");
    const logger = mockLogger();
    const onError = vi.fn();
    const run = vi.fn(async () => {});
    let call = 0;
    const job = make({
      logger,
      onError,
      run,
      runInContext: (() => {
        call++;
        if (call === 1) throw failure;
        return Promise.reject(failure);
      }) as (t: () => Promise<void>) => Promise<void>,
    });
    job.start();
    await tick(2);
    expect(run).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(logger.error).toHaveBeenCalledWith('Cron "job" run failed', failure, { name: "job" });
    expect(job.isActive()).toBe(false);
  });

  it("reports wrapper failures after the tick without rerunning the work or staying active", async () => {
    const failure = new Error("teardown");
    const onError = vi.fn();
    const run = vi.fn(async () => {});
    const job = make({
      onError,
      run,
      runInContext: async (t) => {
        await t();
        throw failure;
      },
    });
    job.start();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    expect(job.isActive()).toBe(false);
    await tick();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
