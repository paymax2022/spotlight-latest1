// Estate Documents (Block 36) — types + dual mock/live api + constants.
import { mockAllowed } from '@/config/mockPolicy';
import { api } from '@/api/client';

export type DocumentCategory = 'general' | 'bylaws' | 'minutes' | 'finance' | 'notice' | 'form' | 'contract' | 'map';

export interface EstateDocument {
  id: string; estateId: string; title: string; category: DocumentCategory | string;
  fileUrl: string; uploadedBy: string; uploaderName?: string; restricted: boolean; createdAt: string;
}
export interface CreateDocumentInput { title: string; category: DocumentCategory; fileUrl: string; restricted?: boolean; }

// The /api/v1/estate/documents handlers are live and query real tables (restricted
// documents are filtered server-side for non-admins), so this defaults to live: a
// forgotten flag fails visibly instead of inventing documents. Set
// EXPO_PUBLIC_DOCUMENTS_USE_MOCK=true to force fixtures locally.
export const USE_MOCK = mockAllowed(process.env.EXPO_PUBLIC_DOCUMENTS_USE_MOCK, false);

// Documents are served by the resident-scoped frontend-web handler under
// /api/v1/estate/documents (GET list, POST create). The current resident's
// estate is derived SERVER-SIDE from the auth token
// (frontend-web/src/server/estate/resident.ts → getResidentContext), so the
// client never passes an estate ID.
export const DOCUMENTS_API_BASE = '/api/v1/estate/documents';

export const CATEGORY_META: Record<DocumentCategory, { label: string; icon: string }> = {
  general:  { label: 'General',  icon: 'File' },
  bylaws:   { label: 'Bye-laws', icon: 'Scale' },
  minutes:  { label: 'Minutes',  icon: 'FileText' },
  finance:  { label: 'Finance',  icon: 'FileSpreadsheet' },
  notice:   { label: 'Notices',  icon: 'FileWarning' },
  form:     { label: 'Forms',    icon: 'ClipboardList' },
  contract: { label: 'Contracts',icon: 'FileSignature' },
  map:      { label: 'Maps',     icon: 'Map' },
};

const H = 3_600_000, iso = (o: number) => new Date(Date.now() + o).toISOString();
const docs: EstateDocument[] = [
  { id: 'd1', estateId: 'est_amber_court', title: 'Estate Bye-laws (2026)', category: 'bylaws', fileUrl: 'https://example.com/bylaws.pdf', uploadedBy: 'admin', uploaderName: 'Estate Admin', restricted: false, createdAt: iso(-240 * H) },
  { id: 'd2', estateId: 'est_amber_court', title: 'Q1 Financial Report', category: 'finance', fileUrl: 'https://example.com/q1.pdf', uploadedBy: 'admin', uploaderName: 'Estate Admin', restricted: true, createdAt: iso(-120 * H) },
  { id: 'd3', estateId: 'est_amber_court', title: 'AGM Minutes — March', category: 'minutes', fileUrl: 'https://example.com/agm.pdf', uploadedBy: 'admin', uploaderName: 'Estate Admin', restricted: false, createdAt: iso(-72 * H) },
];
const latency = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// createDocument has a live route handler (admin-only), so fixture mode refuses loudly
// instead of reporting a document recorded that never reached the database — mirrors
// frontend-admin's crowdfundingAdminService.ts NOT_IN_FIXTURE_MODE pattern.
const notInFixtureMode = (action: string) =>
  new Error(`${action} is unavailable in fixture mode: this app will not report a write it did not perform. Set EXPO_PUBLIC_DOCUMENTS_USE_MOCK=false to send this against the live backend.`);

export async function listDocuments(): Promise<EstateDocument[]> {
  if (USE_MOCK) { await latency(); return docs.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)); }
  const { data } = await api.get<EstateDocument[]>(DOCUMENTS_API_BASE); return data;
}
export async function createDocument(input: CreateDocumentInput): Promise<EstateDocument> {
  if (USE_MOCK) throw notInFixtureMode('Adding a document');
  const { data } = await api.post<EstateDocument>(DOCUMENTS_API_BASE, input); return data;
}
