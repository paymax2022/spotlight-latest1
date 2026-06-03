import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AdminSidebar from '@/src/components/AdminSidebar';
import { requireAdmin } from '@/src/lib/auth/server';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'UNAUTHORIZED') redirect('/login?next=/admin');
    if (msg === 'FORBIDDEN') redirect('/');
    throw err;
  }
  return (
    <div className="d-flex admin-theme" style={{ background: 'var(--bg)', color: 'var(--foreground)', minHeight: '100vh' }}>
      <AdminSidebar />
      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <header
          className="d-flex justify-content-between align-items-center px-4 py-3"
          style={{ background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 20, borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <div className="text-uppercase" style={{ fontSize: 11, color: 'var(--foreground-muted)', letterSpacing: '0.08em' }}>
              Spotlight Control Center
            </div>
            <div className="font-semibold" style={{ color: 'var(--foreground)' }}>Administrative Command Portal</div>
          </div>
          <div className="d-flex gap-2 align-items-center">
            <Link href="/admin" className="btn-outline text-xs py-2 px-3">Dashboard</Link>
            <Link href="/homepage" className="btn-primary text-xs py-2 px-3">Public Site</Link>
          </div>
        </header>
        <main className="p-4 p-lg-5" style={{ paddingTop: 72 }}>{children}</main>
      </div>
    </div>
  );
}
