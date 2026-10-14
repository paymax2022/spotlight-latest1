'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminUsersRequestError, getUserModules, type UserModule } from '@/services/usersService';
import { Card, Button, colors } from '@/components/ui/vuexy';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-NG');
}

/** Only same-origin admin paths are linkable; the href comes from the backend. */
function safeHref(href: string): string | null {
  return typeof href === 'string' && /^\/admin\/[^\s\\]*$/.test(href) ? href : null;
}

const muted = { color: colors.muted, fontSize: 13 };
const rowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  padding: '6px 0',
  fontSize: 13,
  wordBreak: 'break-word' as const,
};

/**
 * Read-only module memberships panel (GET /admin/users/:id/modules). A 404 means the module
 * overview is disabled in this environment (no Retry). Backend values are rendered as text only;
 * the Open link is shown only for same-origin /admin/ paths. No mutation controls.
 */
export function ModulesPanel({ userId }: { userId: string }) {
  const [rows, setRows] = useState<UserModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [showNone, setShowNone] = useState(false);
  // Incremented per load(); results of superseded requests are ignored.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const myId = ++requestId.current;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setDisabled(false);
    setShowNone(false);
    try {
      const res = await getUserModules(userId);
      if (myId !== requestId.current) return;
      setRows(res);
    } catch (err) {
      if (myId !== requestId.current) return;
      setRows([]);
      if (err instanceof AdminUsersRequestError && err.status === 404) {
        setDisabled(true);
      } else if (err instanceof AdminUsersRequestError && err.status === 403) {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : 'Loading modules failed.');
      }
    } finally {
      if (myId === requestId.current) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  let body;
  if (loading) {
    body = <p style={muted}>Loading modules…</p>;
  } else if (forbidden) {
    body = <p style={muted}>You don&apos;t have permission to view this.</p>;
  } else if (disabled) {
    body = <p style={muted}>Module overview is not enabled in this environment.</p>;
  } else if (error) {
    body = (
      <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
        <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>
        <Button variant="outline" sm onClick={() => void load()}>Retry</Button>
      </div>
    );
  } else {
    const members = rows.filter((r) => r.status === 'member');
    const none = rows.filter((r) => r.status === 'none');
    const errored = rows.filter((r) => r.status === 'error');
    const groups = new Map<string, UserModule[]>();
    for (const m of members) {
      const list = groups.get(m.group) ?? [];
      list.push(m);
      groups.set(m.group, list);
    }
    body = (
      <div style={{ display: 'grid', gap: 12 }}>
        {members.length === 0 ? <p style={{ ...muted, margin: 0 }}>Not onboarded to any module</p> : null}
        {Array.from(groups.entries()).map(([group, list]) => (
          <div key={group}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.muted }}>{group}</div>
            {list.map((m) => {
              const href = safeHref(m.href);
              return (
                <div key={m.key} style={rowStyle}>
                  <span>{m.label}</span>
                  <span style={{ textAlign: 'right' }}>
                    {`Count: ${m.count}`}
                    {m.since ? ` · Since ${formatDate(m.since)}` : ''}
                    {href ? (
                      <>
                        {' · '}
                        <a href={href} style={{ color: colors.info }}>Open</a>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {errored.length > 0 ? (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.muted }}>Unavailable</div>
            {errored.map((m) => (
              <div key={m.key} style={rowStyle}>
                <span>{m.label}</span>
                <span style={{ color: colors.danger }}>Membership unavailable</span>
              </div>
            ))}
          </div>
        ) : null}
        {none.length > 0 ? (
          <div>
            <Button variant="outline" sm onClick={() => setShowNone((v) => !v)}>
              {`Not onboarded (${none.length})`}
            </Button>
            {showNone
              ? none.map((m) => (
                  <div key={m.key} style={rowStyle}>
                    <span>{m.label}</span>
                    <span style={{ color: colors.muted }}>{m.group}</span>
                  </div>
                ))
              : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div data-testid="modules-panel">
      <Card title="Modules">
        <div style={{ marginTop: 8 }}>{body}</div>
      </Card>
    </div>
  );
}
