'use client';

// 9.D.1 — Per-asset cap table + export. 9.D.2 — Ownership transfers (dual-control).

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getCapTable, listAssets, transferUnits } from '@/services/fractionalreAdminService';
import type { AdminAsset, CapTable, TransferUnitsInput } from '@/types/fractionalreAdmin';
import { FractionalReTabs, SodNote } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

const SOURCE_COLOR: Record<string, string> = {
  primary: colors.info, secondary: colors.secondary, matched: colors.secondary, correction: colors.warning,
};

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
    <Page>
      <PageHeader title="Cap table" subtitle="Ownership ledger per asset, exportable; transfers are dual-control." actions={<Button onClick={() => load(assetId)}>Refresh</Button>} />
      <FractionalReTabs active="cap-table" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="vx-input" style={{ width: 320 }}>
          <option value="">Select asset…</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <Button onClick={exportCsv} disabled={!cap}>Export CSV</Button>
      </div>

      <Card title={cap ? `${cap.assetName} — ${cap.unitsAllocated.toLocaleString('en-NG')} / ${cap.totalUnits.toLocaleString('en-NG')} units` : 'Cap table'}>
        {loading ? <p style={{ color: colors.muted }}>Loading cap table…</p> : !cap || cap.entries.length === 0 ? <p style={{ color: colors.muted }}>No holders.</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thCell}>Investor</th><th style={thCell}>Units</th><th style={thCell}>Ownership</th><th style={thCell}>Acquired</th><th style={thCell}>Source</th><th style={thCell}>Certificate</th></tr></thead>
            <tbody>{cap.entries.map((e) => (
              <tr key={e.id}><td style={tdCell}>{e.investorName}</td><td style={tdCell}>{e.units.toLocaleString('en-NG')}</td><td style={tdCell}>{e.ownershipPct}%</td><td style={tdCell}>{new Date(e.acquisitionDate).toLocaleDateString('en-NG')}</td><td style={tdCell}><Badge text={e.source} color={SOURCE_COLOR[e.source] ?? colors.secondary} /></td><td style={tdCell}>{e.certificateRef ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      <SodNote>Ownership transfers / manual corrections are <strong>logged and dual-control</strong>: this submits a request that a second authorised user must approve.</SodNote>
      <Card title="Ownership transfer / correction">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.8rem', maxWidth: 640 }}>
          <div><label style={labelStyle}>From investor ID</label><Input value={xfer.from} onChange={(e) => setXfer({ ...xfer, from: e.target.value })} placeholder="inv-2" /></div>
          <div><label style={labelStyle}>To investor ID</label><Input value={xfer.to} onChange={(e) => setXfer({ ...xfer, to: e.target.value })} placeholder="inv-3" /></div>
          <div><label style={labelStyle}>Units</label><Input value={xfer.units} onChange={(e) => setXfer({ ...xfer, units: e.target.value })} placeholder="20" /></div>
          <div><label style={labelStyle}>Reason (logged)</label><Input value={xfer.reason} onChange={(e) => setXfer({ ...xfer, reason: e.target.value })} /></div>
        </div>
        <Button variant="primary" onClick={submitTransfer} disabled={working || !xfer.from || !xfer.to || !xfer.units || !xfer.reason} style={{ marginTop: '0.8rem' }}>{working ? 'Submitting…' : 'Submit transfer (maker)'}</Button>
      </Card>
    </Page>
  );
}
