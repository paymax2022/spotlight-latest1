import type { Election } from '../types/election.types';

const H = 3_600_000;
const D = 24 * H;
const iso = (off: number) => new Date(Date.now() + off).toISOString();

// One election whose admin-set window is currently OPEN (started 1h ago, ends in
// 6h), so the resident header banner shows as live. Change startsAt to a future
// time to see the "scheduled" (banner-off) behaviour.
export const seedElections: Election[] = [
  {
    id: 'elec_2026_exco',
    estateId: 'est_amber_court',
    title: '2026 Estate Exco Election',
    description: 'Vote for the executive committee that will run Amber Court for the 2026–2027 term.',
    startsAt: iso(-1 * H),
    endsAt: iso(6 * H),
    status: 'live',
    totalEligibleVoters: 142,
    votesCast: 63,
    resultsPublished: false,
    positions: [
      {
        id: 'pos_chair',
        title: 'Chairperson',
        seats: 1,
        candidates: [
          { id: 'cand_1', positionId: 'pos_chair', name: 'Ngozi Okeke', manifesto: 'Transparent dues, better security, monthly town halls.', votes: 41 },
          { id: 'cand_2', positionId: 'pos_chair', name: 'Emeka Eze', manifesto: 'Invest in solar power and faster repair turnaround.', votes: 22 },
        ],
      },
      {
        id: 'pos_treasurer',
        title: 'Treasurer',
        seats: 1,
        candidates: [
          { id: 'cand_3', positionId: 'pos_treasurer', name: 'Fatima Sani', manifesto: 'Audited accounts every quarter, digital receipts.', votes: 39 },
          { id: 'cand_4', positionId: 'pos_treasurer', name: 'Bola Adeyemi', manifesto: 'Zero-based budgeting and a reserve fund.', votes: 24 },
        ],
      },
    ],
  },
  {
    id: 'elec_security_lead',
    estateId: 'est_amber_court',
    title: 'Security Committee Lead',
    description: 'Voting has closed. Results are awaiting admin publication.',
    startsAt: iso(-2 * D),
    endsAt: iso(-2 * H),
    status: 'closed',
    totalEligibleVoters: 140,
    votesCast: 96,
    resultsPublished: false,
    positions: [
      {
        id: 'pos_seclead',
        title: 'Security Committee Lead',
        seats: 1,
        candidates: [
          { id: 'cand_s1', positionId: 'pos_seclead', name: 'Yusuf Bello', manifesto: 'Two extra night patrols and a gate-camera upgrade.', votes: 54 },
          { id: 'cand_s2', positionId: 'pos_seclead', name: 'Ifeoma Okafor', manifesto: 'Visitor-code audits and a resident safety hotline.', votes: 42 },
        ],
      },
    ],
  },
  {
    id: 'elec_2025_review',
    estateId: 'est_amber_court',
    title: '2025 Service Charge Review',
    description: 'A past poll on the 2025 service charge.',
    startsAt: iso(-30 * D),
    endsAt: iso(-28 * D),
    status: 'results_published',
    totalEligibleVoters: 138,
    votesCast: 121,
    resultsPublished: true,
    positions: [
      {
        id: 'pos_review',
        title: 'Approve the 2025 service charge?',
        seats: 1,
        candidates: [
          { id: 'cand_y', positionId: 'pos_review', name: 'Approve', votes: 78 },
          { id: 'cand_n', positionId: 'pos_review', name: 'Reject', votes: 43 },
        ],
      },
    ],
  },
];
