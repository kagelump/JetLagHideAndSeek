import { useEffect, useState } from "react";

/**
 * Returns `value` debounced by `delay` milliseconds. The returned value only
 * updates after `delay` ms of inactivity on `value`.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);

    return debounced;
}
