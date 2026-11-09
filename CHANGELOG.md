# Changelog

## 1.0.0 (2026-11-08)

### Features

- **One entry point:** `createCron({ name, schedule, run })` returns a job with `start()`, `stop()`, `isStarted()` and `isActive()`. The job is created stopped, its options are copied at creation, and an invalid schedule throws straight away. Schedules are `node-cron` expressions, five fields or six with leading seconds, in the process's timezone.
- **No overlapping runs:** a tick that arrives while an earlier run is unfinished is skipped and logged, never queued. `allowOverlap: true` lets runs overlap instead. A run left over from before a stop still blocks new runs after a restart.
- **Clean stop:** `stop()` disables scheduling before it returns and resolves once the runs already in progress have finished, without cancelling them or timing out. A failed run doesn't reject it. `waitForCompletionOnStop: false` returns without waiting. A job can be restarted at any time, even before an earlier `stop()` resolves.
- **Context per run:** `runInContext` wraps each run, so each gets its own context, such as an `AsyncLocalStorage` store. The work, its failure log and `onError` all see that run's context. Context setup and teardown failures are reported like any other failure, without rerunning the work.
- **Failures are reported, never fatal:** a throw or rejection from the work is logged, then passed to `onError` with its original value. Failed work isn't retried, and the job carries on with the next tick. A throwing `onError` is logged separately.
- **Any logger, or none:** the optional `logger` takes `info`, `warn` and `error`. A logger that throws or rejects can't break the job, and without one the package logs nothing.
- **Nothing held while stopped:** each `start()` creates a `node-cron` task and each `stop()` destroys it, so a stopped job holds no timers and nothing in `node-cron`'s process-wide registry.
