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
import { Page, PageHeader, Card, Button, Input } from '@/components/ui/vuexy';

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
    <Page>
      <PageHeader title="STEM Voting and Paid Voting" />
      <StemModuleLinks />
      <Card style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Input placeholder="Contest ID" value={contestId} onChange={(e) => setContestId(e.target.value)} />
          <Button variant="outline" onClick={() => void load()}>Load</Button>
          <Button
            variant="primary"
            onClick={() => void upsertStemVotingRule({ contestId, votingStatus: 'ACTIVE', votingMode: 'HYBRID', dailyVoteLimit: 3, oneUserOneVote: false, allowPaidVotes: true }).then(load)}
          >
            Upsert Rule
          </Button>
          <Button
            variant="primary"
            onClick={() => void createStemVotePackage({ contestId, name: 'Starter Pack', votes: 10, amountNgn: 1000, isActive: true }).then(load)}
          >
            Add Package
          </Button>
          <Button
            variant="primary"
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
          >
            Record Paid Vote Tx
          </Button>
        </div>
        <p style={{ marginTop: 12, fontSize: 13 }}>Rules: {rules.length} · Packages: {packages.length} · Transactions: {transactions.length}</p>
      </Card>
    </Page>
  );
}
