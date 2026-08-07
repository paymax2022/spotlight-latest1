'use client';

import { useState, useCallback } from 'react';

/**
 * Passkey authentication (passwordless)
 * Uses WebAuthn for resident keys (synced across devices)
 *
 * Advantages over biometric:
 * - Works across devices (iCloud Keychain, Google Password Manager)
 * - No password to remember
 * - FIDO2 certified security
 * - Cross-platform support
 */

export interface PasskeyCredential {
  id: string;
  userId: string;
  publicKey: string;
  signCount: number;
  transports: string[];
  createdAt: number;
  lastUsed: number;
}

/**
 * Hook for passkey registration
 * Creates a new passkey on the user's device
 *
 * Usage:
 * const { register, isLoading, error } = usePasskeyRegister();
 * const result = await register('user@example.com', 'Display Name');
 */
export function usePasskeyRegister() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(
    async (
      userId: string,
      displayName: string
    ): Promise<{
      success: boolean;
      credentialId?: string;
      error?: string;
    }> => {
      if (!window.PublicKeyCredential) {
        return {
          success: false,
          error: 'Passkeys not supported on this device',
        };
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get registration options from server
        const optionsResponse = await fetch('/api/auth/passkey/register/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            displayName,
          }),
        });

        if (!optionsResponse.ok) {
          throw new Error('Failed to get registration options');
        }

        const options = await optionsResponse.json();

        // Convert buffer fields
        options.challenge = new Uint8Array(
          Buffer.from(options.challenge, 'base64')
        );
        if (options.user.id) {
          options.user.id = new Uint8Array(Buffer.from(options.user.id, 'base64'));
        }

        // Create credential
        const credential = (await navigator.credentials.create(options)) as
          | PublicKeyCredential
          | null;

        if (!credential) {
          throw new Error('Failed to create credential');
        }

        // Verify with server
        const verifyResponse = await fetch('/api/auth/passkey/register/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            credential: JSON.stringify(credential),
          }),
        });

        if (!verifyResponse.ok) {
          throw new Error('Failed to verify credential');
        }

        const result = await verifyResponse.json();

        return {
          success: true,
          credentialId: result.credentialId,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);

        return {
          success: false,
          error: errorMsg,
        };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { register, isLoading, error };
}

/**
 * Hook for passkey authentication
 * Authenticates using a previously registered passkey
 *
 * Usage:
 * const { authenticate, isLoading } = usePasskeyAuth();
 * const result = await authenticate('user@example.com');
 */
export function usePasskeyAuth() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticate = useCallback(
    async (userId: string): Promise<{
      success: boolean;
      token?: string;
      error?: string;
    }> => {
      if (!window.PublicKeyCredential) {
        return {
          success: false,
          error: 'Passkeys not supported on this device',
        };
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get authentication options
        const optionsResponse = await fetch('/api/auth/passkey/authenticate/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });

        if (!optionsResponse.ok) {
          throw new Error('Failed to get authentication options');
        }

        const options = await optionsResponse.json();

        // Convert buffer fields
        options.challenge = new Uint8Array(Buffer.from(options.challenge, 'base64'));
        if (options.allowCredentials) {
          options.allowCredentials = options.allowCredentials.map(
            (cred: { id: string; type: string }) => ({
              id: new Uint8Array(Buffer.from(cred.id, 'base64')),
              type: cred.type,
            })
          );
        }

        // Authenticate
        const assertion = (await navigator.credentials.get(options)) as
          | PublicKeyCredential
          | null;

        if (!assertion) {
          throw new Error('Authentication cancelled');
        }

        // Verify with server
        const verifyResponse = await fetch('/api/auth/passkey/authenticate/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            assertion: JSON.stringify(assertion),
          }),
        });

        if (!verifyResponse.ok) {
          throw new Error('Authentication failed');
        }

        const result = await verifyResponse.json();

        return {
          success: true,
          token: result.token,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);

        return {
          success: false,
          error: errorMsg,
        };
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return { authenticate, isLoading, error };
}

/**
 * Hook for managing passkeys
 * List, delete, and update passkeys
 */
export function usePasskeyManagement() {
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listCredentials = useCallback(async (userId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/passkey/credentials/${userId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch credentials');
      }

      const data = await response.json();
      setCredentials(data.credentials);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteCredential = useCallback(async (credentialId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/passkey/credentials/${credentialId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete credential');
      }

      setCredentials((prev) => prev.filter((c) => c.id !== credentialId));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const renameCredential = useCallback(async (credentialId: string, newName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/passkey/credentials/${credentialId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });

      if (!response.ok) {
        throw new Error('Failed to rename credential');
      }

      setCredentials((prev) =>
        prev.map((c) => (c.id === credentialId ? { ...c, publicKey: newName } : c))
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    credentials,
    isLoading,
    error,
    listCredentials,
    deleteCredential,
    renameCredential,
  };
}

/**
 * Detect if device supports conditional UI
 * Shows passkey button directly in input (iOS/Android)
 */
export async function supportsConditionalUI(): Promise<boolean> {
  if (!window.PublicKeyCredential) {
    return false;
  }

  try {
    const result = await PublicKeyCredential.isConditionalMediationAvailable?.();
    return result || false;
  } catch {
    return false;
  }
}

/**
 * Compare passwordless authentication methods
 */
export function compareAuthMethods(): {
  method: string;
  speed: string;
  security: string;
  crossDevice: string;
  userExperience: string;
}[] {
  return [
    {
      method: 'Biometric (Face ID/Fingerprint)',
      speed: '~1 second',
      security: 'Very High',
      crossDevice: 'Limited',
      userExperience: 'Seamless on device',
    },
    {
      method: 'Passkey (WebAuthn resident)',
      speed: '~2-3 seconds',
      security: 'Very High',
      crossDevice: 'Excellent (synced)',
      userExperience: 'Works on new devices',
    },
    {
      method: 'Password',
      speed: 'Variable',
      security: 'Medium',
      crossDevice: 'Excellent',
      userExperience: 'Error-prone',
    },
    {
      method: 'OTP (SMS/Email)',
      speed: '~30-60 seconds',
      security: 'High',
      crossDevice: 'Excellent',
      userExperience: 'Requires separate device',
    },
  ];
}
