// ── Store picture upload (logo, banner, dish photo) ─────────────────────────
// Same shape as the KYB document upload, because the file never travels through our API:
//   1. Ask the backend for a short-lived presigned PUT URL. It chooses the object key —
//      the client cannot pick where the image lands.
//   2. PUT the image straight to R2 with the exact Content-Type the backend bound into the
//      signature.
//   3. The caller saves the returned key as logoUrl / bannerUrl / imageUrl through the
//      normal update; reads then return a short-lived signed URL.
//
// The PUT uses plain `fetch`, NOT the app's axios client: that client attaches the user's
// Supabase bearer token to every request, and sending it to a third-party host would leak
// the session. The presigned URL carries its own authorisation.

import * as ImagePicker from 'expo-image-picker';
import { presignStoreImage, USE_MOCK } from './api';
import {
  STORE_IMAGE_MAX_BYTES, storeImageContentType, storeImageFileName, storeImageProblem,
  type StoreImageKind,
} from './storeImages';

export interface PickedStoreImage {
  uri: string;
  name: string;
  size?: number | null;
}

/** Which step failed, so the owner (and Sentry) can tell them apart. */
export type StoreImageStep = 'permission' | 'validate' | 'read-file' | 'upload';

export class StoreImageError extends Error {
  step: StoreImageStep;
  status?: number;
  constructor(step: StoreImageStep, message: string, status?: number) {
    super(message);
    this.name = 'StoreImageError';
    this.step = step;
    this.status = status;
  }
}

/**
 * Let the owner choose a picture from their library, cropped to the shape it will be shown
 * in (square for a logo and for a dish photo, 16:9 for a banner). Returns null on cancel.
 * Throws StoreImageError for a denied permission or a picture we can't accept, with
 * wording for the owner.
 */
export async function pickStoreImage(kind: StoreImageKind): Promise<PickedStoreImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new StoreImageError('permission', 'Allow photo access in your phone settings to choose a picture.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: kind === 'banner' ? [16, 9] : [1, 1],
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.length) return null;

  const a = result.assets[0];
  const name = storeImageFileName({ uri: a.uri, fileName: a.fileName, mimeType: a.mimeType }, kind);
  if (!name) throw new StoreImageError('validate', 'Choose a PNG, JPG or WEBP picture.');
  const problem = storeImageProblem({ name, size: a.fileSize });
  if (problem) throw new StoreImageError('validate', problem);
  return { uri: a.uri, name, size: a.fileSize ?? null };
}

/**
 * Upload a picked image for the outlet and return the object key to save as logoUrl /
 * bannerUrl. Throws StoreImageUploadsUnavailableError (from presignStoreImage) when the
 * server can't sign uploads, and StoreImageError for every failure after that point.
 */
export async function uploadStoreImage(
  outletId: string, kind: StoreImageKind, file: PickedStoreImage,
): Promise<string> {
  const contentType = storeImageContentType(file.name);
  if (!contentType) throw new StoreImageError('validate', 'Choose a PNG, JPG or WEBP picture.');

  if (USE_MOCK) {
    // Offline demo: nothing to upload to. Keep the local picture so the screen shows it.
    return file.uri;
  }

  const presigned = await presignStoreImage(outletId, kind, file.name, contentType);

  let blob: Blob;
  try {
    blob = await (await fetch(file.uri)).blob();
  } catch {
    throw new StoreImageError('read-file', "We couldn't read that picture. Choose it again.");
  }
  // A zero-byte blob uploads "successfully" and then shows customers nothing; the picker's
  // reported size can also be missing or wrong, so check the real bytes.
  if (!blob.size) throw new StoreImageError('read-file', 'That picture looks empty. Choose a different one.');
  if (blob.size > STORE_IMAGE_MAX_BYTES) {
    throw new StoreImageError('validate', `That picture is too large. Keep it under ${STORE_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`);
  }

  let put: Response;
  try {
    put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      // The signature covers this header — a different value fails with 403.
      headers: { 'Content-Type': presigned.contentType },
      body: blob,
    });
  } catch {
    // fetch only rejects when no HTTP response arrived at all (DNS, TLS, reset, timeout).
    throw new StoreImageError('upload', "The picture couldn't be sent. Check your connection and try again.");
  }
  if (!put.ok) {
    throw new StoreImageError('upload', 'Our storage rejected the picture. Please try again.', put.status);
  }
  return presigned.objectKey;
}
