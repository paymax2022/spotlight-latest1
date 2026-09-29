'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// This page used to be the "KYC Approval Queue" — an admin clicking Approve/
// Reject with no automated identity check behind it (listPendingKyc/approveKyc/
// rejectKyc called /api/finance/admin/kyc/*, which hashed BVN/NIN and stored it,
// nothing more; both the endpoints and that UI are removed, see
// src/services/fintechService.ts). Kept as a redirect rather than deleted
// outright so any existing bookmark/link lands on the real console instead of
// a 404: /admin/finance/kyc-verify reviews actual Dojah/Smile ID/Youverify
// check results.
export default function KycQueueRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/finance/kyc-verify');
  }, [router]);
  return null;
}
