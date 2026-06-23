import type { PropsWithChildren } from 'react';
import { AdminSidebar } from './AdminSidebar';

export function AdminShell({ children }: PropsWithChildren) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: '100vh' }}>
      <AdminSidebar />
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}
