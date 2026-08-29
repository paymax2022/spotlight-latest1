import { useEffect, useState } from 'react';

/**
 * `value` after it has stopped changing for `delayMs`.
 *
 * Search moved server-side when discovery was paged (the screen no longer holds
 * the list it would filter locally), so every keystroke would otherwise be a
 * round trip — and a stale one can land after a newer one. Debouncing the value
 * rather than the request keeps the query key stable, so react-query dedupes and
 * caches per settled term instead of per keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return settled;
}
