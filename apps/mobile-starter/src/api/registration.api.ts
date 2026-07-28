/**
 * Contest registration API client.
 *
 * - Photo upload: multipart POST to /api/registration/uploads (jpg/png/webp),
 *   returns a server-hosted previewUrl that is stored on the application.
 *   (The open-mic presign endpoint is audio/mp3 only and cannot be used for
 *   profile photos.)
 * - Application submit: handled in register.tsx via /api/registration/applications.
 */
import { api } from '@/api/client';

export interface RegistrationPhotoUpload {
  /** Server URL for the uploaded photo (used as photoUri in the application). */
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
}

type PickedAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

function guessName(asset: PickedAsset): string {
  if (asset.fileName) return asset.fileName;
  const ext = (asset.mimeType?.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
  return `registration-photo.${ext}`;
}

/**
 * Upload a locally-picked image to the registration upload endpoint.
 * Returns the persisted URL to attach to the application payload.
 */
export async function uploadRegistrationPhoto(asset: PickedAsset): Promise<RegistrationPhotoUpload> {
  const fileName = guessName(asset);
  const mimeType = asset.mimeType ?? 'image/jpeg';

  const form = new FormData();
  // React Native FormData file shape — cast to satisfy the web FormData typing.
  form.append('file', {
    uri: asset.uri,
    name: fileName,
    type: mimeType,
  } as unknown as Blob);

  const response = await api.post('/api/registration/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  const body = response.data ?? {};
  const upload = body.upload ?? body.data?.upload ?? body.data ?? body;
  const url = String(upload.previewUrl ?? upload.url ?? '');
  if (!url) {
    throw new Error('Upload succeeded but no photo URL was returned.');
  }
  return {
    url,
    fileName: String(upload.fileName ?? fileName),
    fileSize: Number(upload.fileSize ?? 0),
    mimeType: String(upload.mimeType ?? mimeType),
    storageKey: String(upload.storageKey ?? ''),
  };
}
