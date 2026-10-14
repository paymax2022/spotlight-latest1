// Builds a privacy-safe route template ("/orders/[id]") from a concrete pathname.
// Anything that still looks like an identifier after param substitution is
// refused (null) so an unmapped id can never leave the browser.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function routeTemplate(
  pathname: string,
  params: Record<string, string | string[]>,
): string | null {
  const path = pathname.split('?')[0].split('#')[0];
  const byValue = new Map<string, string>();
  for (const [key, val] of Object.entries(params ?? {})) {
    for (const v of Array.isArray(val) ? val : [val]) {
      if (typeof v === 'string' && v !== '') {
        let decoded = v;
        try { decoded = decodeURIComponent(v); } catch { /* keep raw */ }
        byValue.set(v, key);
        byValue.set(decoded, key);
      }
    }
  }
  const out: string[] = [];
  for (const seg of path.split('/')) {
    let s = seg;
    try { s = decodeURIComponent(seg); } catch { /* keep raw */ }
    const key = seg === '' ? undefined : (byValue.get(seg) ?? byValue.get(s));
    if (key) { out.push(`[${key}]`); continue; }
    if (/^\d+$/.test(s) || UUID.test(s) || s.includes('@') || seg.includes('%40')) return null;
    out.push(seg);
  }
  return out.join('/') || '/';
}
