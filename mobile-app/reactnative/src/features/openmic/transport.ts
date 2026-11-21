// Moving beat and song bytes on the device.
//
// The server decides *where* the song bytes go (`mode` in the presign answer),
// so the phone has to be able to speak both transports:
//
//   • `presigned` — raw mp3 as the request body, PUT to a signed Cloudflare R2
//     URL. A signed URL is not an API endpoint: it carries its own signature and
//     must NOT receive the Supabase bearer token or axios's JSON Content-Type.
//     Streaming it from a phone is what `uploadAsync` with BINARY_CONTENT does;
//     base64-ing a 30 MB track through JS would blow the memory budget.
//   • `direct` — multipart POST to our own route, which is how every local
//     checkout (no bucket) stores the file. The server re-validates the bytes
//     themselves, so the declared `contentType` here is only what the transport
//     puts on the part.
//
// The native module is `require`d lazily, exactly like
// `src/features/filmAcademy/api.ts`, so a web bundle never pulls it in and the
// pure modules in this feature stay loadable under `node --test`.

import { Platform } from 'react-native';
import { createSupabaseClient } from '@/lib/supabase';
import type { SongUploadTicket } from './api';
import { SONG_CONTENT_TYPE } from './constants';
import { mediaUrl } from './media';

/** A picked local file, ready for the transport. */
export interface LocalSongFile {
  uri: string;
  name: string;
  size: number;
}

export interface SavedBeat {
  /** `file://` uri on native; null on web, where the browser owns the download. */
  uri: string | null;
  filename: string;
}

async function sessionToken(refresh = false): Promise<string | null> {
  const supabase = createSupabaseClient();
  if (refresh) {
    const { data, error } = await supabase.auth.refreshSession();
    return error ? null : data.session?.access_token ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function requireLegacyFileSystem() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const FileSystem = require('expo-file-system/legacy') as typeof import('expo-file-system/legacy');
  return FileSystem;
}

function requireModernFileSystem() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-file-system') as typeof import('expo-file-system');
}

function safeName(value: string, fallback: string): string {
  const cleaned = String(value || '')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Store the beat on the device and hand it to the OS (iOS Files / Android
 * share sheet), because "download the beat so I can record over it" means the
 * file has to leave the app.
 */
export async function downloadBeat(url: string, suggestedName = 'official-beat'): Promise<SavedBeat> {
  const filename = safeName(suggestedName, 'official-beat') + '.mp3';

  if (Platform.OS === 'web') {
    // The reader already names the attachment when `?download=1` is set, so the
    // browser's own download is the honest path on web: no object URL to leak,
    // and the user gets the server's filename.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not download the beat (${response.status}).`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return { uri: null, filename };
  }

  const FileSystem = requireLegacyFileSystem();
  const directory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!directory) throw new Error('This device cannot store the beat file. Please try again.');
  const target = `${directory}${filename}`;
  try {
    await FileSystem.deleteAsync(target, { idempotent: true });
  } catch { /* a stale copy must not block the download */ }

  const result = await FileSystem.downloadAsync(url, target, {});
  if (result.status !== 200) {
    try {
      await FileSystem.deleteAsync(result.uri, { idempotent: true });
    } catch { /* the partial file is disposable */ }
    throw new Error(`Could not download the beat (${result.status}).`);
  }
  return { uri: result.uri, filename };
}

/**
 * Offer the saved beat to another app (voice recorder, DAW, Files). Returns
 * false when the platform has no share sheet, so the caller can fall back to
 * telling the user where the file is.
 */
export async function shareSavedBeat(uri: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sharing = require('expo-sharing') as typeof import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(uri, { mimeType: SONG_CONTENT_TYPE, dialogTitle: 'Save the official beat' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Size the picked file, which the presign request must declare (the server caps
 * at 50 MB before it ever sees a byte, then re-checks the real size on the way
 * in). Native reads the attribute directly; web has to materialise the blob.
 */
export async function statSongFile(uri: string, name: string): Promise<LocalSongFile> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read the selected file.');
    const blob = await response.blob();
    return { uri, name, size: blob.size };
  }
  const { File } = requireModernFileSystem();
  const file = new File(uri);
  const size = Number(file.size) || 0;
  if (size <= 0) throw new Error('The selected file is empty or unreadable on this device.');
  return { uri, name, size };
}

/**
 * Send the bytes for a song, in whichever transport the server issued.
 *
 * Throws with the server's own message when one is present: an eligibility 403
 * from the direct route means the window closed mid-upload, and the artist needs
 * to read that rather than "upload failed".
 */
export async function uploadSongBytes(ticket: SongUploadTicket, file: LocalSongFile): Promise<void> {
  // A direct-mode `uploadUrl` comes back root-relative (`/api/open-mic/uploads`)
  // and a presigned one is already absolute. Resolving it here — after
  // `getDevUrl()`'s localhost rewrite — is what lets a phone reach a Mac's dev
  // server, because `localhost` on a handset is the handset.
  const target = mediaUrl(ticket.uploadUrl);
  if (!target) throw new Error('The upload instructions came back incomplete. Please try again.');

  if (ticket.mode === 'direct') {
    const token = await sessionToken();
    if (!token) throw new Error('Sign in again to upload your song.');
    await postMultipartSong(target, ticket, file, token);
    return;
  }
  await putRawSongBytes(target, ticket, file);
}

async function putRawSongBytes(target: string, ticket: SongUploadTicket, file: LocalSongFile): Promise<void> {
  // Only the headers the signature was computed with. No Authorization, no
  // Content-Type other than the signed one: R2 rejects a PUT whose headers
  // drifted from the ones that went into the signature.
  const headers = { ...ticket.headers };

  if (Platform.OS === 'web') {
    const response = await fetch(target, {
      method: 'PUT',
      headers,
      body: await (await fetch(file.uri)).blob(),
    });
    if (!response.ok) throw new Error(`Storage rejected the song upload (${response.status}).`);
    return;
  }

  const FileSystem = requireLegacyFileSystem();
  const { FileSystemUploadType } = FileSystem;
  const result = await FileSystem.uploadAsync(target, file.uri, {
    uploadType: FileSystemUploadType.BINARY_CONTENT,
    httpMethod: 'PUT',
    headers,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Storage rejected the song upload (${result.status}).`);
  }
}

async function postMultipartSong(
  target: string,
  ticket: SongUploadTicket,
  file: LocalSongFile,
  token: string,
): Promise<void> {
  const fieldName = ticket.fieldName ?? 'file';
  const auth = { Authorization: `Bearer ${token}` };

  if (Platform.OS === 'web') {
    // RN's FormData descriptor stringifies to `[object Object]` under Expo web —
    // see `regUpload` in the registration client. A real Blob is the only shape
    // the server's multipart parser can read there.
    const form = new FormData();
    const blob = await (await fetch(file.uri)).blob();
    (form.append as (name: string, value: Blob, filename?: string) => void)(fieldName, blob, file.name);
    form.append('contestSlug', ticket.contestSlug);
    form.append('submissionId', ticket.submissionId);
    // No Content-Type: the browser must set it, multipart boundary included, and
    // the shared axios instance would pin it to application/json.
    let response = await fetch(target, { method: 'POST', body: form, headers: auth });
    if (response.status === 401) {
      const refreshed = await sessionToken(true);
      if (refreshed) {
        response = await fetch(target, {
          method: 'POST',
          body: form,
          headers: { Authorization: `Bearer ${refreshed}` },
        });
      }
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      throw new Error(
        typeof body?.error === 'string' && body.error.trim()
          ? body.error.trim()
          : `Song upload failed (${response.status}).`,
      );
    }
    return;
  }

  const FileSystem = requireLegacyFileSystem();
  const { FileSystemUploadType } = FileSystem;
  const options = (bearer: string) => ({
    uploadType: FileSystemUploadType.MULTIPART,
    httpMethod: 'POST' as const,
    fieldName,
    mimeType: SONG_CONTENT_TYPE,
    parameters: { contestSlug: ticket.contestSlug, submissionId: ticket.submissionId },
    headers: { Authorization: `Bearer ${bearer}` },
  });
  let result = await FileSystem.uploadAsync(target, file.uri, options(token));
  if (result.status === 401) {
    const refreshed = await sessionToken(true);
    if (refreshed) result = await FileSystem.uploadAsync(target, file.uri, options(refreshed));
  }
  if (result.status < 200 || result.status >= 300) {
    let message = `Song upload failed (${result.status}).`;
    try {
      const body = JSON.parse(String(result.body ?? '')) as { error?: unknown };
      if (typeof body?.error === 'string' && body.error.trim()) message = body.error.trim();
    } catch { /* a non-JSON body keeps the status message */ }
    throw new Error(message);
  }
}
