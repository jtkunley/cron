import { AsyncLocalStorage } from 'node:async_hooks';
import { runExecution } from '../runExecution';
describe('runExecution', () => {
    describe('without a context wrapper', () => {
        it('runs the work once', async () => {
            const run = vi.fn(() => Promise.resolve());
            const report = vi.fn();

            await runExecution(run, undefined, report);

            expect(run).toHaveBeenCalledTimes(1);
            expect(run).toHaveBeenCalledWith();
            expect(report).not.toHaveBeenCalled();
        });

        it('reports a rejection and a synchronous throw, and resolves', async () => {
            const failure = new Error('x');
            const report = vi.fn();
            const throwing = () => {
                throw failure;
            };

            await expect(
                runExecution(() => Promise.reject(failure), undefined, report),
            ).resolves.toBeUndefined();
            await expect(runExecution(throwing, undefined, report)).resolves.toBeUndefined();

            expect(report).toHaveBeenCalledTimes(2);
            expect(report).toHaveBeenNthCalledWith(1, failure);
            expect(report).toHaveBeenNthCalledWith(2, failure);
        });
    });

    describe('with a context wrapper', () => {
        it('runs the work, and reports its failure, inside the context', async () => {
            const storage = new AsyncLocalStorage<string>();
            let seenByRun: string | undefined;
            let seenByReport: string | undefined;

            await runExecution(
                () => {
                    seenByRun = storage.getStore();
                    return Promise.reject(new Error('x'));
                },
                (tick) => storage.run('ctx', tick),
                () => {
                    seenByReport = storage.getStore();
                },
            );

            expect(seenByRun).toBe('ctx');
            expect(seenByReport).toBe('ctx');
        });

        it('passes a tick that resolves even when the work fails', async () => {
            const tickResults: Promise<void>[] = [];

            await runExecution(
                () => Promise.reject(new Error('x')),
                (tick) => {
                    const result = tick();
                    tickResults.push(result);
                    return result;
                },
                () => {},
            );

            await expect(tickResults[0]).resolves.toBeUndefined();
        });

        it.each([
            [
                'throws',
                () => {
                    throw new Error('setup');
                },
            ],
            ['rejects', () => Promise.reject(new Error('setup'))],
        ])(
            'reports a wrapper that %s before the tick, without running the work',
            async (_case, wrapper) => {
                const run = vi.fn(() => Promise.resolve());
                const report = vi.fn();

                await runExecution(run, wrapper, report);

                expect(run).not.toHaveBeenCalled();
                expect(report).toHaveBeenCalledWith(new Error('setup'));
            },
        );

        it('reports a wrapper failure after the tick once, without rerunning the work', async () => {
            const run = vi.fn(() => Promise.resolve());
            const report = vi.fn();
            const failure = new Error('teardown');

            await runExecution(
                run,
                async (tick) => {
                    await tick();
                    throw failure;
                },
                report,
            );

            expect(run).toHaveBeenCalledTimes(1);
            expect(report).toHaveBeenCalledTimes(1);
            expect(report).toHaveBeenCalledWith(failure);
        });

        it('runs the work once if the wrapper calls the tick twice', async () => {
            const run = vi.fn(() => Promise.resolve());

            await runExecution(
                run,
                async (tick) => {
                    await tick();
                    await tick();
                },
                () => {},
            );

            expect(run).toHaveBeenCalledTimes(1);
        });

        it('waits for the work even if the wrapper resolves first', async () => {
            let release!: () => void;
            let finished = false;
            const run = () =>
                new Promise<void>((resolve) => {
                    release = resolve;
                }).then(() => {
                    finished = true;
                });

            const execution = runExecution(
                run,
                (tick) => {
                    void tick();
                    return Promise.resolve();
                },
                () => {},
            );
            let executionDone = false;
            void execution.then(() => {
                executionDone = true;
            });
            await new Promise((resolve) => setImmediate(resolve));
            expect(executionDone).toBe(false);

            release();
            await execution;
            expect(finished).toBe(true);
        });
    });
});
