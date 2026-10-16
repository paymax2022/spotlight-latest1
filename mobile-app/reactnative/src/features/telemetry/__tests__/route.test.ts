import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeTemplate } from '../route.ts';

describe('routeTemplate', () => {
  test('replaces param values with [key]', () => {
    assert.equal(routeTemplate('/orders/123', { id: '123' }), '/orders/[id]');
  });
  test('static route unchanged', () => {
    assert.equal(routeTemplate('/crypto/assets', {}), '/crypto/assets');
  });
  test('strips query string', () => {
    assert.equal(routeTemplate('/crypto/assets?ref=abc', {}), '/crypto/assets');
  });
  test('array params', () => {
    assert.equal(routeTemplate('/docs/a', { slug: ['a'] }), '/docs/[slug]');
  });
  test('unmapped all-digit segment -> null', () => {
    assert.equal(routeTemplate('/orders/123', {}), null);
  });
  test('unmapped uuid -> null', () => {
    assert.equal(routeTemplate('/x/3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab', {}), null);
  });
  test('unmapped email -> null', () => {
    assert.equal(routeTemplate('/u/a@b.com', {}), null);
  });
});
