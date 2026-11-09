import { getTasks } from 'node-cron';
import { scheduleTicks } from '../scheduleTicks';

describe('scheduleTicks', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: new Date(2026, 0, 1, 0, 0, 0, 0) });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('calls onTick on every tick until stopped', async () => {
        const onTick = vi.fn();
        const stop = scheduleTicks('* * * * * *', 'job', onTick);

        await vi.advanceTimersByTimeAsync(3000);
        expect(onTick).toHaveBeenCalledTimes(3);

        stop();
        await vi.advanceTimersByTimeAsync(3000);
        expect(onTick).toHaveBeenCalledTimes(3);
    });

    it('drops a tick node-cron delivers after stopping', async () => {
        const onTick = vi.fn();
        const stop = scheduleTicks('* * * * * *', 'job', onTick);

        // Fires node-cron's timer without flushing microtasks, so its tick is still on the way.
        vi.advanceTimersByTime(1000);
        stop();
        await vi.advanceTimersByTimeAsync(0);

        expect(onTick).not.toHaveBeenCalled();
    });

    it("removes its task from node-cron's registry when stopped", () => {
        const before = getTasks().size;

        const stop = scheduleTicks('* * * * * *', 'job', () => {});
        expect(getTasks().size).toBe(before + 1);

        stop();
        expect(getTasks().size).toBe(before);
    });
});
