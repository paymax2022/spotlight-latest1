// ── Association — Settings & Support mock dataset (V/W) ───────────────────────

import type {
  NotificationPrefs, SecuritySettings, Device, FaqItem, SupportTicket,
} from '../types/settings.types';

export const MOCK_NOTIF_PREFS: NotificationPrefs = {
  announcements: true,
  duesReminders: true,
  meetings: true,
  tasks: true,
  chat: false,
  events: true,
};

export const MOCK_SECURITY: SecuritySettings = {
  biometricEnabled: false,
  twoFactorEnabled: true,
};

export const MOCK_DEVICES: Device[] = [
  { id: 'dev1', name: 'iPhone 14 Pro', platform: 'iOS 18.2', lastActive: '2026-06-20T08:00:00Z', current: true, location: 'Lagos, NG' },
  { id: 'dev2', name: 'Pixel 8', platform: 'Android 15', lastActive: '2026-06-12T19:30:00Z', current: false, location: 'Abuja, NG' },
  { id: 'dev3', name: 'Chrome · MacBook', platform: 'Web', lastActive: '2026-06-05T11:00:00Z', current: false, location: 'Lagos, NG' },
];

export const MOCK_FAQS: FaqItem[] = [
  { id: 'f1', question: 'How do I pay my dues?', answer: 'Open Dues from your dashboard, choose the invoice, and pay with your wallet or card. Payment is confirmed instantly and your membership card updates automatically.' },
  { id: 'f2', question: 'Why is my membership card restricted?', answer: 'Cards are restricted when dues are outstanding beyond the grace period set by your organisation. Settle the balance under Dues to restore access immediately.' },
  { id: 'f3', question: 'How do I join a committee?', answer: 'Open Committees, select one, and tap "Request to join". A committee admin will review your request.' },
  { id: 'f4', question: 'How are meeting minutes generated?', answer: 'Secretaries can record or upload a meeting under AI notes. The AI drafts minutes, decisions, and tasks, which a human approves before publishing.' },
  { id: 'f5', question: 'Can I transfer to another chapter?', answer: 'Chapter transfers are handled by your admin. Contact support or your chapter secretary to request a transfer.' },
];

export const MOCK_TICKETS: SupportTicket[] = [
  {
    id: 'tk1', subject: 'Dues payment not reflecting', category: 'PAYMENT', status: 'IN_PROGRESS', updatedAt: '2026-06-19T14:00:00Z',
    messages: [
      { id: 'm1', author: 'You', fromSupport: false, body: 'I paid my 2026 dues via transfer but my card still shows restricted.', createdAt: '2026-06-18T10:00:00Z' },
      { id: 'm2', author: 'Support', fromSupport: true, body: 'Thanks for reaching out. We can see a pending offline payment — your treasurer is reviewing the proof. This usually clears within 24 hours.', createdAt: '2026-06-18T12:30:00Z' },
    ],
  },
  {
    id: 'tk2', subject: 'Cannot access committee chat', category: 'TECHNICAL', status: 'RESOLVED', updatedAt: '2026-06-10T09:00:00Z',
    messages: [
      { id: 'm3', author: 'You', fromSupport: false, body: 'The welfare committee chat won’t open.', createdAt: '2026-06-09T08:00:00Z' },
      { id: 'm4', author: 'Support', fromSupport: true, body: 'This was a sync issue, now fixed. Please pull to refresh. Closing this ticket — reopen if it recurs.', createdAt: '2026-06-10T09:00:00Z' },
    ],
  },
];
