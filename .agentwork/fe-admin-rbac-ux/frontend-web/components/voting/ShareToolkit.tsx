'use client';

import { useState } from 'react';
import type { ContestantShareLink } from '@/src/features/voting/types';

interface Props {
  shareLink: ContestantShareLink;
  contestantName: string;
  contestName: string;
  className?: string;
}

export default function ShareToolkit({ shareLink, contestantName, contestName, className = '' }: Props) {
  const [copied, setCopied] = useState(false);

  const shareUrl = shareLink.shareUrl;
  const text = `Please vote for ${contestantName} on ${contestName}. Your vote means everything!\n\nVote here: ${shareUrl}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function recordShareClick(channel: string) {
    // Fire-and-forget analytics
    fetch('/api/contestants/' + shareLink.contestantId + '/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shareLinkId: shareLink.id, channel, eventType: 'share' }),
    }).catch(() => {});
  }

  return (
    <div className={`${className}`}>
      <p className="text-sm text-gray-400 font-medium mb-3">Share &amp; get more votes</p>

      {/* Copy link */}
      <div className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 mb-3">
        <span className="text-gray-400 text-xs flex-1 truncate">{shareUrl}</span>
        <button
          onClick={copyLink}
          className="text-amber-400 text-xs font-semibold shrink-0 hover:text-amber-300"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Social buttons */}
      <div className="flex flex-wrap gap-2">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => recordShareClick('whatsapp')}
          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all"
        >
          <WhatsAppIcon /> WhatsApp
        </a>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => recordShareClick('twitter')}
          className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all"
        >
          <XIcon /> X / Twitter
        </a>
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => recordShareClick('facebook')}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all"
        >
          <FacebookIcon /> Facebook
        </a>
        <a
          href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => recordShareClick('telegram')}
          className="flex items-center gap-1.5 bg-sky-400 hover:bg-sky-300 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-all"
        >
          Telegram
        </a>
      </div>

      {/* QR Code placeholder */}
      {shareLink.qrCodeUrl && (
        <a
          href={shareLink.qrCodeUrl}
          download
          className="mt-3 block text-center text-xs text-gray-500 underline hover:text-gray-400"
        >
          Download QR code
        </a>
      )}
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}
