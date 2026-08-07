'use client';

import { useCallback, useEffect, useState } from 'react';
import { getNotificationEngine } from '@/lib/compliance/notificationEngine';
import type { Notification, NotificationPreference, NotificationChannel } from '@/lib/compliance/notificationEngine';

/**
 * Hook for sending notifications
 */
export function useSendNotification() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engine = getNotificationEngine();

  const sendNotification = useCallback(
    async (
      templateId: string,
      recipient: string,
      variables: Record<string, string>,
      channels?: NotificationChannel[]
    ) => {
      setIsLoading(true);
      setError(null);

      try {
        const notifications = await engine.sendNotification(templateId, recipient, variables, channels);
        return notifications;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to send notification';
        setError(errorMsg);
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [engine]
  );

  return {
    sendNotification,
    isLoading,
    error,
  };
}

/**
 * Hook for managing notifications
 */
export function useNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const engine = getNotificationEngine();

  /**
   * Fetch notifications
   */
  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/notifications${userId ? `?userId=${userId}` : ''}`);
      if (!response.ok) throw new Error('Failed to fetch notifications');

      const data = await response.json();
      setNotifications(data.notifications || []);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  /**
   * Mark as read
   */
  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await fetch(`/api/notifications/${notificationId}/read`, { method: 'POST' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, status: 'read' } : n))
      );
    } catch (err) {
      console.error('Failed to mark as read:', err);
    }
  }, []);

  /**
   * Delete notification
   */
  const deleteNotification = useCallback(async (notificationId: string) => {
    try {
      await fetch(`/api/notifications/${notificationId}`, { method: 'DELETE' });
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  return {
    notifications,
    isLoading,
    unread: notifications.filter((n) => n.status !== 'read'),
    byCategory: {
      incident: notifications.filter((n) => n.category === 'incident'),
      prediction: notifications.filter((n) => n.category === 'prediction'),
      escalation: notifications.filter((n) => n.category === 'escalation'),
      resolution: notifications.filter((n) => n.category === 'resolution'),
      report: notifications.filter((n) => n.category === 'report'),
    },
    markAsRead,
    deleteNotification,
    refresh: fetchNotifications,
  };
}

/**
 * Hook for notification preferences
 */
export function useNotificationPreferences(userId: string) {
  const [preferences, setPreferences] = useState<NotificationPreference | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Fetch preferences
   */
  const fetchPreferences = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/notifications/preferences/${userId}`);
      if (!response.ok) throw new Error('Failed to fetch preferences');

      const data = await response.json();
      setPreferences(data.preferences);
    } catch (err) {
      console.error('Failed to fetch preferences:', err);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  /**
   * Update preferences
   */
  const updatePreferences = useCallback(
    async (updates: Partial<NotificationPreference>) => {
      try {
        const response = await fetch(`/api/notifications/preferences/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (!response.ok) throw new Error('Failed to update preferences');

        const data = await response.json();
        setPreferences(data.preferences);
      } catch (err) {
        console.error('Failed to update preferences:', err);
      }
    },
    [userId]
  );

  /**
   * Toggle channel
   */
  const toggleChannel = useCallback(
    async (channel: NotificationChannel) => {
      if (!preferences) return;

      const updated = {
        ...preferences,
        channels: {
          ...preferences.channels,
          [channel]: !preferences.channels[channel],
        },
      };

      await updatePreferences(updated);
    },
    [preferences, updatePreferences]
  );

  /**
   * Update quiet hours
   */
  const updateQuietHours = useCallback(
    async (enabled: boolean, start?: string, end?: string) => {
      if (!preferences) return;

      const updated = {
        ...preferences,
        quiet_hours: {
          enabled,
          start: start || '22:00',
          end: end || '08:00',
        },
      };

      await updatePreferences(updated);
    },
    [preferences, updatePreferences]
  );

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  return {
    preferences,
    isLoading,
    updatePreferences,
    toggleChannel,
    updateQuietHours,
    refresh: fetchPreferences,
  };
}

/**
 * Hook for notification statistics
 */
export function useNotificationStats() {
  const [stats, setStats] = useState<{
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    read: number;
    byChannel: Record<string, number>;
    byPriority: Record<string, number>;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/notifications/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');

      const data = await response.json();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    refresh: fetchStats,
  };
}

/**
 * Hook for notification templates
 */
export function useNotificationTemplates() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/notifications/templates');
      if (!response.ok) throw new Error('Failed to fetch templates');

      const data = await response.json();
      setTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create custom template
   */
  const createTemplate = useCallback(
    async (template: any) => {
      try {
        const response = await fetch('/api/notifications/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(template),
        });

        if (!response.ok) throw new Error('Failed to create template');

        await fetchTemplates();
      } catch (err) {
        console.error('Failed to create template:', err);
      }
    },
    [fetchTemplates]
  );

  /**
   * Delete template
   */
  const deleteTemplate = useCallback(
    async (templateId: string) => {
      try {
        await fetch(`/api/notifications/templates/${templateId}`, { method: 'DELETE' });
        setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      } catch (err) {
        console.error('Failed to delete template:', err);
      }
    },
    []
  );

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  return {
    templates,
    isLoading,
    createTemplate,
    deleteTemplate,
    refresh: fetchTemplates,
    byCategory: {
      incident: templates.filter((t) => t.category === 'incident'),
      prediction: templates.filter((t) => t.category === 'prediction'),
      escalation: templates.filter((t) => t.category === 'escalation'),
      resolution: templates.filter((t) => t.category === 'resolution'),
      report: templates.filter((t) => t.category === 'report'),
    },
  };
}
