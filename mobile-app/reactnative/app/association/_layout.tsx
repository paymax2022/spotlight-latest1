import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function AssociationLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    >
      {/* Discovery & join (B) */}
      <Stack.Screen name="index" />
      <Stack.Screen name="organisation/[id]" />
      <Stack.Screen name="join/invite" />
      <Stack.Screen name="join/access-code" />
      <Stack.Screen name="join/scan" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="join/[id]/index" />
      <Stack.Screen name="join/[id]/documents" />
      <Stack.Screen name="join/[id]/submitted" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Member area (C, D, E) */}
      <Stack.Screen name="home" />
      <Stack.Screen name="card" />
      <Stack.Screen name="verify-card" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="directory" />
      <Stack.Screen name="member/[id]" />

      {/* Dues & payments (G) */}
      <Stack.Screen name="dues/index" />
      <Stack.Screen name="pay/[invoiceId]" options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="receipt/[receiptId]" />

      {/* Announcements (J) & Notifications (X) */}
      <Stack.Screen name="announcements/index" />
      <Stack.Screen name="announcements/[id]" />
      <Stack.Screen name="notifications" />

      {/* Meetings (K) */}
      <Stack.Screen name="meetings/index" />
      <Stack.Screen name="meetings/[id]" />

      {/* Tasks (M) */}
      <Stack.Screen name="tasks/index" />
      <Stack.Screen name="tasks/[id]" />

      {/* Documents (P) */}
      <Stack.Screen name="documents/index" />
      <Stack.Screen name="documents/[id]" />

      {/* Group chat (I) */}
      <Stack.Screen name="chat/index" />
      <Stack.Screen name="chat/[id]" />

      {/* AI note-taking (L) */}
      <Stack.Screen name="ai-notes/index" />
      <Stack.Screen name="ai-notes/new" />
      <Stack.Screen name="ai-notes/[id]/processing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="ai-notes/[id]/index" />

      {/* Member profile (C) */}
      <Stack.Screen name="profile/index" />
      <Stack.Screen name="profile/edit" />
      <Stack.Screen name="profile/privacy" />
      <Stack.Screen name="profile/activity" />

      {/* Committees (N) */}
      <Stack.Screen name="committees/index" />
      <Stack.Screen name="committees/[id]" />

      {/* Events & attendance (O) */}
      <Stack.Screen name="events/index" />
      <Stack.Screen name="events/[id]" />
      <Stack.Screen name="event-pay/[id]" options={{ animation: 'slide_from_bottom' }} />

      {/* Organisation creation wizard (U) */}
      <Stack.Screen name="create/index" />
      <Stack.Screen name="create/basics" />
      <Stack.Screen name="create/branding" />
      <Stack.Screen name="create/structure" />
      <Stack.Screen name="create/membership" />
      <Stack.Screen name="create/access" />
      <Stack.Screen name="create/preview" />
      <Stack.Screen name="create/success" options={{ gestureEnabled: false, animation: 'fade' }} />

      {/* Admin-lite (Q/R/S/T) */}
      <Stack.Screen name="admin/index" />
      <Stack.Screen name="admin/approvals/index" />
      <Stack.Screen name="admin/approvals/[id]" />
      <Stack.Screen name="admin/finance/index" />
      <Stack.Screen name="admin/finance/offline" />
      <Stack.Screen name="admin/import/index" />
      <Stack.Screen name="admin/import/preview" />
      <Stack.Screen name="admin/members/index" />
      <Stack.Screen name="admin/members/[id]" />
      <Stack.Screen name="admin/audit" />

      {/* Admin: content authoring — the write side of announcements, meetings,
          documents, events and tasks, plus the dues run that raises the
          invoices the member payment path settles. */}
      <Stack.Screen name="admin/announcements/index" />
      <Stack.Screen name="admin/announcements/new" />
      <Stack.Screen name="admin/announcements/[id]" />
      <Stack.Screen name="admin/meetings/index" />
      <Stack.Screen name="admin/meetings/new" />
      <Stack.Screen name="admin/meetings/[id]" />
      <Stack.Screen name="admin/documents/index" />
      <Stack.Screen name="admin/documents/new" />
      <Stack.Screen name="admin/documents/[id]" />
      <Stack.Screen name="admin/events/index" />
      <Stack.Screen name="admin/events/new" />
      <Stack.Screen name="admin/events/[id]" />
      <Stack.Screen name="admin/tasks/index" />
      <Stack.Screen name="admin/tasks/new" />
      <Stack.Screen name="admin/tasks/[id]" />
      <Stack.Screen name="admin/dues/index" />
      <Stack.Screen name="admin/dues/run" />

      {/* Governance & elections (Y) — integrates the shared election feature */}
      <Stack.Screen name="governance" />

      {/* Settings (V) */}
      <Stack.Screen name="settings/index" />
      <Stack.Screen name="settings/notifications" />
      <Stack.Screen name="settings/security" />
      <Stack.Screen name="settings/devices" />
      <Stack.Screen name="settings/language" />
      <Stack.Screen name="settings/theme" />

      {/* Support (W) */}
      <Stack.Screen name="support/index" />
      <Stack.Screen name="support/tickets" />
      <Stack.Screen name="support/new" />
      <Stack.Screen name="support/[id]" />
      <Stack.Screen name="elections/[id]" />

      {/* Edge / restriction states (H, Z) */}
      <Stack.Screen name="edge/[type]" options={{ animation: 'fade' }} />
    </Stack>
  );
}
