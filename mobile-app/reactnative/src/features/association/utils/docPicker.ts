// ── Association — Document picker helper ──────────────────────────────────────
// Thin wrapper around expo-image-picker for membership document uploads, so the
// screen stays declarative and permission/cancel handling lives in one place.

import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export interface PickedFile {
  uri:       string;
  name:      string;
  sizeLabel: string;
  /** Present for files picked with `pickSpreadsheet` (needed for multipart). */
  mimeType?: string;
}

/** MIME types accepted by the bulk member import (.xlsx / .xls / .csv). */
const SPREADSHEET_TYPES = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

function mimeFromName(name: string): string {
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.xlsx$/i.test(name)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (/\.xls$/i.test(name)) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
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

/**
 * Pick a spreadsheet / CSV for the bulk member import. Uses
 * expo-document-picker (the photo library cannot surface .xlsx / .csv).
 * Returns null on cancel or error.
 */
export async function pickSpreadsheet(): Promise<PickedFile | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: SPREADSHEET_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const f = result.assets[0];
    const name = f.name ?? `members-${Date.now()}.csv`;
    return {
      uri: f.uri,
      name,
      sizeLabel: sizeLabel(f.size ?? undefined),
      mimeType: f.mimeType ?? mimeFromName(name),
    };
  } catch {
    Alert.alert('Couldn’t open the file picker', 'Something went wrong. Please try again.');
    return null;
  }
}
