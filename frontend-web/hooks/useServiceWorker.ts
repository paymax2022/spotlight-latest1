'use client';

import { useEffect, useState } from 'react';

interface ServiceWorkerState {
  isRegistered: boolean;
  isUpdateAvailable: boolean;
  isOnline: boolean;
}

export function useServiceWorker(): ServiceWorkerState {
  const [state, setState] = useState<ServiceWorkerState>({
    isRegistered: false,
    isUpdateAvailable: false,
    isOnline: typeof navigator !== 'undefined' && navigator.onLine,
  });

  useEffect(() => {
    // Register service worker
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js', { scope: '/' })
        .then((registration) => {
          setState((prev) => ({ ...prev, isRegistered: true }));

          // Listen for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  // New service worker available
                  setState((prev) => ({ ...prev, isUpdateAvailable: true }));

                  // Notify user about update
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('sw-update-available', { detail: newWorker })
                    );
                  }
                }
              });
            }
          });
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    }

    // Listen for online/offline events
    const handleOnline = () => {
      setState((prev) => ({ ...prev, isOnline: true }));
    };

    const handleOffline = () => {
      setState((prev) => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return state;
}

/**
 * Prompt user to update service worker
 */
export function useServiceWorkerUpdate() {
  const [showUpdatePrompt, setShowUpdatePrompt] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handleUpdateAvailable = (event: Event) => {
      const customEvent = event as CustomEvent;
      setRegistration(customEvent.detail?.controller?.registration || null);
      setShowUpdatePrompt(true);
    };

    window.addEventListener('sw-update-available', handleUpdateAvailable);
    return () => window.removeEventListener('sw-update-available', handleUpdateAvailable);
  }, []);

  const handleUpdate = () => {
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  };

  const handleDismiss = () => {
    setShowUpdatePrompt(false);
  };

  return { showUpdatePrompt, handleUpdate, handleDismiss };
}

/**
 * Get install prompt and handle PWA install
 */
export function useInstallPrompt() {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = () => {
    if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then((choiceResult: { outcome: string }) => {
        if (choiceResult.outcome === 'accepted') {
          setIsInstalled(true);
        }
        setInstallPrompt(null);
      });
    }
  };

  return {
    canInstall: !!installPrompt && !isInstalled,
    isInstalled,
    handleInstall,
  };
}
