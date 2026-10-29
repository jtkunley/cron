# Changelog

## 1.0.0 (2026-10-28)

### Features

- **Scheduled jobs:** `createCron` wraps `node-cron` with overlap control, failure logging and an `onError` hook that never stop the schedule, an optional `runInContext` wrapper for each tick, and a `stop()` that waits for runs in progress. Moved out of `@jtkunley/service-runtime`, where it was the `/cron` subpath, with its `context` and `source` options replaced by `runInContext`.
