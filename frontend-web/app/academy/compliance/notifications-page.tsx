'use client';

import React, { useState } from 'react';
import {
  NotificationItem,
  NotificationPreferencesPanel,
  NotificationStats,
  NotificationCenterHeader,
  TemplateCard,
} from './notifications';
import {
  useNotifications,
  useNotificationPreferences,
  useNotificationStats,
  useNotificationTemplates,
} from '@/hooks/useNotificationEngine';

/**
 * Notification Center Page
 */
export default function NotificationCenterPage() {
  const [activeTab, setActiveTab] = useState<'inbox' | 'preferences' | 'templates' | 'stats'>('inbox');
  const [userId] = useState('current-user'); // In production, get from auth

  const notifications = useNotifications(userId);
  const preferences = useNotificationPreferences(userId);
  const stats = useNotificationStats();
  const templates = useNotificationTemplates();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <NotificationCenterHeader
            unreadCount={notifications.unread.length}
            onMarkAllRead={() => {
              notifications.unread.forEach((n) => notifications.markAsRead(n.id));
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8">
            {[
              { id: 'inbox', label: `Inbox (${notifications.unread.length})` },
              { id: 'preferences', label: 'Preferences' },
              { id: 'templates', label: `Templates (${templates.templates.length})` },
              { id: 'stats', label: 'Statistics' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-4 font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Inbox Tab */}
        {activeTab === 'inbox' && (
          <div className="space-y-4">
            {notifications.unread.length > 0 && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-4">Unread ({notifications.unread.length})</h2>
                <div className="space-y-3">
                  {notifications.unread.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      notification={notif}
                      onMarkRead={(id) => notifications.markAsRead(id)}
                      onDelete={(id) => notifications.deleteNotification(id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {notifications.notifications.filter((n) => n.status === 'read').length > 0 && (
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-4">Read</h2>
                <div className="space-y-3">
                  {notifications.notifications
                    .filter((n) => n.status === 'read')
                    .slice(0, 10)
                    .map((notif) => (
                      <NotificationItem
                        key={notif.id}
                        notification={notif}
                        onMarkRead={() => {}}
                        onDelete={(id) => notifications.deleteNotification(id)}
                      />
                    ))}
                </div>
              </div>
            )}

            {notifications.notifications.length === 0 && (
              <div className="text-center py-12 bg-green-50 rounded-lg">
                <p className="text-green-900 font-semibold">✓ All caught up!</p>
                <p className="text-sm text-green-800">No notifications to review</p>
              </div>
            )}
          </div>
        )}

        {/* Preferences Tab */}
        {activeTab === 'preferences' && (
          <div className="bg-white rounded-lg shadow-lg p-6 max-w-2xl">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Notification Preferences</h2>
            <NotificationPreferencesPanel
              preferences={preferences.preferences}
              onToggleChannel={(channel) => preferences.toggleChannel(channel as any)}
              onUpdateQuietHours={(enabled, start, end) => preferences.updateQuietHours(enabled, start, end)}
              onUpdateFrequency={(freq) => {
                if (preferences.preferences) {
                  preferences.updatePreferences({ digest_frequency: freq as any });
                }
              }}
            />
          </div>
        )}

        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Notification Templates</h2>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold">
                + Create Template
              </button>
            </div>

            {/* By Category */}
            {Object.entries(templates.byCategory).map(([category, templateList]) => (
              templateList.length > 0 && (
                <div key={category}>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 capitalize">{category}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {templateList.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        onDelete={(id) => templates.deleteTemplate(id)}
                      />
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        )}

        {/* Statistics Tab */}
        {activeTab === 'stats' && stats.stats && (
          <NotificationStats stats={stats.stats} />
        )}
      </div>
    </div>
  );
}
