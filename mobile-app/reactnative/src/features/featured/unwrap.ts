// List endpoints answer {"data": [...]}, but Go serialises a nil slice as
// {"data": null}. `res.data?.data ?? res.data` then returned the envelope object
// itself, and the screens' `data.map(...)` threw. A list call must always yield
// an array, whatever the body looks like.
export function unwrapList<T>(res: { data?: unknown }): T[] {
  const body = res?.data as { data?: unknown } | unknown[] | null | undefined;
  const inner = Array.isArray(body) ? body : (body as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}
