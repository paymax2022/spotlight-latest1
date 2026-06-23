// ── Crowdfunding — Media picker helpers ──────────────────────────────────────
// Thin wrappers around expo-image-picker so screens stay declarative and
// permission / cancel / error handling lives in one place.

import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export interface PickedAsset {
  uri: string;
  width?: number;
  height?: number;
  fileName?: string | null;
  mimeType?: string | null;
}

export interface PickedDocument {
  uri: string;
  name: string;
  mimeType?: string | null;
  sizeLabel: string;        // human-readable, e.g. '240 KB'
}

type Kind = 'images' | 'videos';

async function ensureLibraryPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const { status, canAskAgain } = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (status === 'granted') return true;
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (req.status === 'granted') return true;
  if (!canAskAgain || req.status === 'denied') {
    Alert.alert(
      'Permission needed',
      'Allow photo access in Settings to add media to your campaign.',
    );
  }
  return false;
}

async function ensureCameraPermission(): Promise<boolean> {
  const { status } = await ImagePicker.getCameraPermissionsAsync();
  if (status === 'granted') return true;
  const req = await ImagePicker.requestCameraPermissionsAsync();
  if (req.status === 'granted') return true;
  Alert.alert('Permission needed', 'Allow camera access in Settings to take a photo.');
  return false;
}

/** Pick a single image (or video) from the library. Returns null on cancel/denied. */
export async function pickFromLibrary(opts?: { kind?: Kind; allowsEditing?: boolean; aspect?: [number, number] }): Promise<PickedAsset | null> {
  try {
    if (!(await ensureLibraryPermission())) return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: [opts?.kind ?? 'images'],
      allowsEditing: opts?.allowsEditing ?? true,
      aspect: opts?.aspect,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    return { uri: a.uri, width: a.width, height: a.height, fileName: a.fileName, mimeType: a.mimeType };
  } catch (e) {
    Alert.alert('Couldn’t open photos', 'Something went wrong selecting media. Please try again.');
    return null;
  }
}

/** Pick multiple images from the library (up to `limit`). Returns [] on cancel/denied. */
export async function pickMultipleFromLibrary(limit = 6): Promise<PickedAsset[]> {
  try {
    if (!(await ensureLibraryPermission())) return [];
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: limit,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return [];
    return result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height, fileName: a.fileName, mimeType: a.mimeType }));
  } catch {
    Alert.alert('Couldn’t open photos', 'Something went wrong selecting media. Please try again.');
    return [];
  }
}

function fileSizeLabel(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Pick a document (PDF/image) from the device. Returns null on cancel. */
export async function pickDocument(opts?: { types?: string[] }): Promise<PickedDocument | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: opts?.types ?? ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    return { uri: a.uri, name: a.name, mimeType: a.mimeType, sizeLabel: fileSizeLabel(a.size) };
  } catch {
    Alert.alert('Couldn’t open files', 'Something went wrong selecting a document. Please try again.');
    return null;
  }
}

/** Take a photo with the camera. Returns null on cancel/denied. */
export async function takePhoto(opts?: { allowsEditing?: boolean; aspect?: [number, number] }): Promise<PickedAsset | null> {
  try {
    if (!(await ensureCameraPermission())) return null;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: opts?.allowsEditing ?? true,
      aspect: opts?.aspect,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    return { uri: a.uri, width: a.width, height: a.height, fileName: a.fileName, mimeType: a.mimeType };
  } catch {
    Alert.alert('Couldn’t open camera', 'Something went wrong. Please try again.');
    return null;
  }
}
