import type { PropsWithChildren } from 'react';
import { AdminShell } from '@/components/layouts/AdminShell';
import { AdminRouteGuard } from '@/components/guards/AdminRouteGuard';

export default function AdminLayout({ children }: PropsWithChildren) {
  return (
    <AdminRouteGuard>
      <AdminShell>{children}</AdminShell>
    </AdminRouteGuard>
  );
}
