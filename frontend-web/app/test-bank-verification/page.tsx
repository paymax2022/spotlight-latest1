'use client';

import { useState } from 'react';
import { BankAccountVerification } from '@/components/bank-account/BankAccountVerification';

const BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '050', name: 'Ecobank' },
  { code: '011', name: 'First Bank' },
  { code: '058', name: 'Gtbank' },
];

export default function TestBankVerificationPage() {
  const [bankCode, setBankCode] = useState('044');
  const [bankName, setBankName] = useState('Access Bank');
  const [accountNumber, setAccountNumber] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [verifiedName, setVerifiedName] = useState('');

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem' }}>
        🏦 Bank Account Verification Test
      </h1>

      <div style={{
        background: '#f9fafb',
        padding: '1.5rem',
        borderRadius: '0.5rem',
        marginBottom: '2rem'
      }}>
        <p style={{ marginBottom: '1rem', color: '#666' }}>
          Test the bank account verification component. Enter a bank code and account number, then click "Verify account".
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Bank
          </label>
          <select
            value={bankCode}
            onChange={(e) => {
              const selected = BANKS.find(b => b.code === e.target.value);
              if (selected) {
                setBankCode(selected.code);
                setBankName(selected.name);
              }
            }}
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ddd',
              borderRadius: '0.375rem',
              fontSize: '1rem'
            }}
          >
            {BANKS.map(bank => (
              <option key={bank.code} value={bank.code}>
                {bank.name} ({bank.code})
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
            Account Number (10 digits)
          </label>
          <input
            type="text"
            maxLength={10}
            value={accountNumber}
            onChange={(e) => {
              const value = e.target.value.replace(/[^0-9]/g, '');
              setAccountNumber(value);
              setIsVerified(false);
              setVerifiedName('');
            }}
            placeholder="e.g., 0123456789"
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ddd',
              borderRadius: '0.375rem',
              fontSize: '1rem',
              fontFamily: 'monospace'
            }}
          />
          <small style={{ color: '#666', marginTop: '0.25rem', display: 'block' }}>
            {accountNumber.length}/10 digits
          </small>
        </div>

        <BankAccountVerification
          bankCode={bankCode}
          accountNumber={accountNumber}
          bankName={bankName}
          disabled={accountNumber.length !== 10}
          onVerificationComplete={(result) => {
            setIsVerified(result.is_verified);
            setVerifiedName(result.account_name);
            alert(`✅ Verification successful!\n\nAccount: ${result.account_name}\nBank: ${result.bank_name}`);
          }}
        />
      </div>

      <div style={{
        background: '#e0f2fe',
        border: '1px solid #0284c7',
        padding: '1rem',
        borderRadius: '0.5rem',
        marginBottom: '2rem'
      }}>
        <h3 style={{ margin: '0 0 0.5rem 0', color: '#0284c7' }}>💡 Testing Tips</h3>
        <ul style={{ margin: '0', paddingLeft: '1.5rem', color: '#0284c7' }}>
          <li>Try with a <strong>valid test account</strong> from Paystack docs</li>
          <li>Invalid accounts will show error: "Could not verify account"</li>
          <li>The component shows the verified account name from Paystack</li>
          <li>If backend is down, you'll see "Internal server error"</li>
          <li>Successfully verified accounts show a green ✓ badge</li>
        </ul>
      </div>

      <div style={{
        background: '#f0fdf4',
        border: '1px solid #16a34a',
        padding: '1rem',
        borderRadius: '0.5rem'
      }}>
        <h3 style={{ margin: '0 0 0.5rem 0', color: '#16a34a' }}>✅ Component Features</h3>
        <ul style={{ margin: '0', paddingLeft: '1.5rem', color: '#16a34a' }}>
          <li>Real-time verification against Paystack API</li>
          <li>Graceful error handling with user-friendly messages</li>
          <li>Shows verified account name and details</li>
          <li>Loading state while verifying</li>
          <li>Re-verification support</li>
          <li>Disable button when form incomplete</li>
        </ul>
      </div>

      {isVerified && (
        <div style={{
          marginTop: '2rem',
          padding: '1rem',
          background: '#f0fdf4',
          border: '2px solid #16a34a',
          borderRadius: '0.5rem'
        }}>
          <p style={{ margin: 0, color: '#16a34a', fontWeight: 'bold' }}>
            ✅ Verified: {verifiedName}
          </p>
        </div>
      )}
    </div>
  );
}
