// ── Association — Member profile type contract (C) ────────────────────────────

export interface EmergencyContact { name: string; phone: string }
export interface NextOfKin { name: string; relationship: string; phone: string }

export interface MyProfile {
  fullName:    string;
  memberId:    string;
  photoUrl:    string | null;
  email:       string;
  phone:       string;
  profession:  string;
  location:    string;
  dob:         string | null;        // ISO date, optional
  bio:         string;
  emergency:   EmergencyContact;
  nextOfKin:   NextOfKin;
  categoryLabel: string;
  chapterName: string | null;
}

/** Editable subset submitted from the edit screen. */
export interface ProfileEdit {
  fullName:   string;
  phone:      string;
  email:      string;
  profession: string;
  location:   string;
  dob:        string | null;
  bio:        string;
  emergency:  EmergencyContact;
  nextOfKin:  NextOfKin;
  photoUrl:   string | null;
}

export interface PrivacySettings {
  showPhone:       boolean;
  showEmail:       boolean;
  showInDirectory: boolean;
  showProfession:  boolean;
}

export interface CompletionItem { key: string; label: string; done: boolean }

export interface ProfileCompletion {
  percent: number;          // 0-100
  items:   CompletionItem[];
}

export type ActivityType = 'payment' | 'meeting' | 'task' | 'document' | 'membership' | 'profile';

export interface ActivityEntry {
  id:    string;
  type:  ActivityType;
  text:  string;
  at:    string;            // ISO
}
