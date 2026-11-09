import { types } from 'util';

/** Returns an `Error` unchanged, and wraps anything else in one that keeps the value as its `cause`. */
export function toError(value: unknown): Error {
    if (isError(value)) return value;
    let message: string;
    try {
        message = String(value);
    } catch {
        // Objects without a prototype, or with a throwing `toString`, can't be converted.
        message = 'Non-Error failure value (string conversion failed)';
    }
    return new Error(message, { cause: value });
}

// `isNativeError` recognises errors from other realms, such as `vm` contexts, on every supported
// Node version; `instanceof` adds objects that only inherit from `Error.prototype`.
function isError(value: unknown): value is Error {
    try {
        return types.isNativeError(value) || value instanceof Error;
    } catch {
        // `instanceof` throws for a revoked Proxy, which is no Error.
        return false;
    }
}
