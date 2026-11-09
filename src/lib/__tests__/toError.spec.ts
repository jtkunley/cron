import { runInNewContext } from 'node:vm';
import { toError } from '../toError';

describe('toError', () => {
    it.each([
        ['an Error', new TypeError('x')],
        ['an Error from another realm', runInNewContext('new Error("vm")') as Error],
        ['an object inheriting from Error.prototype', Object.create(Error.prototype) as Error],
    ])('returns %s unchanged', (_case, error) => {
        expect(toError(error)).toBe(error);
    });

    it.each([
        ['a string', 'boom', 'boom'],
        ['a number', 42, '42'],
        ['an object with toString', { toString: () => 'custom' }, 'custom'],
        ['undefined', undefined, 'undefined'],
    ])(
        'wraps %s with String(value) as the message and the value as cause',
        (_case, value, message) => {
            const error = toError(value);

            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe(message);
            expect(error.cause).toBe(value);
        },
    );

    it.each([
        ['has no prototype', Object.create(null) as object],
        [
            'throws from toString',
            {
                toString() {
                    throw new Error('no');
                },
            },
        ],
        [
            'is a revoked Proxy',
            (() => {
                const { proxy, revoke } = Proxy.revocable({}, {});
                revoke();
                return proxy;
            })(),
        ],
    ])('still wraps a value that %s, keeping it as cause', (_case, value) => {
        const error = toError(value);

        expect(error.message).toBe('Non-Error failure value (string conversion failed)');
        expect(error.cause).toBe(value);
    });
});
