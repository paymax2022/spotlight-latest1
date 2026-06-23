// ── Association — Settings & Support type contract (V/W) ──────────────────────

// ─── Settings (V) ─────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  announcements: boolean;
  duesReminders: boolean;
  meetings:      boolean;
  tasks:         boolean;
  chat:          boolean;
  events:        boolean;
}

export interface SecuritySettings {
  biometricEnabled: boolean;
  twoFactorEnabled: boolean;
}

export type ThemePref = 'LIGHT' | 'DARK' | 'SYSTEM';

export interface Preferences {
  language: string;   // e.g. 'English'
  theme:    ThemePref;
}

export const LANGUAGE_OPTIONS = ['English', 'Hausa', 'Yoruba', 'Igbo', 'French', 'Pidgin'];

export interface Device {
  id:        string;
  name:      string;          // "iPhone 14 Pro"
  platform:  string;          // "iOS 18.2"
  lastActive: string;         // ISO
  current:   boolean;
  location:  string | null;
}

// ─── Support (W) ──────────────────────────────────────────────────────────────

export interface FaqItem { id: string; question: string; answer: string }

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
export type TicketCategory = 'MEMBERSHIP' | 'PAYMENT' | 'TECHNICAL' | 'OTHER';

export interface TicketMessage {
  id:       string;
  author:   string;
  fromSupport: boolean;
  body:     string;
  createdAt: string;
}

export interface SupportTicketSummary {
  id:        string;
  subject:   string;
  category:  TicketCategory;
  status:    TicketStatus;
  updatedAt: string;
}

export interface SupportTicket extends SupportTicketSummary {
  messages: TicketMessage[];
}

export interface CreateTicketInput {
  subject:  string;
  category: TicketCategory;
  message:  string;
}
