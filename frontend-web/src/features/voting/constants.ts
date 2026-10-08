// Voting constants now live in ./types (consolidated 2026-09 refactor).
// This shim preserves the '@/src/features/voting/constants' import surface —
// protected legacy services and golden-path specs import from this path.
export * from './types';
