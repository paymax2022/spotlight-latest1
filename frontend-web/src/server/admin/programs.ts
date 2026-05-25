import { randomUUID } from 'crypto';

export type AdminProgramStatus =
  | 'draft'
  | 'published'
  | 'active'
  | 'closed'
  | 'archived';

export interface AdminProgram {
  id: string;
  title: string;
  slug: string;
  programType: string;
  description: string;
  status: AdminProgramStatus;
  visibility: 'public' | 'private';
  startDate?: string;
  endDate?: string;
  registrationStartDate?: string;
  registrationEndDate?: string;
  applicationFeeNgn?: number;
  featuredOnWebsite: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
}

interface ProgramStore {
  programs: Map<string, AdminProgram>;
}

function now() {
  return new Date().toISOString();
}

function seedPrograms(): AdminProgram[] {
  const t = now();
  return [
    {
      id: randomUUID(),
      title: 'Spotlight Reality TV Show Season 1',
      slug: 'spotlight-reality-tv-show-season-1',
      programType: 'reality_tv',
      description: 'National reality TV talent discovery programme.',
      status: 'active',
      visibility: 'public',
      featuredOnWebsite: true,
      startDate: t,
      createdAt: t,
      updatedAt: t,
    },
    {
      id: randomUUID(),
      title: 'Spotlight STEM Innovation League 2026',
      slug: 'spotlight-stem-innovation-league-2026',
      programType: 'stem',
      description: 'School and independent innovator STEM competition.',
      status: 'published',
      visibility: 'public',
      featuredOnWebsite: true,
      createdAt: t,
      updatedAt: t,
    },
  ];
}

function getStore(): ProgramStore {
  const key = '__spotlightAdminProgramStore';
  const g = globalThis as unknown as Record<string, ProgramStore | undefined>;
  if (!g[key]) {
    const map = new Map<string, AdminProgram>();
    for (const p of seedPrograms()) map.set(p.id, p);
    g[key] = { programs: map };
  }
  return g[key] as ProgramStore;
}

export function listPrograms() {
  return Array.from(getStore().programs.values());
}

export function getProgram(id: string) {
  return getStore().programs.get(id) || null;
}

export function createProgram(input: Partial<AdminProgram>, actorId?: string) {
  const t = now();
  const program: AdminProgram = {
    id: randomUUID(),
    title: String(input.title || 'Untitled Program'),
    slug: String(input.slug || `program-${Date.now()}`),
    programType: String(input.programType || 'general'),
    description: String(input.description || ''),
    status: (input.status as AdminProgramStatus) || 'draft',
    visibility: input.visibility === 'private' ? 'private' : 'public',
    startDate: input.startDate,
    endDate: input.endDate,
    registrationStartDate: input.registrationStartDate,
    registrationEndDate: input.registrationEndDate,
    applicationFeeNgn: Number(input.applicationFeeNgn || 0),
    featuredOnWebsite: Boolean(input.featuredOnWebsite),
    createdAt: t,
    updatedAt: t,
    createdBy: actorId,
    updatedBy: actorId,
  };
  getStore().programs.set(program.id, program);
  return program;
}

export function updateProgram(id: string, patch: Partial<AdminProgram>, actorId?: string) {
  const current = getProgram(id);
  if (!current) return null;
  const updated: AdminProgram = {
    ...current,
    ...patch,
    status: (patch.status as AdminProgramStatus) || current.status,
    visibility: patch.visibility === 'private' ? 'private' : patch.visibility === 'public' ? 'public' : current.visibility,
    updatedAt: now(),
    updatedBy: actorId || current.updatedBy,
  };
  getStore().programs.set(id, updated);
  return updated;
}

