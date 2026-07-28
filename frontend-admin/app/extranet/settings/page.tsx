'use client';

import { useEffect, useState } from 'react';
import { getSettings, updateSettings } from '@/services/staysExtranetService';
import type { ExtranetSettings } from '@/types/staysExtranet';
import { PageHeader, ExtranetTabs, Card, PropertyScopeNote, StateBlock, btn, btnPrimary, label, select } from '../_ui';

export default function SettingsPage() {
  const [data, setData] = useState<ExtranetSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setData(await getSettings()); }
    catch (e) { setError(String(e)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!data) return;
    setSaving(true);
    try { setData(await updateSettings(data)); setSavedAt(new Date().toLocaleTimeString('en-NG')); }
    catch (e) { setError(String(e)); } finally { setSaving(false); }
  }
  const setNotif = (k: keyof ExtranetSettings['notifications']) => setData((x) => (x ? { ...x, notifications: { ...x.notifications, [k]: !x.notifications[k] } } : x));
  const setChannel = (k: keyof ExtranetSettings['channel']) => setData((x) => (x ? { ...x, channel: { ...x.channel, [k]: !x.channel[k] } } : x));

  return (
    <div style={{ padding: '0.5rem 0.5rem 2rem' }}>
      <PageHeader title="Settings & notifications" subtitle="Choose which events notify you and how. Timezone affects arrival/departure cut-offs." action={<button onClick={load} style={btn()}>Refresh</button>} />
      <ExtranetTabs active="account" />
      <PropertyScopeNote propertyName="Lekki Grand Hotel & Suites" />

      <StateBlock loading={loading} error={error} empty={!data}>
        {data && (
          <>
            <Card title="Notify me about">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.6rem' }}>
                {(Object.keys(data.notifications) as (keyof ExtranetSettings['notifications'])[]).map((k) => (
                  <label key={k} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={data.notifications[k]} onChange={() => setNotif(k)} />{k.replace(/_/g, ' ')}
                  </label>
                ))}
              </div>
            </Card>

            <Card title="Delivery channels">
              <div style={{ display: 'flex', gap: '1.2rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                {(Object.keys(data.channel) as (keyof ExtranetSettings['channel'])[]).map((k) => (
                  <label key={k} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={data.channel[k]} onChange={() => setChannel(k)} />{k.toUpperCase()}
                  </label>
                ))}
              </div>
            </Card>

            <Card title="Preferences">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.7rem' }}>
                <div><label style={label()}>Timezone</label>
                  <select style={select()} value={data.timezone} onChange={(e) => setData({ ...data, timezone: e.target.value })}>
                    {['Africa/Lagos', 'Africa/Abuja', 'UTC'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div><label style={label()}>Default currency</label>
                  <select style={select()} value={data.default_currency} onChange={(e) => setData({ ...data, default_currency: e.target.value as ExtranetSettings['default_currency'] })}>
                    <option value="NGN">NGN (₦)</option>
                  </select>
                </div>
              </div>
            </Card>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button style={btnPrimary()} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
              {savedAt ? <span style={{ color: '#15803d', fontSize: '0.82rem' }}>Saved at {savedAt}</span> : null}
            </div>
          </>
        )}
      </StateBlock>
    </div>
  );
}
