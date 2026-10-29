# @jtkunley/cron

[![CI](https://github.com/jtkunley/cron/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/cron/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Scheduled jobs for Node.js services, on top of [`node-cron`](https://www.npmjs.com/package/node-cron), with the parts every service ends up adding: **overlapping runs are skipped**, a **failed run is reported without stopping the schedule**, each tick can run **in its own context**, and **`stop()` waits for the run in progress**, so a job finishes before the process exits.

## Contents

- [Design decisions](#design-decisions)
- [Install](#install)
- [Usage](#usage)
  - [Logger, overlap and error hook](#logger-overlap-and-error-hook)
  - [Running each tick in a context](#running-each-tick-in-a-context)
  - [Stopping with graceful shutdown](#stopping-with-graceful-shutdown)
- [API](#api)
- [Development](#development)
- [License](#license)

## Design decisions

- **One run at a time, by default.** A tick that arrives while the previous run is still going is skipped and logged, so a slow job can't pile up copies of itself. Jobs that are safe to overlap opt in with `allowOverlap`.
- **A failure belongs to its tick.** A run that throws is logged and passed to `onError`, and the next tick runs as normal. A throwing `onError` is logged too and never escapes as an unhandled rejection.
- **Stopping finishes the work.** `stop()` stops scheduling first, then waits for runs in progress, so it can sit in a shutdown sequence before the database closes.
- **Context without coupling.** `runInContext` wraps each tick in whatever context the service uses, an `AsyncLocalStorage` or a request-context library, without this package knowing about it. The failure log is written inside that context, so a logger that injects context values sees the tick's.
- **Logs only what the logger can't know.** Lines carry the job's name, and its schedule when it starts. Request IDs and the like come from the logger's own context injection.
- **Tested the way it runs.** Unit tests hold coverage at 100%, enforced in CI. Component tests build the package as published, install it beside the real `node-cron`, and check its behaviour on real schedules.

## Install

```bash
npm i @jtkunley/cron
```

Requires Node.js 22 or later. Logging is optional; any logger with `info`, `warn` and `error(message, error, data)` fits, including a [`@jtkunley/logger`](https://github.com/jtkunley/logger) child logger.

## Usage

```ts
import { createCron } from '@jtkunley/cron';

const job = createCron({
  name: 'nightly-sync',
  schedule: '0 2 * * *', // 02:00 daily
  run: async () => {
    await syncSomething();
  },
});

job.start();

// On shutdown:
await job.stop();
```

The `node-cron` task is created stopped and named after the job; nothing is scheduled until `start()`. An invalid `schedule` makes `createCron` throw, so a bad expression from config fails at startup rather than never running.

### Logger, overlap and error hook

```ts
const job = createCron({
  name: 'poll-queue',
  schedule: '*/5 * * * *', // every 5 minutes
  run: drainQueue,
  logger: childLogger,
  allowOverlap: false, // default: skip a tick while the previous run is in progress
  onError: (err) => Sentry.captureException(err), // called after the failure is logged
  waitForCompletionOnStop: true, // default: stop() waits for runs in progress
});
```

### Running each tick in a context

`runInContext` receives each tick and runs it, so the job can open a fresh context for every run:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const storage = new AsyncLocalStorage<{ requestId: string }>();

createCron({
  name: 'reconcile',
  schedule: '*/5 * * * *',
  runInContext: (tick) => storage.run({ requestId: randomUUID() }, tick),
  run: reconcile, // storage.getStore() works in here
  logger: childLogger,
});
```

With a [`@jtkunley/service-runtime`](https://github.com/jtkunley/service-runtime) service, a tick gets the same values a request would, worked out by the context's own `value` functions:

```ts
runInContext: (tick) => service.context.run({ headers: { 'x-tenant-id': process.env.TENANT_ID } }, tick),
```

A `runInContext` that throws, such as a context missing a required value, fails the tick without calling `run()`. It is logged and reported to `onError` like a failed run, and later ticks still run.

### Stopping with graceful shutdown

Stop the job in a shutdown cleanup, listed before the resources its runs use. A `@jtkunley/service-runtime` service runs its cleanups in order:

```ts
configureService({
  logger: rootLogger,
  port: 3000,
  cleanups: [() => job.stop(), closeDatabase],
});
```

## API

### `createCron(options)`

Returns a `CronController`.

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Names the `node-cron` task and appears in every log line. |
| `schedule` | `string` | Yes | — | A cron expression `node-cron` accepts, with an optional leading seconds field. |
| `run` | `() => Promise<void>` | Yes | — | The work for each tick. |
| `logger` | `CronLogger` | No | — | Logs start, stop, skipped ticks and failures. |
| `onError` | `(error: unknown) => void` | No | — | Called with whatever a run threw, after it is logged. |
| `allowOverlap` | `boolean` | No | `false` | If `false`, a tick is skipped while the previous run is in progress, and a `warn` is logged. |
| `waitForCompletionOnStop` | `boolean` | No | `true` | If `true`, `stop()` waits for runs in progress. |
| `runInContext` | `(tick) => Promise<void>` | No | — | Runs each tick, so it can open a context around it. |

### `CronController`

| Method | Description |
|--------|-------------|
| `start()` | Starts scheduling. Calling it again while started does nothing. |
| `stop()` | Stops scheduling, then, by default, waits for runs in progress. Does nothing when not started. Scheduling stops at once, so a `start()` made before `stop()` resolves takes effect. |
| `isStarted()` | Whether the job is started. |
| `isActive()` | Whether a run is in progress. |

Without `allowOverlap`, a run still in progress after `stop()` (with `waitForCompletionOnStop: false`) keeps blocking ticks after a restart, until it finishes.

### `CronLogger`

`info(message, data)`, `warn(message, data)` and `error(message, error, data)`, where `data` is a plain object such as `{ name }`.

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
  index.ts                 the package entry point: createCron and its types
  cron.ts                  createCron
  types.ts                 CronOptions, CronController and CronLogger
  to-error.ts              wraps non-Error failures for the logger
  __tests__/               unit tests, against a mocked node-cron
test/component/            behaviour tests against the built package and the real node-cron
```

### Publishing

`main`, `types` and `exports` in package.json point at built output. `npm run build` compiles it into `dist/src/` and copies `package.json`, this README, the changelog and the license into `dist/`, which is the directory to publish:

```bash
npm run build && npm publish ./dist
```

Publishing from the repository root is refused, since it would ship the TypeScript sources.

## License

[MIT](LICENSE)
