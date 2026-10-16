import * as DocumentPicker from 'expo-document-picker';
import { KYB_PICKER_TYPES } from './kybFiles';
import type { KYBPickedFile } from './kybUpload';

/**
 * Pick one KYB document (PDF or photo). Uses the document picker rather than the
 * photo library because CAC certificates are very often PDFs, which the photo
 * library cannot surface. Returns null on cancel; a picker failure throws so the
 * caller can say so instead of silently doing nothing.
 */
export async function pickKYBDocument(): Promise<KYBPickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: KYB_PICKER_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  return { uri: a.uri, name: a.name, size: a.size ?? null };
}
