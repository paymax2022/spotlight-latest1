import { randomUUID } from 'crypto';

export interface CmsPage {
  id: string;
  title: string;
  slug: string;
  contentType: 'page' | 'blog' | 'announcement' | 'winner_update';
  excerpt?: string;
  body: string;
  seoTitle?: string;
  seoDescription?: string;
  status: 'draft' | 'published' | 'archived';
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

interface CmsStore {
  pages: Map<string, CmsPage>;
}

function now() {
  return new Date().toISOString();
}

function getStore(): CmsStore {
  const key = '__spotlightAdminCmsStore';
  const g = globalThis as unknown as Record<string, CmsStore | undefined>;
  if (!g[key]) {
    const t = now();
    const page: CmsPage = {
      id: randomUUID(),
      title: 'Spotlight Open Mic Winner Update',
      slug: 'open-mic-winner-update',
      contentType: 'winner_update',
      excerpt: 'Monthly winner announcement and next steps.',
      body: 'Winner content goes here.',
      status: 'draft',
      createdAt: t,
      updatedAt: t,
    };
    g[key] = { pages: new Map([[page.id, page]]) };
  }
  return g[key] as CmsStore;
}

export function listCmsPages() {
  return Array.from(getStore().pages.values());
}

export function createCmsPage(input: Partial<CmsPage>, actorId?: string) {
  const t = now();
  const page: CmsPage = {
    id: randomUUID(),
    title: String(input.title || 'Untitled Page'),
    slug: String(input.slug || `page-${Date.now()}`),
    contentType: input.contentType || 'page',
    excerpt: input.excerpt,
    body: String(input.body || ''),
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    status: input.status || 'draft',
    publishedAt: input.status === 'published' ? t : undefined,
    createdAt: t,
    updatedAt: t,
    createdBy: actorId,
    updatedBy: actorId,
  };
  getStore().pages.set(page.id, page);
  return page;
}

export function updateCmsPage(id: string, patch: Partial<CmsPage>, actorId?: string) {
  const current = getStore().pages.get(id);
  if (!current) return null;
  const nextStatus = patch.status || current.status;
  const updated: CmsPage = {
    ...current,
    ...patch,
    status: nextStatus,
    publishedAt: nextStatus === 'published' ? patch.publishedAt || current.publishedAt || now() : current.publishedAt,
    updatedAt: now(),
    updatedBy: actorId || current.updatedBy,
  };
  getStore().pages.set(id, updated);
  return updated;
}

