'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CrowdfundingApiError,
  getCampaign,
  getComments,
  getContributors,
  postComment,
  toggleSave,
} from '@/src/lib/crowdfunding/api';
import { formatNaira, progressPct, daysLeft } from '@/src/lib/crowdfunding/format';
import type { CampaignComment, CampaignDetail, Contributor } from '@/src/types/crowdfunding-customer';

type Tab = 'story' | 'updates' | 'comments' | 'contributors' | 'milestones' | 'rewards' | 'documents';

export default function CrowdfundingDetailClient({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [comments, setComments] = useState<CampaignComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('story');
  const [saving, setSaving] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [isQuestion, setIsQuestion] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await getCampaign(campaignId);
        if (cancelled) return;
        if (!data) return; // redirected to login
        setCampaign(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load this campaign.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [campaignId]);

  useEffect(() => {
    if (tab === 'contributors' && contributors.length === 0) {
      void getContributors(campaignId).then(setContributors).catch(() => {});
    }
    if (tab === 'comments' && comments.length === 0) {
      void getComments(campaignId).then(setComments).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, campaignId]);

  async function onToggleSave() {
    if (!campaign) return;
    setSaving(true);
    try {
      const result = await toggleSave(campaign.id, campaign.saved);
      if (result) setCampaign((prev) => prev ? { ...prev, saved: result.saved } : prev);
    } catch {
      // Non-critical.
    } finally {
      setSaving(false);
    }
  }

  async function onPostComment() {
    if (!commentBody.trim()) return;
    setPostingComment(true);
    try {
      const created = await postComment(campaignId, commentBody.trim(), isQuestion);
      if (created) {
        setComments((prev) => [created, ...prev]);
        setCampaign((prev) => prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev);
        setCommentBody('');
        setIsQuestion(false);
      }
    } catch (e) {
      setError(e instanceof CrowdfundingApiError ? e.message : 'Unable to post your comment.');
    } finally {
      setPostingComment(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[220, 100, 300].map((h, i) => <div key={i} style={{ height: h, background: 'rgba(0,0,0,0.06)', borderRadius: 10 }} />)}
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ color: '#dc2626' }}>{error || 'Campaign not found.'}</p>
        <Link href="/crowdfunding" className="btn-outline py-2.5 px-4 text-[11px]">Back to Campaigns</Link>
      </div>
    );
  }

  const pct = progressPct(campaign.raisedKobo, campaign.goalKobo);
  const left = daysLeft(campaign.deadline);
  const canContribute = campaign.status === 'ACTIVE';

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'story', label: 'Story' },
    { id: 'updates', label: 'Updates', count: campaign.updates.length },
    { id: 'comments', label: 'Q&A', count: campaign.commentCount },
    { id: 'contributors', label: 'Backers', count: campaign.contributorCount },
    { id: 'milestones', label: 'Milestones', count: campaign.milestones.length },
    { id: 'rewards', label: 'Rewards', count: campaign.rewardTiers.length },
    { id: 'documents', label: 'Documents', count: campaign.documents.length },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
      <div className="glass-card rounded-md p-4 md:p-5">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p className="section-label mb-2">{campaign.categoryLabel}</p>
            <h1 className="font-display text-3xl text-foreground" style={{ marginBottom: 4 }}>{campaign.title}</h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--foreground-muted)' }}>
              by {campaign.creator.name} {campaign.verified && <span style={{ color: '#0ea5e9' }}>· ✓ Verified</span>}
            </p>
          </div>
          <button type="button" className="btn-outline py-2 px-3 text-[11px]" disabled={saving} onClick={() => void onToggleSave()}>
            {campaign.saved ? '💛 Saved' : '🤍 Save'}
          </button>
        </div>

        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--foreground-muted)' }}>{campaign.summary}</p>

        <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginTop: 20, overflowX: 'auto' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                padding: '10px 14px', fontSize: 12, fontWeight: 600,
                borderBottom: tab === t.id ? '2px solid var(--accent-gold)' : '2px solid transparent',
                color: tab === t.id ? 'var(--accent-gold)' : 'var(--foreground-muted)',
                marginBottom: -2,
              }}
            >
              {t.label}{t.count !== undefined ? ` (${t.count})` : ''}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 20 }}>
          {tab === 'story' && (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, color: 'var(--foreground)', lineHeight: 1.7 }}>
              {campaign.story || 'No story provided yet.'}
              {campaign.beneficiary && (
                <div className="glass-card rounded-md p-3" style={{ marginTop: 16 }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>
                    Raising for {campaign.beneficiary.name} ({campaign.beneficiary.relationship})
                    {campaign.beneficiary.verified && <span style={{ color: '#0ea5e9' }}> · ✓ Verified</span>}
                  </p>
                  {campaign.beneficiary.description && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--foreground-muted)' }}>{campaign.beneficiary.description}</p>}
                </div>
              )}
              {campaign.budget.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <h5 style={{ fontWeight: 700, marginBottom: 10, fontSize: 15 }}>Use of Funds</h5>
                  {campaign.budget.map((b) => (
                    <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span>{b.label}{b.note ? ` — ${b.note}` : ''}</span>
                      <span style={{ fontWeight: 700 }}>{formatNaira(b.amountKobo)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'updates' && (
            campaign.updates.length === 0 ? <p style={{ color: 'var(--foreground-muted)' }}>No updates yet.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {campaign.updates.map((u) => (
                  <div key={u.id} className="glass-card rounded-md p-3">
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{u.title}</p>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--foreground-muted)', whiteSpace: 'pre-wrap' }}>{u.body}</p>
                    <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--foreground-dim)' }}>{new Date(u.createdAt).toLocaleDateString()} · ❤️ {u.likeCount}</p>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'comments' && (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Ask a question or leave a comment…"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <input type="checkbox" checked={isQuestion} onChange={(e) => setIsQuestion(e.target.checked)} />
                    This is a question
                  </label>
                  <button type="button" className="btn-primary py-2 px-3 text-[11px]" disabled={postingComment || !commentBody.trim()} onClick={() => void onPostComment()}>
                    {postingComment ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </div>
              {comments.length === 0 ? <p style={{ color: 'var(--foreground-muted)' }}>No comments yet — be the first to ask a question.</p> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {comments.map((c) => (
                    <div key={c.id} className="glass-card rounded-md p-3">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{c.authorName}</span>
                        {c.isCreator && <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: 'var(--accent-gold)', color: '#0d0d0d' }}>Creator</span>}
                        {c.isQuestion && <span style={{ fontSize: 10, color: 'var(--foreground-dim)' }}>Question</span>}
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: 13 }}>{c.body}</p>
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--foreground-dim)' }}>{new Date(c.createdAt).toLocaleDateString()}</p>
                      {c.replies.length > 0 && (
                        <div style={{ marginTop: 8, paddingLeft: 14, borderLeft: '2px solid var(--border)' }}>
                          {c.replies.map((r, i) => (
                            <div key={i} style={{ marginBottom: 6 }}>
                              <span style={{ fontWeight: 700, fontSize: 12 }}>{r.authorName}</span>{r.isCreator && <span style={{ fontSize: 10, marginLeft: 6, color: 'var(--accent-gold)' }}>Creator</span>}
                              <p style={{ margin: '2px 0 0', fontSize: 12 }}>{r.body}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'contributors' && (
            contributors.length === 0 ? <p style={{ color: 'var(--foreground-muted)' }}>No backers yet — be the first.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {contributors.map((c) => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{c.anonymous ? 'Anonymous' : c.displayName}{c.message ? ` — "${c.message}"` : ''}</span>
                    <span style={{ fontWeight: 700 }}>{formatNaira(c.amountKobo)}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'milestones' && (
            campaign.milestones.length === 0 ? <p style={{ color: 'var(--foreground-muted)' }}>This campaign has no milestone plan — funds are released directly.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {campaign.milestones.map((m) => (
                  <div key={m.id} className="glass-card rounded-md p-3">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{m.title}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: m.status === 'RELEASED' ? '#d1fae5' : m.status === 'ACTIVE' ? '#dbeafe' : '#e5e7eb', color: m.status === 'RELEASED' ? '#065f46' : m.status === 'ACTIVE' ? '#1d4ed8' : '#374151' }}>
                        {m.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--foreground-muted)' }}>Target: {formatNaira(m.targetKobo)}</p>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'rewards' && (
            campaign.rewardTiers.length === 0 ? <p style={{ color: 'var(--foreground-muted)' }}>No reward tiers — this is a straightforward donation campaign.</p> : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
                {campaign.rewardTiers.map((r) => (
                  <div key={r.id} className="glass-card rounded-md p-3">
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{formatNaira(r.amountKobo)}+</p>
                    <p style={{ margin: '2px 0 0', fontWeight: 600, fontSize: 13 }}>{r.title}</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--foreground-muted)' }}>{r.description}</p>
                    {r.limit !== null && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--foreground-dim)' }}>{r.claimed}/{r.limit} claimed</p>}
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'documents' && (
            campaign.documents.length === 0 ? <p style={{ color: 'var(--foreground-muted)' }}>No supporting documents.</p> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {campaign.documents.map((d) => (
                  <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span>{d.label} {d.verified && <span style={{ color: '#0ea5e9' }}>✓</span>}</span>
                    <span style={{ color: 'var(--foreground-dim)' }}>{d.sizeLabel}</span>
                  </a>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      <aside>
        <div className="glass-card rounded-md p-4" style={{ position: 'sticky', top: 20 }}>
          <div style={{ height: 8, borderRadius: 8, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <div style={{ height: 8, width: `${pct}%`, background: 'var(--accent-gold)' }} />
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 22, fontWeight: 800 }}>{formatNaira(campaign.raisedKobo)}</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--foreground-muted)' }}>raised of {formatNaira(campaign.goalKobo)} goal · {pct}%</p>

          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--foreground-muted)' }}>
            <span><strong style={{ color: 'var(--foreground)' }}>{campaign.contributorCount}</strong> backers</span>
            {left !== null && <span><strong style={{ color: 'var(--foreground)' }}>{left}</strong> days left</span>}
          </div>

          {canContribute ? (
            <Link href={`/crowdfunding/${campaign.id}/donate`} className="btn-primary py-3 px-4 text-[12px]" style={{ width: '100%', textAlign: 'center', display: 'block', marginTop: 16 }}>
              🤝 Contribute Now
            </Link>
          ) : (
            <p style={{ marginTop: 16, fontSize: 12, color: 'var(--foreground-dim)' }}>This campaign is not currently accepting contributions ({campaign.status.replace('_', ' ').toLowerCase()}).</p>
          )}

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700 }}>{campaign.creator.name}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--foreground-muted)' }}>{campaign.creator.type} · {campaign.creator.verification}</p>
            {campaign.creator.location && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--foreground-muted)' }}>{campaign.creator.location}</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
