import React from 'react';
import StateView from '@/components/StateView';

// Every commerce route (quote, receipts, refunds, inbox, support) is unmounted
// while FEATURE_EVENTS_COMMERCIAL is off, so a call there is a 404 rather than an
// empty answer. These screens say what is switched off instead of showing a list
// that looks like the buyer has nothing.
export default function CommerceNotice() {
  return (
    <StateView
      kind="empty"
      title="Not available yet"
      message="Receipts, refunds and the support desk appear once event commerce is switched on for this build."
      icon="Lock"
    />
  );
}
