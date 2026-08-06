'use client';

import { useState, useEffect } from 'react';

/**
 * Network connection type
 * Based on navigator.connection.effectiveType
 */
export type NetworkType = '4g' | '3g' | '2g' | 'slow-2g' | 'unknown';

/**
 * Network status information
 */
export interface NetworkStatus {
  isOnline: boolean;
  type: NetworkType;
  effectiveType: NetworkType;
  downlink?: number; // Mbps
  rtt?: number; // Round-trip time in ms
  saveData: boolean; // User has enabled data saver mode
  isSlow: boolean; // Derived: 3g or slower
  isFast: boolean; // Derived: 4g
}

/**
 * Hook to detect network status and connection type
 *
 * Usage:
 * const network = useNetworkStatus();
 * if (network.isSlow) {
 *   // Show low-quality images, disable autoplay, etc
 * }
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: typeof navigator !== 'undefined' && navigator.onLine,
    type: 'unknown',
    effectiveType: 'unknown',
    saveData: false,
    isSlow: false,
    isFast: false,
  });

  useEffect(() => {
    // Get initial network status
    const updateNetworkStatus = () => {
      const isOnline = navigator.onLine;

      // Check if browser supports Network Information API
      const connection = (navigator as any).connection || (navigator as any).mozConnection;

      let type: NetworkType = 'unknown';
      let effectiveType: NetworkType = 'unknown';
      let downlink: number | undefined;
      let rtt: number | undefined;

      if (connection) {
        effectiveType = (connection.effectiveType || 'unknown') as NetworkType;
        type = (connection.type || 'unknown') as NetworkType;
        downlink = connection.downlink; // Mbps
        rtt = connection.rtt; // ms
      }

      const saveData = (navigator as any).connection?.saveData || false;
      const isSlow = !isOnline || ['slow-2g', '2g', '3g'].includes(effectiveType);
      const isFast = effectiveType === '4g';

      setStatus({
        isOnline,
        type,
        effectiveType,
        downlink,
        rtt,
        saveData,
        isSlow,
        isFast,
      });
    };

    updateNetworkStatus();

    // Listen for online/offline events
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Listen for connection changes (if supported)
    const connection = (navigator as any).connection || (navigator as any).mozConnection;
    if (connection) {
      connection.addEventListener('change', updateNetworkStatus);
    }

    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
      if (connection) {
        connection.removeEventListener('change', updateNetworkStatus);
      }
    };
  }, []);

  return status;
}

/**
 * Hook to detect if user has enabled data saver mode
 */
export function useSaveData(): boolean {
  const [saveData, setSaveData] = useState(false);

  useEffect(() => {
    const connection = (navigator as any).connection;
    setSaveData(connection?.saveData || false);

    const handleChange = () => {
      setSaveData(connection?.saveData || false);
    };

    if (connection) {
      connection.addEventListener('change', handleChange);
      return () => connection.removeEventListener('change', handleChange);
    }
  }, []);

  return saveData;
}

/**
 * Detect if connection is metered (mobile data)
 * Uses Battery API + Network API
 */
export function useMeteredConnection(): boolean {
  const [isMetered, setIsMetered] = useState(false);

  useEffect(() => {
    const connection = (navigator as any).connection;

    // iOS doesn't expose detailed info, assume mobile is metered
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      setIsMetered(true);
      return;
    }

    // Android: check if on mobile data
    if (connection) {
      const isMobileData = ['cellular', 'bluetooth', 'wifi'].includes(connection.type);
      setIsMetered(connection.type === 'cellular');

      const handleChange = () => {
        setIsMetered(connection.type === 'cellular');
      };

      connection.addEventListener('change', handleChange);
      return () => connection.removeEventListener('change', handleChange);
    }

    // Fallback: assume desktop is not metered
    setIsMetered(false);
  }, []);

  return isMetered;
}

/**
 * Estimator for download time
 * Based on effective type
 */
export function estimateDownloadTime(fileSizeKB: number, networkType: NetworkType): number {
  // Average speeds for each network type (Mbps)
  const speeds: Record<NetworkType, number> = {
    '4g': 10,
    '3g': 1,
    '2g': 0.4,
    'slow-2g': 0.1,
    unknown: 1, // Assume 3G
  };

  const speedMbps = speeds[networkType];
  const speedKBps = (speedMbps * 1000) / 8;
  return Math.ceil(fileSizeKB / speedKBps);
}

/**
 * Get network quality score (0-100)
 * Higher = better network
 */
export function getNetworkQualityScore(status: NetworkStatus): number {
  if (!status.isOnline) return 0;

  const typeScores: Record<NetworkType, number> = {
    '4g': 100,
    '3g': 60,
    '2g': 20,
    'slow-2g': 10,
    unknown: 50,
  };

  let score = typeScores[status.effectiveType];

  // Penalty for save data mode
  if (status.saveData) score -= 10;

  // Penalty for metered connection
  // (would need to pass it in to calculate)

  return Math.max(0, score);
}
