import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import AdminSidebar from '@/src/components/AdminSidebar';
import AdminTableEnhancer from '@/src/components/admin/AdminTableEnhancer';
import { requireAdmin } from '@/src/lib/auth/server';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'UNAUTHORIZED') redirect('/admin/login?next=/admin');
    if (msg === 'FORBIDDEN') redirect('/admin/login?error=forbidden');
    throw err;
  }
  return (
    <div className="admin-theme admin-shell">
      <AdminSidebar />
      <div className="admin-content">
        <header className="admin-topbar">
          <div className="admin-search" aria-label="Admin search">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            <span>Search [CTRL + K]</span>
          </div>
          <div className="admin-topbar-actions">
            <Link href="/homepage" className="admin-icon-button" aria-label="Public site">
              <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
            </Link>
            <button type="button" className="admin-icon-button" aria-label="Language">
              <i className="fa-solid fa-language" aria-hidden="true" />
            </button>
            <button type="button" className="admin-icon-button" aria-label="Theme">
              <i className="fa-regular fa-sun" aria-hidden="true" />
            </button>
            <button type="button" className="admin-icon-button admin-notification" aria-label="Notifications">
              <i className="fa-regular fa-bell" aria-hidden="true" />
            </button>
            <div className="admin-avatar" aria-label="Admin profile">
              <img src="/assets/img/about/author.png" alt="" />
              <span />
            </div>
          </div>
        </header>
        <main className="admin-main">{children}</main>
      </div>
      <AdminTableEnhancer />
    </div>
  );
}
