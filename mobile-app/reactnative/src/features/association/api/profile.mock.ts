// ── Association — Member profile mock dataset (C) ─────────────────────────────

import type { MyProfile, PrivacySettings, ActivityEntry } from '../types/profile.types';

export const MOCK_MY_PROFILE: MyProfile = {
  fullName: 'Dr. Chidinma Okeke',
  memberId: 'NMA/LA/2024/0192',
  photoUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&q=80',
  email: 'c.okeke@example.com',
  phone: '+234 803 555 0192',
  profession: 'General Practitioner',
  location: 'Lagos, Nigeria',
  dob: null,
  bio: 'GP with a focus on community health. Welfare committee member.',
  emergency: { name: 'Mr. Emeka Okeke', phone: '+234 803 555 1000' },
  nextOfKin: { name: 'Mrs. Ada Okeke', relationship: 'Mother', phone: '+234 803 555 2000' },
  categoryLabel: 'Full member',
  chapterName: 'Lagos State Chapter',
};

export const MOCK_PRIVACY: PrivacySettings = {
  showPhone: false,
  showEmail: true,
  showInDirectory: true,
  showProfession: true,
};

export const MOCK_ACTIVITY: ActivityEntry[] = [
  { id: 'ac1', type: 'payment', text: 'Paid 2025 annual dues (₦15,000)', at: '2025-07-20T10:00:00Z' },
  { id: 'ac2', type: 'meeting', text: 'Checked in to May General Meeting', at: '2026-05-31T16:10:00Z' },
  { id: 'ac3', type: 'task', text: 'Completed “Review draft chapter budget”', at: '2026-06-05T14:00:00Z' },
  { id: 'ac4', type: 'document', text: 'Acknowledged Code of Ethics (v2)', at: '2026-06-09T11:30:00Z' },
  { id: 'ac5', type: 'membership', text: 'Membership renewed for 2026', at: '2026-01-02T09:00:00Z' },
  { id: 'ac6', type: 'profile', text: 'Updated contact information', at: '2026-06-12T08:00:00Z' },
];
