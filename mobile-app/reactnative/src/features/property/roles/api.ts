// ── Property roles — API (live by default; mock only via the property mock flag) ──
import { api } from '@/api/client';
import { mockAllowed } from '@/config/mockPolicy';
import type {
  RegisterRoleInput,
  RoleDocumentPresign,
  RoleProfile,
  UpdateRoleInput,
  UploadRoleDocumentInput,
} from './types';
import type { ProfessionalRole } from './requirements';

const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_PROPERTY_USE_MOCK, true);
const BASE = '/api/finance/property/roles';
const wait = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms));

const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
const TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf',
};

/** Thrown when the server has no R2 credentials (presign 503). Not retryable. */
export class RoleUploadsUnavailableError extends Error {
  constructor() {
    super('Document uploads are not configured on this server.');
    this.name = 'RoleUploadsUnavailableError';
  }
}

/** Thrown for a file type the backend will not sign. */
export class RoleDocumentTypeError extends Error {
  constructor() {
    super('Use a PNG, JPEG, WebP or PDF file.');
    this.name = 'RoleDocumentTypeError';
  }
}

export function contentTypeFor(fileName: string, mimeType?: string): string {
  if (mimeType && ALLOWED_CONTENT_TYPES.includes(mimeType)) return mimeType;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const t = TYPE_BY_EXT[ext];
  if (!t) throw new RoleDocumentTypeError();
  return t;
}

const unwrap = <T,>(res: { data?: { data?: T } & Record<string, unknown> }): T =>
  (res.data?.data ?? res.data) as T;

// Mock store (only when the flag allows mocks).
const mockProfiles = new Map<ProfessionalRole, RoleProfile>();

export async function listMyRoleProfiles(): Promise<RoleProfile[]> {
  if (USE_MOCK) {
    await wait();
    return [...mockProfiles.values()];
  }
  const res = await api.get(BASE);
  return unwrap<{ items: RoleProfile[] }>(res).items ?? [];
}

export async function registerRole(input: RegisterRoleInput): Promise<RoleProfile> {
  if (USE_MOCK) {
    await wait();
    const existing = mockProfiles.get(input.role);
    if (existing) return existing;
    const now = new Date().toISOString();
    const p: RoleProfile = {
      id: `mock-${input.role}`, userId: 'mock', role: input.role, status: 'draft',
      verificationStatus: 'unverified', displayName: input.displayName,
      details: input.details ?? {}, createdAt: now, updatedAt: now, documents: [],
    };
    mockProfiles.set(input.role, p);
    return p;
  }
  const res = await api.post(`${BASE}/${input.role}`, {
    displayName: input.displayName,
    details: input.details ?? {},
  });
  return unwrap<RoleProfile>(res);
}

export async function updateRoleProfile(role: ProfessionalRole, input: UpdateRoleInput): Promise<RoleProfile> {
  if (USE_MOCK) {
    await wait();
    const p = mockProfiles.get(role);
    if (!p) throw new Error('Role profile not found');
    const next = { ...p, ...input, details: { ...p.details, ...(input.details ?? {}) } } as RoleProfile;
    mockProfiles.set(role, next);
    return next;
  }
  const res = await api.patch(`${BASE}/${role}`, input);
  return unwrap<RoleProfile>(res);
}

export async function submitRoleForVerification(role: ProfessionalRole): Promise<RoleProfile> {
  if (USE_MOCK) {
    await wait();
    const p = mockProfiles.get(role);
    if (!p) throw new Error('Role profile not found');
    const next: RoleProfile = { ...p, verificationStatus: 'pending', status: 'active' };
    mockProfiles.set(role, next);
    return next;
  }
  const res = await api.post(`${BASE}/${role}/submit`);
  return unwrap<RoleProfile>(res);
}

async function presignDocument(role: ProfessionalRole, kind: string, contentType: string): Promise<RoleDocumentPresign> {
  try {
    const res = await api.post(`${BASE}/${role}/documents/presign`, { kind, contentType });
    return unwrap<RoleDocumentPresign>(res);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 503) throw new RoleUploadsUnavailableError();
    throw err;
  }
}

/** presign → PUT straight to R2 (plain fetch, no bearer token) → record. */
export async function uploadRoleDocument(role: ProfessionalRole, input: UploadRoleDocumentInput): Promise<RoleProfile> {
  const contentType = contentTypeFor(input.fileName, input.mimeType);
  if (USE_MOCK) {
    await wait();
    const p = mockProfiles.get(role);
    if (!p) throw new Error('Role profile not found');
    const next: RoleProfile = {
      ...p,
      documents: [...p.documents, { id: `doc-${Date.now()}`, kind: input.kind, storageKey: `mock/${input.fileName}`, createdAt: new Date().toISOString() }],
    };
    mockProfiles.set(role, next);
    return next;
  }
  const presigned = await presignDocument(role, input.kind, contentType);
  const blob = await (await fetch(input.localUri)).blob();
  const put = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': presigned.contentType },
    body: blob,
  });
  if (!put.ok) throw new Error(`Document upload failed (${put.status})`);
  const res = await api.post(`${BASE}/${role}/documents`, { kind: input.kind, storageKey: presigned.storageKey });
  return unwrap<RoleProfile>(res);
}
