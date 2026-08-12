'use client';

// 9.H — Secondary market: listings oversight, price-vs-NAV sanity, halt,
// fee/price-band controls.
//
// Current control state is read via GET /market/controls (mirrors the Go admin
// group's PUT /market/controls). The GET may lag the PUT on older backend
// deploys — a failed GET degrades to an em-dash state and disables mutations,
// but listings oversight keeps working.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { listMarketListings, haltListing, getMarketControls, setMarketControls } from '@/services/fractionalreAdminService';
import type { SecondaryListing, MarketControls } from '@/types/fractionalreAdmin';
import { FractionalReTabs, money, timeAgo } from '../_ui';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const STATUS_COLOR: Record<string, string> = {
  active: colors.success, halted: colors.danger, closed: colors.secondary, pending: colors.warning, matched: colors.secondary,
};

const labelStyle = { fontSize: '0.78rem', fontWeight: 600, color: colors.text, display: 'block', marginBottom: 4 } as const;

export default function MarketPage() {
  const [listings, setListings] = useState<SecondaryListing[]>([]);
  const [controls, setControls] = useState<MarketControls | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feeBps, setFeeBps] = useState('');
  const [bandPct, setBandPct] = useState('');

  async function load() {
    setLoading(true); setError(null);
    const [l, c] = await Promise.allSettled([listMarketListings(), getMarketControls()]);
    if (l.status === 'fulfilled') setListings(l.value); else setError(String(l.reason));
    if (c.status === 'fulfilled') {
      setControls(c.value); setFeeBps(String(c.value.secondaryFeeBps)); setBandPct(String(c.value.priceBandPct));
    } else {
      setControls(null); // GET /market/controls 404s on backends that only ship the PUT — degrade, don't fail.
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function halt(id: string) {
    const reason = window.prompt('Reason to halt listing:') || '';
    if (!reason) return;
    setBusy(id); setError(null); setMsg(null);
    try { await haltListing(id, reason); setMsg('Listing halted.'); await load(); } catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function saveControls() {
    if (!controls) return;
    setBusy('controls'); setError(null); setMsg(null);
    try { const c = await setMarketControls({ ...controls, secondaryFeeBps: parseInt(feeBps, 10), priceBandPct: parseInt(bandPct, 10) }); setControls(c); setMsg('Market controls saved.'); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }
  async function togglePause() {
    if (!controls) return;
    setBusy('pause'); setError(null); setMsg(null);
    try { const c = await setMarketControls({ ...controls, tradingPaused: !controls.tradingPaused }); setControls(c); setMsg(c.tradingPaused ? 'Trading paused.' : 'Trading resumed.'); }
    catch (e) { setError(String(e)); } finally { setBusy(null); }
  }

  const stateLabel = (): CSSProperties => ({ fontSize: '0.72rem', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 2 });
  const stateValue = (): CSSProperties => ({ fontSize: '0.95rem', fontWeight: 600, color: colors.text });

  return (
    <Page>
      <PageHeader title="Secondary market" subtitle="Listings oversight, NAV sanity and market controls." actions={<Button onClick={load}>Refresh</Button>} />
      <FractionalReTabs active="market" />
      {error && <p style={{ color: colors.danger }}>{error}</p>}
      {msg && <p style={{ color: colors.success }}>{msg}</p>}

      {loading ? <p style={{ color: colors.muted }}>Loading market…</p> : (
        <>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Market controls</h2>
              {controls ? <Badge text={controls.tradingPaused ? 'paused' : 'live'} color={controls.tradingPaused ? colors.danger : colors.success} /> : <Badge text="unknown" color={colors.secondary} />}
            </div>
            {/* Current state (read-only) — shown before the mutation controls. */}
            <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '1rem', paddingBottom: '0.85rem', borderBottom: `1px solid ${colors.border}` }}>
              <div><span style={stateLabel()}>Trading</span><span style={stateValue()}>{controls ? <Badge text={controls.tradingPaused ? 'paused' : 'enabled'} color={controls.tradingPaused ? colors.danger : colors.success} /> : '—'}</span></div>
              <div><span style={stateLabel()}>Secondary fee</span><span style={stateValue()}>{controls ? `${controls.secondaryFeeBps} bps` : '—'}</span></div>
              <div><span style={stateLabel()}>Price band vs NAV</span><span style={stateValue()}>{controls ? `±${controls.priceBandPct}%` : '—'}</span></div>
              <div><span style={stateLabel()}>Paused assets</span><span style={stateValue()}>{controls ? controls.pausedAssetIds.length : '—'}</span></div>
            </div>
            {controls ? (
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'end', flexWrap: 'wrap' }}>
                <div style={{ width: 160 }}><label style={labelStyle}>Secondary fee (bps)</label><Input value={feeBps} onChange={(e) => setFeeBps(e.target.value)} /></div>
                <div style={{ width: 160 }}><label style={labelStyle}>Price band (% vs NAV)</label><Input value={bandPct} onChange={(e) => setBandPct(e.target.value)} /></div>
                <Button variant="primary" onClick={saveControls} disabled={busy === 'controls'}>Save controls</Button>
                <Button variant={controls.tradingPaused ? 'primary' : 'danger'} onClick={togglePause} disabled={busy === 'pause'}>{controls.tradingPaused ? 'Resume trading' : 'Pause trading'}</Button>
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: colors.muted, margin: 0 }}>Current control state could not be read (the backend may not expose GET /market/controls yet). Mutations are disabled until the state loads — refresh once the backend is updated.</p>
            )}
          </Card>

          <Card title="Active listings">
            {listings.length === 0 ? <p style={{ color: colors.muted }}>No listings.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={thCell}>Asset</th><th style={thCell}>Seller</th><th style={thCell}>Units</th><th style={thCell}>Ask / unit</th><th style={thCell}>NAV / unit</th><th style={thCell}>Premium</th><th style={thCell}>Status</th><th style={thCell} /></tr></thead>
                <tbody>{listings.map((l) => {
                  const flagged = controls ? Math.abs(l.pricePremiumPct) > controls.priceBandPct : false;
                  return (
                    <tr key={l.id}>
                      <td style={tdCell}>{l.assetName}</td><td style={tdCell}>{l.sellerName}</td><td style={tdCell}>{l.units}</td>
                      <td style={tdCell}>{money(l.askPriceKobo)}</td><td style={tdCell}>{money(l.navPriceKobo)}</td>
                      <td style={{ ...tdCell, color: flagged ? colors.danger : colors.success, fontWeight: flagged ? 700 : 400 }}>{l.pricePremiumPct > 0 ? '+' : ''}{l.pricePremiumPct}%{flagged ? ' ⚠' : ''}</td>
                      <td style={tdCell}><Badge text={l.status} color={STATUS_COLOR[l.status.toLowerCase()] ?? colors.secondary} /></td>
                      <td style={tdCell}>{l.status === 'active' ? <Button variant="danger" sm disabled={busy === l.id} onClick={() => halt(l.id)}>Halt</Button> : '—'}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            <p style={{ fontSize: '0.75rem', color: colors.muted, marginTop: '0.6rem', marginBottom: 0 }}>{controls ? `Listings outside the ±${controls.priceBandPct}% NAV band are flagged ⚠ for review.` : 'NAV-band flagging unavailable until market controls load.'}</p>
          </Card>
          {listings.length > 0 && <p style={{ fontSize: '0.72rem', color: colors.muted }}>Last listed activity: {timeAgo(listings[0].listedAt)}.</p>}
        </>
      )}
    </Page>
  );
}
