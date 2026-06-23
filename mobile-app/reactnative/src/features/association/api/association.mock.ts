// ── Association — Mock dataset ───────────────────────────────────────────────
// Realistic Nigeria-first sample data. All money is in kobo.

import type {
  Organisation,
  OrganisationSummary,
  MemberProfile,
  MemberDashboard,
  MembershipCard,
  DuesSummary,
  PaymentReceipt,
} from '../types/association.types';

export const MOCK_ORGANISATIONS: Organisation[] = [
  {
    id: 'org1',
    name: 'Nigerian Medical Association',
    acronym: 'NMA',
    category: 'Professional body',
    logoUrl: null,
    coverUrl: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&q=80',
    groupType: 'CLOSED',
    memberCount: 42180,
    chapterCount: 37,
    verified: true,
    location: 'Abuja, Nigeria',
    tagline: 'The voice of medicine in Nigeria',
    description:
      'The Nigerian Medical Association is the umbrella professional body for registered medical and dental practitioners in Nigeria, with chapters in all 36 states and the FCT. Membership gives access to CPD events, advocacy, welfare, and professional indemnity support.',
    foundedYear: 1951,
    requiresPayment: true,
    registrationFeeKobo: 1_500_000,
    approvalSummary: 'State chapter admin approves, then National membership officer validates.',
    membershipCategories: [
      { id: 'cat1', label: 'Full member', description: 'Fully registered practitioner', duesKobo: 2_000_000, duesCadence: 'ANNUAL' },
      { id: 'cat2', label: 'Provisional member', description: 'House officer / intern', duesKobo: 1_000_000, duesCadence: 'ANNUAL' },
      { id: 'cat3', label: 'Life member', description: 'One-off lifetime dues', duesKobo: 25_000_000, duesCadence: 'LIFETIME' },
    ],
    chapters: [
      { id: 'ch1', name: 'Lagos State Chapter', level: 'STATE', parentId: null, memberCount: 6120 },
      { id: 'ch2', name: 'FCT Abuja Chapter',   level: 'STATE', parentId: null, memberCount: 3840 },
      { id: 'ch3', name: 'Rivers State Chapter', level: 'STATE', parentId: null, memberCount: 2210 },
      { id: 'ch4', name: 'Kano State Chapter',   level: 'STATE', parentId: null, memberCount: 1980 },
    ],
    requirements: [
      { id: 'rq1', label: 'Upload MDCN practising licence', type: 'DOCUMENT', required: true },
      { id: 'rq2', label: 'Upload valid ID', type: 'DOCUMENT', required: true },
      { id: 'rq3', label: 'Add a sponsoring member', type: 'SPONSOR', required: false },
      { id: 'rq4', label: 'Pay registration fee', type: 'PAYMENT', required: true },
    ],
    rules: [
      'I will abide by the NMA code of medical ethics.',
      'I consent to verification of my professional credentials.',
      'I understand dues are payable annually and govern access to benefits.',
    ],
    website: 'https://nma.org.ng',
    branches: ['Ikeja Branch', 'Lagos Island Branch', 'Lekki Branch', 'Surulere Branch'],
    committeeOptions: ['Welfare', 'Finance', 'Events', 'Membership', 'Disciplinary'],
  },
  {
    id: 'org2',
    name: 'Ikoyi Estate Residents Association',
    acronym: 'IERA',
    category: 'Estate / residents',
    logoUrl: null,
    coverUrl: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=80',
    groupType: 'CODE_BASED',
    memberCount: 312,
    chapterCount: 1,
    verified: true,
    location: 'Ikoyi, Lagos',
    tagline: 'A safer, cleaner, better-run estate',
    description:
      'The residents association coordinates security levies, waste management, and community events for households in the estate. Join with the access code shared by your block representative.',
    foundedYear: 2009,
    requiresPayment: false,
    registrationFeeKobo: 0,
    approvalSummary: 'Enter the estate access code, then the estate admin confirms your unit.',
    membershipCategories: [
      { id: 'cat4', label: 'Resident household', description: 'One vote per household', duesKobo: 5_000_000, duesCadence: 'ANNUAL' },
      { id: 'cat5', label: 'Tenant', description: 'Non-voting resident', duesKobo: 3_000_000, duesCadence: 'ANNUAL' },
    ],
    chapters: [
      { id: 'ch5', name: 'Main Estate', level: 'LOCAL', parentId: null, memberCount: 312 },
    ],
    requirements: [
      { id: 'rq5', label: 'Enter estate access code', type: 'INFO', required: true },
      { id: 'rq6', label: 'Upload proof of residence', type: 'DOCUMENT', required: true },
    ],
    rules: [
      'I am a verified resident of the estate.',
      'I agree to pay the approved security and sanitation levies.',
    ],
    website: null,
    branches: ['Block A', 'Block B', 'Block C'],
    committeeOptions: ['Security', 'Sanitation', 'Social'],
  },
  {
    id: 'org3',
    name: 'UNILAG Alumni Network',
    acronym: 'UAN',
    category: 'Alumni',
    logoUrl: null,
    coverUrl: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=800&q=80',
    groupType: 'OPEN',
    memberCount: 18750,
    chapterCount: 12,
    verified: false,
    location: 'Lagos, Nigeria',
    tagline: 'Once a Lagosian, always a Lagosian',
    description:
      'An open network for graduates of the University of Lagos worldwide. Connect with your set, give back through scholarship drives, and attend reunions.',
    foundedYear: 1980,
    requiresPayment: false,
    registrationFeeKobo: 0,
    approvalSummary: 'Open group — you join instantly and can verify your set later.',
    membershipCategories: [
      { id: 'cat6', label: 'Alumnus', description: 'Any graduate', duesKobo: 0, duesCadence: 'ANNUAL' },
      { id: 'cat7', label: 'Supporting member', description: 'Optional yearly support', duesKobo: 1_000_000, duesCadence: 'ANNUAL' },
    ],
    chapters: [
      { id: 'ch6', name: 'Diaspora — UK Chapter', level: 'REGION', parentId: null, memberCount: 2100 },
      { id: 'ch7', name: 'Lagos Chapter', level: 'STATE', parentId: null, memberCount: 8400 },
    ],
    requirements: [
      { id: 'rq7', label: 'Graduation year & faculty', type: 'INFO', required: true },
    ],
    rules: [
      'I am a graduate or affiliate of the University of Lagos.',
      'I will keep community conduct respectful.',
    ],
    website: 'https://unilagalumni.org',
    branches: [],
    committeeOptions: ['Scholarship', 'Fundraising', 'Alumni Relations'],
  },
];

export const MOCK_MEMBER_CARD: MembershipCard = {
  memberId: 'NMA/LA/2024/0192',
  fullName: 'Dr. Chidinma Okeke',
  photoUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&q=80',
  organisationName: 'Nigerian Medical Association',
  organisationAcronym: 'NMA',
  categoryLabel: 'Full member',
  chapterName: 'Lagos State Chapter',
  status: 'ACTIVE',
  paymentStanding: 'DUE',
  verified: true,
  validThrough: '2026-12-31T23:59:59Z',
  qrPayload: 'SPOTLIGHT:NMA:0192:8f3ac1',
};

export const MOCK_DASHBOARD: MemberDashboard = {
  card: MOCK_MEMBER_CARD,
  outstandingKobo: 2_000_000,
  nextDueDate: '2026-07-31T23:59:59Z',
  unreadAnnouncements: 3,
  openTasks: 2,
  nextMeeting: {
    id: 'mtg1',
    title: 'Lagos Chapter Monthly General Meeting',
    startsAt: '2026-06-28T16:00:00Z',
    location: 'NMA House, Ikeja',
  },
  latestAnnouncement: {
    id: 'ann1',
    title: 'Annual dues deadline extended to 31 July',
    postedAt: '2026-06-18T10:00:00Z',
    urgent: true,
  },
  restriction: null,
};

export const MOCK_MEMBERS: MemberProfile[] = [
  {
    id: 'm1', fullName: 'Dr. Adebayo Williams', memberId: 'NMA/LA/2019/0044',
    photoUrl: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&q=80',
    categoryLabel: 'Full member', chapterName: 'Lagos State Chapter', status: 'ACTIVE',
    profession: 'Cardiologist', committees: ['Welfare', 'Finance'],
    email: 'a.williams@example.com', phone: '+234 803 000 0044', location: 'Lagos',
    joinedAt: '2019-03-01T00:00:00Z', paymentStanding: 'PAID',
    bio: 'Consultant cardiologist. Welfare committee co-chair.', contactRestricted: false,
  },
  {
    id: 'm2', fullName: 'Dr. Fatima Bello', memberId: 'NMA/LA/2021/0118',
    photoUrl: null,
    categoryLabel: 'Full member', chapterName: 'Lagos State Chapter', status: 'ACTIVE',
    profession: 'Paediatrician', committees: ['Membership'],
    email: null, phone: null, location: 'Lagos',
    joinedAt: '2021-08-12T00:00:00Z', paymentStanding: 'PAID',
    bio: null, contactRestricted: true,
  },
  {
    id: 'm3', fullName: 'Dr. Emeka Nwosu', memberId: 'NMA/LA/2023/0177',
    photoUrl: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&q=80',
    categoryLabel: 'Provisional member', chapterName: 'Lagos State Chapter', status: 'PENDING',
    profession: 'House officer', committees: [],
    email: 'e.nwosu@example.com', phone: '+234 701 222 0177', location: 'Lagos',
    joinedAt: '2026-06-01T00:00:00Z', paymentStanding: 'DUE',
    bio: null, contactRestricted: false,
  },
  {
    id: 'm4', fullName: 'Dr. Grace Okafor', memberId: 'NMA/LA/2018/0021',
    photoUrl: null,
    categoryLabel: 'Life member', chapterName: 'Lagos State Chapter', status: 'SUSPENDED',
    profession: 'Surgeon', committees: ['Disciplinary'],
    email: null, phone: null, location: 'Lagos',
    joinedAt: '2018-01-20T00:00:00Z', paymentStanding: 'OVERDUE',
    bio: null, contactRestricted: true,
  },
];

export const MOCK_DUES: DuesSummary = {
  outstandingKobo: 2_000_000,
  paidThisYearKobo: 1_500_000,
  standing: 'DUE',
  invoices: [
    {
      id: 'inv1', title: '2026 Annual dues', description: 'National membership dues',
      amountKobo: 2_000_000, cadence: 'ANNUAL', status: 'DUE',
      dueDate: '2026-07-31T23:59:59Z', scope: 'NATIONAL',
    },
    {
      id: 'inv2', title: 'Lagos Chapter levy', description: 'Chapter development levy',
      amountKobo: 500_000, cadence: 'ANNUAL', status: 'OVERDUE',
      dueDate: '2026-05-31T23:59:59Z', scope: 'STATE',
    },
    {
      id: 'inv3', title: '2025 Annual dues', description: 'National membership dues',
      amountKobo: 1_500_000, cadence: 'ANNUAL', status: 'PAID',
      dueDate: '2025-07-31T23:59:59Z', scope: 'NATIONAL',
    },
    {
      id: 'inv4', title: 'Welfare committee dues', description: 'Committee contribution',
      amountKobo: 300_000, cadence: 'ANNUAL', status: 'DUE',
      dueDate: '2026-08-15T23:59:59Z', scope: 'COMMITTEE',
    },
  ],
};

export function buildReceipt(invoiceId: string, method: 'WALLET' | 'PAYSTACK'): PaymentReceipt {
  const invoice = MOCK_DUES.invoices.find((i) => i.id === invoiceId) ?? MOCK_DUES.invoices[0];
  const amount = invoice.amountKobo;
  // Revenue split: National 50% · State 30% · Local 15% · Platform 5%
  return {
    id: `rcpt_${invoiceId}`,
    reference: `SPL-${Date.now().toString().slice(-8)}`,
    invoiceTitle: invoice.title,
    amountKobo: amount,
    method,
    paidAt: new Date().toISOString(),
    memberName: MOCK_MEMBER_CARD.fullName,
    organisationName: MOCK_MEMBER_CARD.organisationName,
    split: [
      { label: 'National body',  amountKobo: Math.round(amount * 0.5) },
      { label: 'State chapter',  amountKobo: Math.round(amount * 0.3) },
      { label: 'Local chapter',  amountKobo: Math.round(amount * 0.15) },
      { label: 'Platform fee',   amountKobo: Math.round(amount * 0.05) },
    ],
  };
}

export function toSummary(o: Organisation): OrganisationSummary {
  const { id, name, acronym, category, logoUrl, coverUrl, groupType, memberCount, chapterCount, verified, location, tagline } = o;
  return { id, name, acronym, category, logoUrl, coverUrl, groupType, memberCount, chapterCount, verified, location, tagline };
}
