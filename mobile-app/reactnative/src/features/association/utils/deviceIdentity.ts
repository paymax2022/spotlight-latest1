// ── Association — This device's identity ──────────────────────────────────────

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import type { DeviceInput } from '../types/authoring.types';

/**
 * Describe the current device for `POST /me/devices`.
 *
 * The server is idempotent on (user, name, platform), so both fields MUST be
 * stable across launches — a name that varied per session (a timestamp, a
 * random id) would insert a new row every time the app opened and turn the
 * devices screen into an append-only log the member cannot clean up.
 */
export function describeThisDevice(): DeviceInput {
  const osName = Device.osName?.trim() || Platform.OS;
  const osVersion = Device.osVersion?.trim() ?? '';

  if (Platform.OS === 'web') {
    // The devices list renders a monitor icon for the exact string "Web".
    return { name: Device.deviceName?.trim() || `${osName} browser`, platform: 'Web' };
  }

  const name = Device.deviceName?.trim() || Device.modelName?.trim() || `${osName} device`;
  return { name, platform: osVersion ? `${osName} ${osVersion}` : String(osName) };
}
