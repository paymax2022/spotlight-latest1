import type { PropsWithChildren } from 'react';
import { AdminRouteGuard } from '@/components/guards/AdminRouteGuard';

// The shell is applied INSIDE the guard, not here. Wrapping it around the guard
// rendered the full sidebar — navigation, the previous operator's email, and a
// Log out button — on /admin/login, which is a logged-OUT page.
export default function AdminLayout({ children }: PropsWithChildren) {
  return <AdminRouteGuard>{children}</AdminRouteGuard>;
}
