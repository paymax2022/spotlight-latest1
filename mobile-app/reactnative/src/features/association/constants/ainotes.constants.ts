// ── Association — AI note-taking constants (L) ────────────────────────────────

import { Colors } from '@/constants/colors';
import type { AiNoteStatus, AiNoteSource } from '../types/ainotes.types';

export const AI_STATUS_STYLE: Record<AiNoteStatus, { label: string; color: string; bg: string }> = {
  PROCESSING: { label: 'Processing', color: Colors.secondary, bg: Colors.iconBgBlue },
  READY:      { label: 'Ready for review', color: Colors.gold, bg: Colors.iconBgGold },
  APPROVED:   { label: 'Approved', color: Colors.primary, bg: Colors.iconBgPurple },
  PUBLISHED:  { label: 'Published', color: Colors.teal, bg: Colors.iconBgTeal },
  FAILED:     { label: 'Failed', color: Colors.error, bg: Colors.errorContainer },
};

export const AI_SOURCE_META: Record<AiNoteSource, { label: string; icon: string }> = {
  RECORD:     { label: 'Record audio',     icon: 'Mic' },
  AUDIO:      { label: 'Upload audio',     icon: 'FileAudio' },
  VIDEO:      { label: 'Upload video',     icon: 'FileVideo' },
  TRANSCRIPT: { label: 'Upload transcript', icon: 'FileText' },
};

/** Review tab segments. */
export const AI_REVIEW_SEGMENTS = [
  { value: 'summary',   label: 'Summary' },
  { value: 'minutes',   label: 'Minutes' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'actions',   label: 'Actions' },
  { value: 'people',    label: 'People' },
] as const;
