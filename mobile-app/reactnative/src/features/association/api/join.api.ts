// ── Association — Join-variants API wrapper (B) ───────────────────────────────
// Mock-flagged code validation for invite + access codes.

import { api } from '@/api/client';
import { USE_MOCK } from '../constants/association.constants';
import { MOCK_ORGANISATIONS } from './association.mock';
import type { CodeKind, CodeValidation } from '../types/join.types';

const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

/**
 * Mock rules (case-insensitive):
 *  - "NMA2026"      → valid invite → NMA, Lagos State Chapter
 *  - "IKOYI"        → valid access → Ikoyi Estate Residents Association
 *  - "EXPIRED"      → expired
 *  - anything else  → invalid
 */
export async function validateCode(kind: CodeKind, raw: string): Promise<CodeValidation> {
  if (USE_MOCK) {
    await delay();
    const code = raw.trim().toUpperCase();
    const nma = MOCK_ORGANISATIONS.find((o) => o.acronym === 'NMA');
    const iera = MOCK_ORGANISATIONS.find((o) => o.acronym === 'IERA');

    if (code === 'EXPIRED') {
      return base(kind, { valid: false, expired: true, message: 'This code has expired. Ask your admin for a new one.' });
    }
    if (kind === 'INVITE' && code === 'NMA2026' && nma) {
      return base(kind, {
        valid: true, organisationId: nma.id, organisationName: nma.name, organisationAcronym: nma.acronym,
        chapterName: 'Lagos State Chapter', categoryLabel: 'Full member',
        message: `You’ve been invited to join ${nma.name} (Lagos State Chapter).`,
      });
    }
    if (kind === 'ACCESS' && code === 'IKOYI' && iera) {
      return base(kind, {
        valid: true, organisationId: iera.id, organisationName: iera.name, organisationAcronym: iera.acronym,
        chapterName: 'Main Estate',
        message: `Access code accepted for ${iera.name}.`,
      });
    }
    return base(kind, { valid: false, message: kind === 'INVITE' ? 'Invite code not recognised.' : 'Group access code not recognised.' });
  }

  const path = kind === 'INVITE' ? '/associations/invites/validate' : '/associations/access-codes/validate';
  const { data } = await api.post(path, { code: raw });
  return data;
}

function base(kind: CodeKind, over: Partial<CodeValidation> & Pick<CodeValidation, 'valid' | 'message'>): CodeValidation {
  return {
    kind,
    expired: false,
    organisationId: null,
    organisationName: null,
    organisationAcronym: null,
    chapterName: null,
    categoryLabel: null,
    ...over,
  };
}
