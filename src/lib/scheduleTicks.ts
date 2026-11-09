import { createTask } from 'node-cron';

/**
 * Calls `onTick` on every tick of `schedule` until the returned function is called.
 * The schedule must already be valid.
 *
 * Each call creates its own node-cron task and stopping destroys it. node-cron keeps every
 * task in a process-wide registry until it is destroyed, so a task kept for the job's lifetime
 * would never be freed, and node-cron's global `shutdown()` could kill it while the job still
 * reported itself started.
 */
export function scheduleTicks(schedule: string, name: string, onTick: () => void): () => void {
    let live = true;
    // node-cron delivers a tick a microtask after its timer fires, so a stop in between, which
    // may be followed by a restart, would otherwise let that tick through.
    const task = createTask(
        schedule,
        () => {
            if (live) onTick();
        },
        { name },
    );
    // A task with a function, unlike one with a file path, starts and stops synchronously, which
    // is why the `void | Promise<void>` returned by `start()` and `destroy()` is discarded.
    void task.start();

    return () => {
        live = false;
        void task.destroy();
    };
}
