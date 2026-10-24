// Pure query-string builder for the discovery endpoint. axios' default
// serialiser sends arrays as `key[]=a&key[]=b`, which the Go handler does not
// read; `cuisine_id` / `category_id` must be REPEATED (`k=a&k=b`).

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;

export function serializeQueryParams(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  const push = (k: string, v: string | number | boolean) =>
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const el of v) push(k, el);
    } else {
      push(k, v as string | number | boolean);
    }
  }
  return parts.join('&');
}
