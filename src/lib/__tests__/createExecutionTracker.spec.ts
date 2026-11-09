import { createExecutionTracker } from '../createExecutionTracker';

function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('createExecutionTracker', () => {
    it('is inactive with nothing tracked, and settles at once', async () => {
        const tracker = createExecutionTracker();

        expect(tracker.isActive()).toBe(false);
        await expect(tracker.settled()).resolves.toBeUndefined();
    });

    it('counts an execution as active, and waits for it, from before it starts', async () => {
        const tracker = createExecutionTracker();
        const d = deferred();
        let activeAtStart: boolean | undefined;
        let settledFromInside: Promise<void> | undefined;
        let settledResolved = false;

        tracker.track(() => {
            activeAtStart = tracker.isActive();
            settledFromInside = tracker.settled().then(() => {
                settledResolved = true;
            });
            return d.promise;
        });
        await Promise.resolve();

        expect(activeAtStart).toBe(true);
        expect(settledResolved).toBe(false);
        d.resolve();
        await settledFromInside;
        expect(tracker.isActive()).toBe(false);
    });

    it('stays active until every execution settles', async () => {
        const tracker = createExecutionTracker();
        const first = deferred();
        const second = deferred();
        tracker.track(() => first.promise);
        tracker.track(() => second.promise);

        first.resolve();
        await first.promise;
        await Promise.resolve();
        expect(tracker.isActive()).toBe(true);

        second.resolve();
        await tracker.settled();
        expect(tracker.isActive()).toBe(false);
    });

    it('waits only for executions unfinished when settled() was called', async () => {
        const tracker = createExecutionTracker();
        const before = deferred();
        const after = deferred();
        tracker.track(() => before.promise);

        const settled = tracker.settled();
        tracker.track(() => after.promise);
        before.resolve();

        await expect(settled).resolves.toBeUndefined();
        expect(tracker.isActive()).toBe(true);
        after.resolve();
    });

    it('still settles, without rejecting, if an execution rejects', async () => {
        const tracker = createExecutionTracker();
        const d = deferred();
        tracker.track(() => d.promise);

        const settled = tracker.settled();
        d.reject(new Error('x'));

        await expect(settled).resolves.toBeUndefined();
        expect(tracker.isActive()).toBe(false);
    });
});
