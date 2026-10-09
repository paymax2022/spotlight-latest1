import type { MyProfile, PrivacySettings, ActivityEntry } from '../types';
import type {
  NotificationPrefs, SecuritySettings, Device, FaqItem, SupportTicket,
} from '../types';
import type { Committee, Event } from '../types';
import type { AiNote } from '../types';
import type { ChatThread } from '../types';
import type {
  AdminKpis, AdminApplication, FinanceSummary, OfflinePayment, ImportPreview, AuditEntry,
} from '../types';

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

export const MOCK_COMMITTEES: Committee[] = [
  {
    id: 'cm1', name: 'Welfare Committee', purpose: 'Member welfare & support',
    memberCount: 12, joinStatus: 'MEMBER', myRole: 'Member',
    description: 'Coordinates welfare support, bereavement assistance, and member hardship cases across the chapter.',
    chair: 'Dr. Adebayo Williams', secretary: 'Mrs. Ngozi Eze',
    members: [
      { id: 'u9', name: 'Dr. Adebayo Williams', role: 'Chairperson', photoUrl: null },
      { id: 'u12', name: 'Mrs. Ngozi Eze', role: 'Secretary', photoUrl: null },
      { id: 'me', name: 'Dr. Chidinma Okeke', role: 'Member', photoUrl: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=200&q=80' },
    ],
    meetingsCount: 6, tasksCount: 3, docsCount: 4, chatThreadId: 'th3',
  },
  {
    id: 'cm2', name: 'Finance Committee', purpose: 'Budgets & oversight',
    memberCount: 8, joinStatus: 'NONE', myRole: null,
    description: 'Oversees the chapter budget, dues structure, and financial reporting.',
    chair: 'Dr. Tunde Bakare', secretary: 'Mr. Sola Adeniyi',
    members: [
      { id: 'u20', name: 'Dr. Tunde Bakare', role: 'Chairperson', photoUrl: null },
      { id: 'u21', name: 'Mr. Sola Adeniyi', role: 'Secretary', photoUrl: null },
    ],
    meetingsCount: 4, tasksCount: 2, docsCount: 7, chatThreadId: null,
  },
  {
    id: 'cm3', name: 'Events Committee', purpose: 'CPD & social events',
    memberCount: 10, joinStatus: 'PENDING', myRole: null,
    description: 'Plans CPD seminars, the AGM, and chapter social events.',
    chair: 'Dr. Fatima Bello', secretary: 'Dr. Emeka Nwosu',
    members: [
      { id: 'u2', name: 'Dr. Fatima Bello', role: 'Chairperson', photoUrl: null },
      { id: 'u3', name: 'Dr. Emeka Nwosu', role: 'Secretary', photoUrl: null },
    ],
    meetingsCount: 5, tasksCount: 4, docsCount: 2, chatThreadId: null,
  },
];

export const MOCK_EVENTS: Event[] = [
  {
    id: 'ev1', title: 'Quarterly CPD Seminar', startsAt: '2026-07-12T09:00:00Z', endsAt: '2026-07-12T15:00:00Z',
    location: 'NMA House, Ikeja', state: 'UPCOMING', paid: true, feeKobo: 500_000,
    registered: false, rsvp: null, coverUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80',
    description: 'Earn 6 CPD points across emergency cardiology and ethics-in-practice sessions. Lunch included.',
    organiser: 'Events Committee', attendeeCount: 128, capacity: 200,
    documents: [{ id: 'ed1', name: 'Seminar programme.pdf' }],
    ticketCode: 'SPOTLIGHT:EVT:ev1:ticket', checkedIn: false, feedbackSubmitted: false,
  },
  {
    id: 'ev2', title: 'Annual General Meeting 2026', startsAt: '2026-08-30T10:00:00Z', endsAt: '2026-08-30T16:00:00Z',
    location: 'Eko Hotel, Victoria Island', state: 'UPCOMING', paid: false, feeKobo: 0,
    registered: true, rsvp: 'GOING', coverUrl: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&q=80',
    description: 'The chapter AGM: annual reports, elections, and the year-ahead plan. All members in good standing may attend.',
    organiser: 'National Secretariat', attendeeCount: 412, capacity: null,
    documents: [{ id: 'ed2', name: 'AGM agenda.pdf' }, { id: 'ed3', name: '2025 annual report.pdf' }],
    ticketCode: 'SPOTLIGHT:EVT:ev2:ticket', checkedIn: false, feedbackSubmitted: false,
  },
  {
    id: 'ev3', title: 'May Health Outreach', startsAt: '2026-05-18T08:00:00Z', endsAt: '2026-05-18T14:00:00Z',
    location: 'Mushin Community Centre', state: 'PAST', paid: false, feeKobo: 0,
    registered: true, rsvp: 'GOING', coverUrl: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=800&q=80',
    description: 'Free community health screening organised with volunteer members.',
    organiser: 'Welfare Committee', attendeeCount: 64, capacity: 80,
    documents: [], ticketCode: 'SPOTLIGHT:EVT:ev3:ticket', checkedIn: true, feedbackSubmitted: false,
  },
];

// ── Association — AI note-taking mock dataset (L) ─────────────────────────────


export const MOCK_AI_NOTES: AiNote[] = [
  {
    id: 'ai1',
    meetingTitle: 'May Monthly General Meeting',
    status: 'PUBLISHED',
    source: 'AUDIO',
    createdAt: '2026-06-01T11:00:00Z',
    durationLabel: '1h 48m',
    meetingId: 'mtg3',
    summary:
      'The May general meeting reviewed Q2 finances, approved the CPD seminar budget, and resolved to extend the dues deadline. Welfare disbursements for two cases were ratified.',
    minutes:
      '1. Opening — The chairperson called the meeting to order at 16:05.\n2. Treasurer’s report — ₦4.2M collected in Q2; outstanding ₦1.1M.\n3. CPD seminar — Budget of ₦850,000 approved.\n4. Welfare — Two cases ratified for disbursement.\n5. Closing — Adjourned at 17:53.',
    decisions: [
      { id: 'd1', text: 'Approve CPD seminar budget of ₦850,000.' },
      { id: 'd2', text: 'Extend 2026 dues deadline to 31 July.' },
      { id: 'd3', text: 'Ratify welfare disbursement for the Adeyemi and Okoro cases.' },
    ],
    actionItems: [
      { id: 'a1', title: 'Book CPD seminar venue', owner: 'Events Committee', dueLabel: 'in 14 days', convertedTaskId: 'tk2' },
      { id: 'a2', title: 'Publish dues extension circular', owner: 'Secretariat', dueLabel: 'in 2 days', convertedTaskId: null },
    ],
    unresolved: ['Vendor selection for the AGM venue remains undecided.'],
    financialCommitments: [
      { id: 'f1', label: 'CPD seminar budget', amountKobo: 85_000_000 },
    ],
    attendees: [
      { id: 'at1', name: 'Dr. Chidinma Okeke', present: true },
      { id: 'at2', name: 'Dr. Adebayo Williams', present: true },
      { id: 'at3', name: 'Dr. Fatima Bello', present: true },
      { id: 'at4', name: 'Dr. Grace Okafor', present: false },
    ],
    transcriptPreview:
      'Chair: Good evening colleagues, let us call the meeting to order… Treasurer: Thank you chair, our Q2 collections stand at four point two million…',
  },
  {
    id: 'ai2',
    meetingTitle: 'Welfare Committee — June Sitting',
    status: 'READY',
    source: 'RECORD',
    createdAt: '2026-06-18T15:00:00Z',
    durationLabel: '52m',
    meetingId: null,
    summary:
      'The welfare committee reviewed three new support requests and agreed on a disbursement framework. A report is due before the next general meeting.',
    minutes:
      '1. Review of new cases — Three requests received; two recommended for support.\n2. Framework — Agreed a maximum of ₦300,000 per case pending council approval.\n3. Next steps — Compile a disbursement report for the general meeting.',
    decisions: [
      { id: 'd4', text: 'Recommend two of three cases for support.' },
      { id: 'd5', text: 'Cap individual welfare support at ₦300,000 pending council approval.' },
    ],
    actionItems: [
      { id: 'a3', title: 'Compile welfare disbursement report', owner: 'Dr. Chidinma Okeke', dueLabel: 'in 7 days', convertedTaskId: null },
      { id: 'a4', title: 'Notify approved beneficiaries', owner: 'Welfare Secretary', dueLabel: 'in 5 days', convertedTaskId: null },
    ],
    unresolved: ['Whether the ₦300,000 cap needs a constitutional amendment.'],
    financialCommitments: [
      { id: 'f2', label: 'Per-case welfare cap', amountKobo: 30_000_000 },
    ],
    attendees: [
      { id: 'at5', name: 'Dr. Chidinma Okeke', present: true },
      { id: 'at6', name: 'Dr. Adebayo Williams', present: true },
      { id: 'at7', name: 'Mrs. Ngozi Eze', present: true },
    ],
    transcriptPreview:
      'Chair: Welcome everyone to the June welfare sitting… Member: We have three new requests to consider today…',
  },
];

export const MOCK_THREADS: ChatThread[] = [
  {
    id: 'th1',
    title: 'NMA — All Members',
    scope: 'ORG',
    description: 'Organisation-wide channel for all members.',
    lastMessage: 'Reminder: dues deadline extended to 31 July.',
    lastAt: '2026-06-19T09:10:00Z',
    unreadCount: 2,
    muted: false,
    memberCount: 42180,
    postingBlock: 'ANNOUNCEMENT_ONLY',
    messages: [
      { id: 'm1', threadId: 'th1', authorId: 'sec', authorName: 'National Secretariat', authorRole: 'Admin', body: 'Welcome to the official NMA members channel.', createdAt: '2026-06-01T08:00:00Z', mine: false, system: false, pinned: true, imageUrl: null, reactions: [] },
      { id: 'm2', threadId: 'th1', authorId: 'sec', authorName: 'National Secretariat', authorRole: 'Admin', body: 'Reminder: dues deadline extended to 31 July.', createdAt: '2026-06-19T09:10:00Z', mine: false, system: false, pinned: false, imageUrl: null, reactions: [] },
    ],
  },
  {
    id: 'th2',
    title: 'Lagos State Chapter',
    scope: 'CHAPTER',
    description: 'Lagos chapter general discussion.',
    lastMessage: 'Dr. Bello: See everyone at the CPD seminar 👍',
    lastAt: '2026-06-19T18:42:00Z',
    unreadCount: 5,
    muted: false,
    memberCount: 6120,
    postingBlock: null,
    messages: [
      { id: 'm3', threadId: 'th2', authorId: 'u9', authorName: 'Dr. Adebayo Williams', authorRole: 'Welfare Chair', body: 'Has everyone seen the new CPD schedule?', createdAt: '2026-06-19T18:30:00Z', mine: false, system: false, pinned: false, imageUrl: null, reactions: [] },
      { id: 'm4', threadId: 'th2', authorId: 'me', authorName: 'You', authorRole: null, body: 'Yes — registering now.', createdAt: '2026-06-19T18:35:00Z', mine: true, system: false, pinned: false, imageUrl: null, reactions: [] },
      { id: 'm5', threadId: 'th2', authorId: 'u2', authorName: 'Dr. Fatima Bello', authorRole: null, body: 'See everyone at the CPD seminar 👍', createdAt: '2026-06-19T18:42:00Z', mine: false, system: false, pinned: false, imageUrl: null, reactions: [] },
    ],
  },
  {
    id: 'th3',
    title: 'Welfare Committee',
    scope: 'COMMITTEE',
    description: 'Welfare committee coordination.',
    lastMessage: 'You: Draft report attached for review.',
    lastAt: '2026-06-18T13:05:00Z',
    unreadCount: 0,
    muted: true,
    memberCount: 12,
    postingBlock: null,
    messages: [
      { id: 'm6', threadId: 'th3', authorId: 'u9', authorName: 'Dr. Adebayo Williams', authorRole: 'Chair', body: 'Please share the Q2 disbursement figures.', createdAt: '2026-06-18T12:50:00Z', mine: false, system: false, pinned: false, imageUrl: null, reactions: [] },
      { id: 'm7', threadId: 'th3', authorId: 'me', authorName: 'You', authorRole: null, body: 'Draft report attached for review.', createdAt: '2026-06-18T13:05:00Z', mine: true, system: false, pinned: false, imageUrl: null, reactions: [] },
    ],
  },
  {
    id: 'th4',
    title: 'Executive Council',
    scope: 'EXECUTIVE',
    description: 'Executive members only.',
    lastMessage: 'Restricted channel.',
    lastAt: '2026-06-17T20:00:00Z',
    unreadCount: 0,
    muted: false,
    memberCount: 22,
    postingBlock: 'ROLE_RESTRICTED',
    messages: [
      { id: 'm8', threadId: 'th4', authorId: 'sys', authorName: 'System', authorRole: null, body: 'This channel is limited to Executive Council members.', createdAt: '2026-06-17T20:00:00Z', mine: false, system: true, pinned: false, imageUrl: null, reactions: [] },
    ],
  },
  {
    id: 'th5',
    title: 'Dr. Adebayo Williams',
    scope: 'DIRECT',
    description: null,
    lastMessage: 'Thanks, talk soon.',
    lastAt: '2026-06-16T10:15:00Z',
    unreadCount: 0,
    muted: false,
    memberCount: 0,
    postingBlock: null,
    messages: [
      { id: 'm9', threadId: 'th5', authorId: 'u9', authorName: 'Dr. Adebayo Williams', authorRole: null, body: 'Could you send the welfare figures?', createdAt: '2026-06-16T10:00:00Z', mine: false, system: false, pinned: false, imageUrl: null, reactions: [] },
      { id: 'm10', threadId: 'th5', authorId: 'me', authorName: 'You', authorRole: null, body: 'Sent to your email.', createdAt: '2026-06-16T10:12:00Z', mine: true, system: false, pinned: false, imageUrl: null, reactions: [] },
      { id: 'm11', threadId: 'th5', authorId: 'u9', authorName: 'Dr. Adebayo Williams', authorRole: null, body: 'Thanks, talk soon.', createdAt: '2026-06-16T10:15:00Z', mine: false, system: false, pinned: false, imageUrl: null, reactions: [] },
    ],
  },
];

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
