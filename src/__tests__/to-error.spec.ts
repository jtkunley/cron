import { describe, it, expect } from 'vitest';
import { toError } from '../to-error';

describe('toError', () => {
    it('returns an Error as it is', () => {
        const error = new TypeError('bad');

        expect(toError(error)).toBe(error);
    });

    it('wraps anything else in an Error, keeping it as the cause', () => {
        const reason = { code: 'E_PLAIN' };

        const error = toError(reason);

        expect(error).toEqual(new Error('[object Object]'));
        expect(error.cause).toBe(reason);
    });
});
