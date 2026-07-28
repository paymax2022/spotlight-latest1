'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBusinessVerification, getBankSettings } from '@/services/staysExtranetService';
import type { BusinessVerification, BankSettings } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, Badge, StateBlock, btn, btnPrimary, th, td } from '../../_ui';

export default function VerificationPage() {
  const [biz, setBiz] = useState<BusinessVerification | null>(null);
  const [bank, setBank] = useState<BankSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { const [b, k] = await Promise.all([getBusinessVerification(), getBankSettings()]); setBiz(b); setBank(k); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Business & identity verification" subtitle="KYC for the property owner, business documents (CAC), and your Naira payout account. Required before go-live." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="onboarding" />
      <PropertyScopeNote propertyName={biz?.legal_name ?? 'your property'} />

      <StateBlock loading={loading} error={error} empty={!biz}>
        {biz && bank && (
          <>
            <Card title="Step 3 of 6 — Identity & business documents">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={td()}>Legal entity name</td><td style={td()}>{biz.legal_name}</td><td style={td()}><Badge status="verified" /></td></tr>
                  <tr><td style={td()}>CAC RC number</td><td style={td()}>{biz.rc_number}</td><td style={td()}><Badge status={biz.business_doc_status} /></td></tr>
                  <tr><td style={td()}>Tax identification number (TIN)</td><td style={td()}>{biz.tin}</td><td style={td()}><Badge status="verified" /></td></tr>
                  <tr><td style={td()}>Director KYC ({biz.director_name})</td><td style={td()}>BVN ••••{biz.director_bvn_last4}</td><td style={td()}><Badge status={biz.kyc_status} /></td></tr>
                </tbody>
              </table>
            </Card>

            <Card title="Payout account (Naira settlement)">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <tr><td style={td()}>Bank</td><td style={td()}>{bank.bank_name}</td><td style={td()}>{bank.verified ? <Badge status="verified" /> : <Badge status="pending" />}</td></tr>
                  <tr><td style={td()}>Account name</td><td style={td()}>{bank.account_name}</td><td style={td()} /></tr>
                  <tr><td style={td()}>Account number</td><td style={td()}>••••{bank.account_number.slice(-4)}</td><td style={td()} /></tr>
                  <tr><td style={td()}>Settlement currency</td><td style={td()}>{bank.currency} (₦)</td><td style={td()} /></tr>
                </tbody>
              </table>
              <Link href="/extranet/onboarding/content-wizard" style={{ ...btnPrimary(), textDecoration: 'none', display: 'inline-block', marginTop: '0.75rem' }}>Continue → Content wizard</Link>
            </Card>
          </>
        )}
      </StateBlock>
    </div>
  );
}
