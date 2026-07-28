// ── Association — Admin-lite mock dataset (Q/R/S/T) ───────────────────────────

import type {
  AdminKpis, AdminApplication, FinanceSummary, OfflinePayment, ImportPreview, AuditEntry,
} from '../types/admin.types';

export const MOCK_AUDIT: AuditEntry[] = [
  { id: 'au1', action: 'APPROVAL_DECISION', actorName: 'Dr. Adebayo Williams', summary: 'Approved Dr. Emeka Nwosu’s application', subject: 'NMA/LA/2023/0177', at: '2026-06-19T16:40:00Z' },
  { id: 'au2', action: 'OFFLINE_PAYMENT', actorName: 'Mrs. Ngozi Eze', summary: 'Approved offline dues payment (₦20,000)', subject: 'TRF-99812', at: '2026-06-19T14:05:00Z' },
  { id: 'au3', action: 'MEMBER_SUSPEND', actorName: 'Dr. Adebayo Williams', summary: 'Suspended Dr. Grace Okafor', subject: 'NMA/LA/2018/0021', at: '2026-06-18T11:20:00Z' },
  { id: 'au4', action: 'ROLE_ASSIGN', actorName: 'National Secretariat', summary: 'Assigned Finance admin to Mr. Sola Adeniyi', subject: null, at: '2026-06-17T09:30:00Z' },
  { id: 'au5', action: 'MINUTES_PUBLISH', actorName: 'Dr. Chidinma Okeke', summary: 'Published May General Meeting minutes', subject: 'May General Meeting', at: '2026-06-02T10:00:00Z' },
  { id: 'au6', action: 'IMPORT', actorName: 'Mrs. Ngozi Eze', summary: 'Imported 3 members (1 duplicate, 2 invalid skipped)', subject: 'members-2026.xlsx', at: '2026-06-01T08:15:00Z' },
];

export const MOCK_KPIS: AdminKpis = {
  totalMembers: 6120,
  activeMembers: 5380,
  pendingApprovals: 4,
  unpaidMembers: 740,
  duesCollectedKobo: 4_215_000_00,
  duesOutstandingKobo: 1_108_000_00,
};

export const MOCK_APPLICATIONS: AdminApplication[] = [
  {
    id: 'ap1', applicantName: 'Dr. Emeka Nwosu', category: 'Provisional member', chapter: 'Lagos State Chapter',
    submittedAt: '2026-06-17T09:00:00Z', status: 'PENDING', jurisdiction: 'CHAPTER', paid: true,
    email: 'e.nwosu@example.com', phone: '+234 701 222 0177', profession: 'House officer',
    sponsor: 'Dr. Adebayo Williams',
    documents: [{ id: 'd1', name: 'MDCN licence.pdf', verified: true }, { id: 'd2', name: 'National ID.jpg', verified: false }],
    registrationFeeKobo: 1_500_000, slaHoursLeft: 36,
  },
  {
    id: 'ap2', applicantName: 'Dr. Aisha Mohammed', category: 'Full member', chapter: 'Lagos State Chapter',
    submittedAt: '2026-06-16T14:30:00Z', status: 'PENDING', jurisdiction: 'CHAPTER', paid: false,
    email: 'a.mohammed@example.com', phone: '+234 803 444 0210', profession: 'Paediatrician',
    sponsor: null,
    documents: [{ id: 'd3', name: 'MDCN licence.pdf', verified: true }],
    registrationFeeKobo: 1_500_000, slaHoursLeft: -6,
  },
  {
    id: 'ap3', applicantName: 'Dr. Bola Adesanya', category: 'Full member', chapter: 'Lagos State Chapter',
    submittedAt: '2026-06-15T11:00:00Z', status: 'INFO_REQUESTED', jurisdiction: 'CHAPTER', paid: true,
    email: 'b.adesanya@example.com', phone: '+234 805 666 0099', profession: 'Surgeon',
    sponsor: 'Dr. Grace Okafor',
    documents: [{ id: 'd4', name: 'MDCN licence.pdf', verified: false }],
    registrationFeeKobo: 1_500_000, slaHoursLeft: 12,
  },
  {
    id: 'ap4', applicantName: 'Dr. Chinedu Obi', category: 'Full member', chapter: 'National executive',
    submittedAt: '2026-06-14T08:00:00Z', status: 'PENDING', jurisdiction: 'NATIONAL', paid: true,
    email: 'c.obi@example.com', phone: '+234 802 777 0303', profession: 'Consultant',
    sponsor: 'Dr. Tunde Bakare',
    documents: [{ id: 'd5', name: 'MDCN licence.pdf', verified: true }, { id: 'd6', name: 'CV.pdf', verified: true }],
    registrationFeeKobo: 2_500_000, slaHoursLeft: 60,
  },
];

export const MOCK_FINANCE: FinanceSummary = {
  collectedKobo: 4_215_000_00,
  outstandingKobo: 1_108_000_00,
  paidMembers: 5380,
  unpaidMembers: 740,
  byChapter: [
    { label: 'Lagos State', amountKobo: 1_820_000_00 },
    { label: 'FCT Abuja', amountKobo: 1_140_000_00 },
    { label: 'Rivers State', amountKobo: 760_000_00 },
    { label: 'Kano State', amountKobo: 495_000_00 },
  ],
  byCategory: [
    { label: 'Full member', amountKobo: 3_200_000_00 },
    { label: 'Provisional', amountKobo: 715_000_00 },
    { label: 'Life member', amountKobo: 300_000_00 },
  ],
  offlinePending: 3,
};

export const MOCK_OFFLINE_PAYMENTS: OfflinePayment[] = [
  { id: 'op1', memberName: 'Dr. Ifeoma Eze', memberId: 'NMA/LA/2022/0410', amountKobo: 2_000_000, method: 'Bank transfer', reference: 'TRF-99812', forItem: '2026 Annual dues', submittedAt: '2026-06-18T10:00:00Z', status: 'PENDING' },
  { id: 'op2', memberName: 'Dr. Yusuf Sani', memberId: 'NMA/LA/2020/0233', amountKobo: 2_000_000, method: 'Cash', reference: 'RCT-0455', forItem: '2026 Annual dues', submittedAt: '2026-06-17T15:20:00Z', status: 'PENDING' },
  { id: 'op3', memberName: 'Dr. Ada Obi', memberId: 'NMA/LA/2023/0188', amountKobo: 500_000, method: 'Bank transfer', reference: 'TRF-77410', forItem: 'Chapter levy', submittedAt: '2026-06-16T09:45:00Z', status: 'PENDING' },
];

export const MOCK_IMPORT_PREVIEW: ImportPreview = {
  fileName: 'members-2026.xlsx',
  total: 6,
  valid: 3,
  duplicates: 1,
  invalid: 2,
  rows: [
    { rowNum: 1, name: 'Dr. Kunle Ade', phone: '+234 803 111 0001', email: 'k.ade@example.com', chapter: 'Lagos State', issue: null },
    { rowNum: 2, name: 'Dr. Maryam Bello', phone: '+234 803 111 0002', email: 'm.bello@example.com', chapter: 'Lagos State', issue: null },
    { rowNum: 3, name: 'Dr. Peter Obi', phone: '+234 803 111 0003', email: 'p.obi@example.com', chapter: 'FCT Abuja', issue: null },
    { rowNum: 4, name: 'Dr. Adebayo Williams', phone: '+234 803 000 0044', email: 'a.williams@example.com', chapter: 'Lagos State', issue: 'duplicate' },
    { rowNum: 5, name: 'Dr. Sade Cole', phone: '0810', email: 's.cole@example.com', chapter: 'Lagos State', issue: 'invalid_phone' },
    { rowNum: 6, name: 'Dr. Femi Kuti', phone: '+234 803 111 0006', email: 'not-an-email', chapter: 'Lagos State', issue: 'invalid_email' },
  ],
};
