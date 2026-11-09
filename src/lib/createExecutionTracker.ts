export interface ExecutionTracker {
    /** Starts an execution, which must not reject, and counts it as active until it settles. */
    track(start: () => Promise<void>): void;
    /** Whether any tracked execution is unfinished. */
    isActive(): boolean;
    /** Settles once every execution unfinished right now has settled. Never rejects. */
    settled(): Promise<void>;
}

export function createExecutionTracker(): ExecutionTracker {
    const active = new Set<Promise<void>>();

    return {
        track(start) {
            // Registered before `start` runs, so the execution is active during its synchronous
            // part too, and a run that stops its own job is still waited for.
            let finish!: () => void;
            const execution = new Promise<void>((resolve) => {
                finish = resolve;
            });
            active.add(execution);
            const done = () => {
                active.delete(execution);
                finish();
            };
            void start().then(done, done);
        },

        isActive: () => active.size > 0,

        settled() {
            if (active.size === 0) return Promise.resolve();
            // A snapshot: executions started after this call don't extend the wait.
            return Promise.all([...active]).then(() => undefined);
        },
    };
}
