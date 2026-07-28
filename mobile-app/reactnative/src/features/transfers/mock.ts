/**
 * Offline mock data + handlers for the transfers feature.
 *
 * Active when EXPO_PUBLIC_TRANSFERS_USE_MOCK !== 'false' (default true), so the
 * whole flow — bank list, account resolve, PIN, and all three transfer types —
 * runs standalone with no backend. Never returns provider secrets.
 */
import type {
  Bank,
  ResolvedAccount,
  TransferReceiptData,
  WalletBankTransferInput,
  BankToBankTransferInput,
} from './types';

const delay = (ms = 650) => new Promise<void>((r) => setTimeout(r, ms));

// ── Mock PIN store — persisted on web so it survives a page refresh ──────────
// Dev-only: the real backend owns the PIN. On web we stash it in localStorage
// (guarded) so the app-wide transaction-PIN gate doesn't re-prompt after every
// reload; on native (no localStorage) it stays in-memory for the session.
const PIN_STORAGE_KEY = 'paymax_mock_txn_pin';
function loadStoredPin(): string | null {
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    return ls?.getItem(PIN_STORAGE_KEY) ?? null;
  } catch { return null; }
}
function saveStoredPin(pin: string | null): void {
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    if (!ls) return;
    if (pin === null) ls.removeItem(PIN_STORAGE_KEY);
    else ls.setItem(PIN_STORAGE_KEY, pin);
  } catch { /* storage unavailable — stays in-memory */ }
}

/** PIN store for the mock — seeded from persisted storage on load. */
let MOCK_PIN: string | null = loadStoredPin();

export const MOCK_BANKS: Bank[] = [
  { code: '044', name: 'Access Bank', slug: 'access-bank' },
  { code: '063', name: 'Access Bank (Diamond)', slug: 'access-bank-diamond' },
  { code: '035A', name: 'ALAT by Wema', slug: 'alat-by-wema' },
  { code: '401', name: 'ASO Savings & Loans', slug: 'aso-savings' },
  { code: '50931', name: 'Bowen Microfinance Bank', slug: 'bowen-mfb' },
  { code: '50823', name: 'Carbon', slug: 'carbon' },
  { code: '023', name: 'Citibank Nigeria', slug: 'citibank' },
  { code: '050', name: 'Ecobank Nigeria', slug: 'ecobank' },
  { code: '084', name: 'Enterprise Bank', slug: 'enterprise-bank' },
  { code: '070', name: 'Fidelity Bank', slug: 'fidelity-bank' },
  { code: '011', name: 'First Bank of Nigeria', slug: 'first-bank' },
  { code: '214', name: 'First City Monument Bank', slug: 'fcmb' },
  { code: '00103', name: 'Globus Bank', slug: 'globus-bank' },
  { code: '058', name: 'Guaranty Trust Bank', slug: 'gtbank' },
  { code: '50383', name: 'Hasal Microfinance Bank', slug: 'hasal-mfb' },
  { code: '030', name: 'Heritage Bank', slug: 'heritage-bank' },
  { code: '301', name: 'Jaiz Bank', slug: 'jaiz-bank' },
  { code: '082', name: 'Keystone Bank', slug: 'keystone-bank' },
  { code: '50211', name: 'Kuda Bank', slug: 'kuda-bank' },
  { code: '565', name: 'Carbon (One Finance)', slug: 'one-finance' },
  { code: '526', name: 'Parallex Bank', slug: 'parallex-bank' },
  { code: '076', name: 'Polaris Bank', slug: 'polaris-bank' },
  { code: '101', name: 'Providus Bank', slug: 'providus-bank' },
  { code: '221', name: 'Stanbic IBTC Bank', slug: 'stanbic-ibtc' },
  { code: '068', name: 'Standard Chartered Bank', slug: 'standard-chartered' },
  { code: '232', name: 'Sterling Bank', slug: 'sterling-bank' },
  { code: '100', name: 'SunTrust Bank', slug: 'suntrust-bank' },
  { code: '102', name: 'Titan Trust Bank', slug: 'titan-trust' },
  { code: '032', name: 'Union Bank of Nigeria', slug: 'union-bank' },
  { code: '033', name: 'United Bank For Africa', slug: 'uba' },
  { code: '215', name: 'Unity Bank', slug: 'unity-bank' },
  { code: '566', name: 'VFD Microfinance Bank', slug: 'vfd-mfb' },
  { code: '035', name: 'Wema Bank', slug: 'wema-bank' },
  { code: '057', name: 'Zenith Bank', slug: 'zenith-bank' },
];

const NAME_POOL = [
  'ADAOBI N OKAFOR',
  'TUNDE BABATUNDE ADEYEMI',
  'CHIAMAKA G OKONKWO',
  'IBRAHIM MUSA BELLO',
  'FOLAKEMI A OGUNLEYE',
  'EMEKA J NWOSU',
  'AISHA YUSUF DANJUMA',
  'OLUWASEUN P ADEBAYO',
];

/** Deterministic name from an account number so the same number resolves stably. */
function mockNameFor(accountNumber: string): string {
  const sum = accountNumber.split('').reduce((acc, c) => acc + (Number(c) || 0), 0);
  return NAME_POOL[sum % NAME_POOL.length];
}

function bankName(code: string): string {
  return MOCK_BANKS.find((b) => b.code === code)?.name ?? 'Bank';
}

function mockRef(): string {
  return `PMX${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export const transfersMock = {
  async fetchBanks(): Promise<Bank[]> {
    await delay(300);
    return MOCK_BANKS;
  },

  async resolveAccount(bankCode: string, accountNumber: string): Promise<ResolvedAccount> {
    await delay();
    if (!/^\d{10}$/.test(accountNumber)) {
      throw new Error('Account number must be exactly 10 digits.');
    }
    // A couple of numbers fail on purpose to exercise the error path.
    if (accountNumber.endsWith('0000')) {
      throw new Error('Could not resolve account name. Check the number and bank.');
    }
    return {
      accountName: mockNameFor(accountNumber),
      accountNumber,
      bankCode,
    };
  },

  async getPinStatus(): Promise<{ hasPin: boolean }> {
    await delay(200);
    return { hasPin: MOCK_PIN !== null };
  },

  async createPin(pin: string): Promise<void> {
    await delay(400);
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits.');
    MOCK_PIN = pin;
    saveStoredPin(pin);
  },

  async verifyPin(pin: string): Promise<void> {
    await delay(400);
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your 4-digit PIN.');
    if (MOCK_PIN === null) {
      // First-run convenience: treat first valid 4-digit PIN as the new PIN.
      MOCK_PIN = pin;
      saveStoredPin(pin);
      return;
    }
    if (pin !== MOCK_PIN) throw new Error('Incorrect PIN. Please try again.');
  },

  async walletToBank(input: WalletBankTransferInput): Promise<TransferReceiptData> {
    await delay();
    await this.verifyPin(input.pin);
    const fee = input.amountKobo > 5_000_000 ? 5_000 : input.amountKobo > 500_000 ? 2_500 : 1_000;
    return {
      reference: mockRef(),
      amountKobo: input.amountKobo,
      feeKobo: fee,
      totalKobo: input.amountKobo + fee,
      destinationName: input.accountName,
      destinationDetail: `${input.bankName} • •••• ${input.accountNumber.slice(-4)}`,
      sourceLabel: 'Wallet',
      status: 'successful',
      createdAt: new Date().toISOString(),
    };
  },

  async bankToBank(input: BankToBankTransferInput): Promise<TransferReceiptData> {
    await delay(800);
    await this.verifyPin(input.pin);
    const fee = input.amountKobo > 5_000_000 ? 7_500 : input.amountKobo > 500_000 ? 5_000 : 2_500;
    return {
      reference: mockRef(),
      amountKobo: input.amountKobo,
      feeKobo: fee,
      totalKobo: input.amountKobo + fee,
      destinationName: input.destination.accountName,
      destinationDetail: `${input.destination.bankName} • •••• ${input.destination.accountNumber.slice(-4)}`,
      sourceLabel: `${input.source.bankName} • •••• ${input.source.accountNumber.slice(-4)}`,
      status: 'processing',
      createdAt: new Date().toISOString(),
      provider: 'Paystack',
    };
  },

  /** Helper for the bank-name lookup used by callers building receipts. */
  bankName,
};
