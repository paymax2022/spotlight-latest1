'use client';

import { useState } from 'react';
import { CheckCircle2, AlertCircle, Loader } from 'lucide-react';

export interface VerificationResult {
  is_verified: boolean;
  account_name: string;
  bank_name: string;
  bank_code: string;
  account_number_masked: string;
}

export interface BankAccountVerificationProps {
  bankCode: string;
  accountNumber: string;
  bankName?: string;
  onVerificationComplete?: (result: VerificationResult) => void;
  disabled?: boolean;
}

export function BankAccountVerification({
  bankCode,
  accountNumber,
  bankName,
  onVerificationComplete,
  disabled = false,
}: BankAccountVerificationProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canVerify = bankCode && accountNumber?.length === 10 && !disabled;

  const handleVerify = async () => {
    if (!canVerify) return;

    setIsVerifying(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/v1/restaurant/bank-accounts/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_code: bankCode,
          account_number: accountNumber,
          bank_name: bankName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Verification failed');
      }

      const data = await response.json();
      setResult(data);
      onVerificationComplete?.(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not verify account. Check details and try again.';
      setError(message);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="space-y-3 mt-3">
      <button
        onClick={handleVerify}
        disabled={!canVerify || isVerifying}
        className={`w-full px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
          !canVerify || isVerifying
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        {isVerifying ? (
          <span className="flex items-center justify-center gap-2">
            <Loader size={16} className="animate-spin" />
            Verifying...
          </span>
        ) : result ? (
          'Re-verify account'
        ) : (
          'Verify account'
        )}
      </button>

      {error && (
        <div className="flex gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="border border-green-200 rounded-lg p-4 bg-green-50">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 size={18} className="text-green-600" />
            <p className="font-medium text-green-900">Account verified</p>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Account name:</span>
              <span className="font-medium text-gray-900">{result.account_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Bank:</span>
              <span className="font-medium text-gray-900">{result.bank_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Account:</span>
              <span className="font-medium text-gray-900">{result.account_number_masked}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
