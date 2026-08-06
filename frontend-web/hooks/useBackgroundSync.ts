'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { getExamDatabase } from '@/lib/db/examDatabase';

/**
 * Sync status enum
 */
export enum SyncStatus {
  IDLE = 'idle',
  SYNCING = 'syncing',
  SUCCESS = 'success',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

/**
 * Sync event for notifications
 */
export interface SyncEvent {
  type: 'started' | 'success' | 'failed' | 'progress';
  itemsTotal?: number;
  itemsSynced?: number;
  error?: string;
}

/**
 * Hook for background sync of offline data
 *
 * Automatically syncs pending exam submissions when connection is restored
 */
export function useBackgroundSync(onEvent?: (event: SyncEvent) => void) {
  const network = useNetworkStatus();
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(SyncStatus.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [itemsToSync, setItemsToSync] = useState(0);
  const [itemsSynced, setItemsSynced] = useState(0);
  const isSyncingRef = useRef(false);

  // Check for pending syncs when coming online
  useEffect(() => {
    if (network.isOnline && syncStatus !== SyncStatus.SYNCING) {
      performSync();
    }
  }, [network.isOnline]);

  const performSync = useCallback(async () => {
    if (isSyncingRef.current) return; // Prevent concurrent syncs

    try {
      isSyncingRef.current = true;
      setSyncStatus(SyncStatus.SYNCING);
      setErrorMessage(null);

      const db = await getExamDatabase();
      const syncQueue = await db.getSyncQueue();

      if (syncQueue.length === 0) {
        setSyncStatus(SyncStatus.IDLE);
        isSyncingRef.current = false;
        return;
      }

      onEvent?.({
        type: 'started',
        itemsTotal: syncQueue.length,
      });

      setItemsToSync(syncQueue.length);
      setItemsSynced(0);

      let successCount = 0;
      let failureCount = 0;

      // Sync each item in queue
      for (const item of syncQueue) {
        try {
          let response;

          // Handle different sync actions
          if (item.action === 'save_progress') {
            response = await fetch('/api/mock-exams/progress', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.payload),
            });
          } else if (item.action === 'submit_exam') {
            response = await fetch('/api/mock-exams/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.payload),
            });
          }

          if (response?.ok) {
            // Remove from queue
            await db.removeSyncQueueItem(item.id);
            successCount++;
          } else {
            // Retry with exponential backoff
            const maxRetries = 3;
            if (item.retries < maxRetries) {
              await db.updateSyncQueueRetry(item.id, 'HTTP error');
            } else {
              await db.removeSyncQueueItem(item.id); // Give up after 3 retries
              failureCount++;
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';

          // Retry logic
          const maxRetries = 3;
          if (item.retries < maxRetries) {
            await db.updateSyncQueueRetry(item.id, errorMsg);
          } else {
            await db.removeSyncQueueItem(item.id);
            failureCount++;
          }
        }

        const synced = successCount + failureCount;
        setItemsSynced(synced);

        onEvent?.({
          type: 'progress',
          itemsTotal: syncQueue.length,
          itemsSynced: synced,
        });
      }

      if (failureCount === 0) {
        setSyncStatus(SyncStatus.SUCCESS);
        onEvent?.({
          type: 'success',
          itemsTotal: successCount,
        });
      } else {
        setSyncStatus(SyncStatus.FAILED);
        setErrorMessage(`Failed to sync ${failureCount} items`);
        onEvent?.({
          type: 'failed',
          error: `${failureCount} items failed to sync`,
        });
      }

      // Reset status after 3 seconds
      setTimeout(() => {
        setSyncStatus(SyncStatus.IDLE);
      }, 3000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setSyncStatus(SyncStatus.FAILED);
      setErrorMessage(errorMsg);
      onEvent?.({
        type: 'failed',
        error: errorMsg,
      });
    } finally {
      isSyncingRef.current = false;
    }
  }, [onEvent]);

  const manualSync = useCallback(() => {
    if (network.isOnline) {
      performSync();
    } else {
      setErrorMessage('Cannot sync while offline');
    }
  }, [network.isOnline, performSync]);

  return {
    syncStatus,
    errorMessage,
    itemsToSync,
    itemsSynced,
    isOnline: network.isOnline,
    manualSync,
    performSync,
  };
}

/**
 * Hook to queue offline submissions
 * Stores submission in IndexedDB for syncing when online
 */
export function useOfflineQueue() {
  const network = useNetworkStatus();
  const [queueCount, setQueueCount] = useState(0);

  // Update queue count on mount and when online status changes
  useEffect(() => {
    updateQueueCount();
  }, [network.isOnline]);

  const updateQueueCount = async () => {
    try {
      const db = await getExamDatabase();
      const queue = await db.getSyncQueue();
      setQueueCount(queue.length);
    } catch (error) {
      console.error('Error reading sync queue:', error);
    }
  };

  const addToQueue = useCallback(
    async (attemptId: string, action: 'save_progress' | 'submit_exam', payload: any) => {
      try {
        const db = await getExamDatabase();
        await db.queueSync(attemptId, action, payload);
        await updateQueueCount();
        return true;
      } catch (error) {
        console.error('Error adding to sync queue:', error);
        return false;
      }
    },
    []
  );

  const clearQueue = useCallback(async () => {
    try {
      const db = await getExamDatabase();
      const queue = await db.getSyncQueue();
      for (const item of queue) {
        await db.removeSyncQueueItem(item.id);
      }
      setQueueCount(0);
    } catch (error) {
      console.error('Error clearing sync queue:', error);
    }
  }, []);

  return {
    queueCount,
    hasOfflineQueue: queueCount > 0,
    addToQueue,
    clearQueue,
    updateQueueCount,
  };
}

/**
 * Hook for sync status notifications
 * Shows user-friendly messages during sync
 */
export function useSyncNotification() {
  const [notification, setNotification] = useState<{
    message: string;
    type: 'info' | 'success' | 'error' | 'progress';
    visible: boolean;
  } | null>(null);

  const showNotification = useCallback(
    (message: string, type: 'info' | 'success' | 'error' | 'progress' = 'info', duration = 3000) => {
      setNotification({ message, type, visible: true });

      if (duration > 0) {
        setTimeout(() => {
          setNotification(null);
        }, duration);
      }
    },
    []
  );

  const hideNotification = useCallback(() => {
    setNotification(null);
  }, []);

  return {
    notification,
    showNotification,
    hideNotification,
  };
}

/**
 * Register background sync with Service Worker (if available)
 * More efficient than polling, but less widely supported
 */
export function useServiceWorkerSync() {
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      setIsSupported(true);

      navigator.serviceWorker.ready.then((registration) => {
        // Attempt to register background sync
        registration.sync.register('exam-sync').catch((err) => {
          console.warn('Background sync registration failed:', err);
        });
      });
    }
  }, []);

  return { isSupported };
}
