'use client';

import { useState } from 'react';
import { StemModuleLinks } from '../../stem/_components/StemModuleLinks';
import {
  createStemVotePackage,
  createStemVoteTransaction,
  listStemVotePackages,
  listStemVoteTransactions,
  listStemVotingRules,
  upsertStemVotingRule,
} from '@/services/stemService';
import type { StemVotePackage, StemVotingRule, StemVoteTransaction } from '@/types/stem';

export default function AdminStemVotingPage() {
  const [contestId, setContestId] = useState('');
  const [rules, setRules] = useState<StemVotingRule[]>([]);
  const [packages, setPackages] = useState<StemVotePackage[]>([]);
  const [transactions, setTransactions] = useState<StemVoteTransaction[]>([]);

  async function load() {
    setRules(await listStemVotingRules(contestId, 100));
    setPackages(await listStemVotePackages(contestId, 100));
    setTransactions(await listStemVoteTransactions(contestId, 100));
  }

  return (
    <section>
      <h1>STEM Voting and Paid Voting</h1>
      <StemModuleLinks />
      <input placeholder="Contest ID" value={contestId} onChange={(e) => setContestId(e.target.value)} />
      <button type="button" onClick={() => void load()} style={{ marginLeft: 8 }}>Load</button>
      <button
        type="button"
        onClick={() => void upsertStemVotingRule({ contestId, votingStatus: 'ACTIVE', votingMode: 'HYBRID', dailyVoteLimit: 3, oneUserOneVote: false, allowPaidVotes: true }).then(load)}
        style={{ marginLeft: 8 }}
      >
        Upsert Rule
      </button>
      <button
        type="button"
        onClick={() => void createStemVotePackage({ contestId, name: 'Starter Pack', votes: 10, amountNgn: 1000, isActive: true }).then(load)}
        style={{ marginLeft: 8 }}
      >
        Add Package
      </button>
      <button
        type="button"
        onClick={() =>
          void createStemVoteTransaction({
            contestId,
            applicationId: '',
            packageId: packages[0]?.id || '',
            voterRef: `manual-${Date.now()}`,
            paymentReference: `pay-${Date.now()}`,
            amountNgn: 1000,
            votesAllocated: 10,
            status: 'success',
          }).then(load)
        }
        style={{ marginLeft: 8 }}
      >
        Record Paid Vote Tx
      </button>
      <p style={{ marginTop: 10 }}>Rules: {rules.length} · Packages: {packages.length} · Transactions: {transactions.length}</p>
    </section>
  );
}
