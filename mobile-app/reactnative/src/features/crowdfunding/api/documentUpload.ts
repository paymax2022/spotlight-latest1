import { api } from '@/api/client';

/**
 * Upload a supporting document and attach it to a campaign.
 *
 * Two hops on purpose, and in this order:
 *   1. the BYTES go to /api/crowdfunding/uploads/documents, which proxies them to
 *      R2 and returns a durable URL and the object key;
 *   2. that result is recorded against the campaign.
 *
 * The object therefore exists before any row points at it, so a failure between
 * the two leaves an orphaned object rather than a document row whose file is
 * missing — a list entry you cannot open is worse than an object nobody lists.
 *
 * Mirrors coverUpload.ts, which is the proven shape in this repo for getting a
 * picked file off the device: the web picker hands back a `blob:` URI that must be
 * turned back into real bytes, while native FormData streams a { uri, name, type }
 * descriptor itself.
 */
export interface DocumentUploadResult {
  url: string;
  storageKey: string;
  docType: 'pdf' | 'image';
  fileSize: number;
}

export interface AttachedDocument {
  id: string;
  label: string;
  type: 'pdf' | 'image';
  sizeLabel: string;
  verified: boolean;
  url: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function mimeFor(name: string, fallback?: string | null): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? fallback ?? 'application/octet-stream';
}

export async function uploadCampaignDocument(file: {
  uri: string;
  name: string;
  mimeType?: string | null;
}): Promise<DocumentUploadResult> {
  const type = mimeFor(file.name, file.mimeType);
  const form = new FormData();

  if (file.uri.startsWith('blob:') || file.uri.startsWith('data:')) {
    const blob = await (await fetch(file.uri)).blob();
    form.append('file', new File([blob], file.name, { type: blob.type || type }));
  } else {
    form.append('file', { uri: file.uri, name: file.name, type } as unknown as Blob);
  }

  const res = await api.post('/api/crowdfunding/uploads/documents', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const upload = (res?.data?.data ?? res?.data)?.upload as DocumentUploadResult | undefined;
  if (!upload?.url || !upload?.storageKey) throw new Error('Upload did not return a stored file');
  return upload;
}

export async function attachCampaignDocument(
  campaignId: string,
  label: string,
  upload: DocumentUploadResult,
): Promise<AttachedDocument> {
  const res = await api.post(`/api/v1/crowdfunding/campaigns/${campaignId}/documents`, {
    label,
    type: upload.docType,
    url: upload.url,
    storageKey: upload.storageKey,
    sizeBytes: upload.fileSize,
  });
  return (res?.data?.data ?? res?.data) as AttachedDocument;
}
