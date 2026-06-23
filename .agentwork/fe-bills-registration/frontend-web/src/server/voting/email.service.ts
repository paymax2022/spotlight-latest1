import { FORMAT_NAIRA } from '@/src/features/voting/constants';

interface VoteReceiptEmailInput {
  to: string;
  voterName: string;
  contestantName: string;
  contestName: string;
  votesPurchased: number;
  bonusVotes: number;
  amountPaid: number;
  currency: string;
  receiptNumber: string;
  paymentRef: string;
  issuedAt: string;
}

interface MilestoneEmailInput {
  to: string;
  contestantName: string;
  contestName: string;
  milestone: 'top10' | 'top3' | 'rank_change' | 'new_votes';
  currentRank: number;
  totalVotes: number;
  votesToNextRank?: number;
  shareUrl?: string;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Spotlight <no-reply@spotlightng.com>';

  if (!apiKey) {
    // Dev: just log
    console.log(`[email] To: ${to} | Subject: ${subject}`);
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
}

export async function sendVoteReceiptEmail(input: VoteReceiptEmailInput): Promise<void> {
  const totalVotes = input.votesPurchased + input.bonusVotes;
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px">
<div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <div style="background:#f59e0b;padding:24px 32px">
    <h1 style="margin:0;color:#000;font-size:22px">Vote Receipt ✅</h1>
    <p style="margin:4px 0 0;color:#78350f;font-size:13px">Thank you for supporting ${escHtml(input.contestantName)}</p>
  </div>
  <div style="padding:24px 32px">
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="color:#6b7280;padding:6px 0">Receipt Number</td><td style="font-weight:600;text-align:right">${escHtml(input.receiptNumber)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Contest</td><td style="text-align:right">${escHtml(input.contestName)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Contestant</td><td style="text-align:right">${escHtml(input.contestantName)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Votes Purchased</td><td style="font-weight:700;text-align:right;color:#f59e0b">${input.votesPurchased.toLocaleString()}</td></tr>
      ${input.bonusVotes > 0 ? `<tr><td style="color:#6b7280;padding:6px 0">Bonus Votes</td><td style="text-align:right;color:#10b981">+${input.bonusVotes.toLocaleString()}</td></tr>` : ''}
      <tr><td style="color:#6b7280;padding:6px 0">Total Votes Added</td><td style="font-weight:700;text-align:right;font-size:16px">${totalVotes.toLocaleString()}</td></tr>
      <tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:8px"></td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Amount Paid</td><td style="font-weight:700;text-align:right;color:#10b981;font-size:16px">${FORMAT_NAIRA(input.amountPaid)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Payment Reference</td><td style="text-align:right;font-size:12px;font-family:monospace">${escHtml(input.paymentRef)}</td></tr>
      <tr><td style="color:#6b7280;padding:6px 0">Date</td><td style="text-align:right">${new Date(input.issuedAt).toLocaleString()}</td></tr>
    </table>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px">
      Keep this receipt for your records. Votes are non-refundable except in cases of proven fraud.
    </p>
  </div>
</div>
</body>
</html>`;

  await sendEmail(
    input.to,
    `Your ${totalVotes.toLocaleString()} votes for ${input.contestantName} — Receipt ${input.receiptNumber}`,
    html,
  );
}

export async function sendMilestoneEmail(input: MilestoneEmailInput): Promise<void> {
  const messages: Record<MilestoneEmailInput['milestone'], string> = {
    top10: `🎉 You just entered the Top 10 with ${input.totalVotes.toLocaleString()} votes!`,
    top3: `🏆 You are now in the Top 3! Current rank: #${input.currentRank}`,
    rank_change: `📈 Your rank changed — you are now #${input.currentRank} with ${input.totalVotes.toLocaleString()} votes.`,
    new_votes: `🗳️ You received new votes! Total: ${input.totalVotes.toLocaleString()}`,
  };

  const headline = messages[input.milestone];
  const nudge =
    input.votesToNextRank && input.votesToNextRank > 0
      ? `<p style="color:#f59e0b;font-weight:600">You need just ${input.votesToNextRank.toLocaleString()} more votes to move to #${input.currentRank - 1}. Share your link now!</p>`
      : '';

  const shareBtn = input.shareUrl
    ? `<a href="${escHtml(input.shareUrl)}" style="display:inline-block;background:#f59e0b;color:#000;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px">Share My Voting Link</a>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f9fafb;padding:32px">
<div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
  <div style="background:#111827;padding:24px 32px">
    <h1 style="margin:0;color:#f59e0b;font-size:20px">${escHtml(input.contestName)}</h1>
  </div>
  <div style="padding:24px 32px">
    <h2 style="color:#111;font-size:18px;margin-top:0">${headline}</h2>
    <p>Hi <strong>${escHtml(input.contestantName)}</strong>,</p>
    <p>You're currently ranked <strong>#${input.currentRank}</strong> with <strong>${input.totalVotes.toLocaleString()} total votes</strong>.</p>
    ${nudge}
    ${shareBtn}
    <p style="font-size:12px;color:#9ca3af;margin-top:24px">You're receiving this because you're a contestant in ${escHtml(input.contestName)}.</p>
  </div>
</div>
</body>
</html>`;

  await sendEmail(
    input.to,
    headline,
    html,
  );
}

function escHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
