/**
 * Centralized error handling for registration API
 * Ensures consistent error messages and logging across all endpoints
 */

import { errorResponse } from '@/src/lib/api/responses';

export interface RegistrationErrorContext {
  endpoint: string;
  applicationId?: string;
  userId?: string;
  stepKey?: string;
  error: unknown;
}

export function handleRegistrationError(context: RegistrationErrorContext) {
  const { endpoint, applicationId, userId, stepKey, error } = context;

  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Log with full context for debugging
  console.error('[registration-error]', {
    endpoint,
    applicationId,
    userId,
    stepKey,
    message: errorMessage,
    stack: errorStack,
  });

  if (errorMessage === 'UNAUTHORIZED') {
    return errorResponse('Authentication required', 401);
  }

  if (errorMessage === 'Application not found.' || errorMessage === 'Application not found') {
    return errorResponse('Application not found', 404);
  }

  if (errorMessage === 'Forbidden') {
    return errorResponse('Forbidden', 403);
  }

  // Exact-match the input-guard strings the store deliberately throws — a
  // substring match (e.g. includes('required')) could catch a PostgREST
  // message like "null value … violates not-null constraint" and echo the
  // raw Postgres text to the client.
  const CLIENT_ERRORS = new Set([
    'Invalid application ID',
    'Step key is required',
    'Invalid step key.',
    'Values must be a non-empty object',
  ]);
  if (CLIENT_ERRORS.has(errorMessage)) {
    return errorResponse(errorMessage, 400);
  }

  // Default to 500 for unexpected errors — fixed text only; errorMessage may
  // carry PostgREST/fs internals and is already logged above.
  return errorResponse('Failed to process registration request', 500);
}

export function validateApplicationId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

export function validateStepKey(key: unknown): key is string {
  return typeof key === 'string' && key.trim().length > 0;
}

export function validateFormData(values: unknown): values is Record<string, unknown> {
  return typeof values === 'object' && values !== null && !Array.isArray(values);
}
