import { AsyncLocalStorage } from 'async_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CronController, CronOptions } from '../../src';
import { consumerRequire } from './installed';

const { createCron } = consumerRequire('@jtkunley/cron') as typeof import('../../src');

const EVERY_SECOND = '* * * * * *';
const TICK_TIMEOUT = { timeout: 3_000 };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const jobs: CronController[] = [];
const start = (options: Partial<CronOptions> & Pick<CronOptions, 'run'>) => {
    const job = createCron({ name: 'job', schedule: EVERY_SECOND, ...options });
    jobs.push(job);
    job.start();
    return job;
};

/** Records every log call, in order, as `level: message`. */
function recordingLogger() {
    const lines: string[] = [];
    const record = (level: string) => (message: string) => void lines.push(`${level}: ${message}`);
    return {
        lines,
        logger: {
            info: vi.fn(record('info')),
            warn: vi.fn(record('warn')),
            error: vi.fn(record('error')),
        },
    };
}

describe('a cron job on the real node-cron', () => {
    afterEach(async () => {
        await Promise.all(jobs.splice(0).map((job) => job.stop()));
    });

    it('refuses a schedule node-cron cannot parse', () => {
        expect(() =>
            createCron({ name: 'bad', schedule: 'every day', run: () => Promise.resolve() }),
        ).toThrow();
    });

    it('runs on its schedule', async () => {
        const run = vi.fn(() => Promise.resolve());

        start({ run });

        await vi.waitFor(() => expect(run).toHaveBeenCalled(), TICK_TIMEOUT);
    });

    it('skips the ticks that arrive while a run is still in progress', async () => {
        const { lines, logger } = recordingLogger();
        const run = vi.fn(() => sleep(2_200));

        start({ name: 'slow', run, logger });

        await vi.waitFor(
            () =>
                expect(lines).toContain(
                    'warn: Cron "slow" skipped: previous run still in progress',
                ),
            TICK_TIMEOUT,
        );
        expect(run).toHaveBeenCalledOnce();
    });

    it('stops scheduling, and waits for the run in progress before stop() resolves', async () => {
        const { lines, logger } = recordingLogger();
        const job = start({
            name: 'drain',
            logger,
            run: async () => {
                lines.push('run started');
                await sleep(500);
                lines.push('run finished');
            },
        });
        await vi.waitFor(() => expect(lines).toContain('run started'), TICK_TIMEOUT);

        await job.stop();
        lines.push('stop resolved');
        await sleep(1_200);

        expect(lines).toEqual([
            'info: Cron "drain" started',
            'run started',
            'info: Cron "drain" stopped',
            'run finished',
            'stop resolved',
        ]);
    });

    it('runs each tick in its own context, and logs a failure from inside it', async () => {
        const storage = new AsyncLocalStorage<{ tickId: number }>();
        let ticks = 0;
        const seenByLogger: unknown[] = [];
        const seenByRun: unknown[] = [];
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(() => void seenByLogger.push(storage.getStore())),
        };

        start({
            logger,
            runInContext: (tick) => storage.run({ tickId: ++ticks }, tick),
            run: () => {
                seenByRun.push(storage.getStore());
                return Promise.reject(new Error('tick failed'));
            },
        });

        await vi.waitFor(() => expect(seenByLogger).toHaveLength(2), { timeout: 4_000 });
        expect(seenByRun.slice(0, 2)).toEqual([{ tickId: 1 }, { tickId: 2 }]);
        expect(seenByLogger).toEqual(seenByRun.slice(0, 2));
    });
});
