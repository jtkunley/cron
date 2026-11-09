import type { CronTick } from './types';

/**
 * Runs the work once, inside `runInContext` when given, and reports any failure.
 * Resolves when the whole execution, wrapper included, has finished. Never rejects.
 */
export async function runExecution(
    run: () => Promise<void>,
    runInContext: ((tick: CronTick) => Promise<void>) | undefined,
    reportFailure: (failure: unknown) => void,
): Promise<void> {
    // Failures of the work are reported here, inside the tick, so the failure log and `onError`
    // see the same context as the work. `await` also catches a synchronous throw from `run`.
    const runWork = async (): Promise<void> => {
        try {
            await run();
        } catch (failure) {
            reportFailure(failure);
        }
    };

    if (!runInContext) {
        await runWork();
        return;
    }

    let tickPromise: Promise<void> | undefined;
    // A wrapper that calls `tick` more than once breaks its contract; the work still runs only once.
    const tick: CronTick = () => (tickPromise ??= runWork());

    try {
        await runInContext(tick);
    } catch (failure) {
        // Context setup or teardown failed. Reported outside the tick, and the work is not rerun.
        reportFailure(failure);
    }
    // A wrapper that resolves before its tick finishes breaks its contract too; waiting here keeps
    // the run active, and overlap protection in place, until the work is really done.
    await tickPromise;
}
