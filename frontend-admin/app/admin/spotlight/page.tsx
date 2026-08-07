'use client';

import { useEffect, useState } from 'react';
import {
  listVideos, createVideo, updateVideo, deleteVideo,
  listChallenges, createChallenge, updateChallenge, deleteChallenge,
  listCampaigns, createCampaign, updateCampaign, deleteCampaign,
  formatNaira,
  type FinanceVideo, type Challenge, type Campaign, type SpotlightTopic, type ChallengeKind,
} from '@/services/spotlightAdminService';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';

const TOPICS: SpotlightTopic[] = ['budgeting', 'investing-basics', 'crypto', 'stocks', 'saving', 'mindset'];
const CHALLENGE_KINDS: ChallengeKind[] = ['literacy', 'quiz', 'savings'];

const emptyVideoForm = { id: '', title: '', creator: '', thumbnailColor: '', durationMins: 5, topic: 'budgeting' as SpotlightTopic, sortOrder: 0, published: true };
const emptyChallengeForm = { id: '', title: '', description: '', rewardNaira: 0, currency: 'NGN', endsAt: '', kind: 'literacy' as ChallengeKind, published: true };
const emptyCampaignForm = { id: '', title: '', description: '', iconColor: '', cta: '', sortOrder: 0, published: true };

function fieldLabel(): React.CSSProperties {
  return { display: 'block', fontSize: '0.78rem', color: colors.muted, marginBottom: '0.25rem', fontWeight: 600 };
}

export default function SpotlightAdminPage() {
  const [videos, setVideos] = useState<FinanceVideo[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [videoForm, setVideoForm] = useState(emptyVideoForm);
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);

  const [challengeForm, setChallengeForm] = useState(emptyChallengeForm);
  const [editingChallengeId, setEditingChallengeId] = useState<string | null>(null);

  const [campaignForm, setCampaignForm] = useState(emptyCampaignForm);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [v, c, cp] = await Promise.all([listVideos(), listChallenges(), listCampaigns()]);
      setVideos(v); setChallenges(c); setCampaigns(cp);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // ── Videos ────────────────────────────────────────────────────────────────
  function editVideo(v: FinanceVideo) {
    setEditingVideoId(v.id);
    setVideoForm({ id: v.id, title: v.title, creator: v.creator, thumbnailColor: v.thumbnailColor, durationMins: v.durationMins, topic: v.topic, sortOrder: 0, published: true });
  }
  function resetVideoForm() { setEditingVideoId(null); setVideoForm(emptyVideoForm); }

  async function submitVideo() {
    setBusy(true); setActionError(null);
    try {
      const input = {
        id: videoForm.id || undefined,
        title: videoForm.title,
        creator: videoForm.creator,
        thumbnailColor: videoForm.thumbnailColor,
        durationMins: videoForm.durationMins,
        topic: videoForm.topic,
        sortOrder: videoForm.sortOrder,
        published: videoForm.published,
      };
      if (editingVideoId) await updateVideo(editingVideoId, input);
      else await createVideo(input);
      resetVideoForm();
      await load();
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  async function removeVideo(id: string) {
    if (!confirm(`Delete video ${id}?`)) return;
    setBusy(true); setActionError(null);
    try { await deleteVideo(id); await load(); }
    catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  // ── Challenges ────────────────────────────────────────────────────────────
  // Reward is authored in ₦ in the form and converted to whole kobo (integer
  // minor units) at submit time — never floats, never strings for math
  // (Iron Rule: money handling). Server DTO field is rewardKobo (int64).
  function editChallenge(c: Challenge) {
    setEditingChallengeId(c.id);
    setChallengeForm({
      id: c.id, title: c.title, description: c.description,
      rewardNaira: c.reward.amount, currency: c.reward.currency,
      endsAt: c.endsAt ? c.endsAt.slice(0, 16) : '', kind: c.kind, published: true,
    });
  }
  function resetChallengeForm() { setEditingChallengeId(null); setChallengeForm(emptyChallengeForm); }

  async function submitChallenge() {
    setBusy(true); setActionError(null);
    try {
      const endsAtIso = challengeForm.endsAt ? new Date(challengeForm.endsAt).toISOString() : '';
      const input = {
        id: challengeForm.id || undefined,
        title: challengeForm.title,
        description: challengeForm.description,
        rewardKobo: Math.round(Number(challengeForm.rewardNaira) * 100),
        currency: challengeForm.currency || 'NGN',
        endsAt: endsAtIso,
        kind: challengeForm.kind,
        published: challengeForm.published,
      };
      if (editingChallengeId) await updateChallenge(editingChallengeId, input);
      else await createChallenge(input);
      resetChallengeForm();
      await load();
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  async function removeChallenge(id: string) {
    if (!confirm(`Delete challenge ${id}?`)) return;
    setBusy(true); setActionError(null);
    try { await deleteChallenge(id); await load(); }
    catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────
  function editCampaign(c: Campaign) {
    setEditingCampaignId(c.id);
    setCampaignForm({ id: c.id, title: c.title, description: c.description, iconColor: c.iconColor, cta: c.cta, sortOrder: 0, published: true });
  }
  function resetCampaignForm() { setEditingCampaignId(null); setCampaignForm(emptyCampaignForm); }

  async function submitCampaign() {
    setBusy(true); setActionError(null);
    try {
      const input = {
        id: campaignForm.id || undefined,
        title: campaignForm.title,
        description: campaignForm.description,
        iconColor: campaignForm.iconColor,
        cta: campaignForm.cta,
        sortOrder: campaignForm.sortOrder,
        published: campaignForm.published,
      };
      if (editingCampaignId) await updateCampaign(editingCampaignId, input);
      else await createCampaign(input);
      resetCampaignForm();
      await load();
    } catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  async function removeCampaign(id: string) {
    if (!confirm(`Delete campaign ${id}?`)) return;
    setBusy(true); setActionError(null);
    try { await deleteCampaign(id); await load(); }
    catch (e) { setActionError(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Page>
      <PageHeader
        title="Spotlight Wealth content"
        subtitle="Author creator-education videos, learn-and-earn challenges (wallet-credit rewards, never a guaranteed return) and campaigns for the Spotlight Wealth surface."
        actions={<Button onClick={load}>Refresh</Button>}
      />

      {actionError ? <p style={{ color: colors.danger, fontSize: '0.85rem' }}>{actionError}</p> : null}

      {loading ? (
        <p style={{ color: colors.muted }}>Loading…</p>
      ) : error ? (
        <p style={{ color: colors.danger }}>{error}</p>
      ) : (
        <>
          {/* ── Videos ───────────────────────────────────────────────────── */}
          <Card title={editingVideoId ? `Edit video — ${editingVideoId}` : 'Create video'} style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
              <div>
                <label style={fieldLabel()}>Title</label>
                <Input value={videoForm.title} onChange={(e) => setVideoForm({ ...videoForm, title: e.target.value })} />
              </div>
              <div>
                <label style={fieldLabel()}>Creator</label>
                <Input value={videoForm.creator} onChange={(e) => setVideoForm({ ...videoForm, creator: e.target.value })} />
              </div>
              <div>
                <label style={fieldLabel()}>Topic</label>
                <select style={{ width: '100%' }} value={videoForm.topic} onChange={(e) => setVideoForm({ ...videoForm, topic: e.target.value as SpotlightTopic })}>
                  {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel()}>Duration (mins)</label>
                <Input type="number" value={videoForm.durationMins} onChange={(e) => setVideoForm({ ...videoForm, durationMins: Number(e.target.value) })} />
              </div>
              <div>
                <label style={fieldLabel()}>Thumbnail color</label>
                <Input value={videoForm.thumbnailColor} onChange={(e) => setVideoForm({ ...videoForm, thumbnailColor: e.target.value })} placeholder="#340075" />
              </div>
              <div>
                <label style={fieldLabel()}>Sort order</label>
                <Input type="number" value={videoForm.sortOrder} onChange={(e) => setVideoForm({ ...videoForm, sortOrder: Number(e.target.value) })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button variant="primary" disabled={busy || !videoForm.title || !videoForm.creator} onClick={submitVideo}>{editingVideoId ? 'Save video' : 'Create video'}</Button>
              {editingVideoId ? <Button onClick={resetVideoForm}>Cancel</Button> : null}
            </div>
          </Card>

          <Card title={`Videos (${videos.length})`} style={{ marginBottom: '1.25rem' }}>
            {videos.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No videos yet.</p> : (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Title</th><th style={thCell}>Creator</th><th style={thCell}>Topic</th><th style={thCell}>Duration</th><th style={thCell}>Actions</th></tr></thead>
                  <tbody>
                    {videos.map((v) => (
                      <tr key={v.id}>
                        <td style={tdCell}>{v.title}</td>
                        <td style={tdCell}>{v.creator}</td>
                        <td style={tdCell}><Badge text={v.topic} color={colors.info} /></td>
                        <td style={tdCell}>{v.durationMins}m</td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <Button sm onClick={() => editVideo(v)}>Edit</Button>
                            <Button sm variant="danger" onClick={() => removeVideo(v.id)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Challenges ───────────────────────────────────────────────── */}
          <Card title={editingChallengeId ? `Edit challenge — ${editingChallengeId}` : 'Create challenge'} style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
              <div>
                <label style={fieldLabel()}>Title</label>
                <Input value={challengeForm.title} onChange={(e) => setChallengeForm({ ...challengeForm, title: e.target.value })} />
              </div>
              <div>
                <label style={fieldLabel()}>Kind</label>
                <select style={{ width: '100%' }} value={challengeForm.kind} onChange={(e) => setChallengeForm({ ...challengeForm, kind: e.target.value as ChallengeKind })}>
                  {CHALLENGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label style={fieldLabel()}>Reward (₦)</label>
                <Input type="number" min={0} step="0.01" value={challengeForm.rewardNaira} onChange={(e) => setChallengeForm({ ...challengeForm, rewardNaira: Number(e.target.value) })} />
              </div>
              <div>
                <label style={fieldLabel()}>Ends at</label>
                <Input type="datetime-local" value={challengeForm.endsAt} onChange={(e) => setChallengeForm({ ...challengeForm, endsAt: e.target.value })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={fieldLabel()}>Description</label>
                <Input value={challengeForm.description} onChange={(e) => setChallengeForm({ ...challengeForm, description: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button variant="primary" disabled={busy || !challengeForm.title || !challengeForm.endsAt} onClick={submitChallenge}>{editingChallengeId ? 'Save challenge' : 'Create challenge'}</Button>
              {editingChallengeId ? <Button onClick={resetChallengeForm}>Cancel</Button> : null}
            </div>
          </Card>

          <Card title={`Challenges (${challenges.length})`} style={{ marginBottom: '1.25rem' }}>
            {challenges.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No challenges yet.</p> : (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Title</th><th style={thCell}>Kind</th><th style={thCell}>Reward</th><th style={thCell}>Ends</th><th style={thCell}>Actions</th></tr></thead>
                  <tbody>
                    {challenges.map((c) => (
                      <tr key={c.id}>
                        <td style={tdCell}>{c.title}</td>
                        <td style={tdCell}><Badge text={c.kind} color={colors.warning} /></td>
                        <td style={tdCell}>{formatNaira(Math.round(c.reward.amount * 100))}</td>
                        <td style={tdCell}>{c.endsAt ? new Date(c.endsAt).toLocaleString('en-NG') : '—'}</td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <Button sm onClick={() => editChallenge(c)}>Edit</Button>
                            <Button sm variant="danger" onClick={() => removeChallenge(c.id)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ── Campaigns ────────────────────────────────────────────────── */}
          <Card title={editingCampaignId ? `Edit campaign — ${editingCampaignId}` : 'Create campaign'} style={{ marginBottom: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
              <div>
                <label style={fieldLabel()}>Title</label>
                <Input value={campaignForm.title} onChange={(e) => setCampaignForm({ ...campaignForm, title: e.target.value })} />
              </div>
              <div>
                <label style={fieldLabel()}>CTA</label>
                <Input value={campaignForm.cta} onChange={(e) => setCampaignForm({ ...campaignForm, cta: e.target.value })} />
              </div>
              <div>
                <label style={fieldLabel()}>Icon color</label>
                <Input value={campaignForm.iconColor} onChange={(e) => setCampaignForm({ ...campaignForm, iconColor: e.target.value })} placeholder="#340075" />
              </div>
              <div>
                <label style={fieldLabel()}>Sort order</label>
                <Input type="number" value={campaignForm.sortOrder} onChange={(e) => setCampaignForm({ ...campaignForm, sortOrder: Number(e.target.value) })} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={fieldLabel()}>Description</label>
                <Input value={campaignForm.description} onChange={(e) => setCampaignForm({ ...campaignForm, description: e.target.value })} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
              <Button variant="primary" disabled={busy || !campaignForm.title} onClick={submitCampaign}>{editingCampaignId ? 'Save campaign' : 'Create campaign'}</Button>
              {editingCampaignId ? <Button onClick={resetCampaignForm}>Cancel</Button> : null}
            </div>
          </Card>

          <Card title={`Campaigns (${campaigns.length})`}>
            {campaigns.length === 0 ? <p style={{ color: colors.muted, marginTop: '0.75rem' }}>No campaigns yet.</p> : (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thCell}>Title</th><th style={thCell}>CTA</th><th style={thCell}>Description</th><th style={thCell}>Actions</th></tr></thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id}>
                        <td style={tdCell}>{c.title}</td>
                        <td style={tdCell}>{c.cta}</td>
                        <td style={tdCell}>{c.description}</td>
                        <td style={tdCell}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <Button sm onClick={() => editCampaign(c)}>Edit</Button>
                            <Button sm variant="danger" onClick={() => removeCampaign(c.id)}>Delete</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
