import { AsyncLocalStorage } from 'async_hooks';
import { createRequire } from 'module';
import { join } from 'path';
import { describe, expect, inject, it } from 'vitest';
import type * as Cron from '../../src/index';

const consumerRequire = createRequire(join(inject('consumerDir'), 'consumer.js'));
const { createCron } = consumerRequire('@jtkunley/cron') as typeof Cron;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Real node-cron, real timers: each test runs for a few seconds of wall-clock time.
describe('a job from the installed package', () => {
    it('runs on schedule, skips overlapping ticks, reports failures and stops cleanly', async () => {
        const lines: string[] = [];
        const storage = new AsyncLocalStorage<number>();
        const contexts: (number | undefined)[] = [];
        const failures: unknown[] = [];
        let runs = 0;
        let next = 0;

        const job = createCron({
            name: 'component',
            schedule: '* * * * * *',
            logger: {
                info: (message) => lines.push(message),
                warn: (message) => lines.push(message),
                error: (message) => lines.push(message),
            },
            runInContext: (tick) => storage.run(++next, tick),
            run: async () => {
                runs++;
                contexts.push(storage.getStore());
                await sleep(1500);
                if (runs === 1) throw new Error('first run failed');
            },
            onError: (error) => failures.push(error),
        });

        job.start();
        await sleep(3300);
        await job.stop();

        expect(job.isStarted()).toBe(false);
        expect(job.isActive()).toBe(false);
        expect(runs).toBeGreaterThanOrEqual(1);
        expect(contexts).toEqual(Array.from({ length: runs }, (_, i) => i + 1));
        expect(failures).toEqual([new Error('first run failed')]);
        expect(lines[0]).toBe('Cron "component" started');
        expect(lines).toContain('Cron "component" skipped: previous run still in progress');
        expect(lines).toContain('Cron "component" run failed');
        expect(lines.at(-1)).toBe('Cron "component" stopped');
    });
});
