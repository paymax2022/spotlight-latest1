'use client';

import React from 'react';
import type { Notification, NotificationPreference } from '@/lib/compliance/notificationEngine';

/**
 * Notification item component
 */
export function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: Notification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'incident':
        return '🚨';
      case 'prediction':
        return '📈';
      case 'escalation':
        return '🔴';
      case 'resolution':
        return '✅';
      case 'report':
        return '📊';
      default:
        return '📬';
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'email':
        return '✉️';
      case 'slack':
        return '💬';
      case 'pagerduty':
        return '📟';
      case 'webhook':
        return '🔗';
      case 'sms':
        return '📱';
      default:
        return '📬';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'border-red-500 bg-red-50';
      case 'high':
        return 'border-orange-500 bg-orange-50';
      case 'medium':
        return 'border-yellow-500 bg-yellow-50';
      default:
        return 'border-blue-500 bg-blue-50';
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  return (
    <div
      className={`rounded-lg border-l-4 p-4 ${getPriorityColor(notification.priority)} ${
        notification.status === 'read' ? 'opacity-60' : ''
      }`}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{getCategoryIcon(notification.category)}</span>
            <h3 className="font-semibold text-gray-900">{notification.templateName}</h3>
            <span className="text-xs px-2 py-0.5 bg-white bg-opacity-60 rounded">
              {getChannelIcon(notification.channel)} {notification.channel}
            </span>
          </div>

          {notification.subject && (
            <p className="text-sm text-gray-700 mb-2">{notification.subject}</p>
          )}

          <p className="text-sm text-gray-600 line-clamp-2">{notification.body}</p>

          <p className="text-xs text-gray-500 mt-2">{formatTime(notification.createdAt)}</p>
        </div>

        {notification.status !== 'read' && (
          <div className="flex gap-2 ml-4">
            <button
              onClick={() => onMarkRead(notification.id)}
              className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 font-semibold"
            >
              Mark Read
            </button>
            <button
              onClick={() => onDelete(notification.id)}
              className="px-2 py-1 bg-gray-300 text-gray-900 rounded text-xs hover:bg-gray-400 font-semibold"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {notification.failureReason && (
        <div className="mt-2 p-2 bg-red-100 rounded text-xs text-red-900">
          Failed: {notification.failureReason} (Retry: {notification.retryCount}/{notification.maxRetries})
        </div>
      )}
    </div>
  );
}

/**
 * Notification preferences panel
 */
export function NotificationPreferencesPanel({
  preferences,
  onToggleChannel,
  onUpdateQuietHours,
  onUpdateFrequency,
}: {
  preferences: NotificationPreference | null;
  onToggleChannel: (channel: string) => void;
  onUpdateQuietHours: (enabled: boolean, start?: string, end?: string) => void;
  onUpdateFrequency: (frequency: string) => void;
}) {
  if (!preferences) {
    return <p className="text-gray-600">Loading preferences...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Channel Preferences */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Notification Channels</h3>
        <div className="space-y-3">
          {[
            { id: 'email', label: '✉️ Email', icon: '📧' },
            { id: 'slack', label: '💬 Slack', icon: '💬' },
            { id: 'pagerduty', label: '📟 PagerDuty', icon: '📟' },
            { id: 'webhook', label: '🔗 Webhook', icon: '🔗' },
            { id: 'sms', label: '📱 SMS', icon: '📱' },
          ].map((channel) => (
            <label key={channel.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
              <input
                type="checkbox"
                checked={preferences.channels[channel.id as keyof typeof preferences.channels] || false}
                onChange={() => onToggleChannel(channel.id)}
                className="w-4 h-4"
              />
              <span className="text-sm font-semibold text-gray-900">{channel.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Digest Frequency */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Digest Frequency</h3>
        <div className="space-y-2">
          {[
            { value: 'immediate', label: '⚡ Immediate (as they happen)' },
            { value: 'hourly', label: '⏱️ Hourly digest' },
            { value: 'daily', label: '📅 Daily digest' },
            { value: 'weekly', label: '📆 Weekly digest' },
          ].map((freq) => (
            <label key={freq.value} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
              <input
                type="radio"
                name="frequency"
                value={freq.value}
                checked={preferences.digest_frequency === freq.value}
                onChange={() => onUpdateFrequency(freq.value)}
                className="w-4 h-4"
              />
              <span className="text-sm font-semibold text-gray-900">{freq.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Quiet Hours */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-4">Quiet Hours</h3>
        <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 mb-3">
          <input
            type="checkbox"
            checked={preferences.quiet_hours?.enabled || false}
            onChange={(e) => onUpdateQuietHours(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm font-semibold text-gray-900">Enable quiet hours</span>
        </label>

        {preferences.quiet_hours?.enabled && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-semibold">Start Time</label>
              <input
                type="time"
                value={preferences.quiet_hours.start}
                onChange={(e) =>
                  onUpdateQuietHours(true, e.target.value, preferences.quiet_hours?.end)
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-semibold">End Time</label>
              <input
                type="time"
                value={preferences.quiet_hours.end}
                onChange={(e) =>
                  onUpdateQuietHours(true, preferences.quiet_hours?.start, e.target.value)
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>
        )}
      </div>

      {/* Escalation */}
      <div>
        <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
          <input
            type="checkbox"
            checked={preferences.escalation_enabled}
            className="w-4 h-4"
            disabled
          />
          <div>
            <p className="text-sm font-semibold text-gray-900">Critical alerts always bypass quiet hours</p>
            <p className="text-xs text-gray-600">Escalation and critical incidents ignored during quiet hours</p>
          </div>
        </label>
      </div>
    </div>
  );
}

/**
 * Notification statistics card
 */
export function NotificationStats({
  stats,
}: {
  stats: {
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    read: number;
    byChannel: Record<string, number>;
    byPriority: Record<string, number>;
  };
}) {
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Notification Statistics</h2>

      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-xs text-blue-600 font-semibold">Total</p>
          <p className="text-2xl font-bold text-blue-900">{stats.total}</p>
        </div>
        <div className="bg-yellow-50 rounded-lg p-4">
          <p className="text-xs text-yellow-600 font-semibold">Sent</p>
          <p className="text-2xl font-bold text-yellow-900">{stats.sent}</p>
        </div>
        <div className="bg-green-50 rounded-lg p-4">
          <p className="text-xs text-green-600 font-semibold">Delivered</p>
          <p className="text-2xl font-bold text-green-900">{stats.delivered}</p>
        </div>
        <div className="bg-orange-50 rounded-lg p-4">
          <p className="text-xs text-orange-600 font-semibold">Failed</p>
          <p className="text-2xl font-bold text-orange-900">{stats.failed}</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-4">
          <p className="text-xs text-purple-600 font-semibold">Read</p>
          <p className="text-2xl font-bold text-purple-900">{stats.read}</p>
        </div>
      </div>

      {/* By Channel */}
      <div className="mb-6">
        <p className="text-sm font-semibold text-gray-900 mb-3">By Channel</p>
        <div className="space-y-2">
          {Object.entries(stats.byChannel).map(([channel, count]) => (
            <div key={channel} className="flex justify-between items-center">
              <span className="text-sm text-gray-600 capitalize">{channel}</span>
              <span className="text-sm font-bold text-gray-900">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* By Priority */}
      <div>
        <p className="text-sm font-semibold text-gray-900 mb-3">By Priority</p>
        <div className="space-y-2">
          {Object.entries(stats.byPriority).map(([priority, count]) => (
            <div key={priority} className="flex justify-between items-center">
              <span className="text-sm text-gray-600 capitalize">{priority}</span>
              <span className="text-sm font-bold text-gray-900">{count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Notification center header
 */
export function NotificationCenterHeader({
  unreadCount,
  onMarkAllRead,
}: {
  unreadCount: number;
  onMarkAllRead: () => void;
}) {
  return (
    <div className="flex justify-between items-center mb-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Notification Center</h1>
        <p className="text-gray-600 mt-1">
          {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
        </p>
      </div>

      {unreadCount > 0 && (
        <button
          onClick={onMarkAllRead}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
        >
          Mark All Read
        </button>
      )}
    </div>
  );
}

/**
 * Notification template card
 */
export function TemplateCard({
  template,
  onDelete,
}: {
  template: any;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-4">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">{template.name}</h3>
          <p className="text-xs text-gray-600 mt-1">{template.description}</p>
        </div>
        <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-semibold capitalize">
          {template.category}
        </span>
      </div>

      <div className="mb-3">
        <p className="text-xs font-semibold text-gray-600 mb-2">Channels:</p>
        <div className="flex gap-2">
          {template.channels.map((channel: string) => (
            <span key={channel} className="px-2 py-1 bg-blue-100 text-blue-900 rounded text-xs">
              {channel}
            </span>
          ))}
        </div>
      </div>

      <button
        onClick={() => onDelete(template.id)}
        className="px-3 py-1 bg-red-100 text-red-900 rounded text-xs hover:bg-red-200 font-semibold"
      >
        Delete Template
      </button>
    </div>
  );
}
