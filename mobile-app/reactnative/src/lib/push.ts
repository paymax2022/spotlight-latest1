// ── Push notifications (client) ──────────────────────────────────────────────
// Client-side delivery for visitor + election notifications:
//   • registers the device for push and sends the Expo push token to the backend
//   • shows incoming notifications in the foreground
//   • deep-links to the right screen when a notification is tapped
//
// expo-notifications is lazy-required (not top-level imported) because the
// package crashes at module-init time in Expo Go SDK 53+ — before any guard
// can run. All callers already check `isExpoGo` before touching the module.
//
// expo-router is lazy-required to break the require cycle:
//   push.ts → expo-router → _layout.tsx → push.ts

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '@/api/client';

// Remote push notifications were removed from Expo Go in SDK 53, and
// expo-notifications' native methods (getLastNotificationResponseAsync, listeners,
// etc.) are not available on web — treat both as unsupported for push.
const isExpoGo = Constants.executionEnvironment === 'storeClient';
const isPushUnsupported = isExpoGo || Platform.OS === 'web';

export type PushPayload = {
  type?: string;
  accessCodeId?: string;
  electionId?: string;
  /** Telemedicine appointment id (e.g. intake reminder deep-links). */
  appointmentId?: string;
  [k: string]: unknown;
};

// Returns the expo-notifications module only when safe to use (development
// build or production). Returns null in Expo Go to prevent the SDK-53 crash.
function N() {
  if (isPushUnsupported) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-notifications') as typeof import('expo-notifications');
}

// Wire up foreground banner/sound behaviour once, lazily, on first call.
let notificationHandlerSet = false;
function ensureNotificationHandler(): void {
  if (notificationHandlerSet) return;
  notificationHandlerSet = true;
  N()?.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList:   true,
      shouldPlaySound:  true,
      shouldSetBadge:   true,
    }),
  });
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await N()?.setNotificationChannelAsync('estate', {
    name:              'Estate alerts',
    importance:        (N()?.AndroidImportance.HIGH) ?? 4,
    vibrationPattern:  [0, 250, 250, 250],
  });
}

function getProjectId(): string | undefined {
  return (
    (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)
      ?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  );
}

/** Request permission and return the Expo push token (or null if unavailable). */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (isPushUnsupported) return null;
  try {
    if (!Device.isDevice) return null;
    await ensureAndroidChannel();

    const notif = N()!;
    const existing = await notif.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await notif.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    const projectId = getProjectId();
    const { data: token } = await notif.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return token ?? null;
  } catch {
    return null;
  }
}

/** Send the device token to the backend so it can target this resident. */
export async function sendPushTokenToBackend(token: string): Promise<void> {
  try {
    await api.post('/api/v1/notifications/push-token', { token, platform: Platform.OS });
  } catch {
    /* token registration is best-effort */
  }
}

/** Show a local notification (foreground / testing helper — works in Expo Go). */
export async function presentLocalNotification(
  title: string,
  body: string,
  data: PushPayload = {},
): Promise<void> {
  try {
    await N()?.scheduleNotificationAsync({ content: { title, body, data }, trigger: null });
  } catch {
    /* no-op if notifications unavailable */
  }
}

/** Route to the relevant screen based on a notification's data payload. */
export function routeFromPush(data: PushPayload | undefined): void {
  if (!data?.type) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { router } = require('expo-router') as { router: import('expo-router').Router };
  switch (data.type) {
    case 'visitor_arrival':
    case 'visitor_checked_in':
    case 'visitor_checked_out':
    case 'visitor_overstayed':
      if (data.accessCodeId) router.push(`/visitor/code/${data.accessCodeId}` as never);
      else router.push('/visitor/notifications' as never);
      break;
    case 'visitor_denied':
      router.push('/visitor/notifications' as never);
      break;
    case 'visitor_restriction':
    case 'visitor_access_restored':
      router.push('/visitor/restricted' as never);
      break;
    case 'election_live':
    case 'election_reminder':
    case 'election_results':
      if (data.electionId) router.push(`/election?id=${data.electionId}` as never);
      else router.push('/election/list' as never);
      break;
    case 'intake_reminder':
      // Deep-link straight into the Pre-Consult intake wizard / resume (M3/M14).
      if (data.appointmentId) {
        router.push(`/services/telemedicine/appointment/${data.appointmentId}/intake?resume=1` as never);
      } else {
        router.push('/services/telemedicine/appointments' as never);
      }
      break;
    default:
      break;
  }
}

/**
 * Registers for push, sends the token to the backend, and wires foreground +
 * tap listeners. Call once from the root layout when a user is signed in.
 */
export function usePushNotifications(enabled: boolean): void {
  const registered = useRef(false);

  useEffect(() => {
    if (isPushUnsupported || !enabled || registered.current) return;
    registered.current = true;

    ensureNotificationHandler();

    registerForPushNotificationsAsync().then((token) => {
      if (token) sendPushTokenToBackend(token);
    });

    const notif = N()!;

    // Tapped a notification (from background/quit) → deep-link.
    const responseSub = notif.addNotificationResponseReceivedListener((response) => {
      routeFromPush(response.notification.request.content.data as PushPayload);
    });

    // Handle the case where the app was launched by tapping a notification.
    notif.getLastNotificationResponseAsync().then((response) => {
      if (response) routeFromPush(response.notification.request.content.data as PushPayload);
    });

    return () => {
      responseSub.remove();
    };
  }, [enabled]);
}
