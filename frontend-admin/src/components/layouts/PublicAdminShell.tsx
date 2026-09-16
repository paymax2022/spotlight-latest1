import type { PropsWithChildren } from 'react';
import { colors } from '@/components/ui/vuexy';

// Chrome for the logged-OUT admin routes (login, unauthorized).
//
// Deliberately carries no navigation, no operator identity and no Log out —
// that is the entire point of keeping AdminShell off these pages: the sidebar
// hydrates from localStorage rather than a live session, so on the login page
// it advertised a signed-in operator to a signed-out visitor.
//
// It exists only so those pages are not flush against the viewport corner.
// They were written against AdminShell's 24px main padding and have no layout
// of their own.
export function PublicAdminShell({ children }: PropsWithChildren) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: colors.bg,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>{children}</div>
    </div>
  );
}
