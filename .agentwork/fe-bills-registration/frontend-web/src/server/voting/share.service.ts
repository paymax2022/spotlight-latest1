import { createAdminClient } from '@/lib/supabase/server';
import { SHARE_CODE_LENGTH, SHARE_MESSAGE_TEMPLATE } from '@/src/features/voting/constants';
import type { ContestantShareLink, ShareEventType } from '@/src/features/voting/types';
import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

function generateShareCode(): string {
  return randomBytes(SHARE_CODE_LENGTH)
    .toString('base64url')
    .slice(0, SHARE_CODE_LENGTH)
    .toUpperCase();
}

export async function getOrCreateShareLink(
  contestId: string,
  contestantId: string,
  baseUrl: string,
): Promise<ContestantShareLink> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('contestant_share_links')
    .select('*')
    .eq('contest_id', contestId)
    .eq('contestant_id', contestantId)
    .maybeSingle();

  if (existing) return mapShareLinkRow(existing);

  const shareCode = generateShareCode();
  const shareUrl = `${baseUrl}/vote/${contestId}/${contestantId}?ref=${shareCode}`;

  // Generate QR code as a data-URL (base64 PNG)
  let qrCodeUrl: string | null = null;
  try {
    qrCodeUrl = await QRCode.toDataURL(shareUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  } catch {
    // Non-fatal; proceed without QR
  }

  const { data: created, error } = await supabase
    .from('contestant_share_links')
    .insert({
      contest_id: contestId,
      contestant_id: contestantId,
      share_code: shareCode,
      share_url: shareUrl,
      qr_code_url: qrCodeUrl,
    })
    .select('*')
    .single();

  if (error || !created) throw new Error('Failed to create share link');
  return mapShareLinkRow(created);
}

export async function recordShareEvent(opts: {
  shareLinkId: string;
  eventType: ShareEventType;
  channel?: string;
  ipAddress?: string;
  userAgent?: string;
  referrer?: string;
}): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('contestant_share_events').insert({
    share_link_id: opts.shareLinkId,
    event_type: opts.eventType,
    channel: opts.channel ?? null,
    ip_address: opts.ipAddress ?? null,
    user_agent: opts.userAgent ?? null,
    referrer: opts.referrer ?? null,
  });

  // Increment click or vote counter
  if (opts.eventType === 'click') {
    await supabase.rpc('increment_share_click', { p_share_link_id: opts.shareLinkId });
  }
}

export function buildShareMessages(
  contestantName: string,
  contestName: string,
  shareUrl: string,
) {
  const base = SHARE_MESSAGE_TEMPLATE(contestantName, contestName, shareUrl);
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(base)}`,
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(base)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(base)}`,
    copyText: base,
    voteUrl: shareUrl,
  };
}

function mapShareLinkRow(row: Record<string, unknown>): ContestantShareLink {
  return {
    id: row.id as string,
    contestId: row.contest_id as string,
    contestantId: row.contestant_id as string,
    shareCode: row.share_code as string,
    shareUrl: row.share_url as string,
    qrCodeUrl: (row.qr_code_url as string | null) ?? null,
    clickCount: Number(row.click_count ?? 0),
    voteCount: Number(row.vote_count ?? 0),
    paidVoteCount: Number(row.paid_vote_count ?? 0),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
