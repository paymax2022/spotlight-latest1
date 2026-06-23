// ── Association — Group chat constants (I) ────────────────────────────────────

import type { ChatScope, ChatPostingBlock } from '../types/chat.types';

/** Lucide icon name per chat scope (rendered via dynamic Icons lookup). */
export const CHAT_SCOPE_ICON: Record<ChatScope, string> = {
  ORG:          'Building2',
  CHAPTER:      'MapPin',
  STATE:        'Map',
  COMMITTEE:    'Users',
  EXECUTIVE:    'ShieldCheck',
  EVENT:        'Ticket',
  TASK:         'ListTodo',
  MEETING:      'CalendarDays',
  DIRECT:       'User',
  ANNOUNCEMENT: 'Megaphone',
};

export const CHAT_SCOPE_LABEL: Record<ChatScope, string> = {
  ORG:          'Organisation',
  CHAPTER:      'Chapter',
  STATE:        'State',
  COMMITTEE:    'Committee',
  EXECUTIVE:    'Executive',
  EVENT:        'Event',
  TASK:         'Task',
  MEETING:      'Meeting',
  DIRECT:       'Direct',
  ANNOUNCEMENT: 'Announcements',
};

/** Member-facing reason a composer is disabled. */
export const POSTING_BLOCK_NOTICE: Record<Exclude<ChatPostingBlock, null>, string> = {
  ANNOUNCEMENT_ONLY:  'This is an announcement-only channel. Only admins can post.',
  ROLE_RESTRICTED:    'This channel is limited to authorised roles.',
  PAYMENT_RESTRICTED: 'Posting is disabled while your dues are outstanding. Pay to restore access.',
  ARCHIVED:           'This conversation has been archived.',
};
