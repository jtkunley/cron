import { createSafeLogger } from '../createSafeLogger';
import type { CronLogger } from '../types';

function mockLogger() {
    return {
        info: vi.fn<CronLogger['info']>(),
        warn: vi.fn<CronLogger['warn']>(),
        error: vi.fn<CronLogger['error']>(),
    };
}

describe('createSafeLogger', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes calls through to the logger', () => {
        const logger = mockLogger();
        const log = createSafeLogger(logger);
        const error = new Error('x');

        log.info('started', { name: 'job' });
        log.warn('skipped', { name: 'job' });
        log.error('failed', error, { name: 'job' });

        expect(logger.info).toHaveBeenCalledWith('started', { name: 'job' });
        expect(logger.warn).toHaveBeenCalledWith('skipped', { name: 'job' });
        expect(logger.error).toHaveBeenCalledWith('failed', error, { name: 'job' });
    });

    it('converts a non-Error failure before passing it on', () => {
        const logger = mockLogger();

        createSafeLogger(logger).error('failed', 'boom', { name: 'job' });

        const [, logged] = logger.error.mock.calls[0]!;
        expect(logged).toBeInstanceOf(Error);
        expect(logged.message).toBe('boom');
        expect(logged.cause).toBe('boom');
    });

    it('swallows logger exceptions', () => {
        const fail = () => {
            throw new Error('logger');
        };
        const log = createSafeLogger({ info: fail, warn: fail, error: fail });

        expect(() => log.info('m', {})).not.toThrow();
        expect(() => log.warn('m', {})).not.toThrow();
        expect(() => log.error('m', new Error('x'), {})).not.toThrow();
    });

    it('swallows rejections from async logger methods', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const reject = () => Promise.reject(new Error('async logger'));
            // The misuse under test: async methods where the interface expects void ones.
            // eslint-disable-next-line @typescript-eslint/no-misused-promises
            const log = createSafeLogger({ info: reject, warn: reject, error: reject });

            log.info('m', {});
            log.warn('m', {});
            log.error('m', new Error('x'), {});
            await new Promise((resolve) => setImmediate(resolve));

            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    it('does nothing without a logger', () => {
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
            vi.spyOn(console, method).mockImplementation(() => {}),
        );
        const log = createSafeLogger(undefined);

        log.info('m', {});
        log.warn('m', {});
        log.error('m', new Error('x'), {});

        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
});
