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
import { PageHeader, FractionalReTabs, Card, Badge, btn, btnPrimary, th, td, input, label, money, timeAgo } from '../_ui';

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

  const stateLabel = (): CSSProperties => ({ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, display: 'block', marginBottom: 2 });
  const stateValue = (): CSSProperties => ({ fontSize: '0.95rem', fontWeight: 600, color: '#111827' });

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Secondary market" subtitle="Listings oversight, NAV sanity and market controls." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <FractionalReTabs active="market" />
      {error && <p style={{ color: '#dc2626' }}>{error}</p>}
      {msg && <p style={{ color: '#15803d' }}>{msg}</p>}

      {loading ? <p style={{ color: '#6b7280' }}>Loading market…</p> : (
        <>
          <Card title="Market controls" right={controls ? <Badge status={controls.tradingPaused ? 'halted' : 'active'} label={controls.tradingPaused ? 'paused' : 'live'} /> : <Badge status="draft" label="unknown" />}>
            {/* Current state (read-only) — shown before the mutation controls. */}
            <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap', marginBottom: '1rem', paddingBottom: '0.85rem', borderBottom: '1px solid #f3f4f6' }}>
              <div><span style={stateLabel()}>Trading</span><span style={stateValue()}>{controls ? <Badge status={controls.tradingPaused ? 'halted' : 'active'} label={controls.tradingPaused ? 'paused' : 'enabled'} /> : '—'}</span></div>
              <div><span style={stateLabel()}>Secondary fee</span><span style={stateValue()}>{controls ? `${controls.secondaryFeeBps} bps` : '—'}</span></div>
              <div><span style={stateLabel()}>Price band vs NAV</span><span style={stateValue()}>{controls ? `±${controls.priceBandPct}%` : '—'}</span></div>
              <div><span style={stateLabel()}>Paused assets</span><span style={stateValue()}>{controls ? controls.pausedAssetIds.length : '—'}</span></div>
            </div>
            {controls ? (
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'end', flexWrap: 'wrap' }}>
                <div style={{ width: 160 }}><label style={label()}>Secondary fee (bps)</label><input value={feeBps} onChange={(e) => setFeeBps(e.target.value)} style={input()} /></div>
                <div style={{ width: 160 }}><label style={label()}>Price band (% vs NAV)</label><input value={bandPct} onChange={(e) => setBandPct(e.target.value)} style={input()} /></div>
                <button onClick={saveControls} disabled={busy === 'controls'} style={btnPrimary()}>Save controls</button>
                <button onClick={togglePause} disabled={busy === 'pause'} style={btnPrimary(controls.tradingPaused ? '#16a34a' : '#dc2626')}>{controls.tradingPaused ? 'Resume trading' : 'Pause trading'}</button>
              </div>
            ) : (
              <p style={{ fontSize: '0.8rem', color: '#6b7280', margin: 0 }}>Current control state could not be read (the backend may not expose GET /market/controls yet). Mutations are disabled until the state loads — refresh once the backend is updated.</p>
            )}
          </Card>

          <Card title="Active listings">
            {listings.length === 0 ? <p style={{ color: '#6b7280' }}>No listings.</p> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th()}>Asset</th><th style={th()}>Seller</th><th style={th()}>Units</th><th style={th()}>Ask / unit</th><th style={th()}>NAV / unit</th><th style={th()}>Premium</th><th style={th()}>Status</th><th style={th()} /></tr></thead>
                <tbody>{listings.map((l) => {
                  const flagged = controls ? Math.abs(l.pricePremiumPct) > controls.priceBandPct : false;
                  return (
                    <tr key={l.id}>
                      <td style={td()}>{l.assetName}</td><td style={td()}>{l.sellerName}</td><td style={td()}>{l.units}</td>
                      <td style={td()}>{money(l.askPriceKobo)}</td><td style={td()}>{money(l.navPriceKobo)}</td>
                      <td style={{ ...td(), color: flagged ? '#dc2626' : '#15803d', fontWeight: flagged ? 700 : 400 }}>{l.pricePremiumPct > 0 ? '+' : ''}{l.pricePremiumPct}%{flagged ? ' ⚠' : ''}</td>
                      <td style={td()}><Badge status={l.status} /></td>
                      <td style={td()}>{l.status === 'active' ? <button disabled={busy === l.id} onClick={() => halt(l.id)} style={btnPrimary('#dc2626')}>Halt</button> : '—'}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.6rem', marginBottom: 0 }}>{controls ? `Listings outside the ±${controls.priceBandPct}% NAV band are flagged ⚠ for review.` : 'NAV-band flagging unavailable until market controls load.'}</p>
          </Card>
          {listings.length > 0 && <p style={{ fontSize: '0.72rem', color: '#9ca3af' }}>Last listed activity: {timeAgo(listings[0].listedAt)}.</p>}
        </>
      )}
    </div>
  );
}
