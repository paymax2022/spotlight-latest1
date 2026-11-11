'use client';

import { useState, useEffect } from 'react';
import { authHeaders } from '@/src/lib/auth/client';
import { extractPaystackAccessCode, loadPaystackClient } from '@/src/lib/payments';
import type { VotePackage, VotingSettings } from '@/src/features/voting/types';
import { FORMAT_NAIRA } from '@/src/features/voting/types';

interface Props {
  contestId: string;
  contestantId: string;
  contestantName: string;
  contestantPhoto?: string | null;
  contestName: string;
  packages: VotePackage[];
  settings: VotingSettings;
  freeVotesRemaining: number;
  shareCode?: string;
  onClose: () => void;
  onVoteSuccess: (message: string) => void;
}

type VoteMode = 'free' | 'paid';

export default function VoteModal({
  contestId,
  contestantId,
  contestantName,
  contestantPhoto,
  contestName,
  packages,
  settings,
  freeVotesRemaining,
  shareCode,
  onClose,
  onVoteSuccess,
}: Props) {
  const [mode, setMode] = useState<VoteMode>('free');
  const [selectedPackage, setSelectedPackage] = useState<string>('custom');
  const [quantity, setQuantity] = useState(1);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  const PRICE_PER_VOTE = 100;

  useEffect(() => {
    if (cooldownRemaining > 0) {
      const timer = setInterval(() => {
        setCooldownRemaining((prev) => Math.max(0, prev - 1000));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldownRemaining]);

  function formatCooldown(ms: number): string {
    const seconds = Math.ceil(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const secs = seconds % 60;
    return [hours, minutes, secs].map((v) => String(v).padStart(2, '0')).join(':');
  }

  const totalVotes = mode === 'paid' ? quantity : 1;
  const totalPrice = mode === 'paid' ? totalVotes * PRICE_PER_VOTE : 0;
  const isValidQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 500;

  const selectedPkg =
    mode === 'paid' && selectedPackage !== 'custom'
      ? packages.find((pkg) => pkg.id === selectedPackage)
      : undefined;
  // Package price comes from the backend; custom quantity uses the base rate.
  const payAmountNgn = selectedPkg ? selectedPkg.amount : totalPrice;
  const displayVotes = selectedPkg ? selectedPkg.votes + selectedPkg.bonusVotes : totalVotes;
  // A chosen package carries its own vote count/amount, so the 1–500 quantity
  // rule only gates the custom-quantity path.
  const isPaidAmountValid = !!selectedPkg || isValidQuantity;

  async function handleFreeVote() {
    if (cooldownRemaining > 0) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const headers = await authHeaders(true);
      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `free:${contestId}:${contestantId}:${Date.now()}`;
      const res = await fetch('/api/v2/votes/free', {
        method: 'POST',
        headers: { ...headers, 'X-Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ contestId, contestantId, voteQuantity: 1, shareCode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMsg(json.error ?? 'Vote failed. Please try again.');
        return;
      }
      onVoteSuccess(
        `1 demo vote recorded for ${contestantName}. ${json.freeVotesRemaining} free vote${json.freeVotesRemaining !== 1 ? 's' : ''} remaining today.`,
      );
    } catch {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePaidVote() {
    if (!isPaidAmountValid) return;
    if (!email || !name) {
      setErrorMsg('Email and name are required for paid votes');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      const headers = await authHeaders(true);
      const body: Record<string, unknown> = {
        contestId,
        contestantId,
        voterEmail: email,
        voterName: name,
        voterPhone: phone || undefined,
        shareCode,
      };

      if (selectedPackage !== 'custom') {
        body.packageId = selectedPackage;
      } else {
        body.customVoteQuantity = quantity;
      }

      const res = await fetch('/api/votes/paid/initiate', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.paymentReference) {
        setErrorMsg(json.error ?? 'Payment setup failed');
        return;
      }

      // Same workflow as the mobile card rail: the server already created this
      // transaction with Paystack's Initialize API, so the SDK must RESUME it
      // with the access code from authorizationUrl — never re-initialize it.
      // onSuccess is not proof of payment; the /verify call below is.
      const accessCode = extractPaystackAccessCode(json.authorizationUrl);
      if (!accessCode) {
        setErrorMsg('Could not start the secure payment. Please try again.');
        return;
      }

      setSubmitting(false);
      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();

      handler.resumeTransaction(accessCode, {
        onSuccess: async () => {
          setSubmitting(true);
          setErrorMsg('');
          try {
            const verifyRes = await fetch('/api/votes/paid/verify', {
              method: 'POST',
              headers: await authHeaders(true),
              body: JSON.stringify({
                transactionId: json.transactionId,
                paymentReference: json.paymentReference,
              }),
            });
            const verifyJson = await verifyRes.json().catch(() => ({}));
            if (!verifyRes.ok || verifyJson.success === false) {
              setErrorMsg(verifyJson.error ?? 'Payment verified but the vote failed to record.');
              return;
            }
            const credited = verifyJson.votesCredited ?? json.votesToCredit ?? quantity;
            // handleVoteSuccess closes the modal and refetches the contestant
            // lists, so the credited votes appear on their card immediately —
            // the web equivalent of the mobile app's voting-query invalidation.
            onVoteSuccess(
              `${credited} paid vote${credited !== 1 ? 's' : ''} cast for ${contestantName}. Thank you for your support!`,
            );
          } catch {
            setErrorMsg('Could not confirm your payment. Please contact support.');
          } finally {
            setSubmitting(false);
          }
        },
        onCancel: () => {
          setSubmitting(false);
        },
        onError: (err) => {
          setErrorMsg(err.message || 'Payment failed. Please try again.');
          setSubmitting(false);
        },
      });
    } catch {
      setErrorMsg('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handlePackageChange(value: string) {
    // Selecting a package makes quantity irrelevant — the server charges the
    // package's own votes/amount via packageId. Do NOT parse the option value
    // (a UUID) into quantity, or the 1–500 validity check breaks the CTA.
    setSelectedPackage(value);
  }

  function handleQuantityChange(value: number) {
    setSelectedPackage('custom');
    setQuantity(Math.max(1, Math.min(500, value)));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#170f20]/85 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#fff8f1] text-[#211827] w-full max-w-[525px] max-h-[calc(100dvh-26px)] border border-[#bfacc5] rounded-lg p-6 overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 bg-[#efe3f0] border border-[#d7c6db] rounded w-9 h-9 flex items-center justify-center text-xl text-[#211827] hover:bg-[#e3d1e8] transition-colors"
        >
          ×
        </button>

        {/* Header */}
        <div className="border-b border-[#d9cad7] pb-3 mb-4">
          <p className="text-[10px] font-bold tracking-widest text-[#744d7d] uppercase mb-2">
            SPOTLIGHT / VOTING BALLOT
          </p>
          <h2 className="text-4xl font-normal text-[#211827] mb-2" style={{ fontFamily: 'Georgia, serif', letterSpacing: '-0.02em' }}>
            Cast your vote.
          </h2>
          <p className="text-sm text-[#67556d]">
            <strong className="text-[#211827]">{contestantName}</strong>
            <span className="mx-2" aria-hidden="true">·</span>
            <span>{contestName}</span>
          </p>
        </div>

        {/* Vote Mode Selection */}
        <fieldset className="grid grid-cols-2 gap-2 border-0 p-0 my-4">
          <legend className="sr-only">Choose a voting method</legend>
          
          {/* Free Vote Option */}
          <label
            className={`flex items-center gap-2 p-3 border rounded cursor-pointer transition-all ${
              mode === 'free'
                ? 'bg-[#eee2ef] border-[#9566a2]'
                : 'border-[#d9cad7] hover:border-[#9464a0]'
            } ${cooldownRemaining > 0 ? 'opacity-60 cursor-default' : ''}`}
          >
            <input
              type="radio"
              name="mode"
              value="free"
              checked={mode === 'free'}
              onChange={() => setMode('free')}
              disabled={cooldownRemaining > 0}
              className="min-h-0 accent-[#542763]"
            />
            <div>
              <strong className="block text-sm font-bold">Free vote</strong>
              <small className="block text-[11px] text-[#67556d] font-medium">
                1 vote every 24 hours
              </small>
            </div>
          </label>

          {/* Paid Vote Option */}
          <label
            className={`flex items-center gap-2 p-3 border rounded cursor-pointer transition-all ${
              mode === 'paid'
                ? 'bg-[#eee2ef] border-[#9566a2]'
                : 'border-[#d9cad7] hover:border-[#9464a0]'
            }`}
          >
            <input
              type="radio"
              name="mode"
              value="paid"
              checked={mode === 'paid'}
              onChange={() => setMode('paid')}
              className="min-h-0 accent-[#542763]"
            />
            <div>
              <strong className="block text-sm font-bold">Paid votes</strong>
              <small className="block text-[11px] text-[#67556d] font-medium">
                Custom quantity or package
              </small>
            </div>
          </label>
        </fieldset>

        {/* Free Vote Note */}
        {mode === 'free' && (
          <p className="text-[13px] text-[#67556d] mb-3">
            {cooldownRemaining > 0
              ? `Next free vote in ${formatCooldown(cooldownRemaining)}.`
              : 'One free vote is available for this contest.'}
          </p>
        )}

        {/* Paid Options */}
        {mode === 'paid' && (
          <div className="space-y-2 mb-4">
            <p className="text-[13px] text-[#67556d] mb-2">
              {packages.length > 0 ? 'Select a package or enter custom quantity.' : 'Enter the number of votes you want to purchase.'}
            </p>

            {/* Package Selection */}
            {packages.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-[#211827] mb-1">
                  Voting package
                </label>
                <select
                  value={selectedPackage}
                  onChange={(e) => handlePackageChange(e.target.value)}
                  className="w-full p-2 border border-[#bdacc1] bg-white text-[#211827] min-h-[42px] rounded"
                >
                  <option value="custom">Custom quantity</option>
                  {packages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} - {pkg.votes + pkg.bonusVotes} votes · {FORMAT_NAIRA(pkg.amount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Quantity Input */}
            <div>
              <label className="block text-xs font-bold text-[#211827] mb-1">
                Number of votes
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
                min={1}
                max={500}
                disabled={selectedPackage !== 'custom'}
                className="w-full p-2 border border-[#bdacc1] rounded min-h-[42px] text-[#211827] bg-white disabled:bg-[#f5f0f3] disabled:text-[#9a8a9e]"
              />
            </div>

            {/* Voter Details */}
            <div className="space-y-2 pt-2">
              <div>
                <label className="block text-xs font-bold text-[#211827] mb-1">
                  Your Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full p-2 border border-[#bdacc1] rounded min-h-[42px] text-[#211827] bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#211827] mb-1">
                  Your Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full p-2 border border-[#bdacc1] rounded min-h-[42px] text-[#211827] bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#211827] mb-1">
                  Phone (optional)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+234 800 000 0000"
                  className="w-full p-2 border border-[#bdacc1] rounded min-h-[42px] text-[#211827] bg-white"
                />
              </div>
            </div>
          </div>
        )}

        {/* Vote Total */}
        <div className="flex items-center justify-between gap-3 p-3 bg-[#30203b] text-[#fff5ed] rounded my-4">
          <div>
            <small className="block text-xs">
              {mode === 'paid' && !isPaidAmountValid
                ? 'Enter 1–500 votes'
                : `${displayVotes} ${displayVotes === 1 ? 'vote' : 'votes'}`}
            </small>
            <strong className="block text-xl">
              {mode === 'paid'
                ? isPaidAmountValid
                  ? FORMAT_NAIRA(payAmountNgn)
                  : '—'
                : 'Free'}
            </strong>
          </div>
          <button
            type="button"
            onClick={mode === 'free' ? handleFreeVote : handlePaidVote}
            disabled={submitting || (mode === 'free' && cooldownRemaining > 0) || (mode === 'paid' && (!isPaidAmountValid || !email || !name))}
            className="!bg-[#f4ab81] hover:!bg-[#ffd0b2] !text-white !px-4 !py-2 font-bold rounded !text-sm transition-colors disabled:opacity-60 disabled:cursor-default"
          >
            {submitting
              ? 'Processing…'
              : mode === 'free'
              ? 'Cast free vote'
              : `Pay ${FORMAT_NAIRA(payAmountNgn)} to vote`}
          </button>
        </div>

        {/* Demo Notice */}
        <p className="text-[13px] text-[#67556d] mb-3">
          Votes are processed securely through Spotlight's voting system.
        </p>

        {/* Error Message */}
        {errorMsg && (
          <p className="text-[13px] text-red-600 bg-red-50 rounded p-3 mb-3" role="status">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
}
