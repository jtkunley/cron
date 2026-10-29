/** Returns `value` if it is an `Error`, or wraps it in one that keeps it as the `cause`. */
export function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value), { cause: value });
}
