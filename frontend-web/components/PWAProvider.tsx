'use client';

import { ReactNode } from 'react';
import { useServiceWorkerUpdate, useInstallPrompt } from '@/hooks/useServiceWorker';

export function PWAProvider({ children }: { children: ReactNode }) {
  const { showUpdatePrompt, handleUpdate, handleDismiss } = useServiceWorkerUpdate();
  const { canInstall, handleInstall } = useInstallPrompt();

  return (
    <>
      {children}

      {/* Update Available Prompt */}
      {showUpdatePrompt && (
        <div className="fixed bottom-20 left-4 right-4 max-w-sm mx-auto bg-white rounded-lg shadow-lg border border-blue-200 p-4 z-50 animate-in slide-in-from-bottom-4">
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900">Update Available</h3>
            <p className="text-sm text-slate-600">
              A new version of Mock Exams is available. Update now to get the latest features and improvements.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleUpdate}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
              >
                Update
              </button>
              <button
                onClick={handleDismiss}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-900 py-2 px-4 rounded-lg text-sm font-medium transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install Prompt */}
      {canInstall && (
        <div className="fixed bottom-20 left-4 right-4 max-w-sm mx-auto bg-white rounded-lg shadow-lg border border-blue-200 p-4 z-50 animate-in slide-in-from-bottom-4">
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900">Install Mock Exams</h3>
            <p className="text-sm text-slate-600">
              Install our app for quick access and offline support. Get started in seconds.
            </p>
            <button
              onClick={handleInstall}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg text-sm font-medium transition-colors"
            >
              Install App
            </button>
          </div>
        </div>
      )}
    </>
  );
}
