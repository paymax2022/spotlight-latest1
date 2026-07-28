/**
 * Shared cross-cutting core for the three vote engines.
 *
 * All three engines (v1 general, v2 bridge, open-mic) delegate their
 * cross-cutting money-safety concerns to this single core so idempotency,
 * fraud signalling, audit, and payment verification can never drift apart.
 * The domain tables stay separate — see docs/voting-engine-architecture.md.
 */
export * from './idempotency';
export * from './fraud';
export * from './audit';
export * from './payment';
