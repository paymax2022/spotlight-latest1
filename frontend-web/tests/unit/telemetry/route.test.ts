import { describe, it, expect } from 'vitest';
import { routeTemplate } from '@/src/features/telemetry/route';

describe('routeTemplate', () => {
  it('substitutes param values', () => {
    expect(routeTemplate('/orders/123', { id: '123' })).toBe('/orders/[id]');
  });
  it('keeps static paths', () => {
    expect(routeTemplate('/wallet', {})).toBe('/wallet');
    expect(routeTemplate('/', {})).toBe('/');
  });
  it('handles catch-all array params', () => {
    expect(routeTemplate('/docs/a/b', { slug: ['a', 'b'] })).toBe('/docs/[slug]/[slug]');
  });
  it('strips query and hash', () => {
    expect(routeTemplate('/wallet?x=1#top', {})).toBe('/wallet');
    expect(routeTemplate('/orders/9?token=abc', { id: '9' })).toBe('/orders/[id]');
  });
  it('refuses unmapped identifiers', () => {
    expect(routeTemplate('/orders/12345', {})).toBeNull();
    expect(routeTemplate('/u/3f2b8a1e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', {})).toBeNull();
    expect(routeTemplate('/u/jo@example.com', {})).toBeNull();
    expect(routeTemplate('/u/jo%40example.com', {})).toBeNull();
  });
});
