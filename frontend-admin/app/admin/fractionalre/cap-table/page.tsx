'use client';

// 9.D.1 — Per-asset cap table + export. 9.D.2 — Ownership transfers (dual-control).

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getCapTable, listAssets, transferUnits } from '@/services/fractionalreAdminService';
import type { AdminAsset, CapTable, TransferUnitsInput } from '@/types/fractionalreAdmin';
import { PageHeader, FractionalReTabs, Card, Badge, SodNote, btn, btnPrimary, th, td, input, label } from '../_ui';

export default function CapTablePage() {
  const params = useSearchParams();
  const [assets, setAssets] = useState<AdminAsset[]>([]);
  const [assetId, setAssetId] = useState<string>(params?.get('asset') ?? '');
  const [cap, setCap] = useState<CapTable | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [xfer, setXfer] = useState<{ from: string; to: string; units: string; reason: string }>({ from: '', to: '', units: '', reason: '' });
  const [working, setWorking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await listAssets();
        setAssets(list);
        if (!assetId && list.length) setAssetId(list[0].id);
      } catch (e) { setError(String(e)); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(id: string) {
    if (!id) return;
    setLoading(true); setError(null);
    try { setCap(await getCapTable(id)); } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { if (assetId) load(assetId); }, [assetId]);

  function exportCsv() {
    if (!cap) return;
    const rows = [['Investor', 'Units', 'Ownership %', 'Acquisition', 'Source', 'Certificate']];
    cap.entries.forEach((e) => rows.push([e.investorName, String(e.units), String(e.ownershipPct), e.acquisitionDate, e.source, e.certificateRef ?? '']));
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cap-table-${assetId}.csv`; a.click();
  }

  async function submitTransfer() {
    if (!assetId || !xfer.from || !xfer.to || !xfer.units || !xfer.reason) return;
    setWorking(true); setError(null); setMsg(null);
    try {
      const payload: TransferUnitsInput = { assetId, fromInvestorId: xfer.from, toInvestorId: xfer.to, units: parseInt(xfer.units, 10), reason: xfer.reason, source: 'correction' };
      const res = await transferUnits(payload);
      setMsg(`Transfer submitted (${res.status}) — awaiting second control / checker approval.`);
      setXfer({ from: '', to: '', units: '', reason: '' });
    } catch (e) { setError(String(e)); } finally { setWorking(false); }
  }

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Cap table" subtitle="Ownership ledger per asset, exportable; transfers are dual-control." action={<button onClick={() => load(assetId)} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="cap-table" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ ...input(), width: 320 }}>
          <option value="">Select asset…</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button onClick={exportCsv} disabled={!cap} style={btn()}>Export CSV</button>
      </div>

      <Card title={cap ? `${cap.assetName} — ${cap.unitsAllocated.toLocaleString('en-NG')} / ${cap.totalUnits.toLocaleString('en-NG')} units` : 'Cap table'}>
        {loading ? <p style={{ color: '#6b7280' }}>Loading cap table…</p> : !cap || cap.entries.length === 0 ? <p style={{ color: '#6b7280' }}>No holders.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th()}>Investor</th><th style={th()}>Units</th><th style={th()}>Ownership</th><th style={th()}>Acquired</th><th style={th()}>Source</th><th style={th()}>Certificate</th></tr></thead>
            <tbody>{cap.entries.map((e) => (
              <tr key={e.id}><td style={td()}>{e.investorName}</td><td style={td()}>{e.units.toLocaleString('en-NG')}</td><td style={td()}>{e.ownershipPct}%</td><td style={td()}>{new Date(e.acquisitionDate).toLocaleDateString('en-NG')}</td><td style={td()}><Badge status={e.source} /></td><td style={td()}>{e.certificateRef ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <SodNote>Ownership transfers / manual corrections are <strong>logged and dual-control</strong>: this submits a request that a second authorised user must approve.</SodNote>
      <Card title="Ownership transfer / correction">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.8rem', maxWidth: 640 }}>
          <div><label style={label()}>From investor ID</label><input value={xfer.from} onChange={(e) => setXfer({ ...xfer, from: e.target.value })} style={input()} placeholder="inv-2" /></div>
          <div><label style={label()}>To investor ID</label><input value={xfer.to} onChange={(e) => setXfer({ ...xfer, to: e.target.value })} style={input()} placeholder="inv-3" /></div>
          <div><label style={label()}>Units</label><input value={xfer.units} onChange={(e) => setXfer({ ...xfer, units: e.target.value })} style={input()} placeholder="20" /></div>
          <div><label style={label()}>Reason (logged)</label><input value={xfer.reason} onChange={(e) => setXfer({ ...xfer, reason: e.target.value })} style={input()} /></div>
        </div>
        <button onClick={submitTransfer} disabled={working || !xfer.from || !xfer.to || !xfer.units || !xfer.reason} style={{ ...btnPrimary(), marginTop: '0.8rem', opacity: working || !xfer.from || !xfer.to || !xfer.units || !xfer.reason ? 0.6 : 1 }}>{working ? 'Submitting…' : 'Submit transfer (maker)'}</button>
      </Card>
    </div>
  );
}
