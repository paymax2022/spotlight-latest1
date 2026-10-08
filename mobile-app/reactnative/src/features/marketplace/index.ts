// (Sell, Transact, Trust/Account) should import types and the client from here.

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
