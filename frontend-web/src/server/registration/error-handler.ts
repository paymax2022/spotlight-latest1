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

  // Extract error details
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

  // Handle specific error types
  if (errorMessage === 'UNAUTHORIZED') {
    return errorResponse('Authentication required', 401);
  }

  if (errorMessage === 'Application not found.' || errorMessage === 'Application not found') {
    return errorResponse('Application not found', 404);
  }

  if (errorMessage === 'Forbidden') {
    return errorResponse('Forbidden', 403);
  }

  if (
    errorMessage.includes('Invalid application ID') ||
    errorMessage.includes('Invalid JSON') ||
    errorMessage.includes('Step key') ||
    errorMessage.includes('values are required') ||
    errorMessage.includes('required')
  ) {
    return errorResponse(errorMessage, 400);
  }

  // Default to 500 for unexpected errors
  return errorResponse(`Failed to process registration request: ${errorMessage}`, 500);
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
