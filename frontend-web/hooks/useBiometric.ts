'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * Biometric authentication types
 */
export type BiometricType = 'fingerprint' | 'face' | 'iris' | 'palm';

/**
 * Biometric availability status
 */
export interface BiometricCapability {
  isSupported: boolean;
  isAvailable: boolean;
  types: BiometricType[];
  isEnrolled: boolean;
}

/**
 * Biometric authentication result
 */
export interface BiometricAuthResult {
  success: boolean;
  type?: BiometricType;
  error?: string;
  retries?: number;
}

/**
 * Hook to detect biometric capabilities
 * Supports: Touch ID/Face ID (iOS), Fingerprint/Face Unlock (Android)
 */
export function useBiometricCapability(): BiometricCapability {
  const [capability, setCapability] = useState<BiometricCapability>({
    isSupported: false,
    isAvailable: false,
    types: [],
    isEnrolled: false,
  });

  useEffect(() => {
    checkBiometricCapability();
  }, []);

  const checkBiometricCapability = async () => {
    // Check if WebAuthn is available (modern biometric API)
    if (!window.PublicKeyCredential) {
      setCapability({
        isSupported: false,
        isAvailable: false,
        types: [],
        isEnrolled: false,
      });
      return;
    }

    try {
      // Check if platform authenticator is available (Touch ID, Face ID, Windows Hello, etc)
      const isAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();

      if (!isAvailable) {
        setCapability({
          isSupported: true,
          isAvailable: false,
          types: [],
          isEnrolled: false,
        });
        return;
      }

      // Detect biometric types
      const types: BiometricType[] = [];

      // iOS: Touch ID or Face ID
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS) {
        // Try to detect Face ID vs Touch ID (Face ID available on iPhone X+)
        const hasFaceID = /iPhone[XS]|iPhone [0-9]+/.test(navigator.userAgent);
        if (hasFaceID) {
          types.push('face');
        } else {
          types.push('fingerprint');
        }
      }
      // Android: Usually fingerprint, some have face unlock
      else if (/Android/.test(navigator.userAgent)) {
        types.push('fingerprint');
        // Some modern Android devices have face unlock
        types.push('face');
      }
      // Windows: Windows Hello (face or fingerprint)
      else if (/Windows/.test(navigator.userAgent)) {
        types.push('face');
        types.push('fingerprint');
      }
      // macOS: Touch ID
      else if (/Mac/.test(navigator.userAgent)) {
        types.push('fingerprint');
      }

      setCapability({
        isSupported: true,
        isAvailable: true,
        types,
        isEnrolled: true, // If available, assume enrolled
      });
    } catch (error) {
      console.error('Error checking biometric capability:', error);
      setCapability({
        isSupported: false,
        isAvailable: false,
        types: [],
        isEnrolled: false,
      });
    }
  };

  return capability;
}

/**
 * Hook for biometric authentication with WebAuthn
 *
 * Usage:
 * const { authenticate, isLoading, error } = useBiometricAuth();
 * const result = await authenticate('user@example.com');
 * if (result.success) {
 *   // Biometric authentication successful
 * }
 */
export function useBiometricAuth() {
  const capability = useBiometricCapability();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticate = useCallback(
    async (userId: string): Promise<BiometricAuthResult> => {
      if (!capability.isAvailable) {
        return {
          success: false,
          error: 'Biometric authentication not available',
        };
      }

      setIsLoading(true);
      setError(null);

      try {
        // Get authentication options from server
        const optionsResponse = await fetch('/api/auth/biometric/options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });

        if (!optionsResponse.ok) {
          throw new Error('Failed to get authentication options');
        }

        const options = await optionsResponse.json();

        // Perform biometric authentication
        const assertion = await navigator.credentials.get(options);

        if (!assertion) {
          return {
            success: false,
            error: 'Biometric authentication cancelled',
            retries: 0,
          };
        }

        // Verify credential with server
        const verifyResponse = await fetch('/api/auth/biometric/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            credential: assertion,
          }),
        });

        if (!verifyResponse.ok) {
          throw new Error('Biometric verification failed');
        }

        const result = await verifyResponse.json();

        return {
          success: result.success,
          type: capability.types[0],
          error: result.error,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);

        return {
          success: false,
          error: errorMessage,
          type: capability.types[0],
        };
      } finally {
        setIsLoading(false);
      }
    },
    [capability]
  );

  return {
    authenticate,
    isLoading,
    error,
    isAvailable: capability.isAvailable,
  };
}

/**
 * Hook for biometric exam security
 * Locks exam when biometric authentication fails or times out
 */
export function useBiometricLock() {
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const [lockStartTime, setLockStartTime] = useState<number | null>(null);
  const capability = useBiometricCapability();

  const lockExam = useCallback((reason: string, durationMinutes = 5) => {
    setIsLocked(true);
    setLockReason(reason);
    setLockStartTime(Date.now());

    // Auto-unlock after duration
    setTimeout(() => {
      setIsLocked(false);
      setLockReason(null);
      setLockStartTime(null);
    }, durationMinutes * 60 * 1000);
  }, []);

  const unlockExam = useCallback(() => {
    setIsLocked(false);
    setLockReason(null);
    setLockStartTime(null);
  }, []);

  const requestBiometricUnlock = useCallback(
    async (userId: string): Promise<boolean> => {
      if (!capability.isAvailable) {
        return false;
      }

      try {
        const { authenticate } = useBiometricAuth();
        const result = await authenticate(userId);

        if (result.success) {
          unlockExam();
          return true;
        }
        return false;
      } catch (error) {
        console.error('Biometric unlock failed:', error);
        return false;
      }
    },
    [capability, unlockExam]
  );

  const remainingLockTime = lockStartTime
    ? Math.max(0, 5 * 60 * 1000 - (Date.now() - lockStartTime))
    : 0;

  return {
    isLocked,
    lockReason,
    remainingLockTime,
    lockExam,
    unlockExam,
    requestBiometricUnlock,
  };
}

/**
 * Hook for biometric session timeout
 * Requires re-authentication after inactivity
 */
export function useBiometricSessionTimeout(timeoutMinutes = 15) {
  const [sessionActive, setSessionActive] = useState(true);
  const [lastActivityTime, setLastActivityTime] = useState(Date.now());
  const capability = useBiometricCapability();

  useEffect(() => {
    if (!capability.isAvailable) return;

    const handleActivity = () => {
      setLastActivityTime(Date.now());
      setSessionActive(true);
    };

    const checkTimeout = setInterval(() => {
      const inactiveTime = Date.now() - lastActivityTime;
      const timeoutMs = timeoutMinutes * 60 * 1000;

      if (inactiveTime > timeoutMs) {
        setSessionActive(false);
      }
    }, 60000); // Check every minute

    // Listen for user activity
    document.addEventListener('click', handleActivity);
    document.addEventListener('keydown', handleActivity);
    document.addEventListener('touchstart', handleActivity);

    return () => {
      clearInterval(checkTimeout);
      document.removeEventListener('click', handleActivity);
      document.removeEventListener('keydown', handleActivity);
      document.removeEventListener('touchstart', handleActivity);
    };
  }, [capability, timeoutMinutes, lastActivityTime]);

  const resetSession = useCallback(() => {
    setLastActivityTime(Date.now());
    setSessionActive(true);
  }, []);

  return {
    sessionActive,
    isSessionExpired: !sessionActive,
    resetSession,
    inactiveMinutes: Math.floor((Date.now() - lastActivityTime) / 60000),
  };
}

/**
 * Detect biometric fraud indicators
 * Flags suspicious authentication attempts
 */
export function detectBiometricFraud(
  previousAttempts: Array<{ timestamp: number; success: boolean }>
): {
  isSuspicious: boolean;
  reasons: string[];
  confidenceScore: number;
} {
  const reasons: string[] = [];
  let confidenceScore = 0;

  if (!previousAttempts || previousAttempts.length === 0) {
    return { isSuspicious: false, reasons: [], confidenceScore: 0 };
  }

  // Check for rapid repeated failures
  const recentAttempts = previousAttempts.slice(-5);
  const failedAttempts = recentAttempts.filter((a) => !a.success).length;

  if (failedAttempts >= 3) {
    reasons.push('Multiple failed biometric attempts');
    confidenceScore += 30;
  }

  // Check for attempts from different times of day (unusual pattern)
  const hours = new Set(
    recentAttempts.map((a) => new Date(a.timestamp).getHours())
  );
  if (hours.size > 3) {
    reasons.push('Unusual authentication time pattern');
    confidenceScore += 20;
  }

  // Check for too-frequent attempts (possible spoofing)
  const timeDiffs = [];
  for (let i = 1; i < recentAttempts.length; i++) {
    timeDiffs.push(recentAttempts[i].timestamp - recentAttempts[i - 1].timestamp);
  }

  const veryRapidAttempts = timeDiffs.filter((diff) => diff < 5000).length;
  if (veryRapidAttempts > 0) {
    reasons.push('Rapid successive authentication attempts');
    confidenceScore += 40;
  }

  return {
    isSuspicious: confidenceScore >= 50,
    reasons,
    confidenceScore: Math.min(100, confidenceScore),
  };
}
