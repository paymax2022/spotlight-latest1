import React from 'react';
import CodeEntryView from '@/features/association/components/CodeEntryView';

export default function AccessCodeEntry() {
  return (
    <CodeEntryView
      kind="ACCESS"
      title="Access code"
      heading="Enter group access code"
      helper="Enter the access code for your group or chapter. Try “IKOYI”."
      placeholder="ACCESS CODE"
    />
  );
}
