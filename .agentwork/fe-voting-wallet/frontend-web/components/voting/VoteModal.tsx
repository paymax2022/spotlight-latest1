'use client';

import { useState } from 'react';
import { authHeaders } from '@/src/lib/auth/client';
import type { VotePackage, VotingSettings } from '@/src/features/voting/types';
import { FORMAT_NAIRA } from '@/src/features/voting/constants';

interface Props {
  contestId: string;
  contestantId: string;
  contestantName: string;
  packages: VotePackage[];
  settings: VotingSettings;
  freeVotesRemaining: number;
  shareCode?: string;
  onClose: () => void;
  onVoteSuccess: (message: string) => void;
}

type Step = 'choose' | 'pay_details' | 'processing' | 'done' | 'error';

export default function VoteModal({
  contestId,
  contestantId,
  contestantName,
  packages,
  settings,
  freeVotesRemaining,
  shareCode,
  onClose,
  onVoteSuccess,
}: Props) {
  const [step, setStep] = useState<Step>('choose');
  const [selectedPackage, setSelectedPackage] = useState<VotePackage | null>(null);
  const [customQty, setCustomQty] = useState(1);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  async function castFreeVote() {
    setStep('processing');
    try {
      const headers = await authHeaders(true);
      const res = await fetch('/api/votes/free', {
        method: 'POST',
        headers,
        body: JSON.stringify({ contestId, contestantId, voteQuantity: 1, shareCode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMsg(json.error ?? 'Vote failed. Please try again.');
        setStep('error');
        return;
      }
      onVoteSuccess(
        `Your vote has been counted! You have ${json.freeVotesRemaining} free vote${json.freeVotesRemaining !== 1 ? 's' : ''} remaining today.`,
      );
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStep('error');
    }
  }

  async function initiatePaidVote() {
    if (!email || !name) {
      setErrorMsg('Email and name are required for paid votes');
      return;
    }
    setStep('processing');
    try {
      const headers = await authHeaders(true);
      const body: Record<string, unknown> = {
        contestId,
        contestantId,
        voterEmail: email,
        voterName: name,
        voterPhone: phone || undefined,
        shareCode,
        callbackUrl: `${window.location.origin}/vote-callback`,
      };

      if (selectedPackage) {
        body.packageId = selectedPackage.id;
      } else {
        body.customVoteQuantity = customQty;
      }

      const res = await fetch('/api/votes/paid/initiate', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.authorizationUrl) {
        setErrorMsg(json.error ?? 'Payment setup failed');
        setStep('error');
        return;
      }
      // Redirect to Paystack
      window.location.href = json.authorizationUrl;
    } catch {
      setErrorMsg('Network error. Please try again.');
      setStep('error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-gray-900 rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">Vote for {contestantName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {step === 'choose' && (
          <>
            {/* Free votes */}
            {settings.freeVotingEnabled && freeVotesRemaining > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between bg-green-600/10 border border-green-500/30 rounded-xl p-4">
                  <div>
                    <p className="text-green-400 font-semibold text-sm">Free Votes Available</p>
                    <p className="text-white text-xl font-bold">{freeVotesRemaining} remaining today</p>
                  </div>
                  <button
                    onClick={castFreeVote}
                    className="bg-green-500 hover:bg-green-400 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
                  >
                    Use 1 Free Vote
                  </button>
                </div>
              </div>
            )}

            {settings.freeVotingEnabled && freeVotesRemaining === 0 && (
              <div className="mb-4 bg-gray-800 rounded-xl p-4 text-sm text-gray-400">
                You have used all free votes for today. Buy votes to keep supporting {contestantName}.
              </div>
            )}

            {/* Paid packages */}
            {settings.paidVotingEnabled && packages.length > 0 && (
              <div>
                <p className="text-sm text-gray-400 font-medium mb-3">Buy Votes</p>
                <div className="space-y-2">
                  {packages.map((pkg) => (
                    <button
                      key={pkg.id}
                      onClick={() => { setSelectedPackage(pkg); setStep('pay_details'); }}
                      className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl border transition-all text-left
                        ${pkg.isRecommended ? 'border-amber-500 bg-amber-500/10' : 'border-gray-700 hover:border-gray-500 bg-gray-800'}`}
                    >
                      <div>
                        <span className="text-white font-semibold">{pkg.name}</span>
                        {pkg.isRecommended && (
                          <span className="ml-2 text-xs bg-amber-500 text-black px-2 py-0.5 rounded-full">Popular</span>
                        )}
                        {pkg.promoLabel && (
                          <span className="ml-2 text-xs bg-green-600 text-white px-2 py-0.5 rounded-full">{pkg.promoLabel}</span>
                        )}
                        <p className="text-gray-400 text-sm mt-0.5">
                          {pkg.votes} votes{pkg.bonusVotes > 0 ? ` + ${pkg.bonusVotes} bonus` : ''}
                        </p>
                      </div>
                      <span className="text-amber-400 font-bold">{FORMAT_NAIRA(pkg.amount)}</span>
                    </button>
                  ))}
                </div>

                {settings.allowCustomVoteQuantity && (
                  <div className="mt-3">
                    <label className="text-sm text-gray-400 block mb-1">Custom amount</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={settings.minPaidVotes}
                        max={settings.maxPaidVotesPerTxn}
                        value={customQty}
                        onChange={(e) => setCustomQty(Math.max(1, Number(e.target.value)))}
                        className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm"
                        placeholder="Enter vote quantity"
                      />
                      <button
                        onClick={() => { setSelectedPackage(null); setStep('pay_details'); }}
                        className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm"
                      >
                        Buy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {step === 'pay_details' && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-4 text-sm">
              {selectedPackage ? (
                <p className="text-white">
                  <span className="text-amber-400 font-bold">{selectedPackage.name}</span>
                  {' — '}
                  {selectedPackage.votes + selectedPackage.bonusVotes} votes for{' '}
                  <span className="font-bold">{FORMAT_NAIRA(selectedPackage.amount)}</span>
                </p>
              ) : (
                <p className="text-white">Custom: {customQty} votes</p>
              )}
            </div>

            <div>
              <label className="text-sm text-gray-400 block mb-1">Your Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Your Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">Phone (optional)</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+234 800 000 0000"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm"
              />
            </div>

            {errorMsg && <p className="text-red-400 text-sm">{errorMsg}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('choose'); setErrorMsg(''); }}
                className="flex-1 border border-gray-700 text-gray-300 py-3 rounded-xl text-sm"
              >
                Back
              </button>
              <button
                onClick={initiatePaidVote}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-xl text-sm"
              >
                Pay & Vote
              </button>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="text-center py-8">
            <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-300">Processing…</p>
          </div>
        )}

        {step === 'error' && (
          <div className="text-center py-6">
            <p className="text-red-400 text-lg font-semibold mb-2">Something went wrong</p>
            <p className="text-gray-400 text-sm mb-4">{errorMsg}</p>
            <button
              onClick={() => setStep('choose')}
              className="bg-amber-500 text-black font-bold px-6 py-2.5 rounded-xl text-sm"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
