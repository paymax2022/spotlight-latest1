import type { PropsWithChildren } from 'react';
import { AdminShell } from '@/components/layouts/AdminShell';

export default function AdminLayout({ children }: PropsWithChildren) {
  return <AdminShell>{children}</AdminShell>;
}
