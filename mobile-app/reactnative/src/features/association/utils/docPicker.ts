// ── Association — Document picker helper ──────────────────────────────────────
// Thin wrapper around expo-image-picker for membership document uploads, so the
// screen stays declarative and permission/cancel handling lives in one place.

import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export interface PickedFile {
  uri:       string;
  name:      string;
  sizeLabel: string;
}

function sizeLabel(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (status === 'granted') return true;
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (req.status === 'granted') return true;
  Alert.alert('Permission needed', 'Allow photo access in Settings to upload your documents.');
  return false;
}

/** Pick a single document/photo from the library. Returns null on cancel/denied. */
export async function pickDocument(): Promise<PickedFile | null> {
  try {
    if (!(await ensurePermission())) return null;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    return {
      uri: a.uri,
      name: a.fileName ?? `document-${Date.now()}.jpg`,
      sizeLabel: sizeLabel(a.fileSize),
    };
  } catch {
    Alert.alert('Couldn’t open photos', 'Something went wrong. Please try again.');
    return null;
  }
}
