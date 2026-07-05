// ── Marketplace feature — public barrel ──────────────────────────────────────
// The single import surface for the marketplace feature. Sibling domain agents
// (Sell, Transact, Trust/Account) should import types and the client from here.
//
//   import { mktGet, mktPost, newMktIdempotencyKey } from '@/features/marketplace';
//   import type { Order, OrderStatus, Listing } from '@/features/marketplace';

export * from './types';
export * from './constants';
export {
  MKT_BASE,
  MKT_USE_MOCK,
  MktApiError,
  deepCamel,
  deepSnake,
  mktGet,
  mktPost,
  mktPut,
  mktPatch,
  mktDelete,
  newMktIdempotencyKey,
} from './api/client';
export type { MktApiErrorBody } from './api/client';
export * as discoveryApi from './api/discovery';
export type { HomeRails } from './api/discovery';
