# @jtkunley/cron

[![npm](https://img.shields.io/npm/v/@jtkunley/cron)](https://www.npmjs.com/package/@jtkunley/cron)
[![CI](https://github.com/jtkunley/cron/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/cron/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178C6?logo=typescript&logoColor=white)](src/index.ts)
[![Dependencies](https://img.shields.io/badge/dependencies-1-brightgreen)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Scheduled jobs for Node.js services, on [`node-cron`](https://www.npmjs.com/package/node-cron), with the parts every service ends up writing around it:

- **No overlapping runs**: a tick that arrives while the last run is still going is skipped and logged, not queued.
- **A context per run**: each run can get its own `AsyncLocalStorage` store, such as a request ID, that its logs and error handling see too.
- **A clean stop**: `stop()` stops scheduling at once and resolves when the runs in progress have finished, ready for graceful shutdown.
- **Failures reported, never fatal**: a failed run is logged and passed to your error hook, and the job carries on.

It works with any logger, or none, and `node-cron` is its only dependency.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Design decisions](#design-decisions)
- [Scheduling](#scheduling)
- [Overlapping runs](#overlapping-runs)
- [Starting and stopping](#starting-and-stopping)
- [A context per run](#a-context-per-run)
- [Failures](#failures)
- [Logging](#logging)
- [API](#api)
- [Development](#development)
- [License](#license)

## Install

```bash
npm i @jtkunley/cron
```

Requires Node.js 22 or later.

## Quick start

```ts
import { createCron } from '@jtkunley/cron';

const expireSessions = createCron({
  name: 'expire-sessions',
  schedule: '*/5 * * * *', // every five minutes
  run: () => sessions.expireStale(),
});

expireSessions.start();

// On shutdown: no new runs, and the one in progress, if any, finishes first.
await expireSessions.stop();
```

## Design decisions

- **Skip, don't pile up.** A job that runs longer than its interval would otherwise start a second copy of itself, then a third. Ticks that arrive while a run is unfinished are skipped with a warning and never replayed, so a slow job falls behind instead of overloading the service. Jobs that are safe to overlap opt in with `allowOverlap`.
- **Stopping means no new runs, not cancelled work.** JavaScript can't safely cancel a promise partway through, so `stop()` disables scheduling straight away and, by default, resolves when the runs already in progress have finished. That's the promise a graceful shutdown awaits before closing the database the job uses.
- **Restarting is always safe.** `start()` takes effect even before an earlier `stop()` resolves, and that earlier stop waits only for the runs it saw. Overlap protection carries across the restart, so a run left over from before the stop still blocks new ones.
- **Each run gets its own context.** `runInContext` wraps every run, so each one gets a fresh store, for example a request ID for its log lines. The failure log and `onError` run inside that store, so they're attributed to the run that failed.
- **A failure is reported, then forgotten.** Thrown errors and rejections are caught, logged, and handed to `onError` with their original value, so `instanceof` checks and custom fields still work. There's no automatic retry; the next tick is the retry.
- **Logging can't break a job.** A logger that throws is ignored, so it can't skip the work, lose a failure for `onError`, or leave a run counted as active. Without a logger, the package makes no logging calls at all.
- **Configured once.** Options are copied at creation, so changing the object later can't reconfigure a running job, and an invalid schedule throws at startup, not at the first tick.
- **Nothing held while stopped.** `node-cron` keeps every task in a process-wide registry until it's destroyed, so each `start()` creates a task and each `stop()` destroys it. A stopped job holds no timers and nothing in that registry, and a job that is created but never started never registers at all.
- **`node-cron` does the timing.** Schedule syntax, timezone, daylight saving time and late timer handling are all `node-cron`'s. This package doesn't replay ticks missed while the process was busy, stopped or down.
- **Tested the way it runs.** Unit tests hold coverage at 100%, enforced in CI, and drive the real `node-cron` on fake timers. Component tests build the package as it's published, install it, and run a job on real timers.

## Scheduling

`schedule` is any expression [`node-cron`](https://www.npmjs.com/package/node-cron) accepts: five fields, or six with a leading seconds field.

```ts
createCron({ name: 'nightly-report', schedule: '0 2 * * *', run: sendReport }); // 02:00 every day
createCron({ name: 'heartbeat', schedule: '*/10 * * * * *', run: ping }); // every 10 seconds
```

Schedules run in the process's timezone (set `TZ` to change it) and follow `node-cron`'s calendar and daylight saving behavior. An invalid expression throws from `createCron`.

Delivery is subject to the event loop, so a busy process may run a tick late. Ticks missed while the process was blocked, the job was stopped, or the process wasn't running aren't made up.

## Overlapping runs

By default, a tick that arrives while an earlier run is still unfinished is skipped, with a warning:

```
Cron "sync-orders" skipped: previous run still in progress
```

The next tick after the run finishes, successfully or not, starts as normal. Nothing is queued.

With `allowOverlap: true`, every tick starts a run, however many are still going. `isActive()` stays `true` until they have all finished.

## Starting and stopping

A job is created stopped. `start()` enables future ticks without running the work now, and `stop()` disables them:

| Call | Effect |
|------|--------|
| `start()` | Enables scheduling and logs `started`. Does nothing if already started. |
| `stop()` | Disables scheduling before it returns, logs `stopped`, and resolves once the runs in progress have finished. Resolves at once if already stopped. |
| `isStarted()` | Whether scheduling is enabled. |
| `isActive()` | Whether a run is unfinished. It can be `true` after `stop()`, while a run finishes. |

`stop()` never cancels a run and has no timeout: a run that never settles keeps it pending, so bound your shutdown with an overall deadline. It resolves even if the run fails. With `waitForCompletionOnStop: false`, it resolves straight away and the runs carry on in the background, still counted by `isActive()`.

A run may stop its own job, for example once there's nothing left to do, but shouldn't `await` the `stop()`: it would be waiting for itself to finish.

In a graceful shutdown, stop the jobs before closing what they use. With [`@jtkunley/service-runtime`](https://github.com/jtkunley/service-runtime):

```ts
const service = configureService({
  logger: rootLogger,
  port: 3000,
  cleanups: [() => expireSessions.stop(), () => db.end()],
});
```

## A context per run

`runInContext` receives each run's `tick` and calls it inside whatever context the run should have. It must call `tick` once and return a promise that covers it:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const runContext = new AsyncLocalStorage<{ runId: string }>();

createCron({
  name: 'sync-orders',
  schedule: '* * * * *',
  run: syncOrders, // runContext.getStore() is this run's store
  runInContext: (tick) => runContext.run({ runId: randomUUID() }, tick),
});
```

With `@jtkunley/service-runtime`, each run can carry the service's own context values, as a request would:

```ts
runInContext: (tick) => service.context.run({ headers: { 'x-request-id': randomUUID() } }, tick),
```

The wrapper runs once per run, never for skipped ticks or ticks after a stop, and the run is active from the moment the wrapper is called until its promise settles, including any work it does before or after `tick`. The work's failure is reported inside `tick`, in the run's context, so `tick` itself never rejects.

If the wrapper throws or rejects before calling `tick`, such as when the context can't be set up, the work doesn't run and the failure is reported as the run's failure. If it fails after `tick`, the failure is reported and the work isn't run again.

## Failures

When the work throws or rejects, the job:

1. Logs `Cron "<name>" run failed` with the failure, if there is a logger
2. Calls `onError` with the original value, if given, even without a logger
3. Counts the run as finished, so the next tick runs as usual

```ts
createCron({
  name: 'sync-orders',
  schedule: '* * * * *',
  run: syncOrders,
  logger: rootLogger.child('cron', 'sync-orders'),
  onError: (error) => metrics.increment('cron.failure', { job: 'sync-orders' }),
});
```

`onError` is called synchronously and its return value is ignored, so make it synchronous. If it throws, that's logged as `Cron "<name>" onError hook failed`, and `onError` isn't called again for it.

The logger always receives an `Error`. A thrown `Error` is passed unchanged; any other value is wrapped in an `Error` whose message is `String(value)` and whose `cause` is the value. `onError` always receives the original value.

## Logging

Pass a `logger` with `info`, `warn` and `error` to get the job's lifecycle in your logs. A child logger from [`@jtkunley/logger`](https://github.com/jtkunley/logger) fits as it is; for a logger that takes the data first, such as pino, adapt the three methods. A logger method that throws or rejects is ignored. Without a logger, the package logs nothing; `node-cron` may still print its own diagnostics, such as a warning for a missed tick.

| Level | Message | Data | When |
|-------|---------|------|------|
| `info` | `Cron "<name>" started` | `{ name, schedule }` | `start()` enables scheduling |
| `info` | `Cron "<name>" stopped` | `{ name }` | `stop()` disables scheduling; runs may still be finishing |
| `warn` | `Cron "<name>" skipped: previous run still in progress` | `{ name }` | A tick is skipped to avoid overlap |
| `error` | `Cron "<name>" run failed` | the failure, `{ name }` | The work or the context wrapper failed |
| `error` | `Cron "<name>" onError hook failed` | the hook's failure, `{ name }` | `onError` threw |

## API

### `createCron(options)`

Returns a stopped `CronController`. Throws a `TypeError` for a missing `name`, `schedule` or `run`, an `onError` or `runInContext` that isn't a function, or an `allowOverlap` or `waitForCompletionOnStop` that isn't a boolean, and `node-cron`'s error for a schedule it can't parse.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | required | Identifies the job in its log lines. |
| `schedule` | `string` | required | A `node-cron` expression: five fields, or six with leading seconds. See [Scheduling](#scheduling). |
| `run` | `() => Promise<void>` | required | The work, called with no arguments on each accepted tick. |
| `logger` | `CronLogger` | none | `info(message, data)`, `warn(message, data)` and `error(message, error, data)`. See [Logging](#logging). |
| `onError` | `(error: unknown) => void` | none | Called synchronously with each failure's original value, after it's logged. |
| `allowOverlap` | `boolean` | `false` | Start a run on every tick, even while earlier runs are unfinished. |
| `waitForCompletionOnStop` | `boolean` | `true` | Whether `stop()` waits for the runs in progress. |
| `runInContext` | `(tick: CronTick) => Promise<void>` | none | Wraps each run in its own context. See [A context per run](#a-context-per-run). |

### `CronController`

| Member | Description |
|--------|-------------|
| `start()` | Enables scheduled runs. Doesn't run the work now. |
| `stop()` | Disables scheduled runs before returning; resolves once the runs in progress have finished, or at once with `waitForCompletionOnStop: false`. Never rejects. |
| `isStarted()` | Whether scheduling is enabled. |
| `isActive()` | Whether at least one run is unfinished. |

### Types

`CronOptions` and `CronController` describe the API above. `CronLogger` and `LogData` describe the logger, and `CronTick` is the function `runInContext` receives.

The package root and its `package.json` are the whole public surface: the `exports` map rejects deep imports.

## Development

```bash
npm install
npm run check           # typecheck, lint, formatting and all tests
npm run test:unit       # unit tests, next to the source in src/
npm run test:component  # component tests in test/component/
npm run test:coverage   # all tests, failing below 100% coverage
npm run format          # format with Prettier
npm run build           # compile the publishable package into dist/
```

```
src/
  index.ts                         the package root
  lib/createCron.ts                createCron, which wires everything below together
  lib/resolveOptions.ts            validates the options and applies the defaults
  lib/scheduleTicks.ts             the node-cron task behind each start(), destroyed by stop()
  lib/runExecution.ts              one run: the context wrapper, the work, and reporting failures
  lib/createExecutionTracker.ts    which runs are unfinished, for overlap, isActive() and stop()
  lib/createFailureReporter.ts     logs a failure, then calls onError
  lib/createSafeLogger.ts          the caller's logger, made optional and unable to throw
  lib/toError.ts                   turns any failure value into an Error for the logger
  lib/types.ts                     the public types
  **/__tests__/                    unit tests, one spec per source file, named after it
test/component/                    component tests against the built package
```

The behavior the package guarantees is listed rule by rule in [`business-rules.md`](business-rules.md), and [`createCron.spec.ts`](src/lib/__tests__/createCron.spec.ts) tests each one against the real `node-cron`.

### Publishing

`npm run build` compiles into `dist/src/` and copies `package.json`, this README, the changelog and the license into `dist/`, which is the directory to publish:

```bash
npm run build && npm publish ./dist
```

Publishing from the repository root is refused, since it would ship the TypeScript sources.

## License

[MIT](LICENSE)
