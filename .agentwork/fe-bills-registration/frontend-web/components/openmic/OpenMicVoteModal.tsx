'use client';

import { useState } from 'react';
import { authHeaders } from '@/src/lib/auth/client';
import { loadPaystackClient } from '@/src/lib/payments/paystack-client';

interface Props {
  contestId: string;
  submissionId: string;
  stageName: string;
  songTitle: string;
  votePriceNgn: number;
  freeVoting: boolean;
  paidVoting: boolean;
  onClose: () => void;
  onSuccess: (newCount?: number) => void;
}

type Step = 'choose' | 'processing' | 'awaiting_payment' | 'done' | 'error';

export default function OpenMicVoteModal({
  contestId,
  submissionId,
  stageName,
  songTitle,
  votePriceNgn,
  freeVoting,
  paidVoting,
  onClose,
  onSuccess,
}: Props) {
  const [step, setStep]         = useState<Step>('choose');
  const [paidQty, setPaidQty]   = useState(1);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  /* ── Free vote ───────────────────────────────────────────────────────── */
  async function castFreeVote() {
    setStep('processing');
    setErrorMsg('');
    try {
      const res = await fetch('/api/open-mic/votes', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({ contestId, submissionId, source: 'free', votes: 1 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) throw new Error(json?.error || 'Vote failed.');
      setSuccessMsg(`Your free vote for ${stageName} has been counted!`);
      setStep('done');
      onSuccess(json?.newCount);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Vote failed. Please try again.');
      setStep('error');
    }
  }

  /* ── Paid vote — Paystack popup flow ─────────────────────────────────── */
  async function initiatePaidVote() {
    setStep('processing');
    setErrorMsg('');
    try {
      // 1. Ask server for a reference + amount
      const initRes = await fetch('/api/open-mic/votes/pay/initiate', {
        method: 'POST',
        headers: await authHeaders(true),
        body: JSON.stringify({ contestId, submissionId, stageName, votes: paidQty, votePriceNgn }),
      });
      const init = await initRes.json().catch(() => ({}));
      if (!initRes.ok || !init.reference) throw new Error(init?.error || 'Could not start payment.');

      const { reference, amountKobo, email, publicKey } = init;

      if (!publicKey || publicKey.includes('placeholder')) {
        throw new Error('Payment gateway is not configured. Please contact support.');
      }

      // 2. Load Paystack inline SDK and open popup
      setStep('awaiting_payment');
      const PaystackPop = await loadPaystackClient();
      const handler = new PaystackPop();

      handler.newTransaction({
        key: publicKey,
        email,
        amount: amountKobo,
        currency: 'NGN',
        metadata: {
          custom_fields: [
            { display_name: 'Artist', variable_name: 'stage_name', value: stageName },
            { display_name: 'Votes', variable_name: 'votes', value: String(paidQty) },
          ],
        },
        onSuccess: async (transaction) => {
          setStep('processing');
          try {
            // 3. Verify payment server-side and cast vote
            const verifyRes = await fetch('/api/open-mic/votes/pay/verify', {
              method: 'POST',
              headers: await authHeaders(true),
              body: JSON.stringify({
                reference: transaction.reference,
                contestId,
                submissionId,
                votes: paidQty,
              }),
            });
            const verifyJson = await verifyRes.json().catch(() => ({}));
            if (!verifyRes.ok || verifyJson?.success === false) {
              throw new Error(verifyJson?.error || 'Payment verified but vote failed.');
            }
            setSuccessMsg(`${paidQty} vote${paidQty !== 1 ? 's' : ''} cast for ${stageName}!`);
            setStep('done');
            onSuccess(verifyJson?.newCount);
          } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Vote failed after payment.');
            setStep('error');
          }
        },
        onCancel: () => {
          setStep('choose');
        },
        onError: (err) => {
          setErrorMsg(err.message || 'Payment failed. Please try again.');
          setStep('error');
        },
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment initiation failed.');
      setStep('error');
    }
  }

  /* ── UI ──────────────────────────────────────────────────────────────── */
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'linear-gradient(160deg,#1a1140 0%,#0f0d1a 100%)',
        border: '1px solid rgba(245,158,11,0.3)',
        borderRadius: 20, padding: '2rem', width: '100%', maxWidth: 420,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        animation: 'modalIn 0.25s ease',
      }}>
        <style>{`
          @keyframes modalIn{from{transform:scale(0.92) translateY(12px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
          @keyframes spin{to{transform:rotate(360deg)}}
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, color: 'rgba(245,158,11,0.8)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Casting your vote</p>
            <h2 style={{ color: '#fff', fontWeight: 800, fontSize: 20, marginBottom: 2, lineHeight: 1.2 }}>{stageName}</h2>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>🎵 {songTitle}</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 8, width: 32, height: 32, color: 'rgba(255,255,255,0.5)', fontSize: 18, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >×</button>
        </div>

        {/* ── Choose ─────────────────────────────────────────────── */}
        {step === 'choose' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {freeVoting && (
              <button
                onClick={castFreeVote}
                style={{
                  width: '100%', padding: '14px', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg,#f59e0b,#d97706)',
                  color: '#000', fontWeight: 800, fontSize: 15, cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(245,158,11,0.35)', transition: 'transform 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = 'none')}
              >
                👍 Cast Free Vote
              </button>
            )}

            {paidVoting && (
              <div style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 14, padding: 16 }}>
                <p style={{ color: '#a5b4fc', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>💳 Buy Extra Votes</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <button onClick={() => setPaidQty((q) => Math.max(1, q - 1))}
                    style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>−</button>
                  <span style={{ color: '#fff', fontWeight: 800, fontSize: 20, minWidth: 32, textAlign: 'center' }}>{paidQty}</span>
                  <button onClick={() => setPaidQty((q) => q + 1)}
                    style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}>+</button>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>× ₦{votePriceNgn.toLocaleString()} each</span>
                </div>
                <button
                  onClick={initiatePaidVote}
                  style={{
                    width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                    background: 'linear-gradient(135deg,#6366f1,#4f46e5)',
                    color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  Pay ₦{(paidQty * votePriceNgn).toLocaleString()} · {paidQty} vote{paidQty !== 1 ? 's' : ''}
                </button>
              </div>
            )}

            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, textAlign: 'center', marginTop: 4 }}>
              Free votes reset daily at midnight · Paid votes have no daily limit
            </p>
          </div>
        )}

        {/* ── Processing ─────────────────────────────────────────── */}
        {(step === 'processing') && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12, animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>⏳</div>
            <p style={{ color: 'rgba(255,255,255,0.6)' }}>Processing…</p>
          </div>
        )}

        {/* ── Awaiting Paystack popup ─────────────────────────────── */}
        {step === 'awaiting_payment' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💳</div>
            <p style={{ color: '#a5b4fc', fontWeight: 700, marginBottom: 6 }}>Complete payment in the popup</p>
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              A Paystack payment window has opened. Complete your payment there to cast your votes.
            </p>
          </div>
        )}

        {/* ── Done ───────────────────────────────────────────────── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🎉</div>
            <h3 style={{ color: '#fff', fontWeight: 800, marginBottom: 8 }}>Vote Counted!</h3>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 20 }}>{successMsg}</p>
            <button onClick={onClose} style={{
              background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: '#000',
              fontWeight: 700, fontSize: 14, padding: '10px 28px', borderRadius: 10, border: 'none', cursor: 'pointer',
            }}>Done</button>
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────── */}
        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <p style={{ color: '#fca5a5', fontSize: 14, marginBottom: 16 }}>{errorMsg}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setStep('choose')} style={{
                background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff', fontWeight: 600, fontSize: 13, padding: '8px 20px', borderRadius: 8, cursor: 'pointer',
              }}>Try again</button>
              <button onClick={onClose} style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.4)', fontSize: 13, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              }}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
