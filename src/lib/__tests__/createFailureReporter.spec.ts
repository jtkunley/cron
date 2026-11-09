import { createFailureReporter } from '../createFailureReporter';
import type { SafeLogger } from '../createSafeLogger';

function mockLog() {
    return {
        info: vi.fn<SafeLogger['info']>(),
        warn: vi.fn<SafeLogger['warn']>(),
        error: vi.fn<SafeLogger['error']>(),
    };
}

describe('createFailureReporter', () => {
    it('logs the failure, then passes the original value to onError', () => {
        const order: string[] = [];
        const log = mockLog();
        log.error.mockImplementation(() => order.push('log'));
        const onError = vi.fn((_error: unknown) => {
            order.push('hook');
        });
        const failure = { code: 1 };

        createFailureReporter('job', log, onError)(failure);

        expect(log.error).toHaveBeenCalledWith('Cron "job" run failed', failure, { name: 'job' });
        expect(onError).toHaveBeenCalledWith(failure);
        expect(onError.mock.calls[0]![0]).toBe(failure);
        expect(order).toEqual(['log', 'hook']);
    });

    it('only logs without onError', () => {
        const log = mockLog();

        expect(() => createFailureReporter('job', log, undefined)('x')).not.toThrow();
        expect(log.error).toHaveBeenCalledTimes(1);
    });

    it('logs a throwing onError separately, without calling it again', () => {
        const log = mockLog();
        const hookFailure = new Error('hook');
        const onError = vi.fn(() => {
            throw hookFailure;
        });

        expect(() => createFailureReporter('job', log, onError)('x')).not.toThrow();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(log.error).toHaveBeenLastCalledWith('Cron "job" onError hook failed', hookFailure, {
            name: 'job',
        });
    });
});
