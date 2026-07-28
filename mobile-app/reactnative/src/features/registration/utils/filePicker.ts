// ── Registration — file picker helper ────────────────────────────────────────
// Wraps expo-image-picker (photos / video) and expo-document-picker (any doc)
// so the field renderer stays declarative. Returns a PickedUpload ready for the
// multipart /api/registration/uploads endpoint, or null on cancel/denied.

import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { PickedUpload } from '../types/registration.types';

// Decide which picker to use from a field's `accept` hint (e.g. ".mp4,.mov").
export function pickerKindForAccept(accept?: string): 'image' | 'video' | 'document' {
  const a = (accept ?? '').toLowerCase();
  if (!a) return 'document';
  const onlyImages = /\.(jpg|jpeg|png|webp)/.test(a) && !/\.(mp4|mov|pdf|doc|ppt|mp3|wav|m4a)/.test(a);
  const onlyVideos = /\.(mp4|mov)/.test(a) && !/\.(jpg|jpeg|png|webp|pdf|doc|ppt|mp3|wav|m4a)/.test(a);
  if (onlyImages) return 'image';
  if (onlyVideos) return 'video';
  return 'document';
}

async function ensureLibraryPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (status === 'granted') return true;
  const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (req.status === 'granted') return true;
  Alert.alert('Permission needed', 'Allow photo access in Settings to attach files to your application.');
  return false;
}

function guessName(uri: string, fallbackExt: string): string {
  const last = uri.split('/').pop();
  if (last && last.includes('.')) return last;
  return `upload-${Date.now()}.${fallbackExt}`;
}

async function pickMedia(kind: 'image' | 'video'): Promise<PickedUpload | null> {
  if (!(await ensureLibraryPermission())) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === 'video' ? ['videos'] : ['images'],
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  const ext = kind === 'video' ? 'mp4' : 'jpg';
  return {
    uri: a.uri,
    name: a.fileName ?? guessName(a.uri, ext),
    mimeType: a.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
  };
}

async function pickDoc(accept?: string): Promise<PickedUpload | null> {
  // expo-document-picker takes MIME globs; map common extensions to a broad set.
  const a = (accept ?? '').toLowerCase();
  const types: string[] = [];
  if (/\.(jpg|jpeg|png|webp)/.test(a)) types.push('image/*');
  if (/\.(mp4|mov)/.test(a)) types.push('video/*');
  if (/\.(mp3|wav|m4a)/.test(a)) types.push('audio/*');
  if (/\.pdf/.test(a)) types.push('application/pdf');
  if (/\.(doc|docx)/.test(a)) types.push('application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  if (/\.(ppt|pptx)/.test(a)) types.push('application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  const result = await DocumentPicker.getDocumentAsync({
    type: types.length ? types : '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const f = result.assets[0];
  return {
    uri: f.uri,
    name: f.name ?? guessName(f.uri, 'bin'),
    mimeType: f.mimeType ?? 'application/octet-stream',
  };
}

// Pick a file appropriate to the field's accept hint. Returns null on cancel.
export async function pickFileForField(accept?: string): Promise<PickedUpload | null> {
  try {
    const kind = pickerKindForAccept(accept);
    if (kind === 'image' || kind === 'video') return await pickMedia(kind);
    return await pickDoc(accept);
  } catch {
    Alert.alert('Couldn’t open file picker', 'Something went wrong selecting a file. Please try again.');
    return null;
  }
}
