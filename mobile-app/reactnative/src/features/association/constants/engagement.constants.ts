// ── Association — Engagement constants ────────────────────────────────────────

import { Colors } from '@/constants/colors';
import type {
  TaskStatus, TaskPriority, MeetingMode, NotificationKind, DocCategory,
} from '../types/engagement.types';

export const TASK_STATUS_STYLE: Record<TaskStatus, { label: string; color: string; bg: string }> = {
  ASSIGNED:        { label: 'Assigned',       color: Colors.secondary, bg: Colors.iconBgBlue },
  ACCEPTED:        { label: 'Accepted',       color: Colors.secondary, bg: Colors.iconBgBlue },
  IN_PROGRESS:     { label: 'In progress',    color: Colors.primary,   bg: Colors.iconBgPurple },
  BLOCKED:         { label: 'Blocked',        color: Colors.error,     bg: Colors.errorContainer },
  AWAITING_REVIEW: { label: 'Awaiting review',color: Colors.gold,      bg: Colors.iconBgGold },
  COMPLETED:       { label: 'Completed',      color: Colors.teal,      bg: Colors.iconBgTeal },
  OVERDUE:         { label: 'Overdue',        color: Colors.error,     bg: Colors.errorContainer },
};

export const TASK_PRIORITY_STYLE: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  LOW:    { label: 'Low',    color: Colors.onSurfaceVariant, bg: Colors.surfaceContainerHigh },
  MEDIUM: { label: 'Medium', color: Colors.secondary,        bg: Colors.iconBgBlue },
  HIGH:   { label: 'High',   color: Colors.error,            bg: Colors.errorContainer },
};

export const MEETING_MODE_LABEL: Record<MeetingMode, string> = {
  PHYSICAL: 'In person',
  VIRTUAL:  'Virtual',
  HYBRID:   'Hybrid',
};

export const NOTIFICATION_ICON: Record<NotificationKind, string> = {
  membership:   'IdCard',
  payment:      'CreditCard',
  meeting:      'CalendarDays',
  task:         'ListTodo',
  announcement: 'Megaphone',
  document:     'FileText',
  admin:        'ShieldCheck',
};

export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  constitution: 'Constitution & bye-laws',
  minutes:      'Meeting minutes',
  financial:    'Financial reports',
  reports:      'Reports',
  certificates: 'Certificates',
  policy:       'Policies',
};

export const TASK_SEGMENTS = [
  { value: 'mine',      label: 'My tasks' },
  { value: 'overdue',   label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
] as const;

export const MEETING_SEGMENTS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past',     label: 'Past' },
] as const;

export const DOC_SEGMENTS = [
  { value: 'all',          label: 'All' },
  { value: 'constitution', label: 'Governance' },
  { value: 'minutes',      label: 'Minutes' },
  { value: 'financial',    label: 'Finance' },
  { value: 'certificates', label: 'Certificates' },
  { value: 'policy',       label: 'Policies' },
] as const;
