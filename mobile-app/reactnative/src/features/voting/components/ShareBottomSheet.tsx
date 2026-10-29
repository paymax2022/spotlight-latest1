import React from 'react';
import SocialShareSheet from '@/components/SocialShareSheet';
import { shareContestant } from '../api/voting.api';

interface Props {
  visible: boolean;
  onClose: () => void;
  contestantName: string;
  /** Ready-made link. When absent and `contestantId` is set, one is minted on open. */
  shareUrl?: string;
  /** Contestant whose public /vote-link/<token> URL should be shared. */
  contestantId?: string;
  shareText?: string;
}

export default function ShareBottomSheet({ visible, onClose, contestantName, shareUrl, contestantId, shareText }: Props) {
  const [minted, setMinted] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!visible) { setMinted(undefined); return; }
    if (shareUrl || !contestantId) return;
    let cancelled = false;
    shareContestant(contestantId)
      .then((r) => { if (!cancelled) setMinted(r.url); })
      .catch(() => { /* share the text alone rather than block the sheet */ });
    return () => { cancelled = true; };
  }, [visible, shareUrl, contestantId]);

  return (
    <SocialShareSheet
      visible={visible}
      onClose={onClose}
      title={`Share ${contestantName}`}
      message={shareText ?? `Vote for ${contestantName} in the Spotlight Contest! 🎤`}
      url={shareUrl ?? minted}
    />
  );
}
