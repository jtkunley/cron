import { resolveOptions } from '../resolveOptions';
import type { CronOptions } from '../types';

const run = () => Promise.resolve();
const base: CronOptions = { name: 'job', schedule: '* * * * *', run };

describe('resolveOptions', () => {
    it('applies the defaults', () => {
        expect(resolveOptions(base)).toEqual({
            name: 'job',
            schedule: '* * * * *',
            run,
            logger: undefined,
            onError: undefined,
            allowOverlap: false,
            waitForCompletionOnStop: true,
            runInContext: undefined,
        });
    });

    it('keeps the values given', () => {
        const logger = { info() {}, warn() {}, error() {} };
        const onError = () => {};
        const runInContext = (tick: () => Promise<void>) => tick();

        expect(
            resolveOptions({
                ...base,
                logger,
                onError,
                allowOverlap: true,
                waitForCompletionOnStop: false,
                runInContext,
            }),
        ).toMatchObject({
            logger,
            onError,
            allowOverlap: true,
            waitForCompletionOnStop: false,
            runInContext,
        });
    });

    it('returns a frozen copy that later changes to the options do not reach', () => {
        const options: CronOptions = { ...base };
        const resolved = resolveOptions(options);
        options.name = 'changed';
        options.allowOverlap = true;

        expect(Object.isFrozen(resolved)).toBe(true);
        expect(resolved.name).toBe('job');
        expect(resolved.allowOverlap).toBe(false);
    });

    it.each([
        ['options that are not an object', null, 'options must be an object'],
        ['a missing name', { schedule: '* * * * *', run }, 'name must be a string'],
        ['a missing schedule', { name: 'job', run }, 'schedule must be a string'],
        ['a missing run', { name: 'job', schedule: '* * * * *' }, 'run must be a function'],
        [
            'an onError that is not a function',
            { ...base, onError: 'x' },
            'onError must be a function',
        ],
        [
            'a runInContext that is not a function',
            { ...base, runInContext: 1 },
            'runInContext must be a function',
        ],
        [
            'an allowOverlap that is not a boolean',
            { ...base, allowOverlap: 'false' },
            'allowOverlap must be a boolean',
        ],
        [
            'a waitForCompletionOnStop that is not a boolean',
            { ...base, waitForCompletionOnStop: 0 },
            'waitForCompletionOnStop must be a boolean',
        ],
    ])('throws a TypeError for %s', (_case, options, message) => {
        expect(() => resolveOptions(options as unknown as CronOptions)).toThrow(
            new TypeError(`createCron: ${message}`),
        );
    });

    it("throws node-cron's error for a schedule it can't parse", () => {
        expect(() => resolveOptions({ ...base, schedule: '99 * * * *' })).toThrow(
            '99 is a invalid expression for minute',
        );
    });
});
