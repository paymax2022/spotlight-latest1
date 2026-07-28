// ── Association — AI note-taking mock dataset (L) ─────────────────────────────

import type { AiNote } from '../types/ainotes.types';

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
