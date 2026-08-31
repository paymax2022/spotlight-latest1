'use client';

/**
 * Voting package templates — the reusable catalog.
 *
 * vote_packages rows are bound to exactly one contest, so before this page there
 * was no way to define a package once and reuse it: every contest meant retyping
 * the same tiers, and they drifted apart. Templates are authored here, then
 * attached to a contest from the competition editor, which clones them into real
 * vote_packages rows.
 *
 * ⚠️ Amounts are NAIRA, matching public.vote_packages.amount. Never scale by 100.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Page, PageHeader, Card, Button, Input, Badge, colors, thCell, tdCell } from '@/components/ui/vuexy';
import {
  listVotePackageTemplates,
  createVotePackageTemplate,
  updateVotePackageTemplate,
  deleteVotePackageTemplate,
  formatNaira,
  type VotePackageTemplate,
  type VotePackageTemplateInput,
} from '@/services/votePackagesAdminService';

type FormState = {
  name: string;
  description: string;
  votes: string;
  bonusVotes: string;
  amount: string;
  promoLabel: string;
  displayOrder: string;
  isRecommended: boolean;
  isActive: boolean;
};

const EMPTY: FormState = {
  name: '',
  description: '',
  votes: '',
  bonusVotes: '0',
  amount: '',
  promoLabel: '',
  displayOrder: '0',
  isRecommended: false,
  isActive: true,
};

function toInput(f: FormState): VotePackageTemplateInput {
  return {
    name: f.name.trim(),
    description: f.description.trim() || undefined,
    votes: Number(f.votes),
    bonusVotes: Number(f.bonusVotes || 0),
    amount: Number(f.amount),
    promoLabel: f.promoLabel.trim() || undefined,
    displayOrder: Number(f.displayOrder || 0),
    isRecommended: f.isRecommended,
    isActive: f.isActive,
  };
}

export default function VotePackageTemplatesPage() {
  const [templates, setTemplates] = useState<VotePackageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await listVotePackageTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const validation = useMemo(() => {
    if (!form.name.trim()) return 'Name is required.';
    const v = Number(form.votes);
    if (!Number.isFinite(v) || v <= 0) return 'Votes must be greater than 0.';
    const a = Number(form.amount);
    if (!Number.isFinite(a) || a < 0) return 'Amount is required and cannot be negative.';
    const b = Number(form.bonusVotes || 0);
    if (!Number.isFinite(b) || b < 0) return 'Bonus votes cannot be negative.';
    return null;
  }, [form]);

  const submit = useCallback(async () => {
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editingId) {
        await updateVotePackageTemplate(editingId, toInput(form));
        setNotice(`Updated "${form.name.trim()}".`);
      } else {
        await createVotePackageTemplate(toInput(form));
        setNotice(`Created "${form.name.trim()}". It can now be attached to any contest.`);
      }
      setForm(EMPTY);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }, [form, editingId, validation, load]);

  const startEdit = useCallback((t: VotePackageTemplate) => {
    setEditingId(t.id);
    setNotice(null);
    setError(null);
    setForm({
      name: t.name,
      description: t.description,
      votes: String(t.votes),
      bonusVotes: String(t.bonusVotes),
      amount: String(t.amount),
      promoLabel: t.promoLabel,
      displayOrder: String(t.displayOrder),
      isRecommended: t.isRecommended,
      isActive: t.isActive,
    });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const remove = useCallback(
    async (t: VotePackageTemplate) => {
      if (
        !window.confirm(
          `Delete the "${t.name}" template?\n\nContests that already use it keep their packages — only the reusable definition is removed.`,
        )
      ) {
        return;
      }
      setError(null);
      try {
        await deleteVotePackageTemplate(t.id);
        setNotice(`Deleted "${t.name}". Contests already using it are unaffected.`);
        if (editingId === t.id) {
          setEditingId(null);
          setForm(EMPTY);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete template');
      }
    },
    [editingId, load],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Page>
      <PageHeader
        title="Voting packages"
        subtitle="Reusable vote-package definitions. Create them once here, then attach them to a contest from the competition editor."
      />

      {error && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.danger}` }}>
          <strong style={{ color: colors.danger }}>{error}</strong>
        </Card>
      )}
      {notice && (
        <Card style={{ marginBottom: 16, borderLeft: `3px solid ${colors.success}` }}>
          <span>{notice}</span>
        </Card>
      )}

      <Card style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 4px' }}>{editingId ? 'Edit template' : 'New template'}</h3>
        <p style={{ margin: '0 0 16px', color: colors.muted, fontSize: 13 }}>
          Amounts are in naira. A package sells <strong>votes + bonus votes</strong> for the amount shown.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <label>
            <span style={{ fontSize: 13 }}>Name *</span>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Starter pack" />
          </label>
          <label>
            <span style={{ fontSize: 13 }}>Votes *</span>
            <Input
              type="number"
              min={1}
              value={form.votes}
              onChange={(e) => set('votes', e.target.value)}
              placeholder="100"
            />
          </label>
          <label>
            <span style={{ fontSize: 13 }}>Bonus votes</span>
            <Input
              type="number"
              min={0}
              value={form.bonusVotes}
              onChange={(e) => set('bonusVotes', e.target.value)}
            />
          </label>
          <label>
            <span style={{ fontSize: 13 }}>Amount (₦) *</span>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="1000"
            />
          </label>
          <label>
            <span style={{ fontSize: 13 }}>Promo label</span>
            <Input
              value={form.promoLabel}
              onChange={(e) => set('promoLabel', e.target.value)}
              placeholder="Best value"
            />
          </label>
          <label>
            <span style={{ fontSize: 13 }}>Display order</span>
            <Input
              type="number"
              value={form.displayOrder}
              onChange={(e) => set('displayOrder', e.target.value)}
            />
          </label>
        </div>

        <label style={{ display: 'block', marginTop: 16 }}>
          <span style={{ fontSize: 13 }}>Description</span>
          <Input
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Shown to voters under the package name"
          />
        </label>

        <div style={{ display: 'flex', gap: 20, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={form.isRecommended}
              onChange={(e) => set('isRecommended', e.target.checked)}
            />
            Highlight as recommended
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
            Available for new contests
          </label>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {editingId && (
              <Button
                variant="outline"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            )}
            <Button variant="primary" onClick={submit} disabled={saving || Boolean(validation)}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create template'}
            </Button>
          </div>
        </div>
        {validation && (
          <p style={{ margin: '10px 0 0', color: colors.muted, fontSize: 12 }}>{validation}</p>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Templates ({templates.length})</h3>
          <Link href="/admin/competitions/list" style={{ marginLeft: 'auto', fontSize: 13, color: colors.primary }}>
            Attach these to a contest →
          </Link>
        </div>

        {loading ? (
          <p style={{ color: colors.muted }}>Loading templates…</p>
        ) : templates.length === 0 ? (
          <div style={{ padding: '28px 0', textAlign: 'center', color: colors.muted }}>
            <p style={{ margin: '0 0 6px' }}>No voting packages yet.</p>
            <p style={{ margin: 0, fontSize: 13 }}>
              Create one above, then attach it to a contest when you create or edit the contest.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thCell}>Name</th>
                  <th style={thCell}>Votes</th>
                  <th style={thCell}>Amount</th>
                  <th style={thCell}>Order</th>
                  <th style={thCell}>Status</th>
                  <th style={thCell} />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td style={tdCell}>
                      <strong>{t.name}</strong>
                      {t.isRecommended && (
                        <span style={{ marginLeft: 8 }}>
                          <Badge text="Recommended" color={colors.primary} />
                        </span>
                      )}
                      {t.promoLabel && (
                        <span style={{ marginLeft: 8 }}>
                          <Badge text={t.promoLabel} color={colors.warning} />
                        </span>
                      )}
                      {t.description && (
                        <div style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>{t.description}</div>
                      )}
                    </td>
                    <td style={tdCell}>
                      {t.votes.toLocaleString('en-NG')}
                      {t.bonusVotes > 0 && (
                        <span style={{ color: colors.success, fontSize: 12 }}>
                          {' '}
                          + {t.bonusVotes.toLocaleString('en-NG')} bonus
                        </span>
                      )}
                    </td>
                    <td style={tdCell}>{formatNaira(t.amount)}</td>
                    <td style={tdCell}>{t.displayOrder}</td>
                    <td style={tdCell}>
                      <Badge
                        text={t.isActive ? 'Active' : 'Inactive'}
                        color={t.isActive ? colors.success : colors.secondary}
                      />
                    </td>
                    <td style={{ ...tdCell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Button variant="secondary" sm onClick={() => startEdit(t)}>
                        Edit
                      </Button>{' '}
                      <Button variant="danger" sm onClick={() => remove(t)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
